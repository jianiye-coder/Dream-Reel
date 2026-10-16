import { NextRequest } from "next/server";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { getStripeCustomerId } from "@/lib/billing";
import { errorJson, privateJson, sessionUser } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import { appOrigin, StripeApiError, stripeRequest, stripeSecretKey } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return errorJson(API_ERROR_CODES.unauthorized, 401);

  if (!stripeSecretKey()) return errorJson(API_ERROR_CODES.billingUnavailable, 503);

  const body = await request.json().catch(() => ({})) as { lang?: unknown };

  try {
    const customerId = await getStripeCustomerId(user.id);
    if (!customerId) return errorJson(API_ERROR_CODES.noSubscription, 404);

    const params = new URLSearchParams();
    params.set("customer", customerId);
    params.set("return_url", `${appOrigin(request.nextUrl.origin)}/account`);
    params.set("locale", body.lang === "en" ? "en" : "zh");

    const session = await stripeRequest<{ url?: string | null }>("POST", "/billing_portal/sessions", params);
    if (!session.url) return errorJson(API_ERROR_CODES.paymentError, 502);
    return privateJson({ url: session.url });
  } catch (error) {
    if (error instanceof StripeApiError && error.code === "resource_missing" && error.param === "customer") {
      return errorJson(API_ERROR_CODES.noSubscription, 404);
    }
    console.error("[billing] portal failed", {
      ...safeErrorMetadata(error),
      ...(error instanceof StripeApiError ? { status: error.status, stripeCode: error.code, stripeParam: error.param } : {}),
    });
    return errorJson(API_ERROR_CODES.paymentError, 502);
  }
}
