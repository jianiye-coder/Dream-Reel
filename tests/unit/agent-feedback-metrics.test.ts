import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: db.ensureSchema,
  getPool: () => ({ query: db.query }),
}));

import { getAgentFeedbackMetrics, saveAgentFeedback } from "@/lib/agentFeedback";

describe("policy-scoped agent feedback metrics", () => {
  beforeEach(() => {
    db.ensureSchema.mockResolvedValue(undefined);
    db.query.mockReset();
  });

  it("persists only verified metadata with the policy assignment", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await saveAgentFeedback(7, {
      interactionId: "d679a3e1-470c-4936-8969-26c73713fe44",
      rating: "down",
      reason: "unsafe",
      variant: "json-object-v1",
      policyVariant: "guarded-v2",
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("policy_variant"), [
      7,
      "d679a3e1-470c-4936-8969-26c73713fe44",
      "down",
      "unsafe",
      "json-object-v1",
      "guarded-v2",
    ]);
  });

  it("returns both detailed and policy-level aggregates", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ policy_variant: "guarded-v2", variant: "json-object-v1", total: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ policy_variant: "guarded-v2", total: 5 }] })
      .mockResolvedValueOnce({ rows: [{ policy_variant: "guarded-v2", reason: "unsafe", count: 1 }] });
    await expect(getAgentFeedbackMetrics(14)).resolves.toMatchObject({
      variants: [{ total: 5 }],
      policies: [{ total: 5 }],
      policyNegativeReasons: [{ reason: "unsafe", count: 1 }],
    });
    expect(db.query).toHaveBeenCalledTimes(4);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("GROUP BY policy_variant"), [14]);
  });
});
