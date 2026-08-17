import { Pool } from "pg";
import {
  getCurrentDreamEncryptionKeyId,
  needsDreamTextReencryption,
  reencryptDreamText,
} from "./dreamTextEncryption";

declare global {
  var dreamPool: Pool | undefined;
}

export function getPool(): Pool {
  if (globalThis.dreamPool) {
    return globalThis.dreamPool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing. Please configure PostgreSQL first.");
  }

  const pool = new Pool({
    connectionString,
    max: 1,                    // one connection per serverless instance
    idleTimeoutMillis: 10_000, // release idle connections after 10s
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
  });
  globalThis.dreamPool = pool;
  return pool;
}

// Bump this whenever you add new migrations. ensureSchema will skip all DDL
// once this version is recorded in the DB, making cold starts near-instant.
const SCHEMA_VERSION = 6;

let schemaReady = false;

async function normalizeUserEmails(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7240318)");
    const duplicates = await client.query<{
      normalized_email: string;
      user_ids: number[];
    }>(
      `
        SELECT LOWER(TRIM(email)) AS normalized_email,
               ARRAY_AGG(id ORDER BY id) AS user_ids
        FROM users
        WHERE email IS NOT NULL
        GROUP BY LOWER(TRIM(email))
        HAVING COUNT(*) > 1
      `,
    );

    for (const group of duplicates.rows) {
      const [canonicalId, ...duplicateIds] = group.user_ids.map(Number);
      if (!canonicalId || duplicateIds.length === 0) continue;

      await client.query(
        `UPDATE dream_entries SET user_id = $1 WHERE user_id = ANY($2::int[])`,
        [canonicalId, duplicateIds],
      );
      await client.query(
        `UPDATE accounts SET "userId" = $1 WHERE "userId" = ANY($2::int[])`,
        [canonicalId, duplicateIds],
      );
      await client.query(
        `UPDATE sessions SET "userId" = $1 WHERE "userId" = ANY($2::int[])`,
        [canonicalId, duplicateIds],
      );
      await client.query(
        `UPDATE subscriptions SET user_id = $1 WHERE user_id = ANY($2::int[])`,
        [canonicalId, duplicateIds],
      );

      const duplicateUsage = await client.query<{
        plan: string;
        period_start: Date;
        period_end: Date;
        dream_entries_used: number;
        analysis_used: number;
        image_generations_used: number;
      }>(
        `
          SELECT plan, period_start, period_end, dream_entries_used,
                 analysis_used, image_generations_used
          FROM usage_periods
          WHERE user_id = ANY($1::int[])
        `,
        [duplicateIds],
      );
      for (const usage of duplicateUsage.rows) {
        await client.query(
          `
            INSERT INTO usage_periods (
              user_id, plan, period_start, period_end,
              dream_entries_used, analysis_used, image_generations_used
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, period_start, period_end)
            DO UPDATE SET
              dream_entries_used = usage_periods.dream_entries_used + EXCLUDED.dream_entries_used,
              analysis_used = usage_periods.analysis_used + EXCLUDED.analysis_used,
              image_generations_used = usage_periods.image_generations_used + EXCLUDED.image_generations_used,
              updated_at = NOW()
          `,
          [
            canonicalId,
            usage.plan,
            usage.period_start,
            usage.period_end,
            usage.dream_entries_used,
            usage.analysis_used,
            usage.image_generations_used,
          ],
        );
      }
      await client.query(
        `DELETE FROM usage_periods WHERE user_id = ANY($1::int[])`,
        [duplicateIds],
      );

      const credits = await client.query<{
        bonus: number;
        used_today: number;
        reset_date: Date;
      }>(
        `
          SELECT COALESCE(SUM(bonus), 0)::int AS bonus,
                 COALESCE(SUM(used_today), 0)::int AS used_today,
                 MAX(reset_date) AS reset_date
          FROM user_credits
          WHERE user_id = ANY($1::int[])
        `,
        [[canonicalId, ...duplicateIds]],
      );
      if (credits.rows[0]?.reset_date) {
        await client.query(
          `
            INSERT INTO user_credits (user_id, bonus, used_today, reset_date)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id)
            DO UPDATE SET
              bonus = EXCLUDED.bonus,
              used_today = EXCLUDED.used_today,
              reset_date = EXCLUDED.reset_date
          `,
          [
            canonicalId,
            credits.rows[0].bonus,
            credits.rows[0].used_today,
            credits.rows[0].reset_date,
          ],
        );
      }
      await client.query(
        `DELETE FROM user_credits WHERE user_id = ANY($1::int[])`,
        [duplicateIds],
      );
      await client.query(
        `DELETE FROM users WHERE id = ANY($1::int[])`,
        [duplicateIds],
      );
      await client.query(
        `UPDATE users SET email = $2 WHERE id = $1`,
        [canonicalId, group.normalized_email],
      );
    }

    await client.query(`UPDATE users SET email = LOWER(TRIM(email)) WHERE email IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email))`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateDreamTextEncryption(pool: Pool): Promise<void> {
  const currentPrefix = `dre2:${getCurrentDreamEncryptionKeyId()}:`;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; raw_text: string; clean_text: string }>(
        `
          SELECT id, raw_text, clean_text
          FROM dream_entries
          WHERE LEFT(raw_text, LENGTH($1)) <> $1
             OR LEFT(clean_text, LENGTH($1)) <> $1
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT 500
        `,
        [currentPrefix],
      );

      if (result.rows.length === 0) {
        await client.query("COMMIT");
        return;
      }

      for (const row of result.rows) {
        await client.query(
          "UPDATE dream_entries SET raw_text = $2, clean_text = $3 WHERE id = $1",
          [
            row.id,
            needsDreamTextReencryption(row.raw_text) ? reencryptDreamText(row.raw_text) : row.raw_text,
            needsDreamTextReencryption(row.clean_text) ? reencryptDreamText(row.clean_text) : row.clean_text,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;

  const pool = getPool();

  // Bootstrap: create the version tracking table in one round-trip
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // If this version is already applied, skip all DDL — fast path on cold starts
  const { rows } = await pool.query<{ version: number }>(
    "SELECT version FROM schema_version WHERE version = $1",
    [SCHEMA_VERSION],
  );
  if (rows.length > 0) {
    await migrateDreamTextEncryption(pool);
    schemaReady = true;
    return;
  }

  // ── First-time / upgrade: run all DDL in parallel where safe ─────────────

  // Core tables (create in parallel — no cross-dependencies at this level)
  await Promise.all([
    pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        "emailVerified" TIMESTAMPTZ,
        image TEXT,
        password_hash TEXT
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS verification_tokens (
        identifier TEXT NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        token TEXT NOT NULL,
        PRIMARY KEY (identifier, token)
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS payment_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS ai_rate_limits (
        scope_key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        scope_key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0
      );
    `),
  ]);

  // Tables that reference users (after users exists)
  await Promise.all([
    pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(255) NOT NULL,
        provider VARCHAR(255) NOT NULL,
        "providerAccountId" VARCHAR(255) NOT NULL,
        refresh_token TEXT,
        access_token TEXT,
        expires_at BIGINT,
        id_token TEXT,
        scope TEXT,
        session_state TEXT,
        token_type TEXT,
        UNIQUE(provider, "providerAccountId")
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires TIMESTAMPTZ NOT NULL,
        "sessionToken" VARCHAR(255) NOT NULL UNIQUE
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS dream_entries (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        input_mode TEXT NOT NULL CHECK (input_mode IN ('voice', 'text')),
        raw_text TEXT NOT NULL,
        clean_text TEXT NOT NULL,
        mood TEXT DEFAULT '',
        stress_score INTEGER CHECK (stress_score BETWEEN 1 AND 5),
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        people TEXT[] NOT NULL DEFAULT '{}',
        locations TEXT[] NOT NULL DEFAULT '{}',
        symbols TEXT[] NOT NULL DEFAULT '{}',
        image_url TEXT,
        asset_status TEXT
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS user_credits (
        user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bonus       INTEGER NOT NULL DEFAULT 0,
        used_today  INTEGER NOT NULL DEFAULT 0,
        reset_date  DATE    NOT NULL DEFAULT CURRENT_DATE
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_customer_id TEXT,
        provider_subscription_id TEXT,
        status TEXT NOT NULL DEFAULT 'incomplete',
        plan TEXT NOT NULL DEFAULT 'plus',
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_subscription_id)
      );
    `),
    pool.query(`
      CREATE TABLE IF NOT EXISTS usage_periods (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL DEFAULT 'free',
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        dream_entries_used INTEGER NOT NULL DEFAULT 0,
        analysis_used INTEGER NOT NULL DEFAULT 0,
        image_generations_used INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, period_start, period_end)
      );
    `),
  ]);

  // All ALTER TABLE and CREATE INDEX in parallel (idempotent)
  await Promise.all([
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS sleep_start TEXT;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS wake_time TEXT;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS sleep_quality INTEGER CHECK (sleep_quality BETWEEN 1 AND 5);"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS pre_sleep_meal TEXT;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS pre_sleep_activity TEXT;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS sleep_insight TEXT;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS title TEXT;"),
    pool.query("ALTER TABLE dream_entries ADD COLUMN IF NOT EXISTS visual_brief TEXT;"),
    pool.query("ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processed';"),
    pool.query("ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_dream_entries_captured_at ON dream_entries (captured_at DESC);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_dream_entries_user_id ON dream_entries (user_id);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (provider, provider_customer_id);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_usage_periods_user_period ON usage_periods (user_id, period_start, period_end);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_ai_rate_limits_window_start ON ai_rate_limits (window_start);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window_start ON auth_rate_limits (window_start);"),
  ]);

  await normalizeUserEmails(pool);

  // Record that this schema version is now applied
  await pool.query(
    "INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING",
    [SCHEMA_VERSION],
  );

  await migrateDreamTextEncryption(pool);

  schemaReady = true;
}
