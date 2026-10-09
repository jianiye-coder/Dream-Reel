import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import {
  deleteMorningPage,
  getMorningPage,
  listMorningPages,
  MorningPageConflictError,
  morningPageDateSchema,
  morningPageDeleteSchema,
  morningPagePutSchema,
  putMorningPage,
} from "@/lib/morningPages";

export const runtime = "nodejs";

const userIdSchema = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));
const privateHeaders = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

async function authenticatedUserId() {
  const session = await auth();
  const parsed = userIdSchema.safeParse(session?.user?.id);
  return parsed.success ? parsed.data : null;
}

function failure(error: unknown) {
  if (error instanceof MorningPageConflictError) {
    return json({ error: "CONFLICT" }, 409);
  }
  // Do not log database errors, request bodies, or decrypted writing.
  return json({ error: API_ERROR_CODES.internalError }, 500);
}

export async function GET(request: NextRequest) {
  try {
    const userId = await authenticatedUserId();
    if (userId === null) return json({ error: API_ERROR_CODES.unauthorized }, 401);

    const dates = request.nextUrl.searchParams.getAll("date");
    if (!dates.length) return json({ entries: await listMorningPages(userId) });
    const parsed = morningPageDateSchema.safeParse(dates[0]);
    if (dates.length !== 1 || !parsed.success) {
      return json({ error: API_ERROR_CODES.invalidRequest }, 400);
    }
    return json({ entry: await getMorningPage(userId, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await authenticatedUserId();
    if (userId === null) return json({ error: API_ERROR_CODES.unauthorized }, 401);

    const parsed = morningPagePutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: API_ERROR_CODES.invalidRequest }, 400);
    return json({ entry: await putMorningPage(userId, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await authenticatedUserId();
    if (userId === null) return json({ error: API_ERROR_CODES.unauthorized }, 401);

    const parsed = morningPageDeleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: API_ERROR_CODES.invalidRequest }, 400);
    await deleteMorningPage(userId, parsed.data);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export function POST() {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

export const PATCH = POST;

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...privateHeaders, Allow: "GET, HEAD, PUT, DELETE, OPTIONS" },
  });
}
