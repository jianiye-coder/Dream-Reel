import { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import {
  findUserIdForStripeCustomer,
  otherPlusSubscriptionIds,
  processStripeEvent,
  recordManualAction,
  upsertStripeSubscription,
  userExists,
} from "@/lib/billing";
import { errorJson, parseUserId, privateJson } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import {
  billsPlusPrice,
  invoiceForRefund,
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

/**
 * Which of two Plus subscriptions the reader keeps: one that is paid and staying (active, no
 * cancellation scheduled) beats one that is ending or still in trial; then the older one.
 */
function keepRank(subscription: StripeSubscription) {
  if (subscription.status !== "active") return 0;
  return subscription.cancel_at_period_end || subscription.cancel_at ? 1 : 2;
}
function keepFirst(a: StripeSubscription, b: StripeSubscription) {
  if (keepRank(a) !== keepRank(b)) return keepRank(a) > keepRank(b);
  if (a.created !== undefined && b.created !== undefined && a.created !== b.created) return a.created < b.created;
  return a.id < b.id;
}

/** Network trouble, timeouts, rate limits, Stripe 5xx: worth Stripe's retry. Anything else won't change. */
function isTransient(error: unknown) {
  if (!(error instanceof StripeApiError)) return true;
  return error.status === 0 || error.status === 409 || error.status === 429 || error.status >= 500;
}

async function needsOwner(client: PoolClient, action: Parameters<typeof recordManualAction>[1]) {
  console.error("[billing] duplicate subscription needs the owner", {
    subscription: action.subscriptionId, kept: action.keptSubscriptionId, invoice: action.invoiceId, reason: action.reason, stripeCode: action.stripeCode,
  });
  await recordManualAction(client, action);
}

/**
 * Two Checkout pages left open (two tabs, sessions last 24 h) can both be paid. The reader keeps
 * one subscription; the other is cancelled at once and, if this is its first invoice, refunded.
 * Refund before cancel with idempotency keys, so a transient failure part-way is finished by
 * Stripe's retry without refunding twice. A refund or cancel Stripe will never accept is not
 * retried (that would hold up every later event for this reader): it is recorded in
 * payment_events with status 'needs_action' for the owner to settle by hand.
 * Returns whether the duplicate is now cancelled in Stripe.
 */
async function dropDuplicate(drop: StripeSubscription, keep: StripeSubscription, client: PoolClient): Promise<boolean> {
  const base = { subscriptionId: drop.id, keptSubscriptionId: keep.id };
  const invoiceId = stripeId(drop.latest_invoice);
  let refunded = false;
  try {
    const invoice = invoiceId ? await invoiceForRefund(invoiceId) : null;
    if (invoice && invoice.amountPaid > 0) {
      if (invoice.billingReason !== "subscription_create") {
        // found late, after a renewal: cancel, but a person decides about money already taken
        await needsOwner(client, { ...base, kind: "refund", invoiceId, reason: "not_first_invoice" });
      } else if (!invoice.payment) {
        await needsOwner(client, { ...base, kind: "refund", invoiceId, reason: "payment_not_found" });
      } else {
        const params = new URLSearchParams({
          [invoice.payment[0]]: invoice.payment[1],
          reason: "duplicate",
          "metadata[reason]": "duplicate_plus_subscription",
          "metadata[subscription]": drop.id,
        });
        try {
          await stripeRequest("POST", "/refunds", params, { idempotencyKey: `dreamreel-duplicate-refund-${drop.id}` });
          refunded = true;
        } catch (error) {
          if (error instanceof StripeApiError && error.code === "charge_already_refunded") refunded = true;
          else if (isTransient(error)) throw error;
          else await needsOwner(client, { ...base, kind: "refund", invoiceId, reason: "refund_rejected", stripeCode: (error as StripeApiError).code });
        }
      }
    }
  } catch (error) {
    if (isTransient(error)) throw error;
    await needsOwner(client, { ...base, kind: "refund", invoiceId, reason: "invoice_unreadable", stripeCode: (error as StripeApiError).code });
  }

  let cancelled = false;
  try {
    await stripeRequest("DELETE", `/subscriptions/${encodeURIComponent(drop.id)}`, undefined, { idempotencyKey: `dreamreel-duplicate-cancel-${drop.id}` });
    cancelled = true;
  } catch (error) {
    const now = await retrieveSubscription(drop.id).catch(() => null);
    if (now?.status === "canceled") cancelled = true;
    else if (isTransient(error)) throw error;
    else await needsOwner(client, { ...base, kind: "cancel", reason: "cancel_rejected", stripeCode: (error as StripeApiError).code });
  }
  console.warn("[billing] duplicate Plus subscription", { kept: keep.id, dropped: drop.id, cancelled, refunded });
  return cancelled;
}

/** Records the reader's subscription and, if it grants Plus, settles any second one. */
async function saveSubscription(subscription: StripeSubscription, userId: number, client: PoolClient, customerId?: string | null) {
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
    const [keep, drop] = keepFirst(other, subscription) ? [other, subscription] : [subscription, other];
    if (await dropDuplicate(drop, keep, client)) await writeSubscription({ ...drop, status: "canceled" }, userId, client);
    if (drop.id === subscription.id) return;
  }
}

/*
 * Lock order is always: this subscription, then its reader; only then is Stripe read. A handler
 * that waited therefore reads the state after the one before it committed, never a stale one.
 */
async function handleCheckoutCompleted(object: Record<string, unknown> & { metadata?: Record<string, string> }, client: PoolClient) {
  if (object.mode !== "subscription") return;
  const userId = parseUserId(object.client_reference_id) ?? parseUserId(object.metadata?.user_id);
  const subscriptionId = stripeId(object.subscription);
  if (!userId || !subscriptionId) return;
  if (!(await userExists(userId, client))) return;

  await lockSubscription(subscriptionId, client);
  await lockUser(userId, client);
  const subscription = await currentSubscription(subscriptionId);
  await saveSubscription(subscription, userId, client, stripeId(object.customer));
}

async function handleSubscriptionEvent(event: StripeEvent, client: PoolClient) {
  const sent = event.data?.object as StripeSubscription | undefined;
  if (!sent?.id) return;
  await lockSubscription(sent.id, client);

  // the reader comes from what we set at checkout (metadata) or the customer we already know
  const customerId = stripeId(sent.customer);
  const metadataUser = parseUserId(sent.metadata?.user_id);
  const userId = metadataUser && (await userExists(metadataUser, client))
    ? metadataUser
    : customerId
      ? await findUserIdForStripeCustomer(customerId, sent.id, client)
      : null;
  // not ours yet: checkout.session.completed links it when it arrives
  if (!userId) return;

  await lockUser(userId, client);
  const subscription = event.type === "customer.subscription.deleted"
    ? { ...sent, status: "canceled" }
    : await currentSubscription(sent.id);
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
