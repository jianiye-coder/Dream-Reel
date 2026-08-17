import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.restoreAllMocks());

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
});
