import { beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: { content: "[]" } }],
    })));
    expect((await POST(request())).status).toBe(422);
    expect(billing.refundConsumedUsage).toHaveBeenCalledOnce();
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
