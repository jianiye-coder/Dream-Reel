import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { agentFeedbackSchema, saveAgentFeedback } from "@/lib/agentFeedback";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { safeErrorMetadata } from "@/lib/safeServerLog";
import { verifyDreamAgentFeedbackToken } from "@/lib/dreamAgentTelemetry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: API_ERROR_CODES.invalidRequest }, { status: 400 });
  }
  const parsed = agentFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: API_ERROR_CODES.invalidRequest }, { status: 400 });
  }
  const verified = verifyDreamAgentFeedbackToken(parsed.data.feedbackToken, userId);
  if (!verified) {
    return NextResponse.json({ error: API_ERROR_CODES.invalidRequest }, { status: 400 });
  }

  try {
    await saveAgentFeedback(userId, {
      interactionId: verified.interactionId,
      rating: parsed.data.rating,
      reason: parsed.data.reason,
      variant: verified.variant,
      policyVariant: verified.policyVariant,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/agent-feedback failed", safeErrorMetadata(error));
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}
