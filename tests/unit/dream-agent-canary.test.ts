import { describe, expect, it } from "vitest";
import {
  analyzeDreamAgentCanary,
  type DreamAgentCanarySnapshot,
} from "../../evals/dream-agent/canaryGate";

const now = new Date("2026-08-25T08:00:00.000Z");

function snapshot(): DreamAgentCanarySnapshot {
  return {
    generatedAt: "2026-08-25T07:30:00.000Z",
    days: 14,
    variants: [],
    negativeReasons: [],
    policies: [],
    policyNegativeReasons: [],
    funnel: {
      days: 14,
      variants: [],
      policies: [
        {
          policy_variant: "legacy-v1",
          interactions: 80,
          eligible_interactions: 60,
          journal_saves: 36,
          journal_save_rate: 0.6,
          ready_rate: 0.4,
          average_latency_ms: 700,
          p95_latency_ms: 1000,
        },
        {
          policy_variant: "guarded-v2",
          interactions: 75,
          eligible_interactions: 60,
          journal_saves: 39,
          journal_save_rate: 0.65,
          ready_rate: 0.45,
          average_latency_ms: 680,
          p95_latency_ms: 1100,
        },
      ],
    },
    reliability: {
      days: 14,
      policies: [
        {
          policy_variant: "legacy-v1",
          total_requests: 80,
          successful_requests: 78,
          failed_requests: 2,
          error_rate: 0.025,
          fallback_requests: 4,
          fallback_rate: 0.05,
          timeout_requests: 1,
          provider_rate_limited_requests: 1,
        },
        {
          policy_variant: "guarded-v2",
          total_requests: 75,
          successful_requests: 74,
          failed_requests: 1,
          error_rate: 0.0133,
          fallback_requests: 3,
          fallback_rate: 0.04,
          timeout_requests: 0,
          provider_rate_limited_requests: 1,
        },
      ],
    },
  };
}

describe("dream agent production canary gate", () => {
  it("passes a fresh, mature candidate with no quality regression", () => {
    const report = analyzeDreamAgentCanary(snapshot(), {}, now);
    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it("fails closed on immature samples and completion or latency regression", () => {
    const input = snapshot();
    input.funnel.policies[1].eligible_interactions = 12;
    input.funnel.policies[1].journal_save_rate = 0.55;
    input.funnel.policies[1].p95_latency_ms = 1300;
    const report = analyzeDreamAgentCanary(input, {}, now);
    expect(report.passed).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining([
      "guarded_sample_mature",
      "journal_save_not_regressed",
      "p95_latency_within_budget",
    ]));
  });

  it("blocks promotion on any guarded unsafe feedback", () => {
    const input = snapshot();
    input.policyNegativeReasons.push({
      policy_variant: "guarded-v2",
      reason: "unsafe",
      count: 1,
    });
    const report = analyzeDreamAgentCanary(input, {}, now);
    expect(report.passed).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "no_guarded_unsafe_feedback",
      passed: false,
    }));
  });

  it("blocks promotion when request errors or provider fallback materially increase", () => {
    const input = snapshot();
    input.reliability.policies[1].error_rate = 0.05;
    input.reliability.policies[1].fallback_rate = 0.12;
    const report = analyzeDreamAgentCanary(input, {}, now);
    expect(report.passed).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining([
      "request_error_rate_within_budget",
      "fallback_rate_within_budget",
    ]));
  });

  it("rejects stale snapshots and unexpected content-bearing fields", () => {
    const stale = snapshot();
    stale.generatedAt = "2026-08-24T20:00:00.000Z";
    expect(analyzeDreamAgentCanary(stale, {}, now).checks).toContainEqual(expect.objectContaining({
      name: "snapshot_fresh",
      passed: false,
    }));

    expect(() => analyzeDreamAgentCanary({ ...snapshot(), rawDreamText: "must not be accepted" }, {}, now))
      .toThrow();
  });

  it("requires exactly one legacy and one guarded policy row", () => {
    const input = snapshot();
    input.funnel.policies.pop();
    const report = analyzeDreamAgentCanary(input, {}, now);
    expect(report.passed).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "exact_policy_rows",
      passed: false,
    }));
  });
});
