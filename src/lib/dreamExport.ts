import type { DreamEntry } from "@/lib/dreams";

export type DreamExportFormat = "markdown" | "json";
export type DreamExportLanguage = "zh" | "en";

type DreamExportPayload = {
  schemaVersion: 1;
  product: "Dream Reel";
  exportedAt: string;
  dreamCount: number;
  dreams: Array<Omit<DreamEntry, "thumbnailUrl">>;
};

const labels = {
  zh: {
    archive: "Dream Reel 梦境档案",
    exportedAt: "导出时间",
    dreamCount: "梦境数量",
    capturedAt: "梦境日期",
    createdAt: "记录时间",
    mood: "情绪",
    stress: "压力评分",
    tags: "标签",
    people: "人物",
    locations: "地点",
    symbols: "符号",
    dream: "梦境内容",
    cleanDream: "整理后的梦境",
    sleep: "睡眠与前情",
    sleepStart: "入睡时间",
    wakeTime: "起床时间",
    sleepQuality: "睡眠质量",
    meal: "睡前饮食",
    activity: "睡前活动",
    insight: "AI 洞察",
    image: "梦境图片",
    visualBrief: "图像提示词",
    none: "未填写",
  },
  en: {
    archive: "Dream Reel Archive",
    exportedAt: "Exported at",
    dreamCount: "Dreams",
    capturedAt: "Dream date",
    createdAt: "Recorded at",
    mood: "Mood",
    stress: "Stress score",
    tags: "Tags",
    people: "People",
    locations: "Locations",
    symbols: "Symbols",
    dream: "Dream",
    cleanDream: "Edited dream",
    sleep: "Sleep & context",
    sleepStart: "Fell asleep",
    wakeTime: "Woke up",
    sleepQuality: "Sleep quality",
    meal: "Pre-sleep meal",
    activity: "Pre-sleep activity",
    insight: "AI insight",
    image: "Dream image",
    visualBrief: "Visual prompt",
    none: "Not provided",
  },
} as const;

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function valueOrFallback(value: string | number | null | undefined, fallback: string): string {
  if (value == null || String(value).trim() === "") return fallback;
  return String(value).trim();
}

function listOrFallback(values: string[], fallback: string): string {
  const cleaned = values.map(inline).filter(Boolean);
  return cleaned.length ? cleaned.join(" · ") : fallback;
}

function exportableDream(entry: DreamEntry): Omit<DreamEntry, "thumbnailUrl"> {
  const dream: Partial<DreamEntry> = { ...entry };
  delete dream.thumbnailUrl;
  return dream as Omit<DreamEntry, "thumbnailUrl">;
}

export function buildDreamExportPayload(
  entries: DreamEntry[],
  exportedAt = new Date(),
): DreamExportPayload {
  return {
    schemaVersion: 1,
    product: "Dream Reel",
    exportedAt: exportedAt.toISOString(),
    dreamCount: entries.length,
    dreams: entries.map(exportableDream),
  };
}

export function buildDreamJsonExport(entries: DreamEntry[], exportedAt = new Date()): string {
  return `${JSON.stringify(buildDreamExportPayload(entries, exportedAt), null, 2)}\n`;
}

export function buildDreamMarkdownExport(
  entries: DreamEntry[],
  lang: DreamExportLanguage,
  exportedAt = new Date(),
): string {
  const L = labels[lang];
  const lines = [
    `# ${L.archive}`,
    "",
    `- ${L.exportedAt}: ${exportedAt.toISOString()}`,
    `- ${L.dreamCount}: ${entries.length}`,
    "",
  ];

  entries.forEach((entry, index) => {
    const title = inline(entry.title) || `${lang === "zh" ? "梦境" : "Dream"} ${index + 1}`;
    lines.push(
      `## ${entry.capturedAt.slice(0, 10)} — ${title}`,
      "",
      `- ${L.capturedAt}: ${entry.capturedAt}`,
      `- ${L.createdAt}: ${entry.createdAt}`,
      `- ${L.mood}: ${valueOrFallback(entry.mood, L.none)}`,
      `- ${L.stress}: ${valueOrFallback(entry.stressScore, L.none)}`,
      `- ${L.tags}: ${listOrFallback(entry.tags, L.none)}`,
      `- ${L.people}: ${listOrFallback(entry.people, L.none)}`,
      `- ${L.locations}: ${listOrFallback(entry.locations, L.none)}`,
      `- ${L.symbols}: ${listOrFallback(entry.symbols, L.none)}`,
      "",
      `### ${L.dream}`,
      "",
      entry.rawText.trim(),
      "",
    );

    if (entry.cleanText.trim() && entry.cleanText.trim() !== entry.rawText.trim()) {
      lines.push(`### ${L.cleanDream}`, "", entry.cleanText.trim(), "");
    }

    const hasSleepContext = [
      entry.sleepStart,
      entry.wakeTime,
      entry.sleepQuality,
      entry.preSleepMeal,
      entry.preSleepActivity,
    ].some((value) => value != null && String(value).trim() !== "");
    if (hasSleepContext) {
      lines.push(
        `### ${L.sleep}`,
        "",
        `- ${L.sleepStart}: ${valueOrFallback(entry.sleepStart, L.none)}`,
        `- ${L.wakeTime}: ${valueOrFallback(entry.wakeTime, L.none)}`,
        `- ${L.sleepQuality}: ${valueOrFallback(entry.sleepQuality, L.none)}`,
        `- ${L.meal}: ${valueOrFallback(entry.preSleepMeal, L.none)}`,
        `- ${L.activity}: ${valueOrFallback(entry.preSleepActivity, L.none)}`,
        "",
      );
    }

    if (entry.sleepInsight?.trim()) {
      lines.push(`### ${L.insight}`, "", entry.sleepInsight.trim(), "");
    }
    if (entry.imageUrl) {
      lines.push(`### ${L.image}`, "", entry.imageUrl, "");
    }
    if (entry.visualBrief?.trim()) {
      lines.push(`### ${L.visualBrief}`, "", entry.visualBrief.trim(), "");
    }

    if (index < entries.length - 1) lines.push("---", "");
  });

  return `${lines.join("\n").trim()}\n`;
}

export function buildDreamExport(
  entries: DreamEntry[],
  format: DreamExportFormat,
  lang: DreamExportLanguage,
  exportedAt = new Date(),
): string {
  return format === "json"
    ? buildDreamJsonExport(entries, exportedAt)
    : buildDreamMarkdownExport(entries, lang, exportedAt);
}

export function sanitizeDreamExportFilename(value: string): string {
  const cleaned = inline(value)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned.slice(0, 80) || "dream";
}
