import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDreamAgentResponseMeta } from "@/lib/dreamAgentTelemetry";

const feedback = vi.hoisted(() => ({ saveAgentFeedback: vi.fn(async () => undefined) }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "11" } })) }));
vi.mock("@/lib/agentFeedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agentFeedback")>()),
  saveAgentFeedback: feedback.saveAgentFeedback,
}));

import { POST } from "@/app/api/agent-feedback/route";

describe("agent feedback API", () => {
  it("stores only validated, content-free feedback metadata", async () => {
    process.env.DREAM_AGENT_FEEDBACK_SECRET = "unit-test-feedback-secret";
    const meta = createDreamAgentResponseMeta("json-object-v1", "model", 10, 11);
    const input = {
      feedbackToken: meta.feedbackToken,
      rating: "down",
      reason: "repetitive",
    };
    const response = await POST(new NextRequest("http://localhost/api/agent-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }));
    expect(response.status).toBe(200);
    expect(feedback.saveAgentFeedback).toHaveBeenCalledWith(11, {
      interactionId: meta.interactionId,
      rating: "down",
      reason: "repetitive",
      variant: "json-object-v1",
    });
  });

  it("rejects raw message fields and invalid reason codes", async () => {
    const response = await POST(new NextRequest("http://localhost/api/agent-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedbackToken: "not-a-valid-token-but-long-enough-to-reach-verification",
        rating: "down",
        reason: "private dream text",
        message: "raw dream",
      }),
    }));
    expect(response.status).toBe(400);
    expect(feedback.saveAgentFeedback).not.toHaveBeenCalled();
  });
});
