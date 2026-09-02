import { describe, expect, it } from "vitest";
import {
  buildDreamJsonExport,
  buildDreamMarkdownExport,
  sanitizeDreamExportFilename,
} from "@/lib/dreamExport";
import type { DreamEntry } from "@/lib/dreams";

const dream: DreamEntry = {
  id: 12,
  title: "Moonlit Station",
  createdAt: "2026-08-20T08:00:00.000Z",
  capturedAt: "2026-08-20T07:30:00.000Z",
  inputMode: "text",
  rawText: "I waited for a train that never arrived.",
  cleanText: "I waited for a silver train that never arrived.",
  mood: "wistful",
  stressScore: 2,
  tags: ["travel", "night"],
  people: ["grandmother"],
  locations: ["station"],
  symbols: ["train"],
  imageUrl: "https://example.com/dream.png",
  thumbnailUrl: "https://example.com/dream-thumb.webp",
  assetStatus: "generated",
  sleepStart: "23:30",
  wakeTime: "07:10",
  sleepQuality: 4,
  preSleepMeal: "tea",
  preSleepActivity: "reading",
  sleepInsight: "The waiting may reflect uncertainty.",
  visualBrief: "A silver train beneath moonlight.",
};

describe("dream exports", () => {
  const exportedAt = new Date("2026-08-24T12:00:00.000Z");

  it("creates a readable Markdown archive", () => {
    const output = buildDreamMarkdownExport([dream], "en", exportedAt);

    expect(output).toContain("# Dream Reel Archive");
    expect(output).toContain("## 2026-08-20 — Moonlit Station");
    expect(output).toContain("I waited for a silver train");
    expect(output).toContain("### Sleep & context");
    expect(output).toContain("https://example.com/dream.png");
  });

  it("creates a versioned JSON backup without derived thumbnail URLs", () => {
    const payload = JSON.parse(buildDreamJsonExport([dream], exportedAt)) as Record<string, unknown>;

    expect(payload).toMatchObject({
      schemaVersion: 1,
      product: "Dream Reel",
      exportedAt: exportedAt.toISOString(),
      dreamCount: 1,
    });
    expect((payload.dreams as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 12,
      title: "Moonlit Station",
      rawText: dream.rawText,
      imageUrl: dream.imageUrl,
    });
    expect((payload.dreams as Array<Record<string, unknown>>)[0]).not.toHaveProperty("thumbnailUrl");
  });

  it("creates filesystem-safe filenames", () => {
    expect(sanitizeDreamExportFilename("  Dream / Night: One?  ")).toBe("Dream - Night- One-");
    expect(sanitizeDreamExportFilename("... ")).toBe("dream");
  });
});
