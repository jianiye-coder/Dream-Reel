export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getPool } from "@/lib/db";
import bcrypt from "bcryptjs";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export async function PUT(request: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "新密码至少 6 位" }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [Number(session.user.id)]);
  if (!rows[0]?.password_hash) {
    return NextResponse.json({ error: "该账号使用第三方登录，无法修改密码" }, { status: 400 });
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash as string);
  if (!valid) return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, Number(session.user.id)]);
  return NextResponse.json({ ok: true });
}
