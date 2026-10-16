import { NextRequest } from "next/server";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { getBillingStatus, getStripeCustomerId } from "@/lib/billing";
import { errorJson, privateJson, returnPage, sessionUser } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import {
  appOrigin,
  isCheckoutConfigured,
  plusPriceId,
  StripeApiError,
  stripeRequest,
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
}) {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${input.origin}${input.from}?upgraded=1`);
  params.set("cancel_url", `${input.origin}${input.from}?billing=cancelled`);
  params.set("client_reference_id", String(input.userId));
  params.set("locale", input.lang);
  params.set("metadata[user_id]", String(input.userId));
  params.set("metadata[plan]", "plus");
  params.set("subscription_data[metadata][user_id]", String(input.userId));
  params.set("subscription_data[metadata][plan]", "plus");
  // Payment methods come from the Dashboard (dynamic payment methods); Checkout has no
  // automatic_payment_methods parameter. In subscription mode Checkout creates the customer
  // itself, so only an existing one is passed.
  if (input.customerId) params.set("customer", input.customerId);
  else if (input.email) params.set("customer_email", input.email);
  return params;
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

    let session: { url?: string | null };
    try {
      session = await stripeRequest("POST", "/checkout/sessions", checkoutParams(input));
    } catch (error) {
      // the stored customer was deleted in the Dashboard, or already bills in the other
      // currency (a customer can't mix currencies): let Checkout create a fresh one
      const customerRejected = error instanceof StripeApiError && error.status === 400 && input.customerId &&
        (error.param === "customer" || /currenc/i.test(error.message));
      if (!customerRejected) throw error;
      session = await stripeRequest("POST", "/checkout/sessions", checkoutParams({ ...input, customerId: null }));
    }

    if (!session.url) return errorJson(API_ERROR_CODES.paymentError, 502);
    return privateJson({ url: session.url });
  } catch (error) {
    console.error("[billing] checkout failed", {
      ...safeErrorMetadata(error),
      ...(error instanceof StripeApiError ? { status: error.status, stripeCode: error.code, stripeParam: error.param } : {}),
    });
    return errorJson(API_ERROR_CODES.paymentError, 502);
  }
}
