import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  query: vi.fn(),
}));
const next = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock("@/lib/db", () => ({
  ensureSchema: db.ensureSchema,
  getPool: () => ({ query: db.query }),
}));
vi.mock("next/server", () => ({ after: next.after }));

import {
  getDreamAgentFunnelMetrics,
  markDreamAgentJournalSaved,
  recordDreamAgentInteraction,
  scheduleDreamAgentInteraction,
} from "@/lib/dreamAgentMetrics";

describe("privacy-safe dream agent metrics", () => {
  beforeEach(() => {
    db.ensureSchema.mockResolvedValue(undefined);
    db.query.mockReset();
    next.after.mockReset();
  });

  it("schedules persistence after the response path instead of adding user latency", async () => {
    db.query.mockResolvedValue({ rows: [] });
    scheduleDreamAgentInteraction(7, {
      message: "not persisted",
      questions: [],
      stage: "ready",
      nextAction: "ready_to_analyze",
      memory: { missingDetails: [], observedSignals: [] },
    }, {
      interactionId: "d679a3e1-470c-4936-8969-26c73713fe44",
      variant: "deterministic-v1",
      policyVariant: "legacy-v1",
      source: "deterministic",
      provider: "deterministic",
      latencyMs: 4,
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(next.after).toHaveBeenCalledOnce();
    await next.after.mock.calls[0][0]();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("records only operational fields and never dream or response text", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await recordDreamAgentInteraction(7, {
      message: "private dream response",
      questions: ["private follow-up"],
      stage: "exploring",
      nextAction: "ask_followup",
      memory: { missingDetails: ["private"], observedSignals: ["private"] },
    }, {
      interactionId: "d679a3e1-470c-4936-8969-26c73713fe44",
      variant: "json-object-v1",
      policyVariant: "guarded-v2",
      source: "model",
      provider: "groq",
      latencyMs: 250,
    }, { promptTokens: 100, completionTokens: 20 });

    const serialized = JSON.stringify(db.query.mock.calls);
    expect(serialized).not.toContain("private");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("dream_agent_interactions"), [
      "d679a3e1-470c-4936-8969-26c73713fe44",
      7,
      "json-object-v1",
      "guarded-v2",
      "model",
      "groq",
      "exploring",
      "ask_followup",
      1,
      250,
      100,
      20,
    ]);
  });

  it("links a save only when interaction and user ownership match", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await markDreamAgentJournalSaved(7, "d679a3e1-470c-4936-8969-26c73713fe44", 42);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/interaction_id = \$1[\s\S]*user_id = \$2/),
      ["d679a3e1-470c-4936-8969-26c73713fe44", 7, 42],
    );
  });

  it("returns aggregate funnel metrics without per-user rows", async () => {
    db.query.mockResolvedValue({ rows: [{
      policy_variant: "guarded-v2",
      variant: "json-object-v1",
      provider: "groq",
      interactions: 10,
      journal_saves: 7,
      journal_save_rate: 0.7,
    }] });
    await expect(getDreamAgentFunnelMetrics(14)).resolves.toMatchObject({
      days: 14,
      variants: [{ journal_save_rate: 0.7 }],
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("GROUP BY policy_variant, variant, provider"), [14]);
  });
});
