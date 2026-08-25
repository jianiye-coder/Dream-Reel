import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAgentFeedbackMetrics } from "@/lib/agentFeedback";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import { getDreamAgentFunnelMetrics } from "@/lib/dreamAgentMetrics";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth() as { user?: { email?: string | null } } | null;
  if (!process.env.ADMIN_EMAIL || session?.user?.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rawDays = Number(new URL(request.url).searchParams.get("days") ?? "7");
  if (!Number.isInteger(rawDays) || rawDays < 1 || rawDays > 90) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  try {
    const [feedback, funnel] = await Promise.all([
      getAgentFeedbackMetrics(rawDays),
      getDreamAgentFunnelMetrics(rawDays),
    ]);
    return NextResponse.json({ ...feedback, funnel });
  } catch (error) {
    console.error("GET /api/admin/agent-feedback failed", safeErrorMetadata(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
