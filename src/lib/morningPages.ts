import { z } from "zod";
import { ensureSchema, getPool } from "@/lib/db";
import { decryptDreamText, encryptDreamText } from "@/lib/dreamTextEncryption";
import { drawingSchema, type DrawingStroke } from "@/lib/morningDrawing";

export const morningPageDateSchema = z.iso.date().refine(
  (date) => !date.startsWith("0000-"),
  "Date must have a positive year",
);

const revisionSchema = z.number().int().min(0).max(2_147_483_647);

export const morningPagePutSchema = z.object({
  date: morningPageDateSchema,
  content: z.string().max(50_000),
  drawing: drawingSchema.optional(),
  revision: revisionSchema,
});

export const morningPageDeleteSchema = z.object({
  date: morningPageDateSchema,
  revision: revisionSchema,
});

export type MorningPage = {
  date: string;
  content: string;
  drawing: DrawingStroke[];
  revision: number;
  updatedAt: string;
};

export type MorningPageMetadata = Pick<MorningPage, "date" | "updatedAt">;

type MorningPageRow = {
  date: string;
  content: string;
  revision: number;
  updated_at: Date;
};

export class MorningPageConflictError extends Error {
  constructor() {
    super("Morning page revision conflict");
    this.name = "MorningPageConflictError";
  }
}

function mapMorningPage(row: MorningPageRow): MorningPage {
  const stored: unknown = JSON.parse(decryptDreamText(row.content));
  const page = typeof stored === "string" ? { content: stored, drawing: [] } : z.object({ content: z.string(), drawing: drawingSchema }).parse(stored);
  return {
    date: row.date,
    ...page,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getMorningPage(userId: number, date: string): Promise<MorningPage | null> {
  await ensureSchema();
  const { rows } = await getPool().query<MorningPageRow>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, content, revision, updated_at
     FROM morning_pages WHERE user_id = $1 AND date = $2::date`,
    [userId, date],
  );
  return rows[0] ? mapMorningPage(rows[0]) : null;
}

export async function listMorningPages(userId: number): Promise<MorningPageMetadata[]> {
  await ensureSchema();
  const { rows } = await getPool().query<Pick<MorningPageRow, "date" | "updated_at">>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, updated_at
     FROM morning_pages WHERE user_id = $1
     ORDER BY morning_pages.date DESC LIMIT 90`,
    [userId],
  );
  return rows.map((row) => ({ date: row.date, updatedAt: row.updated_at.toISOString() }));
}

export async function putMorningPage(
  userId: number,
  input: z.infer<typeof morningPagePutSchema>,
): Promise<MorningPage> {
  await ensureSchema();
  // Encrypt both text and editable strokes; never put private drawings in public Blob storage.
  const content = encryptDreamText(JSON.stringify({ content: input.content, drawing: input.drawing ?? [] }));
  const pool = getPool();
  const { rows } = input.revision === 0
    ? await pool.query<MorningPageRow>(
      `INSERT INTO morning_pages (user_id, date, content)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (user_id, date) DO NOTHING
       RETURNING to_char(date, 'YYYY-MM-DD') AS date, content, revision, updated_at`,
      [userId, input.date, content],
    )
    : await pool.query<MorningPageRow>(
      `UPDATE morning_pages
       SET content = $3, revision = revision + 1, updated_at = NOW()
       WHERE user_id = $1 AND date = $2::date AND revision = $4
         AND revision < 2147483647
       RETURNING to_char(date, 'YYYY-MM-DD') AS date, content, revision, updated_at`,
      [userId, input.date, content, input.revision],
    );
  if (!rows[0]) throw new MorningPageConflictError();
  return mapMorningPage(rows[0]);
}

export async function deleteMorningPage(
  userId: number,
  input: z.infer<typeof morningPageDeleteSchema>,
): Promise<void> {
  await ensureSchema();
  const result = await getPool().query(
    `DELETE FROM morning_pages
     WHERE user_id = $1 AND date = $2::date AND revision = $3
     RETURNING date`,
    [userId, input.date, input.revision],
  );
  if (!result.rows.length) throw new MorningPageConflictError();
}
