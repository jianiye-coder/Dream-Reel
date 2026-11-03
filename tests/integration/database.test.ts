import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkAndConsumeUsage,
  processStripeEvent,
  refundConsumedUsage,
} from "@/lib/billing";
import { ensureSchema, getPool, lockDownPublicApi } from "@/lib/db";
import { createDreamEntry, listDreamEntries, updateDreamEntry } from "@/lib/dreams";

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
const databaseDescribe = hasDatabase ? describe : describe.skip;

databaseDescribe("PostgreSQL integration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "integration-encryption-secret";
    await ensureSchema();
  });

  beforeEach(async () => {
    await getPool().query(`
      TRUNCATE payment_events, usage_periods, subscriptions, user_credits,
               dream_entries, sessions, accounts, users RESTART IDENTITY CASCADE
    `);
  });

  async function createUser(email: string) {
    const result = await getPool().query<{ id: number }>(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      [email, email],
    );
    return result.rows[0].id;
  }

  const input = (text: string) => ({
    title: "",
    inputMode: "text" as const,
    rawText: text,
    cleanText: text,
    mood: "",
    tags: [],
    people: [],
    locations: [],
    symbols: [],
  });

  it("keeps dream reads and updates isolated by user", async () => {
    const userA = await createUser("a@example.com");
    const userB = await createUser("b@example.com");
    await createDreamEntry(input("A's dream"), userA);
    const other = await createDreamEntry(input("B's dream"), userB);

    const entries = await listDreamEntries(userA, 50);
    expect(entries.map((entry) => entry.rawText)).toEqual(["A's dream"]);
    await expect(updateDreamEntry({ ...input("stolen"), id: other.id }, userA))
      .rejects.toThrow();
  });

  it("consumes and refunds AI usage deterministically", async () => {
    const userId = await createUser("usage@example.com");
    const usage = await checkAndConsumeUsage(userId, "analysis");
    expect(usage.allowed).toBe(true);
    expect(usage.usagePeriodId).toBeTypeOf("number");

    await refundConsumedUsage(usage.usagePeriodId!, "analysis");
    const result = await getPool().query<{ analysis_used: number }>(
      `SELECT analysis_used FROM usage_periods WHERE id = $1`,
      [usage.usagePeriodId],
    );
    expect(Number(result.rows[0].analysis_used)).toBe(0);
  });

  it("retries failed Stripe events but deduplicates committed events", async () => {
    const event = { id: "evt_retry", type: "checkout.session.completed", payload: {} };
    await expect(processStripeEvent(event, async () => {
      throw new Error("temporary subscription failure");
    })).rejects.toThrow("temporary subscription failure");

    await expect(processStripeEvent(event, async () => undefined)).resolves.toBe("processed");
    await expect(processStripeEvent(event, async () => {
      throw new Error("must not run");
    })).resolves.toBe("duplicate");
  });

  it("closes the hosted REST API roles out of every app table", async () => {
    // One transaction, rolled back: roles, grants and probe tables never outlive the test.
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      // Recreate what Supabase does: an `anon` role granted on today's and tomorrow's tables.
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        END $$;
      `);
      await client.query("CREATE ROLE rls_owner_probe NOLOGIN");
      await client.query("GRANT CREATE ON SCHEMA public TO rls_owner_probe");
      await client.query("GRANT USAGE ON SCHEMA public TO anon");
      await client.query("GRANT SELECT ON users, dream_entries TO anon");
      await client.query("INSERT INTO users (email, name) VALUES ('rls@example.com', 'rls')");

      // Supabase's `postgres` is an owner, not a superuser, so run the lockdown as one.
      await client.query("SET ROLE rls_owner_probe");
      await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon");
      await client.query("CREATE TABLE rls_probe (id INTEGER)");
      await client.query("INSERT INTO rls_probe VALUES (1)");
      await client.query("GRANT SELECT ON rls_probe TO anon");
      await lockDownPublicApi(client);
      await client.query("CREATE TABLE rls_probe_later (id INTEGER)");
      // the owner still sees its rows
      await expect(client.query("SELECT id FROM rls_probe")).resolves.toMatchObject({ rowCount: 1 });
      await client.query("RESET ROLE");

      await lockDownPublicApi(client);
      const open = await client.query<{ relname: string }>(`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
          AND c.relname <> 'rls_probe_later'
      `);
      expect(open.rows).toEqual([]);
      const grants = await client.query(`
        SELECT has_table_privilege('anon', 'users', 'SELECT') AS users,
               has_table_privilege('anon', 'dream_entries', 'SELECT') AS dreams,
               has_table_privilege('anon', 'rls_probe', 'SELECT') AS probe,
               has_table_privilege('anon', 'rls_probe_later', 'SELECT') AS later
      `);
      expect(grants.rows[0]).toEqual({ users: false, dreams: false, probe: false, later: false });

      // even if a grant slips back in, RLS with no policies shows anon nothing
      await client.query("GRANT SELECT ON users TO anon");
      await client.query("SET ROLE anon");
      await expect(client.query("SELECT id FROM users")).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
