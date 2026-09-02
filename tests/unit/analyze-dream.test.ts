import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const billing = vi.hoisted(() => ({
  checkAndConsumeUsage: vi.fn(),
  refundConsumedUsage: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "7" } })),
}));
vi.mock("@/lib/billing", () => billing);

import { POST } from "@/app/api/analyze-dream/route";

function request() {
  return new NextRequest("http://localhost/api/analyze-dream", {
    method: "POST",
    body: JSON.stringify({ text: "I was walking through a quiet station.", lang: "en" }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/analyze-dream usage accounting", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    billing.checkAndConsumeUsage.mockResolvedValue({
      allowed: true,
      usagePeriodId: 42,
      status: {},
    });
    billing.refundConsumedUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_ANALYSIS_MODEL;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_ANALYSIS_MODEL;
    vi.restoreAllMocks();
  });

  it("uses Groq first when both providers are configured", async () => {
    process.env.GROQ_API_KEY = "groq-test-key";
    process.env.GROQ_ANALYSIS_MODEL = "openai/gpt-oss-120b";
    const fetchMock = vi.fn(async () => Response.json({
      choices: [{ message: { content: "{}" } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Dream-AI-Provider")).toBe("groq");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/gpt-oss-120b",
      max_completion_tokens: 3000,
      reasoning_effort: "low",
    });
  });

  it("falls back to OpenAI when Groq is unavailable", async () => {
    process.env.GROQ_API_KEY = "groq-test-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: "{}" } }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Dream-AI-Provider")).toBe("openai");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(billing.refundConsumedUsage).not.toHaveBeenCalled();
  });

  it("refunds an upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream failed", { status: 502 })));
    expect((await POST(request())).status).toBe(502);
    expect(billing.refundConsumedUsage).toHaveBeenCalledOnce();
  });

  it("refunds a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }));
    expect((await POST(request())).status).toBe(504);
    expect(billing.refundConsumedUsage).toHaveBeenCalledOnce();
  });

  it("refunds invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: { content: "not-json" } }],
    })));
    expect((await POST(request())).status).toBe(422);
    expect(billing.refundConsumedUsage).toHaveBeenCalledOnce();
  });

  it("refunds a schema failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitivePayload = "PRIVATE_DREAM_SENTINEL";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: { content: JSON.stringify([sensitivePayload]) } }],
    })));
    expect((await POST(request())).status).toBe(422);
    expect(billing.refundConsumedUsage).toHaveBeenCalledOnce();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(sensitivePayload);
  });

  it("charges a successful analysis once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: { content: "{}" } }],
    })));
    expect((await POST(request())).status).toBe(200);
    expect(billing.checkAndConsumeUsage).toHaveBeenCalledOnce();
    expect(billing.refundConsumedUsage).not.toHaveBeenCalled();
  });
});
