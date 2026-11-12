export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { getPool } from "@/lib/db";
import bcrypt from "bcryptjs";
import { clearAuthAttempts, consumeAuthAttempt, getTrustedClientIp } from "@/lib/authRateLimit";
import { API_ERROR_CODES } from "@/lib/apiErrors";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export async function PUT(request: NextRequest) {
  // the account page turns these codes into copy with getApiErrorMessage
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const newPasswordOnly = parsed.error.issues.every((issue) => issue.path[0] === "newPassword");
    return NextResponse.json(
      { error: newPasswordOnly ? API_ERROR_CODES.invalidNewPassword : API_ERROR_CODES.invalidRequest },
      { status: 400 },
    );
  }

  const identifier = `user:${userId}`;
  const ipAddress = getTrustedClientIp(request.headers);
  const rateLimit = await consumeAuthAttempt("password", identifier, ipAddress);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: API_ERROR_CODES.rateLimited },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!rows[0]?.password_hash) {
    return NextResponse.json({ error: API_ERROR_CODES.noPassword }, { status: 400 });
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash as string);
  if (!valid) return NextResponse.json({ error: API_ERROR_CODES.wrongPassword }, { status: 400 });

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, userId]);
  await clearAuthAttempts("password", identifier, ipAddress);
  return NextResponse.json({ ok: true });
}
