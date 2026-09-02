export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import {
  createDreamEntry,
  deleteDreamEntry,
  dreamEntryInputSchema,
  dreamEntryUpdateSchema,
  listDreamEntriesPage,
  updateDreamEntry,
} from "@/lib/dreams";
import { auth } from "@/auth";
import { z } from "zod";
import { checkAndConsumeUsage, refundConsumedUsage } from "@/lib/billing";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { scheduleDreamAgentJournalSaved } from "@/lib/dreamAgentMetrics";

const deleteSchema = z.object({ id: z.number().int().positive() });

function parseUserId(id: string | undefined): number | undefined {
  if (!id) return undefined;
  const n = parseInt(id, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const session = await auth();
    const userId = parseUserId((session as { user?: { id?: string } } | null)?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const cursor = request.nextUrl.searchParams.get("cursor");
    const page = await listDreamEntriesPage(userId, { limit, cursor });
    const body = JSON.stringify(page);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Server-Timing": `archive;dur=${(performance.now() - startedAt).toFixed(1)}`,
        "X-Archive-Response-Bytes": String(Buffer.byteLength(body)),
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("GET /api/dreams failed", error);
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = parseUserId((session as { user?: { id?: string } } | null)?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: API_ERROR_CODES.unauthorized }, { status: 401 });
    }

    const json = await request.json() as unknown;
    const parsed = dreamEntryInputSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: API_ERROR_CODES.invalidRequest, details: parsed.error.flatten() }, { status: 400 });
    }

    const usage = await checkAndConsumeUsage(userId, "dream_entries");
    if (!usage.allowed) {
      return NextResponse.json(
        { error: API_ERROR_CODES.quotaExceeded, billingStatus: usage.status },
        { status: 402 },
      );
    }

    let entry;
    try {
      entry = await createDreamEntry(parsed.data, userId);
    } catch (error) {
      if (usage.usagePeriodId) await refundConsumedUsage(usage.usagePeriodId, "dream_entries");
      throw error;
    }
    if (parsed.data.agentInteractionId) {
      scheduleDreamAgentJournalSaved(userId, parsed.data.agentInteractionId, entry.id);
    }
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("POST /api/dreams failed", error);
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth() as { user?: { id?: string } } | null;
    const userId = parseUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: API_ERROR_CODES.unauthorized }, { status: 401 });
    }
    const json = await request.json() as unknown;
    const parsed = dreamEntryUpdateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: API_ERROR_CODES.invalidRequest, details: parsed.error.flatten() }, { status: 400 });
    }

    const entry = await updateDreamEntry(parsed.data, userId);
    if (parsed.data.agentInteractionId) {
      scheduleDreamAgentJournalSaved(userId, parsed.data.agentInteractionId, entry.id);
    }
    return NextResponse.json({ entry });
  } catch (error) {
    console.error("PUT /api/dreams failed", error);
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth() as { user?: { id?: string } } | null;
    const userId = parseUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: API_ERROR_CODES.unauthorized }, { status: 401 });
    }
    const json = await request.json() as unknown;
    const parsed = deleteSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: API_ERROR_CODES.invalidRequest, details: parsed.error.flatten() }, { status: 400 });
    }

    await deleteDreamEntry(parsed.data.id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/dreams failed", error);
    return NextResponse.json({ error: API_ERROR_CODES.internalError }, { status: 500 });
  }
}
