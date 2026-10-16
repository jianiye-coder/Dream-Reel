import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { API_ERROR_CODES } from "@/lib/apiErrors";

// users.id is a Postgres integer
const MAX_USER_ID = 2_147_483_647;

/** A session user id ("42") as a positive integer, or null for anything else. */
export function parseUserId(id: unknown): number | null {
  if (typeof id !== "string" || !/^[1-9]\d{0,9}$/.test(id)) return null;
  const value = Number(id);
  return value <= MAX_USER_ID ? value : null;
}

/** The signed-in user's id, or null without a valid session. */
export async function sessionUserId(): Promise<number | null> {
  const session = (await auth()) as { user?: { id?: string } } | null;
  return parseUserId(session?.user?.id);
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
