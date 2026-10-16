import { NextRequest } from "next/server";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { getStripeCustomerId } from "@/lib/billing";
import { errorJson, privateJson, sessionUser } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import { appOrigin, requireStripe, stripeErrorInfo, stripeSecretKey } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return errorJson(API_ERROR_CODES.unauthorized, 401);

  const origin = appOrigin(request.nextUrl.origin);
  if (!stripeSecretKey() || !origin) return errorJson(API_ERROR_CODES.billingUnavailable, 503);

  const body = await request.json().catch(() => ({})) as { lang?: unknown };

  try {
    const customerId = await getStripeCustomerId(user.id);
    if (!customerId) return errorJson(API_ERROR_CODES.noSubscription, 404);

    const session = await requireStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account`,
      locale: body.lang === "en" ? "en" : "zh",
    });
    if (!session.url) return errorJson(API_ERROR_CODES.paymentError, 502);
    return privateJson({ url: session.url });
  } catch (error) {
    const info = stripeErrorInfo(error);
    if (info.code === "resource_missing" && info.param === "customer") return errorJson(API_ERROR_CODES.noSubscription, 404);
    console.error("[billing] portal failed", { ...safeErrorMetadata(error), ...info });
    return errorJson(API_ERROR_CODES.paymentError, 502);
  }
}
