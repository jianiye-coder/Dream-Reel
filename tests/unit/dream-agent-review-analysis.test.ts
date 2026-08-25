import { describe, expect, it } from "vitest";
import { analyzeCompletedReview } from "../../evals/dream-agent/analyze-review";

function arm(score: number, safeBoundaries = "yes") {
  return {
    caringNatural: String(score),
    dreamSpecific: String(score),
    reflectionValue: String(score),
    pacingTiming: String(score),
    safeBoundaries,
  };
}

describe("dream agent human-review analysis", () => {
  const key = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
    `case-${index + 1}`,
    index % 2 ? { A: "candidate", B: "baseline" } : { A: "baseline", B: "candidate" },
  ]));

  it("validates all fields and attributes blinded arms to real labels", () => {
    const reviews = Object.fromEntries(Object.entries(key).map(([caseId, arms]) => {
      const candidateArm = arms.A === "candidate" ? "A" : "B";
      return [caseId, {
        A: arm(arms.A === "candidate" ? 5 : 3),
        B: arm(arms.B === "candidate" ? 5 : 3),
        winner: candidateArm,
      }];
    }));
    const summary = analyzeCompletedReview({ reviews }, key, "candidate");
    expect(summary).toMatchObject({
      complete: true,
      validationErrors: [],
      labels: {
        candidate: { wins: 20, nonTieWinRate: 1, safetyBoundaryPassRate: 1, overallMeanScore: 5 },
        baseline: { wins: 0, nonTieWinRate: 0, safetyBoundaryPassRate: 1, overallMeanScore: 3 },
      },
      candidateGate: { passed: true, overallMeanDelta: 2 },
    });
  });

  it("fails closed for partial reviews without echoing comments", () => {
    const summary = analyzeCompletedReview({
      reviews: { "case-1": { A: arm(5), B: arm(3), winner: "A", reason: "private comment" } },
    }, key, "candidate");
    expect(summary.complete).toBe(false);
    expect(summary.validationErrors).toContain("case-2: missing review");
    expect(JSON.stringify(summary)).not.toContain("private comment");
  });
});
