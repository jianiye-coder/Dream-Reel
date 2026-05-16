import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { addBonus, getCredits } from "@/lib/credits";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

async function requireAdmin() {
  const session = await auth() as { user?: { id?: string; email?: string | null } } | null;
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) return null;
  return session.user;
}

// GET /api/admin/credits?userId=123  — view any user's credits
// GET /api/admin/credits              — view your own credits
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("userId");
  const userId = rawId ? Number(rawId) : Number(admin.id);

  const credits = await getCredits(userId);
  return NextResponse.json({ userId, ...credits });
}

// POST /api/admin/credits  — add bonus credits
// body: { amount: number, userId?: number }
const schema = z.object({
  amount: z.number().int().min(1).max(9999),
  userId: z.number().int().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const targetId = parsed.data.userId ?? Number(admin.id);
  await addBonus(targetId, parsed.data.amount);

  // Return the new state
  const credits = await getCredits(targetId);
  return NextResponse.json({ ok: true, userId: targetId, ...credits });
}

// GET /api/admin/credits/users — list all users with their credit state
export async function PUT(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.name,
           COALESCE(c.used_today, 0) AS used_today,
           COALESCE(c.bonus, 0)      AS bonus,
           c.reset_date
    FROM users u
    LEFT JOIN user_credits c ON c.user_id = u.id
    ORDER BY u.id
  `);
  return NextResponse.json(rows);
}
