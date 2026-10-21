import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appOrigin,
  billsPlusPrice,
  isCheckoutConfigured,
  STRIPE_API_VERSION,
  stripeClient,
  subscriptionPeriod,
  verifiedEvent,
  type StripeSubscription,
} from "@/lib/stripe";

const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_1", note: "梦 — ünïcode" } } });
const nowSec = () => Math.floor(Date.now() / 1000);
// computed independently of the SDK under test
const sign = (payload: string | Buffer, key = secret, ts = nowSec()) =>
  `t=${ts},v1=` + createHmac("sha256", key).update(Buffer.concat([Buffer.from(`${ts}.`), Buffer.from(payload)])).digest("hex");
const raw = (text: string) => Buffer.from(text, "utf8");
const asSubscription = (value: unknown) => value as StripeSubscription;

describe("webhook verification (stripe.webhooks.constructEvent)", () => {
  beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x"));
  afterEach(() => vi.unstubAllEnvs());

  it("returns the event for a valid v1 signature over the raw bytes", () => {
    expect(verifiedEvent(raw(body), sign(body), secret)).toMatchObject({ id: "evt_1", type: "customer.subscription.updated" });
  });

  it("rejects a different secret, a tampered body and a re-serialised body", () => {
    const header = sign(body);
    expect(verifiedEvent(raw(body), header, "whsec_other")).toBeNull();
    expect(verifiedEvent(raw(body.replace("evt_1", "evt_2")), header, secret)).toBeNull();
    expect(verifiedEvent(raw(JSON.stringify(JSON.parse(body), null, 2)), header, secret)).toBeNull();
  });

  it("accepts any of several v1 signatures (secret rolling) and ignores v0", () => {
    const t = nowSec();
    const v1 = (key: string) => sign(body, key, t).split(",")[1];
    expect(verifiedEvent(raw(body), `t=${t},${v1("whsec_old")},${v1(secret)},v0=${"0".repeat(64)}`, secret)).not.toBeNull();
    expect(verifiedEvent(raw(body), `t=${t},${v1(secret).replace("v1=", "v0=")}`, secret)).toBeNull();
  });

  it("enforces the five-minute tolerance", () => {
    expect(verifiedEvent(raw(body), sign(body, secret, nowSec() - 301), secret)).toBeNull();
    expect(verifiedEvent(raw(body), sign(body, secret, nowSec() - 290), secret)).not.toBeNull();
  });

  it.each([[null], [""], ["garbage"], [`v1=${"a".repeat(64)}`], [`t=${nowSec()}`], [`t=${nowSec()},v1=not-hex`]])(
    "rejects malformed header %j", (header) => {
      expect(verifiedEvent(raw(body), header, secret)).toBeNull();
    },
  );

  it("fails closed on an empty secret and throws on a signed body that isn't JSON", () => {
    expect(verifiedEvent(raw(body), sign(body, ""), "")).toBeNull();
    expect(() => verifiedEvent(raw("not json"), sign("not json"), secret)).toThrow();
  });

  it("creates one client, pinned to the API version, only when configured", () => {
    const client = stripeClient();
    expect(client).not.toBeNull();
    expect(stripeClient()).toBe(client);
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeClient()).toBeNull();
  });
});

describe("Stripe configuration", () => {
  afterEach(() => vi.unstubAllEnvs());
  const full = {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_PLUS_PRICE_ID_USD: "price_usd",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
  } as Record<string, string | undefined>;

  it("needs the key, the price and the webhook secret", () => {
    expect(isCheckoutConfigured(full)).toBe(true);
    for (const name of Object.keys(full)) {
      expect(isCheckoutConfigured({ ...full, [name]: undefined })).toBe(false);
      expect(isCheckoutConfigured({ ...full, [name]: "  " })).toBe(false);
    }
    expect(isCheckoutConfigured({})).toBe(false);
  });

  it("needs NEXT_PUBLIC_APP_URL in production, not locally", () => {
    expect(isCheckoutConfigured({ ...full, NODE_ENV: "production" })).toBe(false);
    expect(isCheckoutConfigured({ ...full, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "not a url" })).toBe(false);
    expect(isCheckoutConfigured({ ...full, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "javascript:alert(1)" })).toBe(false);
    expect(isCheckoutConfigured({ ...full, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://dream-reel.vercel.app" })).toBe(true);
    expect(isCheckoutConfigured({ ...full, NODE_ENV: "development" })).toBe(true);
    expect(isCheckoutConfigured({ ...full, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://dream-reel.vercel.app" })).toBe(false);
    expect(appOrigin("http://localhost:3000", { NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3033" })).toBe("http://localhost:3033");
    // production never builds Stripe return URLs from the request's Host header
    expect(appOrigin("https://attacker.example", { NODE_ENV: "production" })).toBeNull();
    expect(appOrigin("https://attacker.example", { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://dream-reel.vercel.app/x" })).toBe("https://dream-reel.vercel.app");
  });

  it("recognises only the configured Plus prices", () => {
    const sub = (price: unknown) => asSubscription({ id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price }] } });
    expect(billsPlusPrice(sub({ id: "price_usd" }), full)).toBe(true);
    expect(billsPlusPrice(sub("price_usd"), full)).toBe(true);
    expect(billsPlusPrice(sub({ id: "price_cny" }), full)).toBe(false);
    expect(billsPlusPrice(sub({ id: "price_other" }), full)).toBe(false);
    expect(billsPlusPrice(asSubscription({ id: "sub_1", customer: "cus_1", status: "active" }), full)).toBe(false);
    expect(billsPlusPrice(sub({ id: "price_usd" }), {})).toBe(false);
  });

  it("uses NEXT_PUBLIC_APP_URL's origin, else the request origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dream-reel.vercel.app/");
    expect(appOrigin("http://localhost:3000")).toBe("https://dream-reel.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("subscriptionPeriod", () => {
  it("reads the period from items (basil and later, including dahlia)", () => {
    const period = subscriptionPeriod(asSubscription({
      id: "sub_1", customer: "cus_1", status: "active",
      items: { data: [{ current_period_start: 1_760_000_000, current_period_end: 1_762_592_000 }] },
    }));
    expect(period.start?.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
    expect(period.end?.toISOString()).toBe(new Date(1_762_592_000_000).toISOString());
  });

  it("returns nulls when Stripe sends no period", () => {
    expect(subscriptionPeriod(asSubscription({ id: "sub_1", customer: "cus_1", status: "incomplete" }))).toEqual({ start: null, end: null });
  });
});
