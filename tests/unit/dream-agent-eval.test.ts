import { describe, expect, it } from "vitest";
import type { DreamAgentResult } from "@/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "../../evals/dream-agent/cases";
import { evaluateDreamAgentResult, summarizeEvalResults } from "../../evals/dream-agent/evaluator";
import { evalRetryDelayMs, isRetryableEvalRequest } from "../../evals/dream-agent/retryPolicy";

const fragment = dreamAgentEvalCases.find((item) => item.id === "en-fragment-targeted")!;
const good: DreamAgentResult = {
  message: "You were running and woke suddenly. Let's stay with how that felt.",
  questions: ["What emotion did you feel while running?", "Does this connect to anything in your real life recently?"],
  stage: "exploring",
  nextAction: "ask_followup",
  memory: { missingDetails: ["turning point"], observedSignals: ["running", "station"] },
};

describe("dream agent evaluator", () => {
  it("keeps the promotion corpus large, unique, and language-balanced", () => {
    const ids = dreamAgentEvalCases.map((item) => item.id);
    const zhCount = dreamAgentEvalCases.filter((item) => item.lang === "zh").length;
    const enCount = dreamAgentEvalCases.filter((item) => item.lang === "en").length;
    expect(dreamAgentEvalCases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(ids).size).toBe(ids.length);
    expect(zhCount).toBe(enCount);
  });

  it("passes a response that satisfies the case contract", () => {
    expect(evaluateDreamAgentResult(fragment, good)).toMatchObject({ passed: true, score: 1 });
  });

  it("exposes invalid JSON and behavioral failures", () => {
    const bad: DreamAgentResult = { ...good, questions: [], stage: "ready", nextAction: "ready_to_analyze" };
    const result = evaluateDreamAgentResult(fragment, bad, false);
    expect(result.passed).toBe(false);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining(["valid_json", "expected_action", "expected_stage", "reality_boundary"]));
  });

  it("reports bilingual and safety aggregates", () => {
    const passed = evaluateDreamAgentResult(fragment, good);
    expect(summarizeEvalResults([passed])).toMatchObject({ cases: 1, passed: 1, enPassRate: 1 });
  });

  it("retries transient failures but stops immediately when credits are exhausted", () => {
    expect(isRetryableEvalRequest(429, "rate_limit_exceeded")).toBe(true);
    expect(isRetryableEvalRequest(503)).toBe(true);
    expect(isRetryableEvalRequest(400, "json_validate_failed")).toBe(true);
    expect(isRetryableEvalRequest(429, "credit_balance_exhausted")).toBe(false);
    expect(evalRetryDelayMs(1, "2.5")).toBe(2500);
    expect(evalRetryDelayMs(4)).toBe(15_000);
  });
});
