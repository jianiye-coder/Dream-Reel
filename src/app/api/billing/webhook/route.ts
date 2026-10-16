import { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import {
  findUserIdForStripeCustomer,
  processStripeEvent,
  upsertStripeSubscription,
  userExists,
} from "@/lib/billing";
import { errorJson, parseUserId, privateJson } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import {
  retrieveSubscription,
  StripeApiError,
  stripeId,
  STRIPE_WEBHOOK_EVENTS,
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

async function saveSubscription(subscription: StripeSubscription, userId: number, client: PoolClient, customerId?: string | null) {
  const period = subscriptionPeriod(subscription);
  await upsertStripeSubscription({
    userId,
    customerId: customerId ?? stripeId(subscription.customer),
    subscriptionId: subscription.id,
    status: subscription.status || "incomplete",
    plan: "plus",
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
  }, client);
}

async function handleCheckoutCompleted(object: Record<string, unknown> & { metadata?: Record<string, string> }, client: PoolClient) {
  if (object.mode !== "subscription") return;
  const userId = parseUserId(object.client_reference_id) ?? parseUserId(object.metadata?.user_id);
  const subscriptionId = stripeId(object.subscription);
  if (!userId || !subscriptionId) return;
  if (!(await userExists(userId, client))) return;

  const subscription = await currentSubscription(subscriptionId);
  await saveSubscription(subscription, userId, client, stripeId(object.customer));
}

async function handleSubscriptionEvent(event: StripeEvent, client: PoolClient) {
  const sent = event.data?.object as StripeSubscription | undefined;
  if (!sent?.id) return;
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
      ...(error instanceof StripeApiError ? { status: error.status, stripeCode: error.code } : {}),
    });
    return errorJson(API_ERROR_CODES.internalError, 500);
  }
}
