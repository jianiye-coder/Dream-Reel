import { Pool } from "pg";
import { encryptDreamText, isEncryptedDreamText } from "./dreamTextEncryption";

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
const SCHEMA_VERSION = 2;

let schemaReady = false;

async function encryptLegacyDreamTextRows(pool: Pool): Promise<void> {
  while (true) {
    const result = await pool.query<{ id: string; raw_text: string; clean_text: string }>(
      `
        SELECT id, raw_text, clean_text
        FROM dream_entries
        WHERE raw_text NOT LIKE 'dre1:%'
           OR clean_text NOT LIKE 'dre1:%'
        LIMIT 500;
      `,
    );

    if (result.rows.length === 0) {
      return;
    }

    for (const row of result.rows) {
      const encryptedRawText = isEncryptedDreamText(row.raw_text)
        ? row.raw_text
        : encryptDreamText(row.raw_text);
      const encryptedCleanText = isEncryptedDreamText(row.clean_text)
        ? row.clean_text
        : encryptDreamText(row.clean_text);

      await pool.query(
        `
          UPDATE dream_entries
          SET raw_text = $2, clean_text = $3
          WHERE id = $1;
        `,
        [row.id, encryptedRawText, encryptedCleanText],
      );
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
    await encryptLegacyDreamTextRows(pool);
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    pool.query("CREATE INDEX IF NOT EXISTS idx_dream_entries_captured_at ON dream_entries (captured_at DESC);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_dream_entries_user_id ON dream_entries (user_id);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (provider, provider_customer_id);"),
    pool.query("CREATE INDEX IF NOT EXISTS idx_usage_periods_user_period ON usage_periods (user_id, period_start, period_end);"),
  ]);

  // Record that this schema version is now applied
  await pool.query(
    "INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING",
    [SCHEMA_VERSION],
  );

  await encryptLegacyDreamTextRows(pool);

  schemaReady = true;
}
