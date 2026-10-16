import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appOrigin,
  isCheckoutConfigured,
  signStripePayload,
  subscriptionPeriod,
  verifyStripeSignature,
} from "@/lib/stripe";

const secret = "whsec_test_secret";
const now = 1_760_000_000_000;
const t = Math.floor(now / 1000);
const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", note: "梦 — ünïcode" });
// computed independently of the code under test
const sign = (payload: string | Buffer, key = secret, ts = t) =>
  createHmac("sha256", key).update(Buffer.concat([Buffer.from(`${ts}.`), Buffer.from(payload)])).digest("hex");

describe("verifyStripeSignature", () => {
  it("accepts a valid v1 signature over the raw body (string or bytes)", () => {
    const header = `t=${t},v1=${sign(body)}`;
    expect(verifyStripeSignature(body, header, secret, { now })).toBe(true);
    expect(verifyStripeSignature(Buffer.from(body, "utf8"), header, secret, { now })).toBe(true);
  });

  it("agrees with the signing helper used by tests and tooling", () => {
    expect(verifyStripeSignature(body, signStripePayload(body, secret, t), secret, { now })).toBe(true);
  });

  it("rejects a different secret, a tampered body and a re-serialised body", () => {
    const header = `t=${t},v1=${sign(body)}`;
    expect(verifyStripeSignature(body, header, "whsec_other", { now })).toBe(false);
    expect(verifyStripeSignature(body.replace("evt_1", "evt_2"), header, secret, { now })).toBe(false);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyStripeSignature(reserialised, header, secret, { now })).toBe(false);
  });

  it("accepts any of several v1 signatures (secret rolling) and ignores v0", () => {
    const header = `t=${t},v1=${sign(body, "whsec_old")},v1=${sign(body)},v0=${"0".repeat(64)}`;
    expect(verifyStripeSignature(body, header, secret, { now })).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v0=${sign(body)}`, secret, { now })).toBe(false);
  });

  it("tolerates spaces around header parts", () => {
    expect(verifyStripeSignature(body, ` t=${t} , v1=${sign(body)} `, secret, { now })).toBe(true);
  });

  it("enforces the five-minute timestamp tolerance both ways", () => {
    const old = t - 301;
    const future = t + 301;
    expect(verifyStripeSignature(body, `t=${old},v1=${sign(body, secret, old)}`, secret, { now })).toBe(false);
    expect(verifyStripeSignature(body, `t=${future},v1=${sign(body, secret, future)}`, secret, { now })).toBe(false);
    const edge = t - 300;
    expect(verifyStripeSignature(body, `t=${edge},v1=${sign(body, secret, edge)}`, secret, { now })).toBe(true);
    expect(verifyStripeSignature(body, `t=${old},v1=${sign(body, secret, old)}`, secret, { now, toleranceSeconds: 600 })).toBe(true);
  });

  it.each([
    [null],
    [""],
    ["garbage"],
    [`v1=${"a".repeat(64)}`],
    [`t=${t}`],
    [`t=abc,v1=${"a".repeat(64)}`],
    [`t=${t}.5,v1=${"a".repeat(64)}`],
    [`t=${t},v1=not-hex-at-all`],
    [`t=${t},v1=${"a".repeat(63)}`],
  ])("rejects malformed header %j", (header) => {
    expect(verifyStripeSignature(body, header, secret, { now })).toBe(false);
  });

  it("rejects everything when the secret is empty", () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${sign(body, "")}`, "", { now })).toBe(false);
  });
});

describe("Stripe configuration", () => {
  afterEach(() => vi.unstubAllEnvs());
  const full = {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_PLUS_PRICE_ID_USD: "price_usd",
    STRIPE_PLUS_PRICE_ID_CNY: "price_cny",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
  };

  it("needs the key, both prices and the webhook secret", () => {
    expect(isCheckoutConfigured(full)).toBe(true);
    for (const name of Object.keys(full)) {
      expect(isCheckoutConfigured({ ...full, [name]: undefined })).toBe(false);
      expect(isCheckoutConfigured({ ...full, [name]: "  " })).toBe(false);
    }
    expect(isCheckoutConfigured({})).toBe(false);
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
  it("reads the period from items (API 2025-03-31.basil and later)", () => {
    const period = subscriptionPeriod({
      id: "sub_1", customer: "cus_1", status: "active",
      items: { data: [{ current_period_start: 1_760_000_000, current_period_end: 1_762_592_000 }] },
    });
    expect(period.start?.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
    expect(period.end?.toISOString()).toBe(new Date(1_762_592_000_000).toISOString());
  });

  it("still reads the older top-level fields", () => {
    const period = subscriptionPeriod({
      id: "sub_1", customer: "cus_1", status: "active", current_period_start: 10, current_period_end: 20,
    });
    expect(period.start?.getTime()).toBe(10_000);
    expect(period.end?.getTime()).toBe(20_000);
  });

  it("returns nulls when Stripe sends no period", () => {
    expect(subscriptionPeriod({ id: "sub_1", customer: "cus_1", status: "incomplete" })).toEqual({ start: null, end: null });
  });
});
