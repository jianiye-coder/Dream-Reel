import { after } from "next/server";
import { ensureSchema, getPool } from "./db";
import type { DreamAgentResult } from "./dreamFollowUpAgent";
import type {
  DreamAgentPolicyVariant,
  DreamAgentProvider,
  DreamAgentResponseMeta,
} from "./dreamAgentTelemetry";
import { safeErrorMetadata } from "./safeServerLog";

type TokenUsage = { promptTokens?: number; completionTokens?: number };

export type DreamAgentRequestOutcome =
  | "success"
  | "configuration_error"
  | "app_rate_limited"
  | "quota_exceeded"
  | "timeout"
  | "provider_rate_limited"
  | "upstream_error";

export interface DreamAgentRequestOutcomeInput {
  requestId: string;
  policyVariant: DreamAgentPolicyVariant;
  outcome: DreamAgentRequestOutcome;
  source: "deterministic" | "model" | "none";
  provider: DreamAgentProvider | "none";
  providerAttempts: number;
  fallbackUsed: boolean;
  latencyMs: number;
}

export async function recordDreamAgentRequestOutcome(
  userId: number,
  input: DreamAgentRequestOutcomeInput,
) {
  await ensureSchema();
  await getPool().query(
    `
      INSERT INTO dream_agent_request_outcomes (
        request_id, user_id, policy_variant, outcome, source, provider,
        provider_attempts, fallback_used, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (request_id) DO NOTHING
    `,
    [
      input.requestId,
      userId,
      input.policyVariant,
      input.outcome,
      input.source,
      input.provider,
      input.providerAttempts,
      input.fallbackUsed,
      input.latencyMs,
    ],
  );
}

export function scheduleDreamAgentRequestOutcome(
  userId: number,
  input: DreamAgentRequestOutcomeInput,
) {
  after(async () => {
    try {
      await recordDreamAgentRequestOutcome(userId, input);
    } catch (error) {
      console.error("dream agent request outcome telemetry failed", safeErrorMetadata(error));
    }
  });
}

export async function recordDreamAgentInteraction(
  userId: number,
  result: DreamAgentResult,
  meta: DreamAgentResponseMeta,
  usage?: TokenUsage,
) {
  await ensureSchema();
  await getPool().query(
    `
      INSERT INTO dream_agent_interactions (
        interaction_id, user_id, variant, policy_variant, source, provider, stage, next_action,
        question_count, latency_ms, prompt_tokens, completion_tokens
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (interaction_id) DO NOTHING
    `,
    [
      meta.interactionId,
      userId,
      meta.variant,
      meta.policyVariant,
      meta.source,
      meta.provider,
      result.stage,
      result.nextAction,
      result.questions.length,
      meta.latencyMs,
      usage?.promptTokens ?? null,
      usage?.completionTokens ?? null,
    ],
  );
}

export async function markDreamAgentJournalSaved(
  userId: number,
  interactionId: string,
  dreamEntryId: number,
) {
  await ensureSchema();
  await getPool().query(
    `
      UPDATE dream_agent_interactions
      SET journal_saved_at = COALESCE(journal_saved_at, NOW()),
          dream_entry_id = COALESCE(dream_entry_id, $3)
      WHERE interaction_id = $1
        AND user_id = $2
    `,
    [interactionId, userId, dreamEntryId],
  );
}

export function scheduleDreamAgentInteraction(
  userId: number,
  result: DreamAgentResult,
  meta: DreamAgentResponseMeta,
  usage?: TokenUsage,
) {
  after(async () => {
    try {
      await recordDreamAgentInteraction(userId, result, meta, usage);
    } catch (error) {
      console.error("dream agent interaction telemetry failed", safeErrorMetadata(error));
    }
  });
}

export function scheduleDreamAgentJournalSaved(userId: number, interactionId: string, dreamEntryId: number) {
  after(async () => {
    try {
      await markDreamAgentJournalSaved(userId, interactionId, dreamEntryId);
    } catch (error) {
      console.error("dream agent journal completion telemetry failed", safeErrorMetadata(error));
    }
  });
}

export async function getDreamAgentReliabilityMetrics(days: number) {
  await ensureSchema();
  const result = await getPool().query<{
    policy_variant: string;
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    error_rate: number | null;
    fallback_requests: number;
    fallback_rate: number | null;
    timeout_requests: number;
    provider_rate_limited_requests: number;
  }>(
    `
      SELECT policy_variant,
             COUNT(*)::int AS total_requests,
             COUNT(*) FILTER (WHERE outcome = 'success')::int AS successful_requests,
             COUNT(*) FILTER (WHERE outcome <> 'success')::int AS failed_requests,
             ROUND(
               COUNT(*) FILTER (WHERE outcome <> 'success')::numeric / NULLIF(COUNT(*), 0),
               4
             )::float AS error_rate,
             COUNT(*) FILTER (WHERE fallback_used)::int AS fallback_requests,
             ROUND(
               COUNT(*) FILTER (WHERE fallback_used)::numeric / NULLIF(COUNT(*), 0),
               4
             )::float AS fallback_rate,
             COUNT(*) FILTER (WHERE outcome = 'timeout')::int AS timeout_requests,
             COUNT(*) FILTER (WHERE outcome = 'provider_rate_limited')::int AS provider_rate_limited_requests
      FROM dream_agent_request_outcomes
      WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
      GROUP BY policy_variant
      ORDER BY policy_variant
    `,
    [days],
  );
  return { days, policies: result.rows };
}

export async function getDreamAgentFunnelMetrics(days: number) {
  await ensureSchema();
  type FunnelRow = {
    policy_variant: string;
    variant?: string;
    provider?: string;
    interactions: number;
    eligible_interactions: number;
    journal_saves: number;
    journal_save_rate: number | null;
    ready_rate: number | null;
    average_latency_ms: number | null;
    p95_latency_ms: number | null;
  };
  const pool = getPool();
  const [variants, policies] = await Promise.all([
    pool.query<FunnelRow>(
    `
      SELECT policy_variant,
             variant,
             provider,
             COUNT(*)::int AS interactions,
             COUNT(*) FILTER (
               WHERE created_at <= NOW() - INTERVAL '24 hours'
             )::int AS eligible_interactions,
             COUNT(*) FILTER (
               WHERE created_at <= NOW() - INTERVAL '24 hours'
                 AND journal_saved_at IS NOT NULL
                 AND journal_saved_at <= created_at + INTERVAL '24 hours'
             )::int AS journal_saves,
             ROUND(
               COUNT(*) FILTER (
                 WHERE created_at <= NOW() - INTERVAL '24 hours'
                   AND journal_saved_at IS NOT NULL
                   AND journal_saved_at <= created_at + INTERVAL '24 hours'
               )::numeric / NULLIF(COUNT(*) FILTER (
                 WHERE created_at <= NOW() - INTERVAL '24 hours'
               ), 0),
               4
             )::float AS journal_save_rate,
             ROUND(
               COUNT(*) FILTER (WHERE next_action = 'ready_to_analyze')::numeric / NULLIF(COUNT(*), 0),
               4
             )::float AS ready_rate,
             ROUND(AVG(latency_ms))::int AS average_latency_ms,
             ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency_ms
      FROM dream_agent_interactions
      WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
      GROUP BY policy_variant, variant, provider
      ORDER BY policy_variant, variant, provider
    `,
    [days],
    ),
    pool.query<FunnelRow>(
      `
        SELECT policy_variant,
               COUNT(*)::int AS interactions,
               COUNT(*) FILTER (
                 WHERE created_at <= NOW() - INTERVAL '24 hours'
               )::int AS eligible_interactions,
               COUNT(*) FILTER (
                 WHERE created_at <= NOW() - INTERVAL '24 hours'
                   AND journal_saved_at IS NOT NULL
                   AND journal_saved_at <= created_at + INTERVAL '24 hours'
               )::int AS journal_saves,
               ROUND(
                 COUNT(*) FILTER (
                   WHERE created_at <= NOW() - INTERVAL '24 hours'
                     AND journal_saved_at IS NOT NULL
                     AND journal_saved_at <= created_at + INTERVAL '24 hours'
                 )::numeric / NULLIF(COUNT(*) FILTER (
                   WHERE created_at <= NOW() - INTERVAL '24 hours'
                 ), 0),
                 4
               )::float AS journal_save_rate,
               ROUND(
                 COUNT(*) FILTER (WHERE next_action = 'ready_to_analyze')::numeric / NULLIF(COUNT(*), 0),
                 4
               )::float AS ready_rate,
               ROUND(AVG(latency_ms))::int AS average_latency_ms,
               ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency_ms
        FROM dream_agent_interactions
        WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
        GROUP BY policy_variant
        ORDER BY policy_variant
      `,
      [days],
    ),
  ]);
  return { days, variants: variants.rows, policies: policies.rows };
}
