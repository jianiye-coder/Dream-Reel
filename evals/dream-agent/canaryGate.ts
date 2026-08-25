import { z } from "zod";

const policyVariantSchema = z.enum(["legacy-v1", "guarded-v2"]);
const rateSchema = z.number().min(0).max(1).nullable();

const feedbackVariantSchema = z.object({
  policy_variant: policyVariantSchema,
  variant: z.string().min(1),
  total: z.number().int().nonnegative(),
  positive: z.number().int().nonnegative(),
  negative: z.number().int().nonnegative(),
  positive_rate: rateSchema,
}).strict();

const feedbackPolicySchema = feedbackVariantSchema.omit({ variant: true });
const feedbackReasonSchema = z.object({
  policy_variant: policyVariantSchema,
  variant: z.string().min(1),
  reason: z.enum(["repetitive", "irrelevant", "too_many_questions", "unsafe", "other"]),
  count: z.number().int().nonnegative(),
}).strict();
const policyReasonSchema = feedbackReasonSchema.omit({ variant: true });

const funnelBaseSchema = z.object({
  policy_variant: policyVariantSchema,
  interactions: z.number().int().nonnegative(),
  eligible_interactions: z.number().int().nonnegative(),
  journal_saves: z.number().int().nonnegative(),
  journal_save_rate: rateSchema,
  ready_rate: rateSchema,
  average_latency_ms: z.number().nonnegative().nullable(),
  p95_latency_ms: z.number().nonnegative().nullable(),
}).strict();
const funnelVariantSchema = funnelBaseSchema.extend({
  variant: z.string().min(1),
  provider: z.enum(["deterministic", "openai", "groq"]),
}).strict();

const reliabilityPolicySchema = z.object({
  policy_variant: policyVariantSchema,
  total_requests: z.number().int().nonnegative(),
  successful_requests: z.number().int().nonnegative(),
  failed_requests: z.number().int().nonnegative(),
  error_rate: rateSchema,
  fallback_requests: z.number().int().nonnegative(),
  fallback_rate: rateSchema,
  timeout_requests: z.number().int().nonnegative(),
  provider_rate_limited_requests: z.number().int().nonnegative(),
}).strict();

export const dreamAgentCanarySnapshotSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  days: z.number().int().min(1).max(90),
  variants: z.array(feedbackVariantSchema),
  negativeReasons: z.array(feedbackReasonSchema),
  policies: z.array(feedbackPolicySchema),
  policyNegativeReasons: z.array(policyReasonSchema),
  funnel: z.object({
    days: z.number().int().min(1).max(90),
    variants: z.array(funnelVariantSchema),
    policies: z.array(funnelBaseSchema),
  }).strict(),
  reliability: z.object({
    days: z.number().int().min(1).max(90),
    policies: z.array(reliabilityPolicySchema),
  }).strict(),
}).strict();

export type DreamAgentCanarySnapshot = z.infer<typeof dreamAgentCanarySnapshotSchema>;

export interface CanaryGateOptions {
  minimumEligibleInteractions?: number;
  maximumLatencyRegression?: number;
  maximumSnapshotAgeHours?: number;
  maximumErrorRateIncrease?: number;
  maximumFallbackRateIncrease?: number;
}

export interface CanaryGateCheck {
  name: string;
  passed: boolean;
  detail: string;
}

function exactlyOnePolicyRow(
  rows: DreamAgentCanarySnapshot["funnel"]["policies"],
  policy: "legacy-v1" | "guarded-v2",
) {
  const matches = rows.filter((row) => row.policy_variant === policy);
  return matches.length === 1 ? matches[0] : null;
}

export function analyzeDreamAgentCanary(
  input: unknown,
  options: CanaryGateOptions = {},
  now = new Date(),
) {
  const snapshot = dreamAgentCanarySnapshotSchema.parse(input);
  const minimumEligibleInteractions = Math.max(1, options.minimumEligibleInteractions ?? 50);
  const maximumLatencyRegression = Math.max(0, options.maximumLatencyRegression ?? 0.2);
  const maximumSnapshotAgeHours = Math.max(0.1, options.maximumSnapshotAgeHours ?? 2);
  const maximumErrorRateIncrease = Math.max(0, options.maximumErrorRateIncrease ?? 0.01);
  const maximumFallbackRateIncrease = Math.max(0, options.maximumFallbackRateIncrease ?? 0.05);
  const legacy = exactlyOnePolicyRow(snapshot.funnel.policies, "legacy-v1");
  const candidate = exactlyOnePolicyRow(snapshot.funnel.policies, "guarded-v2");
  const legacyReliabilityRows = snapshot.reliability.policies.filter((row) => row.policy_variant === "legacy-v1");
  const candidateReliabilityRows = snapshot.reliability.policies.filter((row) => row.policy_variant === "guarded-v2");
  const legacyReliability = legacyReliabilityRows.length === 1 ? legacyReliabilityRows[0] : null;
  const candidateReliability = candidateReliabilityRows.length === 1 ? candidateReliabilityRows[0] : null;
  const snapshotAgeMs = now.getTime() - new Date(snapshot.generatedAt).getTime();
  const unsafeCandidateFeedback = snapshot.policyNegativeReasons
    .filter((row) => row.policy_variant === "guarded-v2" && row.reason === "unsafe")
    .reduce((sum, row) => sum + row.count, 0);
  const checks: CanaryGateCheck[] = [
    {
      name: "snapshot_fresh",
      passed: snapshotAgeMs >= -5 * 60_000 && snapshotAgeMs <= maximumSnapshotAgeHours * 60 * 60_000,
      detail: `age_minutes=${Math.round(snapshotAgeMs / 60_000)} max_hours=${maximumSnapshotAgeHours}`,
    },
    {
      name: "exact_policy_rows",
      passed: Boolean(legacy && candidate),
      detail: `legacy_rows=${snapshot.funnel.policies.filter((row) => row.policy_variant === "legacy-v1").length} guarded_rows=${snapshot.funnel.policies.filter((row) => row.policy_variant === "guarded-v2").length}`,
    },
    {
      name: "legacy_sample_mature",
      passed: (legacy?.eligible_interactions ?? 0) >= minimumEligibleInteractions,
      detail: `eligible=${legacy?.eligible_interactions ?? 0} required=${minimumEligibleInteractions}`,
    },
    {
      name: "exact_reliability_policy_rows",
      passed: Boolean(legacyReliability && candidateReliability),
      detail: `legacy_rows=${legacyReliabilityRows.length} guarded_rows=${candidateReliabilityRows.length}`,
    },
    {
      name: "guarded_sample_mature",
      passed: (candidate?.eligible_interactions ?? 0) >= minimumEligibleInteractions,
      detail: `eligible=${candidate?.eligible_interactions ?? 0} required=${minimumEligibleInteractions}`,
    },
    {
      name: "journal_save_not_regressed",
      passed: legacy?.journal_save_rate != null
        && candidate?.journal_save_rate != null
        && candidate.journal_save_rate >= legacy.journal_save_rate,
      detail: `legacy=${legacy?.journal_save_rate ?? "missing"} guarded=${candidate?.journal_save_rate ?? "missing"}`,
    },
    {
      name: "p95_latency_within_budget",
      passed: legacy?.p95_latency_ms != null
        && candidate?.p95_latency_ms != null
        && candidate.p95_latency_ms <= legacy.p95_latency_ms * (1 + maximumLatencyRegression),
      detail: `legacy_ms=${legacy?.p95_latency_ms ?? "missing"} guarded_ms=${candidate?.p95_latency_ms ?? "missing"} max_regression=${maximumLatencyRegression}`,
    },
    {
      name: "no_guarded_unsafe_feedback",
      passed: unsafeCandidateFeedback === 0,
      detail: `unsafe_feedback=${unsafeCandidateFeedback}`,
    },
    {
      name: "request_error_rate_within_budget",
      passed: legacyReliability?.error_rate != null
        && candidateReliability?.error_rate != null
        && candidateReliability.error_rate <= legacyReliability.error_rate + maximumErrorRateIncrease,
      detail: `legacy=${legacyReliability?.error_rate ?? "missing"} guarded=${candidateReliability?.error_rate ?? "missing"} max_increase=${maximumErrorRateIncrease}`,
    },
    {
      name: "fallback_rate_within_budget",
      passed: legacyReliability?.fallback_rate != null
        && candidateReliability?.fallback_rate != null
        && candidateReliability.fallback_rate <= legacyReliability.fallback_rate + maximumFallbackRateIncrease,
      detail: `legacy=${legacyReliability?.fallback_rate ?? "missing"} guarded=${candidateReliability?.fallback_rate ?? "missing"} max_increase=${maximumFallbackRateIncrease}`,
    },
  ];
  return {
    passed: checks.every((check) => check.passed),
    generatedAt: snapshot.generatedAt,
    windowDays: snapshot.days,
    checks,
    summary: {
      legacyEligibleInteractions: legacy?.eligible_interactions ?? 0,
      guardedEligibleInteractions: candidate?.eligible_interactions ?? 0,
      legacyJournalSaveRate: legacy?.journal_save_rate ?? null,
      guardedJournalSaveRate: candidate?.journal_save_rate ?? null,
      legacyP95LatencyMs: legacy?.p95_latency_ms ?? null,
      guardedP95LatencyMs: candidate?.p95_latency_ms ?? null,
      guardedUnsafeFeedback: unsafeCandidateFeedback,
      legacyErrorRate: legacyReliability?.error_rate ?? null,
      guardedErrorRate: candidateReliability?.error_rate ?? null,
      legacyFallbackRate: legacyReliability?.fallback_rate ?? null,
      guardedFallbackRate: candidateReliability?.fallback_rate ?? null,
    },
  };
}
