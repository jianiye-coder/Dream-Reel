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
  const refundedKeys = new Set<string>();
  const stripeFailures: {
    cancel: number;
    refundAlreadyDone: boolean;
    refund?: { status: number; error: Record<string, string> };
  } = { cancel: 0, refundAlreadyDone: false };
  const invoiceOverrides = new Map<string, Record<string, unknown>>();
  const callsTo = (method: string, path: string) => fetchMock.mock.calls.filter(([input, init]) =>
    (init?.method ?? "GET") === method && String(input).split("?")[0] === `https://api.stripe.com/v1${path}`);
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const match = url.match(/^https:\/\/api\.stripe\.com\/v1\/subscriptions\/([^/?]+)$/);
    if (match && (init?.method ?? "GET") === "GET") {
      const found = stripeSubscriptions.get(decodeURIComponent(match[1]));
      if (!found) return new Response(JSON.stringify({ error: { code: "resource_missing" } }), { status: 404 });
      if ("error" in found) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: Number(found.error) });
      return new Response(JSON.stringify(found), { status: 200 });
    }
    if (match && init?.method === "DELETE") {
      if (stripeFailures.cancel) { stripeFailures.cancel -= 1; return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }); }
      const id = decodeURIComponent(match[1]);
      const found = stripeSubscriptions.get(id) as Record<string, unknown>;
      stripeSubscriptions.set(id, { ...found, status: "canceled" });
      return new Response(JSON.stringify({ ...found, status: "canceled" }), { status: 200 });
    }
    const invoice = url.match(/^https:\/\/api\.stripe\.com\/v1\/invoices\/([^/?]+)(\?.*)?$/);
    if (invoice) {
      const id = invoice[1];
      const override = invoiceOverrides.get(id);
      if (override && "error" in override) return new Response(JSON.stringify({ error: override.error }), { status: Number(override.status ?? 400) });
      const expanded = new URL(url).searchParams.get("expand[]") === "payments";
      return new Response(JSON.stringify({
        id, object: "invoice", billing_reason: "subscription_create", amount_paid: id.includes("trial") ? 0 : 1299,
        ...(expanded ? { payments: { object: "list", data: [{ object: "invoice_payment", status: "paid", payment: { type: "payment_intent", payment_intent: `pi_for_${id}` } }] } } : {}),
        ...override,
      }), { status: 200 });
    }
    if (url.startsWith("https://api.stripe.com/v1/invoice_payments?")) {
      const invoiceId = new URL(url).searchParams.get("invoice")!;
      return new Response(JSON.stringify({ object: "list", data: [{ object: "invoice_payment", status: "paid", payment: { type: "charge", charge: `ch_listed_${invoiceId}` } }] }), { status: 200 });
    }
    if (url === "https://api.stripe.com/v1/refunds") {
      if (stripeFailures.refund) {
        return new Response(JSON.stringify({ error: stripeFailures.refund.error }), { status: stripeFailures.refund.status });
      }
      const key = new Headers(init?.headers).get("Idempotency-Key")!;
      if (refundedKeys.has(key) && stripeFailures.refundAlreadyDone) {
        return new Response(JSON.stringify({ error: { code: "charge_already_refunded", message: "already refunded" } }), { status: 400 });
      }
      refundedKeys.add(key);
      return new Response(JSON.stringify({ id: "re_1", object: "refund", status: "succeeded" }), { status: 200 });
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
      created: nowSec() - 60,
      latest_invoice: `in_${current.subscription}`,
      items: { object: "list", data: [{ id: "si_1", current_period_start: period.start, current_period_end: period.end, price: { id: "price_cny", object: "price" } }] },
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
    refundedKeys.clear();
    Object.assign(stripeFailures, { cancel: 0, refundAlreadyDone: false, refund: undefined });
    invoiceOverrides.clear();
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
    let firstReadStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstReadStarted = resolve; });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (!String(input).includes("/v1/subscriptions/")) return base(input, init);
      reads += 1;
      if (reads === 1) {
        firstReadStarted();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return new Response(JSON.stringify(subscription("past_due")), { status: 200 });
      }
      return new Response(JSON.stringify(subscription("active")), { status: 200 });
    });
    try {
      await Promise.all([
        deliver(event("customer.subscription.updated", subscription("past_due"))),
        // the second event arrives while the first handler is still reading Stripe
        started.then(() => deliver(event("customer.subscription.updated", subscription("active")))),
      ]);
    } finally {
      fetchMock.mockImplementation(base);
      globalThis.dreamPool = single;
      await wide.end();
    }
    expect(reads).toBe(2);
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", subscriptionStatus: "active" });
  });

  it("grants nothing for a subscription to some other price", async () => {
    const other = { items: { data: [{ current_period_start: nowSec(), current_period_end: nowSec() + 30 * DAY, price: { id: "price_something_else" } }] } };
    stripeSubscriptions.set(current.subscription, subscription("active", other));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await deliver(checkoutCompleted());
    expect(await getBillingStatus(userId)).toMatchObject({ plan: "free", subscriptionStatus: "active" });
    expect(JSON.stringify(warn.mock.calls)).toContain(current.subscription);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("example.test");
    const { rows } = await getPool().query("SELECT plan FROM subscriptions WHERE provider_subscription_id = $1", [current.subscription]);
    expect(rows[0].plan).toBe("free");
  });

  describe("two paid checkouts (two tabs)", () => {
    function second(status = "active", extra: Record<string, unknown> = {}) {
      return { ...subscription(status), id: `${current.subscription}_b`, created: nowSec(), latest_invoice: `in_${current.subscription}_b`, ...extra };
    }

    it("keeps the older subscription and refunds and cancels the newer one, once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      stripeSubscriptions.set(current.subscription, subscription("active"));
      await deliver(checkoutCompleted());
      const newer = second();
      stripeSubscriptions.set(newer.id, newer);
      expect(await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }))).toEqual({ status: 200, body: { received: true } });

      expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", subscriptionStatus: "active" });
      const { rows } = await getPool().query(
        "SELECT provider_subscription_id AS id, status FROM subscriptions WHERE user_id = $1 ORDER BY id", [userId]);
      expect(rows).toEqual([{ id: current.subscription, status: "active" }, { id: newer.id, status: "canceled" }]);

      const refunds = callsTo("POST", "/refunds");
      expect(refunds).toHaveLength(1);
      expect(Object.fromEntries(new URLSearchParams(String(refunds[0][1]!.body)))).toEqual({
        payment_intent: `pi_for_in_${newer.id}`,
        reason: "duplicate",
        "metadata[reason]": "duplicate_plus_subscription",
        "metadata[subscription]": newer.id,
      });
      expect(new Headers(refunds[0][1]!.headers).get("Idempotency-Key")).toBe(`dreamreel-duplicate-refund-${newer.id}`);
      expect(callsTo("DELETE", `/subscriptions/${newer.id}`)).toHaveLength(1);
      expect(callsTo("DELETE", `/subscriptions/${current.subscription}`)).toHaveLength(0);
      expect(JSON.stringify(warn.mock.calls)).toContain("duplicate");

      // Stripe's own deleted/updated events for the cancelled one change nothing more
      await deliver(event("customer.subscription.updated", second("canceled")));
      await deliver(event("customer.subscription.deleted", second("canceled")));
      expect(callsTo("POST", "/refunds")).toHaveLength(1);
      expect(await plan()).toBe("plus");
    });

    it("drops the newer one even when the older one's event arrives last", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const older = subscription("active");
      const newer = second();
      stripeSubscriptions.set(older.id, older);
      stripeSubscriptions.set(newer.id, newer);
      await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }));
      await deliver(checkoutCompleted());
      expect(callsTo("DELETE", `/subscriptions/${newer.id}`)).toHaveLength(1);
      expect(callsTo("DELETE", `/subscriptions/${older.id}`)).toHaveLength(0);
      expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", subscriptionStatus: "active" });
    });

    it("finishes after a failed cancel on Stripe's retry without refunding twice", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      stripeSubscriptions.set(current.subscription, subscription("active"));
      await deliver(checkoutCompleted());
      const newer = second();
      stripeSubscriptions.set(newer.id, newer);
      stripeFailures.cancel = 1;
      stripeFailures.refundAlreadyDone = true;
      const completed = checkoutCompleted({ id: "cs_b", subscription: newer.id });
      expect((await deliver(completed)).status).toBe(500);
      expect(refundedKeys.size).toBe(1);

      expect(await deliver(completed)).toEqual({ status: 200, body: { received: true } });
      expect(refundedKeys.size).toBe(1);
      expect(stripeSubscriptions.get(newer.id)).toMatchObject({ status: "canceled" });
      expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", subscriptionStatus: "active" });
    });

    const needsAction = async () => (await getPool().query(
      "SELECT id, type, payload FROM payment_events WHERE status = 'needs_action' AND payload->>'subscriptionId' LIKE $1 ORDER BY id",
      [`${current.subscription}%`],
    )).rows;

    async function twoActive(newer = second()) {
      stripeSubscriptions.set(current.subscription, subscription("active"));
      await deliver(checkoutCompleted());
      stripeSubscriptions.set(newer.id, newer);
      return newer;
    }

    it("still cancels when Stripe refuses the refund, records it for the owner, and keeps processing", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const newer = await twoActive();
      stripeFailures.refund = { status: 400, error: { code: "charge_disputed", message: "This charge has been disputed" } };
      expect(await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }))).toEqual({ status: 200, body: { received: true } });
      expect(stripeSubscriptions.get(newer.id)).toMatchObject({ status: "canceled" });
      expect(await needsAction()).toEqual([{
        id: `action:refund:${newer.id}`,
        type: "manual.refund",
        payload: expect.objectContaining({ reason: "refund_rejected", stripeCode: "charge_disputed", invoiceId: `in_${newer.id}`, keptSubscriptionId: current.subscription }),
      }]);
      expect(JSON.stringify(log.mock.calls)).not.toContain("has been disputed");

      // later events for this reader (a renewal of the kept subscription) go through
      stripeSubscriptions.set(current.subscription, subscription("active", { cancel_at_period_end: true }));
      expect((await deliver(event("customer.subscription.updated", subscription("active"))))).toEqual({ status: 200, body: { received: true } });
      expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", cancelAtPeriodEnd: true });
      expect(await needsAction()).toHaveLength(1);
    });

    it("retries a transient refund failure instead of recording it", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const newer = await twoActive();
      stripeFailures.refund = { status: 503, error: { message: "try again" } };
      const completed = checkoutCompleted({ id: "cs_b", subscription: newer.id });
      expect((await deliver(completed)).status).toBe(500);
      expect(stripeSubscriptions.get(newer.id)).toMatchObject({ status: "active" });
      expect(await needsAction()).toHaveLength(0);

      stripeFailures.refund = undefined;
      expect((await deliver(completed)).status).toBe(200);
      expect(refundedKeys).toEqual(new Set([`dreamreel-duplicate-refund-${newer.id}`]));
      expect(stripeSubscriptions.get(newer.id)).toMatchObject({ status: "canceled" });
    });

    it("found after a renewal: cancels without refunding and asks the owner", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const newer = await twoActive();
      invoiceOverrides.set(`in_${newer.id}`, { billing_reason: "subscription_cycle" });
      expect((await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }))).status).toBe(200);
      expect(callsTo("POST", "/refunds")).toHaveLength(0);
      expect(callsTo("DELETE", `/subscriptions/${newer.id}`)).toHaveLength(1);
      expect((await needsAction())[0].payload).toMatchObject({ reason: "not_first_invoice", invoiceId: `in_${newer.id}` });
    });

    it("records an unreadable invoice and still cancels", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const newer = await twoActive();
      invoiceOverrides.set(`in_${newer.id}`, { error: { code: "resource_missing" }, status: 404 });
      expect((await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }))).status).toBe(200);
      expect(stripeSubscriptions.get(newer.id)).toMatchObject({ status: "canceled" });
      expect((await needsAction())[0].payload).toMatchObject({ reason: "invoice_unreadable" });
    });

    it("refunds through the charge when the invoice lists its payment only via invoice_payments", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const newer = await twoActive();
      invoiceOverrides.set(`in_${newer.id}`, { payments: { data: [] } });
      await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }));
      const refund = Object.fromEntries(new URLSearchParams(String(callsTo("POST", "/refunds")[0][1]!.body)));
      expect(refund.charge).toBe(`ch_listed_in_${newer.id}`);
    });

    it.each([
      ["a cancellation is scheduled on the older one", { cancel_at_period_end: true }, "active"],
      ["the older one is still in trial", {}, "trialing"],
    ])("keeps the paid, staying subscription when %s", async (_label, olderExtra, olderStatus) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const older = subscription(olderStatus, olderExtra);
      stripeSubscriptions.set(older.id, older);
      await deliver(checkoutCompleted());
      const newer = second();
      stripeSubscriptions.set(newer.id, newer);
      await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }));
      expect(callsTo("DELETE", `/subscriptions/${older.id}`)).toHaveLength(1);
      expect(callsTo("DELETE", `/subscriptions/${newer.id}`)).toHaveLength(0);
      expect(await getBillingStatus(userId)).toMatchObject({ plan: "plus", subscriptionStatus: "active", cancelAtPeriodEnd: false });
    });

    it("cancels without a refund when nothing was charged (trial)", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      stripeSubscriptions.set(current.subscription, subscription("active"));
      await deliver(checkoutCompleted());
      const newer = second("trialing", { latest_invoice: "in_trial_b" });
      stripeSubscriptions.set(newer.id, newer);
      await deliver(checkoutCompleted({ id: "cs_b", subscription: newer.id }));
      expect(callsTo("POST", "/refunds")).toHaveLength(0);
      expect(callsTo("DELETE", `/subscriptions/${newer.id}`)).toHaveLength(1);
    });
  });

  it("keeps Plus for a price id moved to STRIPE_PLUS_PRICE_IDS_LEGACY", async () => {
    const legacy = { items: { data: [{ current_period_start: nowSec(), current_period_end: nowSec() + 30 * DAY, price: { id: "price_2025_cny" } }] } };
    stripeSubscriptions.set(current.subscription, subscription("active", legacy));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await deliver(checkoutCompleted());
    expect(await plan()).toBe("free");
    vi.stubEnv("STRIPE_PLUS_PRICE_IDS_LEGACY", "price_2024_usd, price_2025_cny");
    await deliver(event("customer.subscription.updated", subscription("active", legacy)));
    expect(await plan()).toBe("plus");
  });

  it("pins the Stripe API version on every call", async () => {
    stripeSubscriptions.set(current.subscription, subscription("active"));
    await deliver(checkoutCompleted());
    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("Stripe-Version")).toBe("2025-03-31.basil");
    }
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
