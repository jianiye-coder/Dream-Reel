import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), ensureSchema: vi.fn() }));
vi.mock("@/lib/db", () => ({
  ensureSchema: db.ensureSchema,
  getPool: () => ({ query: db.query }),
}));

import { decryptDreamText, encryptDreamText } from "@/lib/dreamTextEncryption";
import {
  deleteMorningPage,
  getMorningPage,
  listMorningPages,
  MorningPageConflictError,
  morningPageDateSchema,
  putMorningPage,
} from "@/lib/morningPages";

const date = "2026-10-07";
const updatedAt = new Date("2026-10-07T12:00:00.000Z");

beforeEach(() => {
  db.query.mockReset();
  db.ensureSchema.mockResolvedValue(undefined);
  vi.stubEnv("DREAM_TEXT_ENCRYPTION_KEY", "morning-pages-unit-test-secret");
  vi.stubEnv("DREAM_TEXT_ENCRYPTION_KEY_ID", "test");
});

afterEach(() => vi.unstubAllEnvs());

describe("morning page persistence", () => {
  it.each(["private freewriting", "", "dre2:literal words", "dre1:literal words", "  line one\nline two  ", "早晨的想法"])(
    "encrypts and round-trips arbitrary content: %j", async (content) => {
      db.query.mockImplementation(async (_sql: string, params: unknown[]) => ({
        rows: [{ date, content: params[2], revision: 1, updated_at: updatedAt }],
      }));
      const entry = await putMorningPage(42, { date, content, revision: 0 });
      expect(entry).toEqual({ date, content, drawing: [], revision: 1, updatedAt: updatedAt.toISOString() });
      expect(db.ensureSchema).toHaveBeenCalledOnce();
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain("INSERT INTO morning_pages");
      expect(sql).toContain("ON CONFLICT (user_id, date) DO NOTHING");
      expect(params.slice(0, 2)).toEqual([42, date]);
      expect(params[2]).toMatch(/^dre2:test:/);
      expect(params[2]).not.toBe(content);
      expect(JSON.parse(decryptDreamText(params[2]))).toEqual({ content, drawing: [] });
      expect(db.query).toHaveBeenCalledOnce();
    },
  );

  it("reads and decrypts only the owner's requested date", async () => {
    db.query.mockResolvedValue({ rows: [{
      date, content: encryptDreamText(JSON.stringify("private writing")),
      revision: 3, updated_at: updatedAt,
    }] });
    await expect(getMorningPage(42, date)).resolves.toEqual({
      date, content: "private writing", drawing: [], revision: 3, updatedAt: updatedAt.toISOString(),
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = $1 AND date = $2::date"), [42, date],
    );
  });

  it("returns null when the owner has no page for the date", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(getMorningPage(7, date)).resolves.toBeNull();
    expect(db.query.mock.calls[0][1]).toEqual([7, date]);
  });

  it("selects only metadata for the owner's latest 90 dates", async () => {
    db.query.mockResolvedValue({ rows: [{ date, updated_at: updatedAt }] });
    await expect(listMorningPages(42)).resolves.toEqual([{ date, updatedAt: updatedAt.toISOString() }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("WHERE user_id = $1");
    expect(sql).toContain("ORDER BY morning_pages.date DESC LIMIT 90");
    expect(sql).not.toMatch(/\bcontent\b|SELECT\s+\*/i);
    expect(params).toEqual([42]);
  });

  it("clears content with one owner-scoped compare-and-swap update", async () => {
    db.query.mockImplementation(async (_sql: string, params: unknown[]) => ({
      rows: [{ date, content: params[2], revision: 8, updated_at: updatedAt }],
    }));
    await expect(putMorningPage(42, { date, content: "", revision: 7 })).resolves.toMatchObject({
      content: "", revision: 8,
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("SET content = $3, revision = revision + 1, updated_at = NOW()");
    expect(sql).toContain("WHERE user_id = $1 AND date = $2::date AND revision = $4");
    expect(params).toEqual([42, date, expect.stringMatching(/^dre2:/), 7]);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it.each([0, 3])("reports a conflict on duplicate creation or stale/missing update (revision %i)", async (revision) => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(putMorningPage(42, { date, content: "new text", revision }))
      .rejects.toBeInstanceOf(MorningPageConflictError);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("deletes only the owner's matching revision", async () => {
    db.query.mockResolvedValue({ rows: [{ date }] });
    await expect(deleteMorningPage(42, { date, revision: 7 })).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = $1 AND date = $2::date AND revision = $3"),
      [42, date, 7],
    );
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("conflicts when a delete is stale, missing, or belongs to another owner", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(deleteMorningPage(7, { date, revision: 7 })).rejects.toBeInstanceOf(MorningPageConflictError);
    expect(db.query.mock.calls[0][1]).toEqual([7, date, 7]);
  });

  it("does not persist plaintext when encryption is unavailable", async () => {
    vi.stubEnv("DREAM_TEXT_ENCRYPTION_KEY", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    await expect(putMorningPage(42, { date, content: "private text", revision: 0 })).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("encrypts and restores editable drawing strokes alongside text", async () => {
    db.query.mockImplementation(async (_sql: string, params: unknown[]) => ({
      rows: [{ date, content: params[2], revision: 1, updated_at: updatedAt }],
    }));
    const drawing = [{ tool: "pen" as const, color: "#356859" as const, width: 4, points: [{ x: 0.2, y: 0.4 }] }];
    const entry = await putMorningPage(42, { date, content: "", drawing, revision: 0 });
    expect(entry.drawing).toEqual(drawing);
    const encrypted = db.query.mock.calls[0][1][2];
    expect(encrypted).toMatch(/^dre2:/);
    expect(encrypted).not.toContain("#356859");
    expect(JSON.parse(decryptDreamText(encrypted))).toEqual({ content: "", drawing });
  });
});

describe("strict calendar dates", () => {
  it.each(["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])("accepts %s", (value) => {
    expect(morningPageDateSchema.safeParse(value).success).toBe(true);
  });
  it.each([
    "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00",
    "0000-01-01", "2026-1-01", "2026-01-1", " 2026-01-01", "2026-01-01 ",
    "2026-01-01T00:00:00Z", "", "not a date",
  ])("rejects %j", (value) => {
    expect(morningPageDateSchema.safeParse(value).success).toBe(false);
  });
});
