import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBillingStatus } from "@/lib/billing";

export const runtime = "nodejs";

function parseUserId(id: string | undefined) {
  if (!id) return null;
  const value = Number(id);
  return Number.isFinite(value) ? value : null;
}

export async function GET() {
  const session = await auth() as { user?: { id?: string } } | null;
  const userId = parseUserId(session?.user?.id);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getBillingStatus(userId);
  return NextResponse.json(status);
}
