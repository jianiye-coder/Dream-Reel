export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { getPool } from "@/lib/db";
import { API_ERROR_CODES } from "@/lib/apiErrors";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function PUT(request: NextRequest) {
  // the account page turns these codes into copy with getApiErrorMessage
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: API_ERROR_CODES.invalidName }, { status: 400 });

  const pool = getPool();
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [parsed.data.name, userId]);
  return NextResponse.json({ ok: true });
}
