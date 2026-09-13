import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: db.ensureSchema,
  getPool: () => ({ query: db.query }),
}));

import { getDreamEntry, listDreamEntriesPage } from "@/lib/dreams";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: "Moon room",
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    captured_at: new Date("2026-09-01T00:00:00.000Z"),
    input_mode: "text",
    raw_text: "private raw text",
    clean_text: "private clean text",
    mood: "平静",
    stress_score: 2,
    tags: ["tag"],
    people: ["person"],
    locations: ["room"],
    symbols: ["moon"],
    image_url: "data:image/png;base64," + "a".repeat(64),
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

  it("omits legacy base64 images and visual prompts from paginated archive lists", async () => {
    db.query.mockResolvedValue({ rows: [row()] });

    const page = await listDreamEntriesPage(7, { limit: 24 });
    const sql = String(db.query.mock.calls[0][0]);

    expect(page.entries[0]).toMatchObject({
      id: 42,
      imageUrl: null,
      thumbnailUrl: null,
      imageUrlOmitted: true,
      visualBrief: null,
    });
    expect(sql).not.toContain("SELECT *");
    expect(sql).toContain("WHEN image_url LIKE 'data:image/%' THEN NULL");
  });

  it("keeps full image and visual prompt data for a single-entry detail read", async () => {
    const imageUrl = "data:image/png;base64," + "b".repeat(64);
    db.query.mockResolvedValue({ rows: [row({ image_url: imageUrl })] });

    const entry = await getDreamEntry(7, 42);

    expect(entry).toMatchObject({
      imageUrl,
      thumbnailUrl: imageUrl,
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
      imageUrlOmitted: undefined,
    });
  });
});
