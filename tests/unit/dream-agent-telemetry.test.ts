import { afterEach, describe, expect, it, vi } from "vitest";
import { createDreamAgentResponseMeta, logDreamAgentCompletion, selectDreamAgentModelVariant, verifyDreamAgentFeedbackToken } from "@/lib/dreamAgentTelemetry";

describe("dream agent telemetry", () => {
  afterEach(() => { delete process.env.DREAM_AGENT_FEEDBACK_SECRET; });
  it("assigns canary variants deterministically and honors the rollout bounds", () => {
    expect(selectDreamAgentModelVariant(42, "0")).toBe("json-object-v1");
    expect(selectDreamAgentModelVariant(42, "100")).toBe("json-schema-v1");
    expect(selectDreamAgentModelVariant(42, "12.5")).toBe(selectDreamAgentModelVariant(42, "12.5"));
    expect(selectDreamAgentModelVariant(42, "invalid")).toBe("json-object-v1");
  });

  it("signs feedback metadata and rejects tampering", () => {
    process.env.DREAM_AGENT_FEEDBACK_SECRET = "unit-test-feedback-secret";
    const meta = createDreamAgentResponseMeta("json-object-v1", "model", 10, 7);
    expect(verifyDreamAgentFeedbackToken(meta.feedbackToken!, 7)).toMatchObject({
      interactionId: meta.interactionId,
      variant: "json-object-v1",
    });
    expect(verifyDreamAgentFeedbackToken(meta.feedbackToken!, 8)).toBeNull();
    expect(verifyDreamAgentFeedbackToken(`${meta.feedbackToken}x`, 7)).toBeNull();
  });

  it("logs only operational metadata, never message or memory content", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logDreamAgentCompletion({
      message: "private dream text",
      questions: ["private question"],
      stage: "exploring",
      nextAction: "ask_followup",
      memory: { missingDetails: ["private"], observedSignals: ["private"] },
    }, {
      interactionId: "test-id",
      variant: "json-object-v1",
      source: "model",
      latencyMs: 250,
    });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toContain("private");
    expect(serialized).toContain("latencyMs");
  });
});
