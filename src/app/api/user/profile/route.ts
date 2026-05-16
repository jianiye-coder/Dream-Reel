export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getPool } from "@/lib/db";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function PUT(request: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "用户名不合法" }, { status: 400 });

  const pool = getPool();
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [parsed.data.name, Number(session.user.id)]);
  return NextResponse.json({ ok: true });
}
