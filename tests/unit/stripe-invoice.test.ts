import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceForRefund } from "@/lib/stripe";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("invoiceForRefund across API shapes", () => {
  it("asks for the invoice with its payments expanded (Basil+) and uses the paid one", async () => {
    fetchMock.mockResolvedValueOnce(json({
      amount_paid: 1299, billing_reason: "subscription_create",
      payments: { data: [{ status: "canceled", payment: { payment_intent: "pi_old" } }, { status: "paid", payment: { type: "payment_intent", payment_intent: "pi_paid" } }] },
    }));
    expect(await invoiceForRefund("in_1")).toEqual({ amountPaid: 1299, billingReason: "subscription_create", payment: ["payment_intent", "pi_paid"] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.stripe.com/v1/invoices/in_1?expand%5B%5D=payments");
  });

  it("falls back to payment_intent / charge on the invoice (older versions)", async () => {
    fetchMock.mockResolvedValueOnce(json({ amount_paid: 199, billing_reason: "subscription_create", payment_intent: { id: "pi_direct" } }));
    expect((await invoiceForRefund("in_2")).payment).toEqual(["payment_intent", "pi_direct"]);
    fetchMock.mockResolvedValueOnce(json({ amount_paid: 199, billing_reason: "subscription_create", charge: "ch_direct" }));
    expect((await invoiceForRefund("in_3")).payment).toEqual(["charge", "ch_direct"]);
  });

  it("uses the invoice_payments list as the last resort, and survives its absence", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ amount_paid: 199, billing_reason: "subscription_create" }))
      .mockResolvedValueOnce(json({ data: [{ status: "paid", payment: { type: "charge", charge: "ch_listed" } }] }));
    expect((await invoiceForRefund("in_4")).payment).toEqual(["charge", "ch_listed"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/invoice_payments?invoice=in_4");

    fetchMock
      .mockResolvedValueOnce(json({ amount_paid: 199, billing_reason: "subscription_create" }))
      .mockResolvedValueOnce(json({ error: { message: "Unrecognized request URL" } }, 404));
    expect((await invoiceForRefund("in_5")).payment).toBeNull();
  });

  it("doesn't look for a payment on a $0 invoice and lets transient failures through", async () => {
    fetchMock.mockResolvedValueOnce(json({ amount_paid: 0, billing_reason: "subscription_create" }));
    expect(await invoiceForRefund("in_6")).toEqual({ amountPaid: 0, billingReason: "subscription_create", payment: null });
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock
      .mockResolvedValueOnce(json({ amount_paid: 199 }))
      .mockResolvedValueOnce(json({ error: { message: "busy" } }, 503));
    await expect(invoiceForRefund("in_7")).rejects.toMatchObject({ status: 503 });
  });
});

describe("charge → invoice → subscription", () => {
  it("reads the subscription from Basil's parent, else the older field", async () => {
    const { subscriptionOfInvoice } = await import("@/lib/stripe");
    expect(subscriptionOfInvoice({ parent: { subscription_details: { subscription: "sub_basil" } }, subscription: "sub_old" })).toBe("sub_basil");
    expect(subscriptionOfInvoice({ subscription: { id: "sub_old" } })).toBe("sub_old");
    expect(subscriptionOfInvoice({ parent: null })).toBeNull();
  });

  it("goes PaymentIntent → invoice payments → invoice, with the payment filter Stripe documents", async () => {
    const { subscriptionForCharge } = await import("@/lib/stripe");
    fetchMock
      .mockResolvedValueOnce(json({ data: [{ invoice: "in_9" }] }))
      .mockResolvedValueOnce(json({ parent: { subscription_details: { subscription: "sub_9" } } }));
    expect(await subscriptionForCharge({ payment_intent: "pi_9" })).toBe("sub_9");
    const listUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(listUrl.pathname).toBe("/v1/invoice_payments");
    expect(listUrl.searchParams.get("payment[type]")).toBe("payment_intent");
    expect(listUrl.searchParams.get("payment[payment_intent]")).toBe("pi_9");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.stripe.com/v1/invoices/in_9");
  });

  it("returns null for a charge without an invoice", async () => {
    const { subscriptionForCharge } = await import("@/lib/stripe");
    fetchMock.mockResolvedValueOnce(json({ data: [] }));
    expect(await subscriptionForCharge({ payment_intent: "pi_oneoff" })).toBeNull();
    expect(await subscriptionForCharge({})).toBeNull();
  });
});
