import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { API_ERROR_CODES } from "@/lib/apiErrors";

// users.id is a Postgres integer
const MAX_USER_ID = 2_147_483_647;

/** A user id string ("42": the session, Stripe metadata) as a positive integer, or null for anything else. */
export function parseUserId(id: unknown): number | null {
  if (typeof id !== "string" || !/^[1-9]\d{0,9}$/.test(id)) return null;
  const value = Number(id);
  return value <= MAX_USER_ID ? value : null;
}

/** The signed-in user's id and email, or null without a valid session. */
export async function sessionUser(): Promise<{ id: number; email: string | null } | null> {
  const session = (await auth()) as { user?: { id?: string; email?: string | null } } | null;
  const id = parseUserId(session?.user?.id);
  return id === null ? null : { id, email: session?.user?.email ?? null };
}

/** The signed-in user's id, or null without a valid session. */
export async function sessionUserId(): Promise<number | null> {
  return (await sessionUser())?.id ?? null;
}

/**
 * For route handlers: the signed-in user's id, or a 401 response to return as is.
 *
 *   const userId = await requireUserId();
 *   if (userId instanceof NextResponse) return userId;
 */
export async function requireUserId(
  init: { error?: string; headers?: HeadersInit } = {},
): Promise<number | NextResponse> {
  const userId = await sessionUserId();
  if (userId !== null) return userId;
  return NextResponse.json(
    { error: init.error ?? API_ERROR_CODES.unauthorized },
    { status: 401, headers: init.headers },
  );
}
