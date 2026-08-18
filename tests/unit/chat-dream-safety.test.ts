import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const billing = vi.hoisted(() => ({
  checkAiRateLimit: vi.fn(),
  checkAndConsumeUsage: vi.fn(),
  refundConsumedUsage: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "7" } })) }));
vi.mock("@/lib/billing", () => billing);

import { POST } from "@/app/api/chat-dream/route";

describe("dream chat safety routing", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "unit-test-key";
    process.env.DREAM_AGENT_FEEDBACK_SECRET = "unit-test-feedback-secret";
    billing.checkAiRateLimit.mockResolvedValue({ allowed: true });
    billing.checkAndConsumeUsage.mockResolvedValue({ allowed: true, usagePeriodId: 9 });
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DREAM_AGENT_FEEDBACK_SECRET;
    delete process.env.DREAM_AGENT_JSON_SCHEMA_PERCENT;
    vi.restoreAllMocks();
  });

  it("returns immediate support without quota use or an upstream model call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(new NextRequest("http://localhost/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en",
        messages: [{ role: "user", content: "I may hurt myself tonight." }],
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ nextAction: "summarize", questions: [expect.stringMatching(/danger|safe/i)] });
    expect(billing.checkAndConsumeUsage).not.toHaveBeenCalled();
    expect(billing.checkAiRateLimit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns normalized evidence-based state and signed metadata from the model path", async () => {
    process.env.DREAM_AGENT_JSON_SCHEMA_PERCENT = "100";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        message: "There is enough here to organize.",
        questions: [],
        stage: "exploring",
        nextAction: "ready_to_analyze",
        memory: { missingDetails: [], observedSignals: ["school", "calm"] },
      }) } }],
      usage: { prompt_tokens: 500, completion_tokens: 80 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await POST(new NextRequest("http://localhost/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en",
        messages: [{
          role: "user",
          content: "I felt panicked in my old school. Then my grandmother waved and my chest relaxed. I recently started a new job.",
        }],
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      stage: "ready",
      nextAction: "ready_to_analyze",
      meta: { variant: "json-schema-v1", source: "model", feedbackToken: expect.any(String) },
    });
    const upstreamBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(upstreamBody.response_format).toMatchObject({ type: "json_schema" });
    expect(billing.checkAndConsumeUsage).toHaveBeenCalledWith(7, "analysis");
    expect(billing.refundConsumedUsage).not.toHaveBeenCalled();
  });
});
