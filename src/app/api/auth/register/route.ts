export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getPool } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const json = await request.json() as unknown;
    const parsed = registerSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "请填写正确的信息" }, { status: 400 });
    }

    const { name, email, password } = parsed.data;
    const pool = getPool();

    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );

    if (existing.length > 0) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)`,
      [name, email, passwordHash],
    );

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/auth/register failed", error);
    return NextResponse.json({ error: "注册失败" }, { status: 500 });
  }
}
