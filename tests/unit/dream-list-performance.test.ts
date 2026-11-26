import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: db.ensureSchema,
  getPool: () => ({ query: db.query }),
}));

import { getDreamEntry, listDreamEntriesPage, dreamEntryInputSchema } from "@/lib/dreams";
import { encryptDreamText } from "@/lib/dreamTextEncryption";

process.env.DREAM_TEXT_ENCRYPTION_KEY ??= "unit-test-encryption-secret";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: "Moon room",
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    captured_at: new Date("2026-09-01T00:00:00.000Z"),
    input_mode: "text",
    raw_text: encryptDreamText("private raw text"),
    clean_text: encryptDreamText("private clean text"),
    mood: "平静",
    stress_score: 2,
    tags: ["tag"],
    people: ["person"],
    locations: ["room"],
    symbols: ["moon"],
    image_url: "https://blob.example/dream-images/abc.png",
    asset_status: "generated",
    sleep_start: null,
    wake_time: null,
    sleep_quality: null,
    pre_sleep_meal: null,
    pre_sleep_activity: null,
    sleep_insight: null,
    visual_brief: "long visual prompt",
    ...overrides,
  };
}

describe("archive list payloads", () => {
  beforeEach(() => {
    db.ensureSchema.mockReset();
    db.query.mockReset();
  });

  it("omits visual prompts from paginated archive lists", async () => {
    db.query.mockResolvedValue({ rows: [row()] });

    const page = await listDreamEntriesPage(7, { limit: 24 });
    const sql = String(db.query.mock.calls[0][0]);

    expect(page.entries[0]).toMatchObject({ id: 42, visualBrief: null });
    expect(sql).not.toContain("SELECT *");
    expect(sql).toContain("NULL AS visual_brief");
  });

  it("keeps the visual prompt for a single-entry detail read", async () => {
    db.query.mockResolvedValue({ rows: [row()] });

    const entry = await getDreamEntry(7, 42);

    expect(entry).toMatchObject({
      imageUrl: "https://blob.example/dream-images/abc.png",
      thumbnailUrl: "https://blob.example/dream-images/abc-thumb.webp",
      visualBrief: "long visual prompt",
    });
  });

  it("uses generated thumbnails for blob-backed archive list images", async () => {
    db.query.mockResolvedValue({
      rows: [row({ image_url: "https://blob.example/dream-images/abc.png" })],
    });

    const page = await listDreamEntriesPage(7, { limit: 24 });

    expect(page.entries[0]).toMatchObject({
      imageUrl: "https://blob.example/dream-images/abc.png",
      thumbnailUrl: "https://blob.example/dream-images/abc-thumb.webp",
    });
  });

  it("accepts hosted images and refuses inline data URLs on save", () => {
    const base = { inputMode: "text", rawText: "a dream" };
    expect(dreamEntryInputSchema.safeParse({ ...base, imageUrl: "https://blob.example/dream-images/abc.png" }).success).toBe(true);
    expect(dreamEntryInputSchema.safeParse({ ...base, imageUrl: null }).success).toBe(true);
    expect(dreamEntryInputSchema.safeParse({ ...base, imageUrl: "data:image/png;base64,AAAA" }).success).toBe(false);
    expect(dreamEntryInputSchema.safeParse({ ...base, imageUrl: "http://blob.example/a.png" }).success).toBe(false);
  });
});
