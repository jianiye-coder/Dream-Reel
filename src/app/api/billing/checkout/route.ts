import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { getBillingStatus, getStripeCustomerId } from "@/lib/billing";
import { errorJson, privateJson, returnPage, sessionUser } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import {
  appOrigin,
  isCheckoutConfigured,
  CHECKOUT_INTEGRATION_IDENTIFIER,
  plusPriceId,
  requireStripe,
  stripeErrorInfo,
  type BillingLang,
} from "@/lib/stripe";

export const runtime = "nodejs";

// a subscription in these states is still the reader's: send them to the portal, not to a second checkout
const OPEN_SUBSCRIPTION_STATUSES = new Set(["past_due", "unpaid"]);

function checkoutParams(input: {
  userId: number;
  email: string | null;
  customerId: string | null;
  priceId: string;
  lang: BillingLang;
  origin: string;
  from: string;
}): Stripe.Checkout.SessionCreateParams {
  const ids = { user_id: String(input.userId), plan: "plus" };
  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${input.origin}${input.from}?upgraded=1`,
    cancel_url: `${input.origin}${input.from}?billing=cancelled`,
    client_reference_id: String(input.userId),
    locale: input.lang,
    metadata: ids,
    subscription_data: { metadata: ids },
    integration_identifier: CHECKOUT_INTEGRATION_IDENTIFIER,
    // No payment_method_types: dynamic payment methods from the Dashboard. In subscription mode
    // Checkout creates the customer itself, so only an existing one is passed.
    ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
  };
}

export async function POST(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return errorJson(API_ERROR_CODES.unauthorized, 401);

  if (!isCheckoutConfigured()) return errorJson(API_ERROR_CODES.billingUnavailable, 503);

  const body = await request.json().catch(() => ({})) as { lang?: unknown; from?: unknown };
  const lang: BillingLang = body.lang === "en" ? "en" : "zh";
  const priceId = plusPriceId(lang);
  const origin = appOrigin(request.nextUrl.origin);
  if (!priceId || !origin) return errorJson(API_ERROR_CODES.billingUnavailable, 503);

  try {
    const status = await getBillingStatus(user.id);
    if (!status.isUnlimited && (status.plan === "plus" || OPEN_SUBSCRIPTION_STATUSES.has(status.subscriptionStatus ?? ""))) {
      return errorJson(API_ERROR_CODES.alreadySubscribed, 409);
    }

    const input = {
      userId: user.id,
      email: user.email,
      customerId: await getStripeCustomerId(user.id),
      priceId,
      lang,
      origin,
      from: returnPage(body.from),
    };

    const sessions = requireStripe().checkout.sessions;
    let session: Stripe.Checkout.Session;
    try {
      session = await sessions.create(checkoutParams(input));
    } catch (error) {
      // the stored customer was deleted in the Dashboard, or already bills in the other
      // currency (a customer can't mix currencies): let Checkout create a fresh one
      const info = stripeErrorInfo(error);
      const customerRejected = info.status === 400 && input.customerId &&
        (info.param === "customer" || /currenc/i.test((error as Error).message));
      if (!customerRejected) throw error;
      session = await sessions.create(checkoutParams({ ...input, customerId: null }));
    }

    if (!session.url) return errorJson(API_ERROR_CODES.paymentError, 502);
    return privateJson({ url: session.url });
  } catch (error) {
    console.error("[billing] checkout failed", {
      ...safeErrorMetadata(error),
      ...stripeErrorInfo(error),
    });
    return errorJson(API_ERROR_CODES.paymentError, 502);
  }
}
