import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getAgentFeedbackMetrics: vi.fn(),
  getDreamAgentFunnelMetrics: vi.fn(),
  getDreamAgentReliabilityMetrics: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/agentFeedback", () => ({ getAgentFeedbackMetrics: mocks.getAgentFeedbackMetrics }));
vi.mock("@/lib/dreamAgentMetrics", () => ({
  getDreamAgentFunnelMetrics: mocks.getDreamAgentFunnelMetrics,
  getDreamAgentReliabilityMetrics: mocks.getDreamAgentReliabilityMetrics,
}));

import { GET } from "@/app/api/admin/agent-feedback/route";

describe("admin agent feedback metrics", () => {
  afterEach(() => {
    delete process.env.ADMIN_EMAIL;
  });

  it("returns only aggregated feedback for an administrator", async () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    mocks.auth.mockResolvedValue({ user: { email: "admin@example.com" } });
    mocks.getAgentFeedbackMetrics.mockResolvedValue({
      days: 14,
      variants: [{ policy_variant: "guarded-v2", variant: "json-object-v1", total: 10, positive: 8, negative: 2, positive_rate: 0.8 }],
      negativeReasons: [{ policy_variant: "guarded-v2", variant: "json-object-v1", reason: "repetitive", count: 2 }],
      policies: [{ policy_variant: "guarded-v2", total: 10, positive: 8, negative: 2, positive_rate: 0.8 }],
      policyNegativeReasons: [{ policy_variant: "guarded-v2", reason: "repetitive", count: 2 }],
    });
    mocks.getDreamAgentFunnelMetrics.mockResolvedValue({
      days: 14,
      variants: [{ policy_variant: "guarded-v2", variant: "json-object-v1", provider: "groq", interactions: 10, eligible_interactions: 8, journal_saves: 7, journal_save_rate: 0.875 }],
      policies: [{ policy_variant: "guarded-v2", interactions: 10, eligible_interactions: 8, journal_saves: 7, journal_save_rate: 0.875 }],
    });
    mocks.getDreamAgentReliabilityMetrics.mockResolvedValue({
      days: 14,
      policies: [{ policy_variant: "guarded-v2", total_requests: 10, error_rate: 0, fallback_rate: 0 }],
    });
    const response = await GET(new NextRequest("http://localhost/api/admin/agent-feedback?days=14&download=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="dream-agent-canary-/);
    expect(await response.json()).toMatchObject({
      generatedAt: expect.any(String),
      days: 14,
      variants: [{ positive_rate: 0.8 }],
      funnel: { variants: [{ journal_save_rate: 0.875 }], policies: [{ eligible_interactions: 8 }] },
      reliability: { policies: [{ error_rate: 0 }] },
    });
    expect(mocks.getAgentFeedbackMetrics).toHaveBeenCalledWith(14);
    expect(mocks.getDreamAgentFunnelMetrics).toHaveBeenCalledWith(14);
    expect(mocks.getDreamAgentReliabilityMetrics).toHaveBeenCalledWith(14);
  });

  it("rejects non-admin users before reading metrics", async () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    mocks.auth.mockResolvedValue({ user: { email: "other@example.com" } });
    const response = await GET(new NextRequest("http://localhost/api/admin/agent-feedback"));
    expect(response.status).toBe(403);
    expect(mocks.getAgentFeedbackMetrics).not.toHaveBeenCalled();
    expect(mocks.getDreamAgentFunnelMetrics).not.toHaveBeenCalled();
    expect(mocks.getDreamAgentReliabilityMetrics).not.toHaveBeenCalled();
  });
});
