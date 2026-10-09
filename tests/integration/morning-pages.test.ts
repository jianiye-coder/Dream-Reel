import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema, getPool } from "@/lib/db";
import { getMorningPage, putMorningPage, deleteMorningPage, MorningPageConflictError } from "@/lib/morningPages";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;

databaseDescribe("private morning pages in PostgreSQL", () => {
  const users: number[] = [];
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "integration-encryption-secret";
    await ensureSchema();
    const { rows } = await getPool().query<{ id: number }>(
      "INSERT INTO users (email) VALUES ($1), ($2) RETURNING id",
      [`morning-a-${Date.now()}@example.test`, `morning-b-${Date.now()}@example.test`],
    );
    users.push(...rows.map((row) => row.id));
  });
  afterAll(async () => {
    if (users.length) await getPool().query("DELETE FROM users WHERE id = ANY($1::int[])", [users]);
    await getPool().end();
    globalThis.dreamPool = undefined;
  });

  it("round-trips encrypted text and strokes while enforcing ownership and revisions", async () => {
    const drawing = [{ tool: "pen" as const, color: "#0f172a" as const, width: 5, points: [{ x: .1, y: .2 }, { x: .3, y: .4 }] }];
    const input = { date: "2026-10-07", content: "Private morning thoughts.", drawing, revision: 0 };
    const saved = await putMorningPage(users[0], input);
    expect(saved).toMatchObject({ ...input, revision: 1 });
    await expect(getMorningPage(users[1], input.date)).resolves.toBeNull();
    await expect(putMorningPage(users[1], { ...input, revision: 1 })).rejects.toBeInstanceOf(MorningPageConflictError);
    const raw = await getPool().query("SELECT content FROM morning_pages WHERE user_id = $1", [users[0]]);
    expect(raw.rows[0].content).toMatch(/^dre2:/);
    expect(raw.rows[0].content).not.toContain(input.content);
    expect(raw.rows[0].content).not.toContain("#0f172a");
    await expect(getMorningPage(users[0], input.date)).resolves.toEqual(saved);

    const writes = await Promise.allSettled([
      putMorningPage(users[0], { ...input, content: "First window", revision: 1 }),
      putMorningPage(users[0], { ...input, content: "Second window", revision: 1 }),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(deleteMorningPage(users[0], { date: input.date, revision: 1 })).rejects.toBeInstanceOf(MorningPageConflictError);
    await deleteMorningPage(users[0], { date: input.date, revision: 2 });
    await expect(getMorningPage(users[0], input.date)).resolves.toBeNull();
  });
});
