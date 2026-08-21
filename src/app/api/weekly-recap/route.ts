export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getWeeklyRecap } from "@/lib/dreams";
import { auth } from "@/auth";
import { API_ERROR_CODES } from "@/lib/apiErrors";

export async function GET() {
  try {
    const session = await auth();
    const rawId = session?.user?.id ? parseInt(session.user.id, 10) : NaN;
    const userId = Number.isInteger(rawId) && rawId > 0 ? rawId : undefined;
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const recap = await getWeeklyRecap(userId);
    return NextResponse.json({ recap });
  } catch (error) {
    console.error("GET /api/weekly-recap failed", error);
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}
