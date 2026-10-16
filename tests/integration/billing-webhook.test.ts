import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { signStripePayload } from "@/lib/stripe";

/* Signed fake Stripe events go through the real webhook route into PostgreSQL; only
   api.stripe.com is faked (fetch), and only the subscription that the route reads back. */

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const WEBHOOK_SECRET = "whsec_integration";
const DAY = 86_400;

databaseDescribe("Stripe webhook → Plus in PostgreSQL", () => {
  let getPool: typeof import("@/lib/db").getPool;
  let ensureSchema: typeof import("@/lib/db").ensureSchema;
  let getBillingStatus: typeof import("@/lib/billing").getBillingStatus;
  let webhook: typeof import("@/app/api/billing/webhook/route").POST;
  let checkout: typeof import("@/app/api/billing/checkout/route").POST;
  let portal: typeof import("@/app/api/billing/portal/route").POST;

  const users: number[] = [];
  let userId: number;
  let seq = 0;
  const run = `${Date.now()}`;
  const ids = () => ({ subscription: `sub_${run}_${seq}`, customer: `cus_${run}_${seq}` });
  let current: ReturnType<typeof ids>;

  // what GET /v1/subscriptions/:id answers, per subscription id
  const stripeSubscriptions = new Map<string, Record<string, unknown> | { error: number }>();
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const match = url.match(/^https:\/\/api\.stripe\.com\/v1\/subscriptions\/([^/?]+)$/);
    if (match && (init?.method ?? "GET") === "GET") {
      const found = stripeSubscriptions.get(decodeURIComponent(match[1]));
      if (!found) return new Response(JSON.stringify({ error: { code: "resource_missing" } }), { status: 404 });
      if ("error" in found) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: Number(found.error) });
      return new Response(JSON.stringify(found), { status: 200 });
    }
    if (url === "https://api.stripe.com/v1/checkout/sessions") {
      return new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test" }), { status: 200 });
    }
    if (url === "https://api.stripe.com/v1/billing_portal/sessions") {
      return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/test" }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  const nowSec = () => Math.floor(Date.now() / 1000);

  /** A subscription in the shape of API 2025-03-31.basil+: the period lives on the item. */
  function subscription(status: string, extra: Record<string, unknown> = {}, period = { start: nowSec() - DAY, end: nowSec() + 29 * DAY }) {
    return {
      id: current.subscription,
      object: "subscription",
      customer: current.customer,
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { user_id: String(userId), plan: "plus" },
      items: { object: "list", data: [{ id: "si_1", current_period_start: period.start, current_period_end: period.end, price: { id: "price_cny" } }] },
      ...extra,
    };
  }

  let eventSeq = 0;
  function event(type: string, object: Record<string, unknown>, id = `evt_${run}_${++eventSeq}`) {
    return { id, object: "event", type, created: nowSec(), livemode: false, api_version: "2025-09-30.clover", data: { object } };
  }

  async function deliver(payload: unknown, { secret = WEBHOOK_SECRET, signature }: { secret?: string; signature?: string } = {}) {
    const body = JSON.stringify(payload);
    const response = await webhook(new NextRequest("http://localhost/api/billing/webhook", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "Stripe-Signature": signature ?? signStripePayload(body, secret) },
    }));
    return { status: response.status, body: await response.json() };
  }

  const checkoutCompleted = (extra: Record<string, unknown> = {}) => event("checkout.session.completed", {
    id: `cs_${run}_${seq}`,
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    client_reference_id: String(userId),
    customer: current.customer,
    subscription: current.subscription,
    customer_details: { email: "reader@example.test", name: "Reader" },
    metadata: { user_id: String(userId), plan: "plus" },
    ...extra,
  });

  async function plan() {
    return (await getBillingStatus(userId)).plan;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "integration-encryption-secret";
    process.env.ADMIN_UNLIMITED_EMAILS = "nobody@example.test";
    ({ getPool, ensureSchema } = await import("@/lib/db"));
    ({ getBillingStatus } = await import("@/lib/billing"));
    ({ POST: webhook } = await import("@/app/api/billing/webhook/route"));
    ({ POST: checkout } = await import("@/app/api/billing/checkout/route"));
    ({ POST: portal } = await import("@/app/api/billing/portal/route"));
    await ensureSchema();
  });

  beforeEach(async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_integration");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("STRIPE_PLUS_PRICE_ID_USD", "price_usd");
    vi.stubEnv("STRIPE_PLUS_PRICE_ID_CNY", "price_cny");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dream-reel.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    stripeSubscriptions.clear();
    seq += 1;
    current = ids();
    const { rows } = await getPool().query<{ id: number }>(
      "INSERT INTO users (email, name) VALUES ($1, 'Reader') RETURNING id",
      [`billing-${run}-${seq}@example.test`],
    );
    userId = rows[0].id;
    users.push(userId);
    auth.mockResolvedValue({ user: { id: String(userId), email: `billing-${run}-${seq}@example.test` } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (users.length) await getPool().query("DELETE FROM users WHERE id = ANY($1::int[])", [users]);
    await getPool().query("DELETE FROM payment_events WHERE id LIKE $1", [`evt_${run}_%`]);
    await getPool().end();
    globalThis.dreamPool = undefined;
  });

  it("turns Plus on after checkout and back off when the subscription is cancelled", async () => {
    expect(await plan()).toBe("free");
    stripeSubscriptions.set(current.subscription, subscription("active"));

    expect(await deliver(checkoutCompleted())).toEqual({ status: 200, body: { received: true } });
    const on = await getBillingStatus(userId);
    expect(on).toMatchObject({ plan: "plus", subscriptionStatus: "active", cancelAtPeriodEnd: false });
    expect(on.limits.analysis).toBe(20);
    expect(new Date(on.periodEnd).getTime()).toBe((subscription("active").items.data[0].current_period_end) * 1000);

    // cancelled in the portal: Plus stays until the period ends
    stripeSubscriptions.set(current.subscription, subscription("active", { cancel_at_period_end: true }));
    await deliver(event("customer.subscription.updated", subscription("active", { cancel_at_period_end: true })));
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", cancelAtPeriodEnd: true });

    // the period ends: Stripe deletes the subscription
    await deliver(event("customer.subscription.deleted", subscription("canceled")));
    const off = await getBillingStatus(userId);
    expect(off).toMatchObject({ plan: "free", subscriptionStatus: "canceled" });
    expect(off.limits.analysis).toBe(5);
  });

  it("ignores a redelivered event", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    const completed = checkoutCompleted();
    await deliver(completed);
    const calls = fetchMock.mock.calls.length;
    expect(await deliver(completed)).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(fetchMock.mock.calls.length).toBe(calls);
    const { rows } = await getPool().query("SELECT payload FROM payment_events WHERE id = $1", [completed.id]);
    expect(rows).toHaveLength(1);
    // the audit row keeps ids, not the customer's name or email
    expect(JSON.stringify(rows[0].payload)).not.toContain("reader@example.test");
  });

  it("reads the real state back from Stripe, so out-of-order events can't undo a payment", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    // subscription.created (sent while still incomplete) arrives after the payment went through
    await deliver(event("customer.subscription.created", subscription("incomplete")));
    expect(await plan()).toBe("plus");
    await deliver(checkoutCompleted());
    expect(await plan()).toBe("plus");
  });

  it("does not grant Plus for an unpaid (async) checkout until the subscription is active", async () => {
    stripeSubscriptions.set(current.subscription, subscription("incomplete"));
    await deliver(checkoutCompleted({ payment_status: "unpaid" }));
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "free", subscriptionStatus: "incomplete" });

    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(event("customer.subscription.updated", subscription("active")));
    expect(await plan()).toBe("plus");
  });

  it.each(["past_due", "unpaid", "incomplete_expired", "paused"])("treats %s as not Plus", async (status) => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(checkoutCompleted());
    expect(await plan()).toBe("plus");

    stripeSubscriptions.set(current.subscription, subscription(status));
    await deliver(event("customer.subscription.updated", subscription(status)));
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "free", subscriptionStatus: status });
  });

  it("counts trialing as Plus and recovers from past_due", async () => {
    stripeSubscriptions.set(current.subscription, subscription("trialing"));
    await deliver(checkoutCompleted());
    expect(await plan()).toBe("plus");
    stripeSubscriptions.set(current.subscription, subscription("past_due"));
    await deliver(event("customer.subscription.updated", {}  as never));
    // an event without an object id is a no-op
    expect(await plan()).toBe("plus");
    await deliver(event("customer.subscription.updated", subscription("past_due")));
    expect(await plan()).toBe("free");
    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(event("customer.subscription.updated", subscription("active")));
    expect(await plan()).toBe("plus");
  });

  it("respects the period end even if a renewal event never arrives", async () => {
    const ended = { start: nowSec() - 31 * DAY, end: nowSec() - 60 };
    stripeSubscriptions.set(current.subscription, subscription("active", {}, ended));
    await deliver(checkoutCompleted());
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "free", subscriptionStatus: "active" });
  });

  it("handles concurrent events for one subscription one at a time, so the newest state wins", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(checkoutCompleted());
    // production uses one connection per serverless instance; two instances = two connections
    const single = globalThis.dreamPool;
    const wide = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    globalThis.dreamPool = wide;
    // the first read is slow and sees the older state; the second sees the newer one
    let reads = 0;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (!String(input).includes("/v1/subscriptions/")) return base(input, init);
      reads += 1;
      if (reads === 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return new Response(JSON.stringify(subscription("past_due")), { status: 200 });
      }
      return new Response(JSON.stringify(subscription("active")), { status: 200 });
    });
    try {
      await Promise.all([
        deliver(event("customer.subscription.updated", subscription("past_due"))),
        new Promise((resolve) => setTimeout(resolve, 50)).then(() => deliver(event("customer.subscription.updated", subscription("active")))),
      ]);
    } finally {
      fetchMock.mockImplementation(base);
      globalThis.dreamPool = single;
      await wide.end();
    }
    expect(reads).toBe(2);
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", subscriptionStatus: "active" });
  });

  it("never brings an ended subscription back", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(checkoutCompleted());
    await deliver(event("customer.subscription.deleted", subscription("canceled")));
    // a stale replay that still claims "active"
    await deliver(event("customer.subscription.updated", subscription("active")));
    expect(await plan()).toBe("free");
  });

  it("links a subscription event without metadata through the stored customer", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(checkoutCompleted());
    stripeSubscriptions.set(current.subscription, subscription("past_due", { metadata: {} }));
    await deliver(event("customer.subscription.updated", subscription("past_due", { metadata: {} })));
    expect(await plan()).toBe("free");
  });

  it("prefers the subscription that grants Plus over a newer ended one", async () => {
    const first = current.subscription;
    stripeSubscriptions.set(first, subscription("active"));
    await deliver(checkoutCompleted());
    // an old, already-cancelled subscription of the same customer gets touched later
    current = { ...current, subscription: `${first}_old` };
    await deliver(event("customer.subscription.deleted", subscription("canceled")));
    expect(await plan()).toBe("plus");
  });

  it("rejects bad signatures, stale timestamps and a missing header without touching the database", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    const completed = checkoutCompleted();
    expect((await deliver(completed, { secret: "whsec_wrong" })).status).toBe(400);
    const body = JSON.stringify(completed);
    const stale = signStripePayload(body, WEBHOOK_SECRET, nowSec() - 3600);
    expect((await deliver(completed, { signature: stale })).status).toBe(400);
    const missing = await webhook(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "INVALID_REQUEST" });
    const { rows } = await getPool().query("SELECT 1 FROM payment_events WHERE id = $1", [completed.id]);
    expect(rows).toHaveLength(0);
    expect(await plan()).toBe("free");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 without a webhook secret, naming no setting", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const res = await deliver(checkoutCompleted());
    expect(res).toEqual({ status: 503, body: { error: "CONFIGURATION_ERROR" } });
  });

  it("acknowledges events it doesn't handle without storing them", async () => {
    const other = event("invoice.paid", { id: "in_1", customer: current.customer });
    expect(await deliver(other)).toEqual({ status: 200, body: { received: true, ignored: true } });
    const { rows } = await getPool().query("SELECT 1 FROM payment_events WHERE id = $1", [other.id]);
    expect(rows).toHaveLength(0);
  });

  it("lets Stripe retry when reading the subscription fails, then processes the retry", async () => {
    stripeSubscriptions.set(current.subscription, { error: 500 });
    const completed = checkoutCompleted();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await deliver(completed)).toEqual({ status: 500, body: { error: "INTERNAL_ERROR" } });
    expect(await plan()).toBe("free");

    stripeSubscriptions.set(current.subscription, subscription("active"));
    expect(await deliver(completed)).toEqual({ status: 200, body: { received: true } });
    expect(await plan()).toBe("plus");
  });

  it("skips events for unknown readers or subscriptions instead of failing forever", async () => {
    const stranger = checkoutCompleted({ client_reference_id: "2147483000", metadata: {} });
    expect((await deliver(stranger)).status).toBe(200);
    // subscription that this Stripe account can't see (404)
    expect((await deliver(checkoutCompleted({ subscription: "sub_missing" }))).status).toBe(200);
    // a one-off payment session is not a subscription
    expect((await deliver(checkoutCompleted({ mode: "payment", subscription: null }))).status).toBe(200);
    expect(await plan()).toBe("free");
  });

  it("checkout and portal reuse the customer the webhook stored, and Plus can't be bought twice", async () => {
    const first = await checkout(new NextRequest("http://localhost/api/billing/checkout", {
      method: "POST", body: JSON.stringify({ lang: "zh", from: "/account" }),
    }));
    expect(first.status).toBe(200);
    const firstParams = new URLSearchParams(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));
    expect(firstParams.get("customer")).toBeNull();
    expect(firstParams.get("customer_email")).toBe(`billing-${run}-${seq}@example.test`);
    expect(firstParams.get("line_items[0][price]")).toBe("price_cny");

    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(checkoutCompleted());

    const again = await checkout(new NextRequest("http://localhost/api/billing/checkout", {
      method: "POST", body: JSON.stringify({ lang: "en" }),
    }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "ALREADY_SUBSCRIBED" });

    const manage = await portal(new NextRequest("http://localhost/api/billing/portal", { method: "POST", body: "{}" }));
    expect(await manage.json()).toEqual({ url: "https://billing.stripe.com/p/session/test" });
    const portalParams = new URLSearchParams(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));
    expect(portalParams.get("customer")).toBe(current.customer);

    // after cancelling, a new checkout reuses the same customer
    await deliver(event("customer.subscription.deleted", subscription("canceled")));
    await checkout(new NextRequest("http://localhost/api/billing/checkout", {
      method: "POST", body: JSON.stringify({ lang: "en" }),
    }));
    const reuse = new URLSearchParams(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));
    expect(reuse.get("customer")).toBe(current.customer);
    expect(reuse.get("customer_email")).toBeNull();
    expect(reuse.get("line_items[0][price]")).toBe("price_usd");
  });
});
