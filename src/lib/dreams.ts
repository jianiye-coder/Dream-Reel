import { z } from "zod";
import { ensureSchema, getPool } from "@/lib/db";
import { decryptDreamText, encryptDreamText } from "@/lib/dreamTextEncryption";

const listField = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}, z.array(z.string().trim().min(1)).default([]));

export const dreamEntryInputSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  inputMode: z.enum(["voice", "text"]),
  rawText: z.string().trim().min(1),
  cleanText: z.string().trim().min(1).optional(),
  mood: z.string().trim().max(80).optional().default(""),
  stressScore: z.number().int().min(1).max(5).optional().nullable(),
  tags: listField,
  people: listField,
  locations: listField,
  symbols: listField,
  capturedAt: z.coerce.date().optional(),
  imageUrl: z.string().trim().url().optional().nullable(),
  assetStatus: z.string().trim().max(30).optional().nullable(),
  // Sleep tracking
  sleepStart: z.string().trim().max(10).optional().nullable(),
  wakeTime: z.string().trim().max(10).optional().nullable(),
  sleepQuality: z.number().int().min(1).max(5).optional().nullable(),
  preSleepMeal: z.string().trim().max(500).optional().nullable(),
  preSleepActivity: z.string().trim().max(500).optional().nullable(),
  sleepInsight: z.string().trim().max(1000).optional().nullable(),
  visualBrief: z.string().trim().max(3000).optional().nullable(),
});

export type DreamEntryInput = z.infer<typeof dreamEntryInputSchema>;

export const dreamEntryUpdateSchema = dreamEntryInputSchema.extend({
  id: z.number().int().positive(),
});

export type DreamEntryUpdateInput = z.infer<typeof dreamEntryUpdateSchema>;

export type DreamEntry = {
  id: number;
  title: string;
  createdAt: string;
  capturedAt: string;
  inputMode: "voice" | "text";
  rawText: string;
  cleanText: string;
  mood: string;
  stressScore: number | null;
  tags: string[];
  people: string[];
  locations: string[];
  symbols: string[];
  imageUrl: string | null;
  assetStatus: string | null;
  // Sleep tracking
  sleepStart: string | null;
  wakeTime: string | null;
  sleepQuality: number | null;
  preSleepMeal: string | null;
  preSleepActivity: string | null;
  sleepInsight: string | null;
  visualBrief: string | null;
};

type CountItem = {
  item: string;
  count: number;
};

type StressByMood = {
  item: string;
  count: number;
  avgStress: number;
};

export type WeeklyRecap = {
  weekStart: string;
  entryCount: number;
  topMoods: CountItem[];
  topPeople: CountItem[];
  topLocations: CountItem[];
  topSymbols: CountItem[];
  stressByMood: StressByMood[];
};

function mapDreamRow(row: Record<string, unknown>): DreamEntry {
  const rawText = String(row.raw_text);
  const cleanText = String(row.clean_text);

  return {
    id: Number(row.id),
    title: String(row.title ?? ""),
    createdAt: String(row.created_at),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
    inputMode: row.input_mode as "voice" | "text",
    rawText: decryptDreamText(rawText),
    cleanText: decryptDreamText(cleanText),
    mood: String(row.mood ?? ""),
    stressScore: row.stress_score == null ? null : Number(row.stress_score),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    people: Array.isArray(row.people) ? (row.people as string[]) : [],
    locations: Array.isArray(row.locations) ? (row.locations as string[]) : [],
    symbols: Array.isArray(row.symbols) ? (row.symbols as string[]) : [],
    imageUrl: row.image_url == null ? null : String(row.image_url),
    assetStatus: row.asset_status == null ? null : String(row.asset_status),
    sleepStart: row.sleep_start == null ? null : String(row.sleep_start),
    wakeTime: row.wake_time == null ? null : String(row.wake_time),
    sleepQuality: row.sleep_quality == null ? null : Number(row.sleep_quality),
    preSleepMeal: row.pre_sleep_meal == null ? null : String(row.pre_sleep_meal),
    preSleepActivity: row.pre_sleep_activity == null ? null : String(row.pre_sleep_activity),
    sleepInsight: row.sleep_insight == null ? null : String(row.sleep_insight),
    visualBrief: row.visual_brief == null ? null : String(row.visual_brief),
  };
}

export async function createDreamEntry(input: DreamEntryInput, userId?: number): Promise<DreamEntry> {
  await ensureSchema();
  const pool = getPool();
  const cleanText = input.cleanText ?? input.rawText;
  const encryptedRawText = encryptDreamText(input.rawText);
  const encryptedCleanText = encryptDreamText(cleanText);
  const capturedAt = input.capturedAt ?? new Date();

  const result = await pool.query(
    `
      INSERT INTO dream_entries (
        captured_at,
        input_mode,
        raw_text,
        clean_text,
        mood,
        stress_score,
        tags,
        people,
        locations,
        symbols,
        image_url,
        asset_status,
        sleep_start,
        wake_time,
        sleep_quality,
        pre_sleep_meal,
        pre_sleep_activity,
        sleep_insight,
        title,
        user_id,
        visual_brief
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
      RETURNING *;
    `,
    [
      capturedAt,
      input.inputMode,
      encryptedRawText,
      encryptedCleanText,
      input.mood ?? "",
      input.stressScore ?? null,
      JSON.stringify(input.tags ?? []),
      input.people ?? [],
      input.locations ?? [],
      input.symbols ?? [],
      input.imageUrl ?? null,
      input.assetStatus ?? null,
      input.sleepStart ?? null,
      input.wakeTime ?? null,
      input.sleepQuality ?? null,
      input.preSleepMeal ?? null,
      input.preSleepActivity ?? null,
      input.sleepInsight ?? null,
      input.title ?? "",
      userId ?? null,
      input.visualBrief ?? null,
    ],
  );

  return mapDreamRow(result.rows[0] as Record<string, unknown>);
}

export async function updateDreamEntry(input: DreamEntryUpdateInput, userId?: number): Promise<DreamEntry> {
  await ensureSchema();
  const pool = getPool();
  const cleanText = input.cleanText ?? input.rawText;
  const encryptedRawText = encryptDreamText(input.rawText);
  const encryptedCleanText = encryptDreamText(cleanText);
  const capturedAt = input.capturedAt ?? new Date();

  const result = await pool.query(
    `
      UPDATE dream_entries
      SET
        captured_at = $2,
        input_mode = $3,
        raw_text = $4,
        clean_text = $5,
        mood = $6,
        stress_score = $7,
        tags = $8::jsonb,
        people = $9,
        locations = $10,
        symbols = $11,
        image_url = $12,
        asset_status = $13,
        sleep_start = $14,
        wake_time = $15,
        sleep_quality = $16,
        pre_sleep_meal = $17,
        pre_sleep_activity = $18,
        sleep_insight = $19,
        title = $20,
        visual_brief = $21
      WHERE id = $1
        AND ($22::integer IS NULL OR user_id = $22)
      RETURNING *;
    `,
    [
      input.id,
      capturedAt,
      input.inputMode,
      encryptedRawText,
      encryptedCleanText,
      input.mood ?? "",
      input.stressScore ?? null,
      JSON.stringify(input.tags ?? []),
      input.people ?? [],
      input.locations ?? [],
      input.symbols ?? [],
      input.imageUrl ?? null,
      input.assetStatus ?? null,
      input.sleepStart ?? null,
      input.wakeTime ?? null,
      input.sleepQuality ?? null,
      input.preSleepMeal ?? null,
      input.preSleepActivity ?? null,
      input.sleepInsight ?? null,
      input.title ?? "",
      input.visualBrief ?? null,
      userId ?? null,
    ],
  );

  if (result.rows.length === 0) {
    throw new Error("未找到要更新的梦境记录。");
  }

  return mapDreamRow(result.rows[0] as Record<string, unknown>);
}

export async function deleteDreamEntry(id: number, userId?: number): Promise<void> {
  await ensureSchema();
  const pool = getPool();

  const result = await pool.query(
    `
      DELETE FROM dream_entries
      WHERE id = $1
        AND ($2::integer IS NULL OR user_id = $2);
    `,
    [id, userId ?? null],
  );

  if (result.rowCount === 0) {
    throw new Error("未找到要删除的梦境记录。");
  }
}

export async function countTodayDreamEntries(userId: number): Promise<number> {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM dream_entries
     WHERE user_id = $1
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
       AND created_at <  date_trunc('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'`,
    [userId],
  );
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

export async function listDreamEntries(limit = 50, userId?: number): Promise<DreamEntry[]> {
  await ensureSchema();
  const pool = getPool();
  const safeLimit = Math.min(Math.max(limit, 1), 10000);

  const result = userId != null
    ? await pool.query(
        `SELECT * FROM dream_entries WHERE user_id = $1 ORDER BY captured_at DESC LIMIT $2;`,
        [userId, safeLimit],
      )
    : await pool.query(
        `SELECT * FROM dream_entries ORDER BY captured_at DESC LIMIT $1;`,
        [safeLimit],
      );

  return result.rows.map((row) => mapDreamRow(row as Record<string, unknown>));
}

async function getTopTextField(
  field: "mood" | "people" | "locations" | "symbols",
  weekStart: Date,
  userId?: number,
): Promise<CountItem[]> {
  const pool = getPool();
  const userFilter = userId != null ? `AND user_id = ${userId}` : "";

  if (field === "mood") {
    const result = await pool.query(
      `
        SELECT mood AS item, COUNT(*)::int AS count
        FROM dream_entries
        WHERE captured_at >= $1 AND mood <> '' ${userFilter}
        GROUP BY mood
        ORDER BY count DESC, item ASC
        LIMIT 5;
      `,
      [weekStart],
    );
    return result.rows.map((row) => ({ item: String(row.item), count: Number(row.count) }));
  }

  const result = await pool.query(
    `
      SELECT item, COUNT(*)::int AS count
      FROM dream_entries, unnest(${field}) AS item
      WHERE captured_at >= $1 AND item <> '' ${userFilter}
      GROUP BY item
      ORDER BY count DESC, item ASC
      LIMIT 5;
    `,
    [weekStart],
  );
  return result.rows.map((row) => ({ item: String(row.item), count: Number(row.count) }));
}

export async function getWeeklyRecap(userId?: number): Promise<WeeklyRecap> {
  await ensureSchema();
  const pool = getPool();
  const weekStartResult = await pool.query("SELECT date_trunc('week', NOW()) AS week_start;");
  const weekStart = new Date(String(weekStartResult.rows[0].week_start));
  const userFilter = userId != null ? `AND user_id = ${userId}` : "";

  const [countResult, topMoods, topPeople, topLocations, topSymbols, stressByMoodResult] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS entry_count FROM dream_entries WHERE captured_at >= $1 ${userFilter};`,
        [weekStart],
      ),
      getTopTextField("mood", weekStart, userId),
      getTopTextField("people", weekStart, userId),
      getTopTextField("locations", weekStart, userId),
      getTopTextField("symbols", weekStart, userId),
      pool.query(
        `
          SELECT
            mood AS item,
            COUNT(*)::int AS count,
            ROUND(AVG(stress_score)::numeric, 2)::float8 AS avg_stress
          FROM dream_entries
          WHERE captured_at >= $1 AND mood <> '' AND stress_score IS NOT NULL ${userFilter}
          GROUP BY mood
          ORDER BY count DESC, item ASC
          LIMIT 5;
        `,
        [weekStart],
      ),
    ]);

  return {
    weekStart: weekStart.toISOString(),
    entryCount: Number(countResult.rows[0].entry_count ?? 0),
    topMoods,
    topPeople,
    topLocations,
    topSymbols,
    stressByMood: stressByMoodResult.rows.map((row) => ({
      item: String(row.item),
      count: Number(row.count),
      avgStress: Number(row.avg_stress),
    })),
  };
}
