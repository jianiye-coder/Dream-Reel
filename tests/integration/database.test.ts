import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkAndConsumeUsage,
  processStripeEvent,
  refundConsumedUsage,
} from "@/lib/billing";
import { ensureSchema, getPool } from "@/lib/db";
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

    const entries = await listDreamEntries(50, userA);
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
});
