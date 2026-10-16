export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { getPool } from "@/lib/db";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function PUT(request: NextRequest) {
  // the account page shows this body as is
  const userId = await requireUserId({ error: "请先登录" });
  if (userId instanceof NextResponse) return userId;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "用户名不合法" }, { status: 400 });

  const pool = getPool();
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [parsed.data.name, userId]);
  return NextResponse.json({ ok: true });
}
