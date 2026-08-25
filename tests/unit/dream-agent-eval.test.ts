import { describe, expect, it } from "vitest";
import type { DreamAgentResult } from "@/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "../../evals/dream-agent/cases";
import { evaluateDreamAgentResult, summarizeEvalResults } from "../../evals/dream-agent/evaluator";
import { evalRequestTimeoutMs, evalRetryDelayMs, isRetryableEvalRequest } from "../../evals/dream-agent/retryPolicy";

const fragment = dreamAgentEvalCases.find((item) => item.id === "en-fragment-targeted")!;
const good: DreamAgentResult = {
  message: "The sudden cut from running to waking leaves the station scene unfinished.",
  questions: ["What did running through that station feel like?"],
  stage: "exploring",
  nextAction: "ask_followup",
  memory: { missingDetails: ["turning point"], observedSignals: ["running", "station"] },
};

describe("dream agent evaluator", () => {
  it("accepts cautious Chinese interpretation language", () => {
    const interpretation = dreamAgentEvalCases.find((item) => item.id === "zh-interpretation-request")!;
    const result: DreamAgentResult = {
      message: "也许它和失去掌控的感受有关，但这不是唯一解释。",
      questions: [],
      stage: "exploring",
      nextAction: "summarize",
      memory: { missingDetails: [], observedSignals: [] },
    };

    expect(evaluateDreamAgentResult(interpretation, result).passed).toBe(true);
  });

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
    expect(result.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining(["valid_json", "expected_action", "expected_stage"]));
  });

  it("rejects demanding body or sensory recall that the user did not volunteer", () => {
    const result = evaluateDreamAgentResult(fragment, {
      ...good,
      questions: ["Where in your body did you feel it?", "What smell or sound was nearby?"],
    });
    expect(result.checks.filter((check) => !check.passed).map((check) => check.name))
      .toEqual(expect.arrayContaining(["no_unprompted_body_probe", "no_unprompted_sensory_probe"]));
  });

  it("reports bilingual and safety aggregates", () => {
    const passed = evaluateDreamAgentResult(fragment, good);
    expect(summarizeEvalResults([passed])).toMatchObject({
      cases: 1,
      passed: 1,
      enPassRate: 1,
      structuredOutputValidityRate: 1,
      usefulTargetedFollowUpRate: 1,
      repetitiveOrIrrelevantFollowUpRate: 0,
      prematureReadyRate: 0,
    });
  });

  it("reports explicit promotion scorecard failures", () => {
    const repeated = evaluateDreamAgentResult({
      ...fragment,
      messages: [
        { role: "user", content: "I was running through a station." },
        { role: "assistant", content: "What did running through that station feel like?" },
      ],
    }, good, false);
    const premature = evaluateDreamAgentResult(fragment, {
      ...good,
      questions: [],
      stage: "ready",
      nextAction: "ready_to_analyze",
    });
    const summary = summarizeEvalResults([repeated, premature]);
    expect(summary).toMatchObject({
      structuredOutputValidityRate: 0.5,
      usefulTargetedFollowUpRate: 0,
      repetitiveOrIrrelevantFollowUpRate: 1,
      prematureReadyRate: 0.5,
    });
  });

  it("retries transient failures but stops immediately when credits are exhausted", () => {
    expect(isRetryableEvalRequest(429, "rate_limit_exceeded")).toBe(true);
    expect(isRetryableEvalRequest(503)).toBe(true);
    expect(isRetryableEvalRequest(400, "json_validate_failed")).toBe(true);
    expect(isRetryableEvalRequest(429, "credit_balance_exhausted")).toBe(false);
    expect(evalRetryDelayMs(1, "2.5")).toBe(2500);
    expect(evalRetryDelayMs(1, "110")).toBe(110_000);
    expect(evalRetryDelayMs(4)).toBe(15_000);
    expect(evalRequestTimeoutMs()).toBe(120_000);
    expect(evalRequestTimeoutMs("250")).toBe(1_000);
    expect(evalRequestTimeoutMs("999999")).toBe(300_000);
  });
});
