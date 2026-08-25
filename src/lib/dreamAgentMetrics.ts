import { after } from "next/server";
import { ensureSchema, getPool } from "./db";
import type { DreamAgentResult } from "./dreamFollowUpAgent";
import type { DreamAgentResponseMeta } from "./dreamAgentTelemetry";
import { safeErrorMetadata } from "./safeServerLog";

type TokenUsage = { promptTokens?: number; completionTokens?: number };

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

export async function getDreamAgentFunnelMetrics(days: number) {
  await ensureSchema();
  const result = await getPool().query<{
    policy_variant: string;
    variant: string;
    provider: string;
    interactions: number;
    journal_saves: number;
    journal_save_rate: number | null;
    ready_rate: number | null;
    average_latency_ms: number | null;
    p95_latency_ms: number | null;
  }>(
    `
      SELECT policy_variant,
             variant,
             provider,
             COUNT(*)::int AS interactions,
             COUNT(*) FILTER (
               WHERE journal_saved_at IS NOT NULL
                 AND journal_saved_at <= created_at + INTERVAL '24 hours'
             )::int AS journal_saves,
             ROUND(
               COUNT(*) FILTER (
                 WHERE journal_saved_at IS NOT NULL
                   AND journal_saved_at <= created_at + INTERVAL '24 hours'
               )::numeric / NULLIF(COUNT(*), 0),
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
  );
  return { days, variants: result.rows };
}
