import { API_ERROR_CODES } from "@/lib/apiErrors";
import { getBillingStatus } from "@/lib/billing";
import { errorJson, privateJson, sessionUser } from "@/lib/billingHttp";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import { isCheckoutConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

export async function GET() {
  const user = await sessionUser();
  if (!user) return errorJson(API_ERROR_CODES.unauthorized, 401);

  try {
    const status = await getBillingStatus(user.id);
    // checkoutAvailable says only whether payments are switched on, never which setting is missing
    return privateJson({ ...status, checkoutAvailable: isCheckoutConfigured() });
  } catch (error) {
    console.error("[billing] status failed", safeErrorMetadata(error));
    return errorJson(API_ERROR_CODES.internalError, 500);
  }
}
