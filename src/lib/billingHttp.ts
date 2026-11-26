import { NextResponse } from "next/server";
import type { ApiErrorCode } from "@/lib/apiErrors";

/* Small shared pieces of the /api/billing routes. Responses are per-user, so never cached. */

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function errorJson(error: ApiErrorCode, status: number) {
  return privateJson({ error }, status);
}

// pages that can start a checkout, and so the pages Stripe may send the reader back to
export const BILLING_RETURN_PAGES = ["/pricing", "/account", "/journal"] as const;
export type BillingReturnPage = typeof BILLING_RETURN_PAGES[number];

export function returnPage(value: unknown): BillingReturnPage {
  return BILLING_RETURN_PAGES.find((page) => page === value) ?? "/pricing";
}
