import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import type { ApiErrorCode } from "@/lib/apiErrors";

/* Small shared pieces of the /api/billing routes. Responses are per-user, so never cached. */

const userIdSchema = z.union([z.string(), z.number()]).transform(String)
  .pipe(z.string().regex(/^[1-9]\d*$/)).transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));

export function parseUserId(value: unknown): number | null {
  const parsed = userIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function sessionUser() {
  const session = await auth() as { user?: { id?: string; email?: string | null } } | null;
  const id = parseUserId(session?.user?.id);
  return id ? { id, email: session?.user?.email ?? null } : null;
}

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
