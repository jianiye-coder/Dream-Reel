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
  deriveDreamAgentConversationContext,
  dreamAgentStrictResponseFormat,
  inferAgentStage,
  parseDreamAgentContent,
  resolveDeterministicAgentResponse,
} from "@/lib/dreamFollowUpAgent";
import { createDreamAgentResponseMeta, logDreamAgentCompletion, selectDreamAgentModelVariant } from "@/lib/dreamAgentTelemetry";
import { API_ERROR_CODES } from "@/lib/apiErrors";
import { safeErrorMetadata } from "@/lib/safeServerLog";

export const runtime = "nodejs";

const msgSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(5000),
  questions: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
  memory: z.object({
    missingDetails: z.array(z.string().trim().min(1).max(100)).max(5),
    observedSignals: z.array(z.string().trim().min(1).max(100)).max(8),
  }).optional(),
});

const bodySchema = z.object({
  messages: z.array(msgSchema).min(1).max(30),
  lang: z.enum(["zh", "en"]).default("zh"),
  preSleepMeal: z.string().trim().max(200).optional(),
  preSleepActivity: z.string().trim().max(200).optional(),
});

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
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
  const requestStartedAt = Date.now();
  const session = await auth() as { user?: { id?: string } } | null;
  const userId = Number(session?.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: API_ERROR_CODES.unauthorized }, { status: 401 });
  }

  let consumedUsagePeriodId: number | undefined;

  async function refundChatUsageOnce() {
    if (!consumedUsagePeriodId) return;
    const usagePeriodId = consumedUsagePeriodId;
    consumedUsagePeriodId = undefined;
    try {
      await refundConsumedUsage(usagePeriodId, "analysis");
    } catch (refundError) {
      console.error(
        "POST /api/chat-dream usage refund failed",
        safeErrorMetadata(refundError),
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: API_ERROR_CODES.invalidRequest }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: API_ERROR_CODES.invalidRequest, details: parsed.error.flatten() }, { status: 400 });
  }

  const { messages, lang, preSleepMeal, preSleepActivity } = parsed.data;
  const contextLines = buildContextLines(lang, preSleepMeal, preSleepActivity);
  const conversationContext = deriveDreamAgentConversationContext(messages, lang, Boolean(contextLines));
  const deterministicResponse = resolveDeterministicAgentResponse(conversationContext, lang);
  if (deterministicResponse) {
    const meta = createDreamAgentResponseMeta("deterministic-v1", "deterministic", Date.now() - requestStartedAt, userId);
    logDreamAgentCompletion(deterministicResponse, meta);
    return NextResponse.json({ ...deterministicResponse, meta });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: API_ERROR_CODES.configurationError }, { status: 500 });
  }
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwardedFor || req.headers.get("x-real-ip")?.trim() || "unknown";
  const rateLimit = await checkAiRateLimit(userId, ipAddress);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: API_ERROR_CODES.rateLimited },
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
        error: API_ERROR_CODES.quotaExceeded,
        billingStatus: usage.status,
      },
      { status: 402 },
    );
  }
  consumedUsagePeriodId = usage.usagePeriodId;

  const userTurns = messages.filter((m) => m.role === "user").length;
  const stage = inferAgentStage(userTurns);
  const variant = selectDreamAgentModelVariant(userId, process.env.DREAM_AGENT_JSON_SCHEMA_PERCENT);
  const systemPrompt = buildDreamFollowUpAgentPrompt(lang, userTurns, stage, contextLines, conversationContext);
  const upstreamMessages = messages.map((message) => {
    if (message.role === "user") return { role: message.role, content: message.content };
    const workingMemory = message.memory
      ? `\nWorking memory: ${JSON.stringify(message.memory)}`
      : "";
    const shownQuestions = message.questions?.length
      ? `\nQuestions shown to the user: ${message.questions.join(" | ")}`
      : "";
    return { role: message.role, content: `${message.content}${shownQuestions}${workingMemory}` };
  });

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
          messages: [{ role: "system", content: systemPrompt }, ...upstreamMessages],
          max_completion_tokens: 800,
          response_format: variant === "json-schema-v1" ? dreamAgentStrictResponseFormat : { type: "json_object" },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      console.error("POST /api/chat-dream upstream failed", {
        status: upstream.status,
      });
      await refundChatUsageOnce();
      return NextResponse.json({ error: API_ERROR_CODES.upstreamError }, { status: 502 });
    }

    const payload = (await upstream.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      await refundChatUsageOnce();
      return NextResponse.json({ error: API_ERROR_CODES.invalidResponse }, { status: 422 });
    }
    const result = parseDreamAgentContent(content, lang, stage, conversationContext);
    const meta = createDreamAgentResponseMeta(variant, "model", Date.now() - requestStartedAt, userId);
    logDreamAgentCompletion(result, meta, {
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
    });
    return NextResponse.json({ ...result, meta });
  } catch (err) {
    console.error("POST /api/chat-dream failed", safeErrorMetadata(err));
    await refundChatUsageOnce();
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: API_ERROR_CODES.timeout }, { status: 504 });
    }
    return NextResponse.json(
      { error: API_ERROR_CODES.internalError },
      { status: 500 },
    );
  }
}
