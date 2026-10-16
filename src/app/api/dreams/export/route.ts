import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { buildDreamExport } from "@/lib/dreamExport";
import { listDreamEntries } from "@/lib/dreams";
import { safeErrorMetadata } from "@/lib/safeServerLog";

export const runtime = "nodejs";

const querySchema = z.object({
  format: z.enum(["markdown", "json"]).default("markdown"),
  lang: z.enum(["zh", "en"]).default("zh"),
});

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const parsed = querySchema.safeParse({
    format: request.nextUrl.searchParams.get("format") ?? undefined,
    lang: request.nextUrl.searchParams.get("lang") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: API_ERROR_CODES.invalidRequest }, { status: 400 });
  }

  try {
    const entries = await listDreamEntries(userId, 10_000);
    const exportedAt = new Date();
    const body = buildDreamExport(entries, parsed.data.format, parsed.data.lang, exportedAt);
    const extension = parsed.data.format === "json" ? "json" : "md";
    const contentType = parsed.data.format === "json"
      ? "application/json; charset=utf-8"
      : "text/markdown; charset=utf-8";
    const filename = `dream-reel-export-${exportedAt.toISOString().slice(0, 10)}.${extension}`;

    return new NextResponse(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": contentType,
        "X-Dream-Count": String(entries.length),
      },
    });
  } catch (error) {
    console.error("GET /api/dreams/export failed", safeErrorMetadata(error));
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}
