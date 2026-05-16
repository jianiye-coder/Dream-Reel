export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import {
  createDreamEntry,
  deleteDreamEntry,
  dreamEntryInputSchema,
  dreamEntryUpdateSchema,
  listDreamEntries,
  updateDreamEntry,
} from "@/lib/dreams";
import { auth } from "@/auth";
import { z } from "zod";
import { checkAndConsumeUsage, refundConsumedUsage } from "@/lib/billing";

const deleteSchema = z.object({ id: z.number().int().positive() });

function parseUserId(id: string | undefined): number | undefined {
  if (!id) return undefined;
  const n = parseInt(id, 10);
  return isNaN(n) ? undefined : n;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const userId = parseUserId((session as { user?: { id?: string } } | null)?.user?.id);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const entries = await listDreamEntries(limit, userId);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("GET /api/dreams failed", error);
    return NextResponse.json({ error: "无法加载归档记录" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = parseUserId((session as { user?: { id?: string } } | null)?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const json = await request.json() as unknown;
    const parsed = dreamEntryInputSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "请求参数不合法", details: parsed.error.flatten() }, { status: 400 });
    }

    const usage = await checkAndConsumeUsage(userId, "dream_entries");
    if (!usage.allowed) {
      return NextResponse.json(
        { error: "本月梦境记录额度已用完，请升级 Plus 或下月继续。", billingStatus: usage.status },
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
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("POST /api/dreams failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存梦境失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth() as { user?: { id?: string } } | null;
    const userId = parseUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const json = await request.json() as unknown;
    const parsed = dreamEntryUpdateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "请求参数不合法", details: parsed.error.flatten() }, { status: 400 });
    }

    const entry = await updateDreamEntry(parsed.data, userId);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error("PUT /api/dreams failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新梦境失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth() as { user?: { id?: string } } | null;
    const userId = parseUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const json = await request.json() as unknown;
    const parsed = deleteSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "请求参数不合法", details: parsed.error.flatten() }, { status: 400 });
    }

    await deleteDreamEntry(parsed.data.id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/dreams failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除梦境失败" }, { status: 500 });
  }
}
