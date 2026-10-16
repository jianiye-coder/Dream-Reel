import { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import {
  findUserIdForStripeCustomer,
  otherPlusSubscriptionIds,
  processStripeEvent,
  recordManualAction,
  recordNeedsAction,
  upsertStripeSubscription,
  userExists,
} from "@/lib/billing";
import { errorJson, parseUserId, privateJson } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import {
  billsPlusPrice,
  invoiceForRefund,
  isTransientStripeError,
  requireStripe,
  retrieveSubscription,
  stripeErrorInfo,
  stripeId,
  stripeSecretKey,
  STRIPE_WEBHOOK_EVENTS,
  subscriptionForCharge,
  subscriptionOfInvoice,
  subscriptionPeriod,
  verifiedEvent,
  type StripeInvoiceRef,
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
    if (stripeErrorInfo(error).status === 404) throw new SkipEvent("subscription not found");
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

const isTransient = isTransientStripeError;

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
        const [kind, paymentId] = invoice.payment;
        try {
          await requireStripe().refunds.create({
            ...(kind === "payment_intent" ? { payment_intent: paymentId } : { charge: paymentId }),
            reason: "duplicate",
            metadata: { reason: "duplicate_plus_subscription", subscription: drop.id },
          }, { idempotencyKey: `dreamreel-duplicate-refund-${drop.id}` });
          refunded = true;
        } catch (error) {
          if (stripeErrorInfo(error).code === "charge_already_refunded") refunded = true;
          else if (isTransient(error)) throw error;
          else await needsOwner(client, { ...base, kind: "refund", invoiceId, reason: "refund_rejected", stripeCode: stripeErrorInfo(error).code });
        }
      }
    }
  } catch (error) {
    if (isTransient(error)) throw error;
    await needsOwner(client, { ...base, kind: "refund", invoiceId, reason: "invoice_unreadable", stripeCode: stripeErrorInfo(error).code });
  }

  let cancelled = false;
  try {
    await requireStripe().subscriptions.cancel(drop.id, undefined, { idempotencyKey: `dreamreel-duplicate-cancel-${drop.id}` });
    cancelled = true;
  } catch (error) {
    const now = await retrieveSubscription(drop.id).catch(() => null);
    if (now?.status === "canceled") cancelled = true;
    else if (isTransient(error)) throw error;
    else await needsOwner(client, { ...base, kind: "cancel", reason: "cancel_rejected", stripeCode: stripeErrorInfo(error).code });
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
/**
 * checkout.session.completed links the new Stripe customer to the reader who opened the session
 * (client_reference_id; metadata only as a fallback). async_payment_succeeded fulfils a delayed
 * payment, so only when payment_status says paid; async_payment_failed just re-syncs. Plus itself
 * always follows the subscription's status as read back from Stripe.
 */
async function handleCheckoutSession(type: string, object: Record<string, unknown> & { metadata?: Record<string, string> }, client: PoolClient) {
  if (object.mode !== "subscription") return;
  if (type === "checkout.session.async_payment_succeeded" && object.payment_status !== "paid") return;
  const userId = parseUserId(object.client_reference_id) ?? parseUserId(object.metadata?.user_id);
  const subscriptionId = stripeId(object.subscription);
  if (!userId || !subscriptionId) return;
  if (!(await userExists(userId, client))) return;

  await lockSubscription(subscriptionId, client);
  await lockUser(userId, client);
  const subscription = await currentSubscription(subscriptionId);
  await saveSubscription(subscription, userId, client, stripeId(object.customer));
}

/** The reader: the subscription or customer we already know (metadata only as a fallback). */
async function readerFor(subscriptionId: string, customerId: string | null, metadataUserId: unknown, client: PoolClient) {
  // the Stripe subscription / customer we already linked is the owner
  const known = await findUserIdForStripeCustomer(customerId ?? "", subscriptionId, client);
  if (known) return known;
  // explicit fallback for a subscription event that beats checkout.session.completed here
  const fromMetadata = parseUserId(metadataUserId);
  return fromMetadata && (await userExists(fromMetadata, client)) ? fromMetadata : null;
}

/** The locked re-sync every subscription-shaped event goes through. */
async function resync(
  subscriptionId: string,
  hint: { customerId: string | null; metadataUserId?: unknown; deleted?: StripeSubscription },
  client: PoolClient,
) {
  await lockSubscription(subscriptionId, client);
  const userId = await readerFor(subscriptionId, hint.customerId, hint.metadataUserId, client);
  // not ours yet: checkout.session.completed links it when it arrives
  if (!userId) return;
  await lockUser(userId, client);
  const subscription = hint.deleted ? { ...hint.deleted, status: "canceled" } : await currentSubscription(subscriptionId);
  await saveSubscription(subscription, userId, client);
}

async function handleSubscriptionEvent(event: StripeEvent, client: PoolClient) {
  const sent = event.data?.object as StripeSubscription | undefined;
  if (!sent?.id) return;
  await resync(sent.id, {
    customerId: stripeId(sent.customer),
    metadataUserId: sent.metadata?.user_id,
    deleted: event.type === "customer.subscription.deleted" ? sent : undefined,
  }, client);
}

/** invoice.paid / invoice.payment_failed: re-read the invoice's subscription (it says active, past_due…). */
async function handleInvoiceEvent(invoice: Record<string, unknown> & StripeInvoiceRef, client: PoolClient) {
  const subscriptionId = subscriptionOfInvoice(invoice);
  if (!subscriptionId) return; // a one-off invoice
  await resync(subscriptionId, {
    customerId: stripeId(invoice.customer),
    metadataUserId: invoice.parent?.subscription_details?.metadata?.user_id,
  }, client);
}

/** A full refund of a subscription payment ends that subscription at once (see /refund). */
async function handleChargeRefunded(charge: Record<string, unknown>, client: PoolClient) {
  if (charge.refunded !== true) return; // partial refunds leave the subscription alone
  const subscriptionId = await subscriptionForCharge(charge as Parameters<typeof subscriptionForCharge>[0]);
  if (!subscriptionId) return;

  await lockSubscription(subscriptionId, client);
  const userId = await readerFor(subscriptionId, stripeId(charge.customer), undefined, client);
  if (!userId) return;
  await lockUser(userId, client);
  const subscription = await currentSubscription(subscriptionId);
  // already over, including a duplicate we refunded and cancelled ourselves
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    await writeSubscription(subscription, userId, client);
    return;
  }
  try {
    await requireStripe().subscriptions.cancel(subscriptionId, undefined, { idempotencyKey: `dreamreel-refunded-cancel-${subscriptionId}` });
  } catch (error) {
    const now = await retrieveSubscription(subscriptionId).catch(() => null);
    if (now?.status !== "canceled") {
      if (isTransient(error)) throw error;
      console.error("[billing] refunded subscription could not be cancelled", { subscription: subscriptionId, charge: charge.id, stripeCode: stripeErrorInfo(error).code });
      await recordNeedsAction(client, `action:cancel:${subscriptionId}`, "manual.cancel", {
        subscriptionId, chargeId: charge.id, reason: "refunded_cancel_rejected", stripeCode: stripeErrorInfo(error).code,
      });
      return;
    }
  }
  console.warn("[billing] cancelled a fully refunded subscription", { subscription: subscriptionId, charge: charge.id });
  await writeSubscription({ ...subscription, status: "canceled" }, userId, client);
}

/** Disputes and early fraud warnings: the owner decides; we keep the ids. */
async function handleRiskEvent(event: StripeEvent, client: PoolClient) {
  const object = event.data?.object ?? {};
  const kind = event.type === "charge.dispute.created" ? "dispute" : "early_fraud_warning";
  const details = { [`${kind === "dispute" ? "dispute" : "warning"}Id`]: object.id, chargeId: stripeId(object.charge), paymentIntentId: stripeId(object.payment_intent), eventId: event.id };
  console.warn(`[billing] ${kind} needs the owner`, details);
  await recordNeedsAction(client, `action:${kind}:${object.id}`, `manual.${kind}`, details);
}

export async function POST(request: NextRequest) {
  // fail closed: without both secrets nothing is verified or read back
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !stripeSecretKey()) return errorJson(API_ERROR_CODES.configurationError, 503);

  // the signature covers the exact bytes Stripe sent, so read them before any parsing
  const rawBody = Buffer.from(await request.arrayBuffer());
  let event: StripeEvent;
  try {
    const verified = verifiedEvent(rawBody, request.headers.get("stripe-signature"), secret);
    if (!verified) return errorJson(API_ERROR_CODES.invalidRequest, 400);
    event = verified as unknown as StripeEvent;
  } catch {
    return errorJson(API_ERROR_CODES.invalidRequest, 400); // signed, but not JSON
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
          if (event.type.startsWith("checkout.session.")) await handleCheckoutSession(event.type, object, client);
          else if (event.type.startsWith("customer.subscription.")) await handleSubscriptionEvent(event, client);
          else if (event.type.startsWith("invoice.")) await handleInvoiceEvent(object, client);
          else if (event.type === "charge.refunded") await handleChargeRefunded(object, client);
          else await handleRiskEvent(event, client);
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
      ...stripeErrorInfo(error),
    });
    return errorJson(API_ERROR_CODES.internalError, 500);
  }
}
