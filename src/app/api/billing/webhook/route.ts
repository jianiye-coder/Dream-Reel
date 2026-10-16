import { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import {
  findUserIdForStripeCustomer,
  otherPlusSubscriptionIds,
  processStripeEvent,
  upsertStripeSubscription,
  userExists,
} from "@/lib/billing";
import { errorJson, parseUserId, privateJson } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import {
  billsPlusPrice,
  invoicePayment,
  retrieveSubscription,
  StripeApiError,
  stripeId,
  STRIPE_WEBHOOK_EVENTS,
  stripeRequest,
  subscriptionPeriod,
  verifyStripeSignature,
  type StripeSubscription,
} from "@/lib/stripe";

export const runtime = "nodejs";

type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  data?: { object?: Record<string, unknown> & { id?: string; metadata?: Record<string, string> } };
};

class SkipEvent extends Error {}

/**
 * Stripe does not deliver events in order, so the event only says *which* subscription changed;
 * its current state is read back from the API. `deleted` is final and is taken as sent.
 */
async function currentSubscription(id: string): Promise<StripeSubscription> {
  try {
    return await retrieveSubscription(id);
  } catch (error) {
    // a subscription this account can't see (wrong mode, another account) will never appear
    if (error instanceof StripeApiError && error.status === 404) throw new SkipEvent("subscription not found");
    throw error;
  }
}

/** One handler per subscription at a time: the next one reads Stripe only after this one commits. */
async function lockSubscription(id: string, client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('stripe-subscription'), hashtext($1))", [id]);
}

/** One reader at a time, so two subscriptions completing together still see each other. */
async function lockUser(userId: number, client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('stripe-user'), $1)", [userId]);
}

const GRANTING_STATUSES = new Set(["active", "trialing"]);
const grantsPlus = (subscription: StripeSubscription) =>
  GRANTING_STATUSES.has(subscription.status) && billsPlusPrice(subscription);

async function writeSubscription(subscription: StripeSubscription, userId: number, client: PoolClient, customerId?: string | null) {
  const period = subscriptionPeriod(subscription);
  // only a subscription to one of the configured Plus prices is Plus; anything else is
  // recorded (so the customer stays linked) but grants nothing
  const plus = billsPlusPrice(subscription);
  if (!plus && GRANTING_STATUSES.has(subscription.status)) {
    console.warn("[billing] subscription without a Plus price", { subscription: subscription.id });
  }
  await upsertStripeSubscription({
    userId,
    customerId: customerId ?? stripeId(subscription.customer),
    subscriptionId: subscription.id,
    status: subscription.status || "incomplete",
    plan: plus ? "plus" : "free",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
  }, client);
}

/** The subscription Stripe created first; ids break a tie. */
function isOlder(a: StripeSubscription, b: StripeSubscription) {
  if (a.created !== undefined && b.created !== undefined && a.created !== b.created) return a.created < b.created;
  return a.id < b.id;
}

/**
 * Two Checkout pages left open (two tabs, sessions last 24 h) can both be paid. The reader keeps
 * the older subscription; the newer one is refunded and cancelled at once. Refund first: if
 * cancelling then fails, Stripe's retry finds the subscription still active and finishes the job,
 * and the idempotency keys make every step safe to repeat.
 */
async function dropDuplicate(drop: StripeSubscription, keep: StripeSubscription) {
  const invoiceId = stripeId(drop.latest_invoice);
  const payment = invoiceId ? await invoicePayment(invoiceId) : null;
  if (payment) {
    const params = new URLSearchParams({
      [payment[0]]: payment[1],
      reason: "duplicate",
      "metadata[reason]": "duplicate_plus_subscription",
      "metadata[subscription]": drop.id,
    });
    try {
      await stripeRequest("POST", "/refunds", params, { idempotencyKey: `dreamreel-duplicate-refund-${drop.id}` });
    } catch (error) {
      if (!(error instanceof StripeApiError && error.code === "charge_already_refunded")) throw error;
    }
  }
  try {
    await stripeRequest("DELETE", `/subscriptions/${encodeURIComponent(drop.id)}`, undefined, { idempotencyKey: `dreamreel-duplicate-cancel-${drop.id}` });
  } catch (error) {
    // already cancelled is fine; anything else is retried by Stripe
    const now = await retrieveSubscription(drop.id).catch(() => null);
    if (now?.status !== "canceled") throw error;
  }
  console.warn("[billing] cancelled a duplicate Plus subscription", { kept: keep.id, cancelled: drop.id, refunded: Boolean(payment) });
}

async function saveSubscription(subscription: StripeSubscription, userId: number, client: PoolClient, customerId?: string | null) {
  await lockUser(userId, client);
  await writeSubscription(subscription, userId, client, customerId);
  if (!grantsPlus(subscription)) return;

  for (const otherId of await otherPlusSubscriptionIds(userId, subscription.id, client)) {
    let other: StripeSubscription;
    try {
      other = await currentSubscription(otherId);
    } catch (error) {
      if (error instanceof SkipEvent) continue;
      throw error;
    }
    if (!grantsPlus(other)) {
      // the database was behind; bring it up to date
      await writeSubscription(other, userId, client);
      continue;
    }
    const [keep, drop] = isOlder(other, subscription) ? [other, subscription] : [subscription, other];
    await dropDuplicate(drop, keep);
    await writeSubscription({ ...drop, status: "canceled" }, userId, client);
    if (drop.id === subscription.id) return;
  }
}

async function handleCheckoutCompleted(object: Record<string, unknown> & { metadata?: Record<string, string> }, client: PoolClient) {
  if (object.mode !== "subscription") return;
  const userId = parseUserId(object.client_reference_id) ?? parseUserId(object.metadata?.user_id);
  const subscriptionId = stripeId(object.subscription);
  if (!userId || !subscriptionId) return;
  if (!(await userExists(userId, client))) return;

  await lockSubscription(subscriptionId, client);
  const subscription = await currentSubscription(subscriptionId);
  await saveSubscription(subscription, userId, client, stripeId(object.customer));
}

async function handleSubscriptionEvent(event: StripeEvent, client: PoolClient) {
  const sent = event.data?.object as StripeSubscription | undefined;
  if (!sent?.id) return;
  await lockSubscription(sent.id, client);
  const subscription = event.type === "customer.subscription.deleted"
    ? { ...sent, status: "canceled" }
    : await currentSubscription(sent.id);

  const customerId = stripeId(subscription.customer);
  const metadataUser = parseUserId(subscription.metadata?.user_id);
  const userId = metadataUser && (await userExists(metadataUser, client))
    ? metadataUser
    : customerId
      ? await findUserIdForStripeCustomer(customerId, subscription.id, client)
      : null;
  // not ours yet: checkout.session.completed links it when it arrives
  if (!userId) return;

  await saveSubscription(subscription, userId, client);
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return errorJson(API_ERROR_CODES.configurationError, 503);

  // the signature covers the exact bytes Stripe sent, so read them before any parsing
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
    return errorJson(API_ERROR_CODES.invalidRequest, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as StripeEvent;
  } catch {
    return errorJson(API_ERROR_CODES.invalidRequest, 400);
  }
  if (typeof event?.id !== "string" || !event.id || typeof event.type !== "string") {
    return errorJson(API_ERROR_CODES.invalidRequest, 400);
  }
  if (!STRIPE_WEBHOOK_EVENTS.has(event.type)) return privateJson({ received: true, ignored: true });

  try {
    const result = await processStripeEvent(
      {
        id: event.id,
        type: event.type,
        // keep an audit trail without copying customer names, emails or addresses
        payload: { id: event.id, type: event.type, created: event.created, livemode: event.livemode, object: event.data?.object?.id },
      },
      async (client) => {
        const object = event.data?.object;
        if (!object) return;
        try {
          if (event.type === "checkout.session.completed") await handleCheckoutCompleted(object, client);
          else await handleSubscriptionEvent(event, client);
        } catch (error) {
          if (!(error instanceof SkipEvent)) throw error;
        }
      },
    );
    return privateJson(result === "duplicate" ? { received: true, duplicate: true } : { received: true });
  } catch (error) {
    // a non-2xx makes Stripe retry; the event id is only recorded once handling commits
    console.error("[billing] webhook failed", {
      type: event.type,
      ...safeErrorMetadata(error),
      ...(error instanceof StripeApiError ? { status: error.status, stripeCode: error.code, stripeParam: error.param } : {}),
    });
    return errorJson(API_ERROR_CODES.internalError, 500);
  }
}
