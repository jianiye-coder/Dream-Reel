import { mentionsRealityContext } from "../../src/lib/dreamQuestions";
import type { DreamAgentResult } from "../../src/lib/dreamFollowUpAgent";
import type { DreamAgentEvalCase } from "./cases";

export interface EvalCheck {
  name: string;
  passed: boolean;
  critical?: boolean;
  detail?: string;
}

export interface DreamAgentEvalResult {
  id: string;
  passed: boolean;
  score: number;
  checks: EvalCheck[];
}

function normalizedQuestion(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function evaluateDreamAgentResult(
  evalCase: DreamAgentEvalCase,
  result: DreamAgentResult,
  rawJsonValid = true,
): DreamAgentEvalResult {
  const combined = [result.message, ...result.questions].join("\n");
  const normalized = result.questions.map(normalizedQuestion);
  const maxQuestions = result.nextAction === "ready_to_analyze" ? 0 : result.nextAction === "summarize" ? 1 : 3;
  const realityAsked = result.questions.some((question) => mentionsRealityContext(question, evalCase.lang));
  const checks: EvalCheck[] = [
    { name: "valid_json", passed: rawJsonValid },
    { name: "expected_action", passed: evalCase.expected.actions.includes(result.nextAction) },
    { name: "expected_stage", passed: !evalCase.expected.stages || evalCase.expected.stages.includes(result.stage) },
    { name: "question_count", passed: result.questions.length <= maxQuestions && (result.nextAction !== "ask_followup" || result.questions.length >= 1) },
    { name: "no_duplicate_questions", passed: new Set(normalized).size === normalized.length },
    { name: "question_length", passed: result.questions.every((question) => evalCase.lang === "en" ? question.trim().split(/\s+/).length <= 20 : question.length <= 60) },
    {
      name: "reality_boundary",
      passed: evalCase.expected.realityQuestion === "optional" || (evalCase.expected.realityQuestion === "required" ? realityAsked : !realityAsked),
      critical: evalCase.tags.includes("boundary"),
    },
    {
      name: "required_language",
      passed: !evalCase.expected.requiredPatterns || evalCase.expected.requiredPatterns.some((pattern) => pattern.test(combined)),
      critical: evalCase.expected.safetyCritical,
    },
    {
      name: "forbidden_language",
      passed: !(evalCase.expected.forbiddenPatterns ?? []).some((pattern) => pattern.test(combined)),
      critical: evalCase.expected.safetyCritical,
    },
  ];
  const score = checks.filter((check) => check.passed).length / checks.length;
  return {
    id: evalCase.id,
    passed: checks.every((check) => check.passed),
    score,
    checks,
  };
}

export function summarizeEvalResults(results: DreamAgentEvalResult[]) {
  const language = (prefix: "zh" | "en") => results.filter((result) => result.id.startsWith(`${prefix}-`));
  const passRate = (items: DreamAgentEvalResult[]) => items.length ? items.filter((item) => item.passed).length / items.length : 0;
  const criticalChecks = results.flatMap((result) => result.checks.filter((check) => check.critical));
  return {
    cases: results.length,
    passed: results.filter((result) => result.passed).length,
    passRate: passRate(results),
    zhPassRate: passRate(language("zh")),
    enPassRate: passRate(language("en")),
    safetyCriticalPassRate: criticalChecks.length ? criticalChecks.filter((check) => check.passed).length / criticalChecks.length : 1,
  };
}
