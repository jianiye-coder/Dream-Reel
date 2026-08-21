import { z } from "zod";
import { ensureSchema, getPool } from "./db";

export const agentFeedbackSchema = z.object({
  feedbackToken: z.string().min(40).max(1024),
  rating: z.enum(["up", "down"]),
  reason: z.enum(["repetitive", "irrelevant", "too_many_questions", "unsafe", "other"]).nullable().optional(),
}).strict();

export type AgentFeedbackInput = z.infer<typeof agentFeedbackSchema>;
export interface VerifiedAgentFeedbackInput {
  interactionId: string;
  rating: AgentFeedbackInput["rating"];
  reason?: AgentFeedbackInput["reason"];
  variant: "deterministic-v1" | "json-object-v1" | "json-schema-v1";
}

export async function saveAgentFeedback(userId: number, input: VerifiedAgentFeedbackInput) {
  await ensureSchema();
  await getPool().query(
    `
      INSERT INTO agent_feedback (user_id, interaction_id, rating, reason, variant)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, interaction_id)
      DO UPDATE SET rating = EXCLUDED.rating,
                    reason = EXCLUDED.reason,
                    variant = EXCLUDED.variant,
                    updated_at = NOW()
    `,
    [userId, input.interactionId, input.rating, input.reason ?? null, input.variant],
  );
}

export async function getAgentFeedbackMetrics(days: number) {
  await ensureSchema();
  const pool = getPool();
  const [variants, reasons] = await Promise.all([
    pool.query<{
      variant: string;
      total: number;
      positive: number;
      negative: number;
      positive_rate: number | null;
    }>(
      `
        SELECT variant,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE rating = 'up')::int AS positive,
               COUNT(*) FILTER (WHERE rating = 'down')::int AS negative,
               ROUND(
                 COUNT(*) FILTER (WHERE rating = 'up')::numeric / NULLIF(COUNT(*), 0),
                 4
               )::float AS positive_rate
        FROM agent_feedback
        WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
        GROUP BY variant
        ORDER BY variant
      `,
      [days],
    ),
    pool.query<{ variant: string; reason: string; count: number }>(
      `
        SELECT variant, reason, COUNT(*)::int AS count
        FROM agent_feedback
        WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
          AND rating = 'down'
          AND reason IS NOT NULL
        GROUP BY variant, reason
        ORDER BY variant, count DESC, reason
      `,
      [days],
    ),
  ]);
  return { days, variants: variants.rows, negativeReasons: reasons.rows };
}
