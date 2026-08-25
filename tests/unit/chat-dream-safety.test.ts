import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const billing = vi.hoisted(() => ({
  checkAiRateLimit: vi.fn(),
  checkAndConsumeUsage: vi.fn(),
  refundConsumedUsage: vi.fn(),
}));
const agentMetrics = vi.hoisted(() => ({ scheduleDreamAgentInteraction: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "7" } })) }));
vi.mock("@/lib/billing", () => billing);
vi.mock("@/lib/dreamAgentMetrics", () => agentMetrics);

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
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    delete process.env.DREAM_AGENT_FEEDBACK_SECRET;
    delete process.env.DREAM_AGENT_JSON_SCHEMA_PERCENT;
    delete process.env.DREAM_AGENT_GUARDED_PERCENT;
    vi.restoreAllMocks();
  });

  it("keeps the guarded recall policy behind a deterministic rollout", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({
        message: "You can decide what to save.",
        questions: [],
        stage: "deepening",
        nextAction: "summarize",
        memory: { missingDetails: [], observedSignals: ["bathroom"] },
      }) } }],
    }));
    const requestBody = JSON.stringify({
      lang: "en",
      messages: [{
        role: "user",
        content: "I dreamed I was hiding in a bathroom. Will you automatically save or share this?",
      }],
    });

    process.env.DREAM_AGENT_GUARDED_PERCENT = "0";
    const legacy = await POST(new NextRequest("http://localhost/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }));
    expect(await legacy.json()).toMatchObject({ meta: { policyVariant: "legacy-v1", source: "model" } });
    expect(fetchSpy).toHaveBeenCalledOnce();

    process.env.DREAM_AGENT_GUARDED_PERCENT = "100";
    const guarded = await POST(new NextRequest("http://localhost/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }));
    expect(await guarded.json()).toMatchObject({
      meta: { policyVariant: "guarded-v2", source: "deterministic" },
      questions: [],
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
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
    expect(agentMetrics.scheduleDreamAgentInteraction).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ nextAction: "summarize" }),
      expect.objectContaining({ source: "deterministic" }),
    );
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
      meta: { variant: "json-schema-v1", source: "model", provider: "openai", feedbackToken: expect.any(String) },
    });
    const upstreamBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(upstreamBody.response_format).toMatchObject({ type: "json_schema" });
    expect(billing.checkAndConsumeUsage).toHaveBeenCalledWith(7, "analysis");
    expect(billing.refundConsumedUsage).not.toHaveBeenCalled();
    expect(agentMetrics.scheduleDreamAgentInteraction).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ nextAction: "ready_to_analyze" }),
      expect.objectContaining({ provider: "openai" }),
      { promptTokens: 500, completionTokens: 80 },
    );
  });

  it("uses Groq before OpenAI when both providers are configured", async () => {
    process.env.GROQ_API_KEY = "groq-unit-test-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({
        message: "Let's stay with the feeling in that station.",
        questions: ["What feeling was strongest while you were running?"],
        stage: "exploring",
        nextAction: "ask_followup",
        memory: { missingDetails: ["turning point"], observedSignals: ["station", "running"] },
      }) } }],
      usage: { prompt_tokens: 400, completion_tokens: 70 },
    }));

    const response = await POST(new NextRequest("http://localhost/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en",
        messages: [{ role: "user", content: "I was running through a station, then I woke up." }],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta).toMatchObject({ source: "model", provider: "groq" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      model: "openai/gpt-oss-120b",
      max_completion_tokens: 1600,
      reasoning_effort: "low",
    });
    expect(billing.refundConsumedUsage).not.toHaveBeenCalled();
  });

  it("refunds usage once when both providers fail", async () => {
    process.env.GROQ_API_KEY = "groq-unit-test-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("OpenAI unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("Groq unavailable", { status: 503 }));

    const response = await POST(new NextRequest("http://localhost/api/chat-dream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: "en",
        messages: [{ role: "user", content: "I was walking through an unfamiliar market." }],
      }),
    }));

    expect(response.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetchSpy.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(billing.refundConsumedUsage).toHaveBeenCalledTimes(1);
    expect(billing.refundConsumedUsage).toHaveBeenCalledWith(9, "analysis");
  });
});
