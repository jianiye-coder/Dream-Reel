import Stripe from "stripe";

/* Stripe through the official SDK: one lazily created client, configuration checks, webhook
   verification and the few lookups billing needs. Server-only; never import from a client. */

/**
 * Pinned on the client, so responses keep the shape the code reads (billing period on
 * subscription items, invoice ↔ subscription through `parent.subscription_details`, invoice
 * payments as their own list) whatever the account's default is. Create the webhook endpoint on
 * the same version; webhook handlers mostly take ids from events and read objects back.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
/** Tags our Checkout Sessions in the Dashboard. Constant on purpose: keep it when editing. */
export const CHECKOUT_INTEGRATION_IDENTIFIER = "dreamreel_plus_lwgclcae";

export type BillingLang = "zh" | "en";

type Env = Record<string, string | undefined>;

function configuredOrigin(env: Env): string | null {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    // readers are sent here from Stripe with their session: https only in production
    const allowed = env.NODE_ENV === "production" ? ["https:"] : ["https:", "http:"];
    return allowed.includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The public origin for Stripe's return URLs. In production it must be configured: the
 * request's Host header is not trusted to build links Stripe sends readers to. Locally the
 * request origin is fine.
 */
export function appOrigin(requestOrigin: string, env: Env = process.env): string | null {
  return configuredOrigin(env) ?? (env.NODE_ENV === "production" ? null : requestOrigin);
}

/** Everything checkout needs. Without all of it the upgrade buttons say "coming soon". */
export function isCheckoutConfigured(env: Env = process.env): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY?.trim() &&
    env.STRIPE_PLUS_PRICE_ID_USD?.trim() &&
    // without the webhook secret a paid checkout would never turn Plus on
    env.STRIPE_WEBHOOK_SECRET?.trim() &&
    (configuredOrigin(env) || env.NODE_ENV !== "production"),
  );
}

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

/** One price for everyone, in US dollars, whatever language the reader uses. */
export function plusPriceId(): string | null {
  return process.env.STRIPE_PLUS_PRICE_ID_USD?.trim() || null;
}

/**
 * Prices that grant Plus: the current one plus STRIPE_PLUS_PRICE_IDS_LEGACY (comma list).
 * When a price id changes, move the old id to the legacy list, or existing payers lose Plus.
 */
function plusPriceIds(env: Env = process.env): Set<string> {
  const ids = [env.STRIPE_PLUS_PRICE_ID_USD, ...(env.STRIPE_PLUS_PRICE_IDS_LEGACY ?? "").split(",")];
  return new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)));
}

let cached: { key: string; client: Stripe } | null = null;

/** The one Stripe client, created on first use; null while no key is configured. */
export function stripeClient(): Stripe | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new Stripe(key, {
        apiVersion: STRIPE_API_VERSION,
        // these calls run inside webhook transactions or behind a button: Stripe's webhook
        // retries (and the reader) retry; don't stack SDK retries on top
        maxNetworkRetries: 0,
        timeout: 10_000,
        // fetch, looked up per request (works the same on Vercel's Node runtime)
        httpClient: Stripe.createFetchHttpClient((url, init) => fetch(url, init)),
        appInfo: { name: "Dream Reel" },
      }),
    };
  }
  return cached.client;
}

export function requireStripe(): Stripe {
  const client = stripeClient();
  if (!client) throw new Error("Stripe is not configured");
  return client;
}

// ── webhooks ─────────────────────────────────────────────────────────────────

/** Subscribe the Stripe webhook endpoint to exactly these events. */
export const STRIPE_WEBHOOK_EVENTS: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  // delayed payment methods: fulfil on success (gated on payment_status), re-sync on failure
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Stripe's guide: provision / extend access on invoice.paid; a failed payment re-syncs too
  "invoice.paid",
  "invoice.payment_failed",
  // a full refund also ends the subscription (refund policy)
  "charge.refunded",
  // money at risk: recorded for the owner
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
]);

/**
 * The verified event, or null when the signature doesn't match the raw body, is missing, or is
 * outside the SDK's default five-minute tolerance. Throws on a body that isn't JSON.
 */
export function verifiedEvent(rawBody: Buffer, signature: string | null, secret: string): Stripe.Event | null {
  if (!signature || !secret) return null;
  try {
    return requireStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) return null;
    throw error;
  }
}

// ── errors ───────────────────────────────────────────────────────────────────

type AnyStripeError = InstanceType<typeof Stripe.errors.StripeError>;

export function stripeErrorInfo(error: unknown): { status?: number; code?: string; param?: string } {
  if (!(error instanceof Stripe.errors.StripeError)) return {};
  const e = error as AnyStripeError;
  return { status: e.statusCode, code: e.code, param: e.param };
}

/**
 * Worth a retry: network trouble, timeouts, rate limits, Stripe 5xx, and 401/403 (a key or a
 * restricted key's permission that the owner can fix; failing makes Stripe retry and email about
 * the failing webhook instead of the code settling for "needs action"). Anything else won't change.
 */
export function isTransientStripeError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) return true;
  if (
    error instanceof Stripe.errors.StripeConnectionError || error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeAuthenticationError || error instanceof Stripe.errors.StripePermissionError
  ) return true;
  const status = (error as AnyStripeError).statusCode ?? 0;
  return status === 0 || status === 401 || status === 403 || status === 409 || status === 429 || status >= 500;
}

const notFoundToNull = (error: unknown) => {
  const { status } = stripeErrorInfo(error);
  if (status === 400 || status === 404) return null;
  throw error;
};

// ── subscriptions, invoices, charges ─────────────────────────────────────────

export type StripeSubscription = Stripe.Subscription;

export function retrieveSubscription(id: string) {
  return requireStripe().subscriptions.retrieve(id);
}

export function stripeId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

const unixToDate = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null);

/** Billing period from the subscription items (dahlia keeps it there, not on the subscription). */
export function subscriptionPeriod(subscription: StripeSubscription) {
  const items = subscription.items?.data ?? [];
  const starts = items.map((item) => item.current_period_start).filter((v): v is number => typeof v === "number");
  const ends = items.map((item) => item.current_period_end).filter((v): v is number => typeof v === "number");
  return {
    start: starts.length ? unixToDate(Math.min(...starts)) : null,
    end: ends.length ? unixToDate(Math.max(...ends)) : null,
  };
}

/** Does this subscription bill one of the configured Plus prices? */
export function billsPlusPrice(subscription: StripeSubscription, env: Env = process.env): boolean {
  const prices = plusPriceIds(env);
  return (subscription.items?.data ?? []).some((item) => {
    const id = stripeId(item.price);
    return id !== null && prices.has(id);
  });
}

type PaymentRef = { payment_intent?: string | { id: string } | null; charge?: string | { id: string } | null };

function paymentOf(ref: PaymentRef | undefined | null): ["payment_intent" | "charge", string] | null {
  const intent = stripeId(ref?.payment_intent);
  if (intent) return ["payment_intent", intent];
  const charge = stripeId(ref?.charge);
  return charge ? ["charge", charge] : null;
}

const paidPayment = (entries?: Stripe.InvoicePayment[]) =>
  entries?.find((entry) => !entry.status || entry.status === "paid")?.payment as PaymentRef | undefined;

/** What a refund of this invoice needs: the invoice with `expand[]=payments`, else the invoice payments list. */
export async function invoiceForRefund(invoiceId: string): Promise<{
  amountPaid: number;
  billingReason: string | null;
  payment: ["payment_intent" | "charge", string] | null;
}> {
  const stripe = requireStripe();
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
  const amountPaid = invoice.amount_paid ?? 0;
  let payment = paymentOf(paidPayment(invoice.payments?.data));
  if (!payment && amountPaid > 0) {
    const list = await stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 1 }).catch(notFoundToNull);
    payment = paymentOf(paidPayment(list?.data));
  }
  return { amountPaid, billingReason: invoice.billing_reason ?? null, payment };
}

export type StripeInvoiceRef = {
  customer?: unknown;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null; metadata?: Record<string, string> | null } | null } | null;
};

/** The subscription an invoice belongs to (`parent.subscription_details`; the endpoint is on dahlia). */
export function subscriptionOfInvoice(invoice: StripeInvoiceRef | null | undefined): string | null {
  return stripeId(invoice?.parent?.subscription_details?.subscription);
}

/**
 * Charge → PaymentIntent → invoice payments → invoice → subscription, per Stripe's guide (the
 * charge itself no longer names its invoice). Null for a charge that isn't a subscription payment.
 */
export async function subscriptionForCharge(charge: { payment_intent?: unknown }): Promise<string | null> {
  const paymentIntent = stripeId(charge.payment_intent);
  if (!paymentIntent) return null;
  const stripe = requireStripe();
  const list = await stripe.invoicePayments
    .list({ payment: { type: "payment_intent", payment_intent: paymentIntent }, status: "paid", limit: 1 })
    .catch(notFoundToNull);
  const invoiceId = stripeId(list?.data?.[0]?.invoice);
  if (!invoiceId) return null;
  const invoice = await stripe.invoices.retrieve(invoiceId).catch(notFoundToNull);
  return subscriptionOfInvoice(invoice as StripeInvoiceRef | null);
}
