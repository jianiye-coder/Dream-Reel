import { createHmac, timingSafeEqual } from "crypto";

/* Stripe over plain fetch: configuration checks, webhook signature verification and the few
   REST calls billing needs. Server-only; never import from a client component. */

const STRIPE_API = "https://api.stripe.com/v1";
/**
 * Every request pins this API version, so responses keep the shape the code reads (billing
 * period on subscription items, invoice payments as their own list) whatever the account's
 * default is. Webhook payloads follow the endpoint's version; the handler only takes ids from
 * them and reads the objects back through this version.
 */
export const STRIPE_API_VERSION = "2025-03-31.basil";
const REQUEST_TIMEOUT_MS = 10_000;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type BillingLang = "zh" | "en";

type Env = Record<string, string | undefined>;

function configuredOrigin(env: Env): string | null {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
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
    env.STRIPE_PLUS_PRICE_ID_CNY?.trim() &&
    // without the webhook secret a paid checkout would never turn Plus on
    env.STRIPE_WEBHOOK_SECRET?.trim() &&
    (configuredOrigin(env) || env.NODE_ENV !== "production"),
  );
}

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

/** zh readers pay the CNY price, en readers the USD price. */
export function plusPriceId(lang: BillingLang): string | null {
  const id = lang === "zh" ? process.env.STRIPE_PLUS_PRICE_ID_CNY : process.env.STRIPE_PLUS_PRICE_ID_USD;
  return id?.trim() || null;
}

/** The configured Plus prices; a subscription grants Plus only if it bills one of them. */
export function plusPriceIds(env: Env = process.env): Set<string> {
  return new Set([env.STRIPE_PLUS_PRICE_ID_USD?.trim(), env.STRIPE_PLUS_PRICE_ID_CNY?.trim()].filter((id): id is string => Boolean(id)));
}

// ── webhook signatures ────────────────────────────────────────────────────────

/** Subscribe the Stripe webhook endpoint to exactly these events. */
export const STRIPE_WEBHOOK_EVENTS: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

function parseSignatureHeader(header: string) {
  const timestamps: string[] = [];
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t") timestamps.push(value);
    if (key === "v1") signatures.push(value);
  }
  return { timestamp: timestamps[0], signatures };
}

/**
 * Verifies a `Stripe-Signature` header against the exact raw request body.
 * Accepts any of several `v1` signatures (Stripe sends two while a secret is being rolled),
 * ignores other schemes (`v0`), and rejects timestamps outside the tolerance window.
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | null | undefined,
  secret: string,
  { toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS, now = Date.now() } = {},
): boolean {
  if (!header || !secret) return false;
  const { timestamp, signatures } = parseSignatureHeader(header);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;

  const ageSeconds = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]))
    .digest();

  return signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

/** Builds a valid header, for tests and local tooling. */
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

// ── REST ──────────────────────────────────────────────────────────────────────

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly param: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

type StripeErrorBody = { error?: { message?: string; code?: string; param?: string; type?: string } };

export async function stripeRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: URLSearchParams,
  { idempotencyKey }: { idempotencyKey?: string } = {},
): Promise<T> {
  const apiKey = stripeSecretKey();
  if (!apiKey) throw new StripeApiError(0, "not_configured", undefined, "Stripe is not configured");

  const url = method === "GET" && params ? `${STRIPE_API}${path}?${params}` : `${STRIPE_API}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(method === "POST" && params ? { body: params.toString() } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as T & StripeErrorBody;
  if (!response.ok) {
    throw new StripeApiError(
      response.status,
      payload.error?.code,
      payload.error?.param,
      payload.error?.message || `Stripe request failed with ${response.status}`,
    );
  }
  return payload;
}

// ── subscriptions ────────────────────────────────────────────────────────────

export type StripeSubscription = {
  id: string;
  object?: "subscription";
  customer: string | { id: string };
  status: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  /** unix seconds */
  created?: number;
  latest_invoice?: string | { id: string } | null;
  /** Removed from the subscription in API version 2025-03-31.basil; now on each item. */
  current_period_start?: number;
  current_period_end?: number;
  items?: { data?: { current_period_start?: number; current_period_end?: number; price?: string | { id: string } }[] };
  metadata?: Record<string, string>;
};

export function retrieveSubscription(id: string) {
  return stripeRequest<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
}

export function stripeId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

const unixToDate = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null);

/** Billing period of a subscription in both the old and the item-level (basil+) shapes. */
export function subscriptionPeriod(subscription: StripeSubscription) {
  const items = subscription.items?.data ?? [];
  const starts = items.map((item) => item.current_period_start).filter((v): v is number => typeof v === "number");
  const ends = items.map((item) => item.current_period_end).filter((v): v is number => typeof v === "number");
  return {
    start: unixToDate(subscription.current_period_start) ?? (starts.length ? unixToDate(Math.min(...starts)) : null),
    end: unixToDate(subscription.current_period_end) ?? (ends.length ? unixToDate(Math.max(...ends)) : null),
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

type InvoicePaymentRef = { payment_intent?: string | { id: string } | null; charge?: string | { id: string } | null };

/** The payment behind an invoice, as a refund parameter; null for a $0 or unpaid invoice. */
export async function invoicePayment(invoiceId: string): Promise<["payment_intent" | "charge", string] | null> {
  // older API shapes carried the payment on the invoice itself
  const invoice = await stripeRequest<InvoicePaymentRef & { amount_paid?: number }>("GET", `/invoices/${encodeURIComponent(invoiceId)}`);
  if (invoice.amount_paid === 0) return null;
  const direct = stripeId(invoice.payment_intent) ?? stripeId(invoice.charge);
  if (direct) return [direct.startsWith("ch_") ? "charge" : "payment_intent", direct];

  const params = new URLSearchParams({ invoice: invoiceId, status: "paid", limit: "1" });
  const payments = await stripeRequest<{ data?: { payment?: InvoicePaymentRef & { type?: string } }[] }>("GET", "/invoice_payments", params);
  const payment = payments.data?.[0]?.payment;
  const intent = stripeId(payment?.payment_intent);
  if (intent) return ["payment_intent", intent];
  const charge = stripeId(payment?.charge);
  return charge ? ["charge", charge] : null;
}
