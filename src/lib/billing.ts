import { ensureSchema, getPool } from "./db";
import type { PoolClient } from "pg";

export type PlanId = "free" | "plus";
export type UsageKind = "dream_entries" | "analysis" | "image_generations";

type UsageColumn = "dream_entries_used" | "analysis_used" | "image_generations_used";

const PLAN_LIMITS: Record<PlanId, {
  dreamEntries: number;
  analysis: number;
  imageGenerations: number;
}> = {
  free: {
    dreamEntries: 30,
    analysis: 5,
    imageGenerations: 5,
  },
  plus: {
    dreamEntries: 9999,
    analysis: 20,
    imageGenerations: 20,
  },
};

const UNLIMITED_LIMITS = {
  dreamEntries: Number.MAX_SAFE_INTEGER,
  analysis: Number.MAX_SAFE_INTEGER,
  imageGenerations: Number.MAX_SAFE_INTEGER,
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const usageColumnByKind: Record<UsageKind, UsageColumn> = {
  dream_entries: "dream_entries_used",
  analysis: "analysis_used",
  image_generations: "image_generations_used",
};

const limitKeyByKind: Record<UsageKind, keyof typeof PLAN_LIMITS.free> = {
  dream_entries: "dreamEntries",
  analysis: "analysis",
  image_generations: "imageGenerations",
};

export interface BillingStatus {
  plan: PlanId;
  isUnlimited: boolean;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  periodStart: string;
  periodEnd: string;
  limits: typeof PLAN_LIMITS.free;
  usage: typeof PLAN_LIMITS.free;
  remaining: typeof PLAN_LIMITS.free;
}

interface SubscriptionRow {
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  status: string;
  plan: string;
  current_period_start: Date | string | null;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
}

interface UsageRow {
  id: string | number;
  dream_entries_used: number;
  analysis_used: number;
  image_generations_used: number;
}

function getUnlimitedAdminEmails() {
  const configured = process.env.ADMIN_UNLIMITED_EMAILS;
  const emails = configured ? configured.split(",") : ["jianiye@uchicago.edu"];
  return new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
}

async function isUnlimitedAdmin(userId: number) {
  await ensureSchema();
  const result = await getPool().query<{ email: string | null }>(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const email = result.rows[0]?.email?.toLowerCase();
  return !!email && getUnlimitedAdminEmails().has(email);
}

function monthPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function normalizePlan(subscription: SubscriptionRow | null): PlanId {
  if (!subscription) return "free";
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end)
    : null;
  if (
    subscription.plan === "plus" &&
    ACTIVE_STATUSES.has(subscription.status) &&
    (!periodEnd || periodEnd.getTime() > Date.now())
  ) {
    return "plus";
  }
  return "free";
}

function getPeriodForPlan(subscription: SubscriptionRow | null, plan: PlanId) {
  if (plan === "plus" && subscription?.current_period_start && subscription.current_period_end) {
    return {
      start: new Date(subscription.current_period_start),
      end: new Date(subscription.current_period_end),
    };
  }
  return monthPeriod();
}

function toStatus(
  row: UsageRow,
  plan: PlanId,
  subscription: SubscriptionRow | null,
  start: Date,
  end: Date,
  isUnlimited = false,
): BillingStatus {
  const limits = isUnlimited ? UNLIMITED_LIMITS : PLAN_LIMITS[plan];
  const usage = {
    dreamEntries: Number(row.dream_entries_used ?? 0),
    analysis: Number(row.analysis_used ?? 0),
    imageGenerations: Number(row.image_generations_used ?? 0),
  };

  return {
    plan,
    isUnlimited,
    subscriptionStatus: isUnlimited ? "admin" : subscription?.status ?? null,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end ?? false),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    limits,
    usage,
    remaining: isUnlimited
      ? limits
      : {
          dreamEntries: Math.max(0, limits.dreamEntries - usage.dreamEntries),
          analysis: Math.max(0, limits.analysis - usage.analysis),
          imageGenerations: Math.max(0, limits.imageGenerations - usage.imageGenerations),
        },
  };
}

async function getLatestSubscription(userId: number): Promise<SubscriptionRow | null> {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query<SubscriptionRow>(
    `
      SELECT provider_customer_id, provider_subscription_id, status, plan,
             current_period_start, current_period_end, cancel_at_period_end
      FROM subscriptions
      WHERE user_id = $1
      -- a subscription that currently grants Plus wins over a newer, already-ended one
      ORDER BY (
        plan = 'plus'
        AND status = ANY($2::text[])
        AND (current_period_end IS NULL OR current_period_end > NOW())
      ) DESC, updated_at DESC, id DESC
      LIMIT 1
    `,
    [userId, [...ACTIVE_STATUSES]],
  );
  return result.rows[0] ?? null;
}

export async function getBillingStatus(userId: number): Promise<BillingStatus> {
  await ensureSchema();
  const pool = getPool();
  const isAdmin = await isUnlimitedAdmin(userId);
  const subscription = await getLatestSubscription(userId);
  const plan = isAdmin ? "plus" : normalizePlan(subscription);
  const period = getPeriodForPlan(subscription, plan);

  const usage = await pool.query<UsageRow>(
    `
      INSERT INTO usage_periods (user_id, plan, period_start, period_end)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, period_start, period_end)
      DO UPDATE SET plan = EXCLUDED.plan, updated_at = NOW()
      RETURNING id, dream_entries_used, analysis_used, image_generations_used
    `,
    [userId, plan, period.start, period.end],
  );

  return toStatus(usage.rows[0], plan, subscription, period.start, period.end, isAdmin);
}

export async function checkAndConsumeUsage(
  userId: number,
  kind: UsageKind,
): Promise<{ allowed: boolean; usagePeriodId?: number; status: BillingStatus }> {
  const pool = getPool();
  const status = await getBillingStatus(userId);
  if (status.isUnlimited) {
    return { allowed: true, status };
  }

  const column = usageColumnByKind[kind];
  const limitKey = limitKeyByKind[kind];
  const limit = status.limits[limitKey];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<UsageRow>(
      `
        SELECT id, dream_entries_used, analysis_used, image_generations_used
        FROM usage_periods
        WHERE user_id = $1 AND period_start = $2 AND period_end = $3
        FOR UPDATE
      `,
      [userId, status.periodStart, status.periodEnd],
    );

    const row = locked.rows[0];
    const used = Number(row?.[column] ?? 0);
    if (!row || used >= limit) {
      await client.query("ROLLBACK");
      return { allowed: false, status };
    }

    const updated = await client.query<UsageRow>(
      `
        UPDATE usage_periods
        SET ${column} = ${column} + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING id, dream_entries_used, analysis_used, image_generations_used
      `,
      [row.id],
    );
    await client.query("COMMIT");

    return {
      allowed: true,
      usagePeriodId: Number(updated.rows[0].id),
      status: toStatus(updated.rows[0], status.plan, null, new Date(status.periodStart), new Date(status.periodEnd)),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refundConsumedUsage(usagePeriodId: number, kind: UsageKind): Promise<void> {
  await ensureSchema();
  const column = usageColumnByKind[kind];
  await getPool().query(
    `
      UPDATE usage_periods
      SET ${column} = GREATEST(0, ${column} - 1), updated_at = NOW()
      WHERE id = $1
    `,
    [usagePeriodId],
  );
}

export async function checkAiRateLimit(
  userId: number,
  ipAddress: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  await ensureSchema();
  const pool = getPool();
  const client = await pool.connect();
  const windowSeconds = 60;
  const scopes = [
    { key: `user:${userId}`, limit: 12 },
    { key: `ip:${ipAddress}`, limit: 30 },
  ];

  try {
    await client.query("BEGIN");
    let allowed = true;

    for (const scope of scopes) {
      const result = await client.query<{ request_count: number }>(
        `
          INSERT INTO ai_rate_limits (scope_key, window_start, request_count)
          VALUES ($1, NOW(), 1)
          ON CONFLICT (scope_key)
          DO UPDATE SET
            window_start = CASE
              WHEN ai_rate_limits.window_start <= NOW() - ($2 * INTERVAL '1 second') THEN NOW()
              ELSE ai_rate_limits.window_start
            END,
            request_count = CASE
              WHEN ai_rate_limits.window_start <= NOW() - ($2 * INTERVAL '1 second') THEN 1
              ELSE ai_rate_limits.request_count + 1
            END
          RETURNING request_count
        `,
        [scope.key, windowSeconds],
      );
      if (Number(result.rows[0]?.request_count ?? 0) > scope.limit) {
        allowed = false;
      }
    }

    await client.query("COMMIT");
    return { allowed, retryAfterSeconds: windowSeconds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The Stripe customer this user already has, so checkout and the portal reuse it. */
export async function getStripeCustomerId(userId: number): Promise<string | null> {
  await ensureSchema();
  const result = await getPool().query<{ provider_customer_id: string }>(
    `
      SELECT provider_customer_id
      FROM subscriptions
      WHERE user_id = $1 AND provider = 'stripe' AND provider_customer_id IS NOT NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [userId],
  );
  return result.rows[0]?.provider_customer_id ?? null;
}

/** Other subscriptions of this reader that the database still counts as Plus. */
export async function otherPlusSubscriptionIds(userId: number, subscriptionId: string, client?: PoolClient): Promise<string[]> {
  await ensureSchema();
  const result = await (client ?? getPool()).query<{ provider_subscription_id: string }>(
    `
      SELECT provider_subscription_id
      FROM subscriptions
      WHERE user_id = $1 AND provider = 'stripe' AND provider_subscription_id <> $2
        AND plan = 'plus' AND status = ANY($3::text[])
        AND (current_period_end IS NULL OR current_period_end > NOW())
      ORDER BY id
    `,
    [userId, subscriptionId, [...ACTIVE_STATUSES]],
  );
  return result.rows.map((row) => row.provider_subscription_id);
}

/**
 * Something the code must not decide alone (a refund Stripe refused, a duplicate found after a
 * renewal, a dispute, a customer shared by two readers). Kept in payment_events with status
 * 'needs_action'; the id makes it one row per case, so retries don't pile up:
 *   SELECT * FROM payment_events WHERE status = 'needs_action';
 */
export async function recordNeedsAction(client: PoolClient, id: string, type: string, details: Record<string, unknown>) {
  await client.query(
    `
      INSERT INTO payment_events (id, provider, type, payload, status)
      VALUES ($1, 'stripe', $2, $3, 'needs_action')
      ON CONFLICT (id) DO NOTHING
    `,
    [id, type, JSON.stringify(details)],
  );
}

/** A duplicate-subscription case: one row per subscription and kind. */
export async function recordManualAction(client: PoolClient, action: {
  kind: "refund" | "cancel";
  subscriptionId: string;
  keptSubscriptionId: string;
  invoiceId?: string | null;
  reason: string;
  stripeCode?: string;
}) {
  await recordNeedsAction(client, `action:${action.kind}:${action.subscriptionId}`, `manual.${action.kind}`, action);
}

export async function userExists(userId: number, client?: PoolClient): Promise<boolean> {
  await ensureSchema();
  const result = await (client ?? getPool()).query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Who owns this Stripe subscription: the reader it is linked to, else the one reader its customer
 * is linked to. A customer linked to several readers is not guessed at.
 */
export async function findOwnerOfStripeSubscription(
  subscriptionId: string,
  customerId: string | null,
  client?: PoolClient,
): Promise<{ userId: number } | { ambiguous: number[] } | null> {
  await ensureSchema();
  const db = client ?? getPool();
  const bySubscription = await db.query<{ user_id: number }>(
    `SELECT user_id FROM subscriptions WHERE provider = 'stripe' AND provider_subscription_id = $1 LIMIT 1`,
    [subscriptionId],
  );
  if (bySubscription.rows[0]) return { userId: bySubscription.rows[0].user_id };
  if (!customerId) return null;
  const byCustomer = await db.query<{ user_id: number }>(
    `SELECT DISTINCT user_id FROM subscriptions WHERE provider = 'stripe' AND provider_customer_id = $1 ORDER BY user_id LIMIT 5`,
    [customerId],
  );
  if (byCustomer.rows.length > 1) return { ambiguous: byCustomer.rows.map((row) => row.user_id) };
  return byCustomer.rows[0] ? { userId: byCustomer.rows[0].user_id } : null;
}

export async function upsertStripeSubscription(input: {
  userId: number;
  customerId: string | null;
  subscriptionId: string;
  status: string;
  plan?: PlanId;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}, client?: PoolClient) {
  await ensureSchema();
  await (client ?? getPool()).query(
    `
      INSERT INTO subscriptions (
        user_id, provider, provider_customer_id, provider_subscription_id,
        status, plan, current_period_start, current_period_end, cancel_at_period_end
      )
      VALUES ($1, 'stripe', $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (provider, provider_subscription_id)
      DO UPDATE SET
        -- a subscription never changes hands (see the webhook's ownership checks)
        provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
        -- an ended Stripe subscription can never start again; a late, out-of-order event
        -- must not bring it back
        status = CASE
          WHEN subscriptions.status IN ('canceled', 'incomplete_expired') THEN subscriptions.status
          ELSE EXCLUDED.status
        END,
        plan = EXCLUDED.plan,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = NOW()
    `,
    [
      input.userId,
      input.customerId,
      input.subscriptionId,
      input.status,
      input.plan ?? "plus",
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ?? false,
    ],
  );
}

export async function processStripeEvent(
  event: { id: string; type: string; payload: unknown },
  handler: (client: PoolClient) => Promise<void>,
): Promise<"processed" | "duplicate"> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO payment_events (id, provider, type, payload, status)
        VALUES ($1, 'stripe', $2, $3, 'pending')
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [event.id, event.type, JSON.stringify(event.payload)],
    );

    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return "duplicate";
    }

    await handler(client);
    await client.query(
      `
        UPDATE payment_events
        SET status = 'processed', processed_at = NOW()
        WHERE id = $1
      `,
      [event.id],
    );
    await client.query("COMMIT");
    return "processed";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
