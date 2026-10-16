import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => vi.fn());
const billing = vi.hoisted(() => ({
  getBillingStatus: vi.fn(),
  getStripeCustomerId: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/billing", () => billing);

import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { GET as status } from "@/app/api/billing/status/route";

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_PLUS_PRICE_ID_USD: "price_usd_199",
  STRIPE_PLUS_PRICE_ID_CNY: "price_cny_1299",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  NEXT_PUBLIC_APP_URL: "https://dream-reel.example",
};

const freeStatus = { plan: "free", isUnlimited: false, subscriptionStatus: null, cancelAtPeriodEnd: false };
const fetchMock = vi.fn();

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function stripeOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** The form fields of the n-th Stripe call. */
function sentParams(call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, init, params: Object.fromEntries(new URLSearchParams(String(init.body))) };
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries(STRIPE_ENV)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", fetchMock);
  auth.mockResolvedValue({ user: { id: "42", email: "reader@example.com" } });
  billing.getBillingStatus.mockResolvedValue(freeStatus);
  billing.getStripeCustomerId.mockResolvedValue(null);
  fetchMock.mockResolvedValue(stripeOk({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/billing/checkout", () => {
  it("rejects a signed-out reader", async () => {
    auth.mockResolvedValue(null);
    const res = await checkout(post("/api/billing/checkout", { lang: "zh" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["STRIPE_SECRET_KEY", "STRIPE_PLUS_PRICE_ID_USD", "STRIPE_PLUS_PRICE_ID_CNY", "STRIPE_WEBHOOK_SECRET"])(
    "answers BILLING_UNAVAILABLE without naming settings when %s is missing", async (name) => {
      vi.stubEnv(name, "");
      const res = await checkout(post("/api/billing/checkout", { lang: "zh" }));
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "BILLING_UNAVAILABLE" });
      expect(text).not.toMatch(/STRIPE|price|secret/i);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("sends zh readers the CNY price with exactly the documented Checkout parameters", async () => {
    const res = await checkout(post("/api/billing/checkout", { lang: "zh", from: "/journal" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const { url, init, params } = sentParams();
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk_test_123",
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2025-03-31.basil",
    });
    expect(params).toEqual({
      mode: "subscription",
      "line_items[0][price]": "price_cny_1299",
      "line_items[0][quantity]": "1",
      success_url: "https://dream-reel.example/journal?upgraded=1",
      cancel_url: "https://dream-reel.example/journal?billing=cancelled",
      client_reference_id: "42",
      locale: "zh",
      "metadata[user_id]": "42",
      "metadata[plan]": "plus",
      "subscription_data[metadata][user_id]": "42",
      "subscription_data[metadata][plan]": "plus",
      customer_email: "reader@example.com",
    });
    expect(Object.keys(params).some((key) => key.startsWith("automatic_payment_methods"))).toBe(false);
  });

  it("sends en readers the USD price and an English Checkout", async () => {
    await checkout(post("/api/billing/checkout", { lang: "en", from: "/account" }));
    const { params } = sentParams();
    expect(params["line_items[0][price]"]).toBe("price_usd_199");
    expect(params.locale).toBe("en");
    expect(params.success_url).toBe("https://dream-reel.example/account?upgraded=1");
    expect(params.cancel_url).toBe("https://dream-reel.example/account?billing=cancelled");
  });

  it("ignores a client-sent currency and unknown return pages", async () => {
    await checkout(post("/api/billing/checkout", { lang: "en", currency: "cny", from: "https://evil.example/" }));
    const { params } = sentParams();
    expect(params["line_items[0][price]"]).toBe("price_usd_199");
    expect(params.cancel_url).toBe("https://dream-reel.example/pricing?billing=cancelled");
  });

  it("is unavailable in production without NEXT_PUBLIC_APP_URL (no Host-header return URLs)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const res = await checkout(post("/api/billing/checkout", { lang: "zh" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "BILLING_UNAVAILABLE" });
    billing.getStripeCustomerId.mockResolvedValue("cus_existing");
    expect((await portal(post("/api/billing/portal", {}))).status).toBe(503);
    expect(await (await status()).json()).toMatchObject({ checkoutAvailable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the request origin without NEXT_PUBLIC_APP_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await checkout(post("/api/billing/checkout", { lang: "zh" }));
    expect(sentParams().params.success_url).toBe("http://localhost:3000/pricing?upgraded=1");
  });

  it("reuses the reader's Stripe customer instead of creating another", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_existing");
    await checkout(post("/api/billing/checkout", { lang: "zh" }));
    const { params } = sentParams();
    expect(params.customer).toBe("cus_existing");
    expect(params.customer_email).toBeUndefined();
    expect(billing.getStripeCustomerId).toHaveBeenCalledWith(42);
  });

  it("starts over with the email when the stored customer was deleted in Stripe", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_deleted");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "resource_missing", param: "customer", message: "No such customer" } }), { status: 400 }))
      .mockResolvedValueOnce(stripeOk({ url: "https://checkout.stripe.com/c/pay/cs_test_2" }));
    const res = await checkout(post("/api/billing/checkout", { lang: "en" }));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_2" });
    expect(sentParams(0).params.customer).toBe("cus_deleted");
    expect(sentParams(1).params.customer).toBeUndefined();
    expect(sentParams(1).params.customer_email).toBe("reader@example.com");
  });

  it("starts over with the email when the stored customer bills in the other currency", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_cny");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "You cannot combine currencies on a single customer." } }), { status: 400 }))
      .mockResolvedValueOnce(stripeOk({ url: "https://checkout.stripe.com/c/pay/cs_test_3" }));
    const res = await checkout(post("/api/billing/checkout", { lang: "en" }));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_3" });
    expect(sentParams(1).params.customer).toBeUndefined();
    expect(sentParams(1).params["line_items[0][price]"]).toBe("price_usd_199");
  });

  it("does not retry other Stripe rejections", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_existing");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "No such price", param: "line_items[0][price]" } }), { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await checkout(post("/api/billing/checkout", { lang: "en" }))).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...freeStatus, plan: "plus", subscriptionStatus: "active" }],
    [{ ...freeStatus, subscriptionStatus: "past_due" }],
    [{ ...freeStatus, subscriptionStatus: "unpaid" }],
  ])("refuses a second subscription (%j)", async (current) => {
    billing.getBillingStatus.mockResolvedValue(current);
    const res = await checkout(post("/api/billing/checkout", { lang: "zh" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ALREADY_SUBSCRIBED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a quota-exempt account through to checkout", async () => {
    billing.getBillingStatus.mockResolvedValue({ ...freeStatus, plan: "plus", isUnlimited: true, subscriptionStatus: "admin" });
    expect((await checkout(post("/api/billing/checkout", { lang: "zh" }))).status).toBe(200);
  });

  it("hides Stripe's own error text behind PAYMENT_ERROR", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Received unknown parameter: foo", code: "parameter_unknown" } }), { status: 400 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await checkout(post("/api/billing/checkout", { lang: "zh" }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "PAYMENT_ERROR" });
    expect(text).not.toContain("unknown parameter");
    expect(JSON.stringify(log.mock.calls)).not.toContain("sk_test_123");
  });

  it("treats a network failure as PAYMENT_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await checkout(post("/api/billing/checkout", { lang: "zh" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "PAYMENT_ERROR" });
  });
});

describe("POST /api/billing/portal", () => {
  it("rejects a signed-out reader", async () => {
    auth.mockResolvedValue(null);
    expect((await portal(post("/api/billing/portal", {}))).status).toBe(401);
  });

  it("answers BILLING_UNAVAILABLE without a secret key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await portal(post("/api/billing/portal", {}));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "BILLING_UNAVAILABLE" });
  });

  it("answers NO_SUBSCRIPTION when the reader has no Stripe customer", async () => {
    const res = await portal(post("/api/billing/portal", { lang: "en" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NO_SUBSCRIPTION" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the portal for the stored customer and returns to the account page", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_existing");
    fetchMock.mockResolvedValue(stripeOk({ url: "https://billing.stripe.com/p/session/test_1" }));
    const res = await portal(post("/api/billing/portal", { lang: "en" }));
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/p/session/test_1" });
    const { url, params } = sentParams();
    expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(params).toEqual({ customer: "cus_existing", return_url: "https://dream-reel.example/account", locale: "en" });
  });

  it("treats a customer Stripe no longer knows as NO_SUBSCRIPTION", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_gone");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "resource_missing", param: "customer", message: "No such customer" } }), { status: 400 }));
    const res = await portal(post("/api/billing/portal", {}));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NO_SUBSCRIPTION" });
  });

  it("hides portal failures behind PAYMENT_ERROR", async () => {
    billing.getStripeCustomerId.mockResolvedValue("cus_existing");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "No configuration provided" } }), { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await portal(post("/api/billing/portal", {}));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "PAYMENT_ERROR" });
  });
});

describe("GET /api/billing/status", () => {
  it("says whether checkout is available, and nothing about which setting is missing", async () => {
    let res = await status();
    expect(await res.json()).toEqual({ ...freeStatus, checkoutAvailable: true });
    vi.stubEnv("STRIPE_PLUS_PRICE_ID_CNY", "");
    res = await status();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ...freeStatus, checkoutAvailable: false });
    expect(text).not.toMatch(/STRIPE/);
  });

  it("rejects a signed-out reader", async () => {
    auth.mockResolvedValue(null);
    expect((await status()).status).toBe(401);
  });
});
