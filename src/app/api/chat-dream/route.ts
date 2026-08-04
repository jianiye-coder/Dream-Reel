import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  checkAiRateLimit,
  checkAndConsumeUsage,
  refundConsumedUsage,
} from "@/lib/billing";
import {
  buildDreamFollowUpAgentPrompt,
  inferAgentStage,
  parseDreamAgentContent,
} from "@/lib/dreamFollowUpAgent";

export const runtime = "nodejs";

const msgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(5000),
});

const bodySchema = z.object({
  messages: z.array(msgSchema).min(1).max(30),
  lang: z.enum(["zh", "en"]).default("zh"),
  preSleepMeal: z.string().trim().max(200).optional(),
  preSleepActivity: z.string().trim().max(200).optional(),
});

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";
const OPENAI_TIMEOUT_MS = 60_000;

function buildContextLines(
  lang: "zh" | "en",
  preSleepMeal?: string,
  preSleepActivity?: string,
) {
  const meal = preSleepMeal?.trim();
  const activity = preSleepActivity?.trim();
  return [
    meal && (lang === "en" ? `ate: ${meal}` : `睡前吃了：${meal}`),
    activity && (lang === "en" ? `did before sleep: ${activity}` : `睡前活动：${activity}`),
  ]
    .filter(Boolean)
    .join(lang === "en" ? ", " : "\n");
}

export async function POST(req: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  const userId = Number(session?.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let consumedUsagePeriodId: number | undefined;

  async function refundChatUsageOnce() {
    if (!consumedUsagePeriodId) return;
    const usagePeriodId = consumedUsagePeriodId;
    consumedUsagePeriodId = undefined;
    try {
      await refundConsumedUsage(usagePeriodId, "analysis");
    } catch (refundError) {
      console.error("POST /api/chat-dream usage refund failed", refundError);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid params", details: parsed.error.flatten() }, { status: 400 });
  }

  const { messages, lang, preSleepMeal, preSleepActivity } = parsed.data;
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwardedFor || req.headers.get("x-real-ip")?.trim() || "unknown";
  const rateLimit = await checkAiRateLimit(userId, ipAddress);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const usage = await checkAndConsumeUsage(userId, "analysis");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: lang === "en"
          ? "Your monthly AI analysis limit is used up."
          : "本月 AI 分析额度已用完。",
        billingStatus: usage.status,
      },
      { status: 402 },
    );
  }
  consumedUsagePeriodId = usage.usagePeriodId;

  const userTurns = messages.filter((m) => m.role === "user").length;
  const stage = inferAgentStage(userTurns);
  const contextLines = buildContextLines(lang, preSleepMeal, preSleepActivity);
  const systemPrompt = buildDreamFollowUpAgentPrompt(lang, userTurns, stage, contextLines);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          max_completion_tokens: 800,
          response_format: { type: "json_object" },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      await refundChatUsageOnce();
      return NextResponse.json({ error: text || "AI service unavailable" }, { status: 502 });
    }

    const payload = (await upstream.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      await refundChatUsageOnce();
      return NextResponse.json({ error: "AI response was empty" }, { status: 422 });
    }
    return NextResponse.json(parseDreamAgentContent(content, lang, stage));
  } catch (err) {
    console.error("POST /api/chat-dream failed", err);
    await refundChatUsageOnce();
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 504 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Conversation failed" },
      { status: 500 },
    );
  }
}
