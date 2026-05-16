export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getWeeklyRecap } from "@/lib/dreams";
import { auth } from "@/auth";

export async function GET() {
  try {
    const session = await auth();
    const rawId = session?.user?.id ? parseInt(session.user.id, 10) : NaN;
    const userId = isNaN(rawId) ? undefined : rawId;
    const recap = await getWeeklyRecap(userId);
    return NextResponse.json({ recap });
  } catch (error) {
    console.error("GET /api/weekly-recap failed", error);
    return NextResponse.json({ error: "无法生成本周回顾" }, { status: 500 });
  }
}
