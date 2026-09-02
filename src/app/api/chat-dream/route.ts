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
  inferAgentStageFromConversation,
  parseDreamAgentContent,
  resolveDeterministicAgentResponse,
} from "@/lib/dreamFollowUpAgent";
import {
  createDreamAgentResponseMeta,
  logDreamAgentCompletion,
  selectDreamAgentModelVariant,
  selectDreamAgentPolicyVariant,
} from "@/lib/dreamAgentTelemetry";
import {
  scheduleDreamAgentInteraction,
  scheduleDreamAgentRequestOutcome,
  type DreamAgentRequestOutcomeInput,
} from "@/lib/dreamAgentMetrics";
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
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const OPENAI_TIMEOUT_MS = 60_000;

type ModelProvider = {
  name: "openai" | "groq";
  apiKey: string;
  model: string;
  url: string;
};

function configuredModelProviders(): ModelProvider[] {
  return [
    process.env.GROQ_API_KEY && {
      name: "groq" as const,
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? GROQ_MODEL,
      url: "https://api.groq.com/openai/v1/chat/completions",
    },
    process.env.OPENAI_API_KEY && {
      name: "openai" as const,
      apiKey: process.env.OPENAI_API_KEY,
      model: OPENAI_MODEL,
      url: "https://api.openai.com/v1/chat/completions",
    },
  ].filter((provider): provider is ModelProvider => Boolean(provider));
}

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
  const policyVariant = selectDreamAgentPolicyVariant(userId, process.env.DREAM_AGENT_GUARDED_PERCENT);
  const guardedRecall = policyVariant === "guarded-v2";
  const requestId = crypto.randomUUID();
  let requestOutcomeRecorded = false;
  function recordRequestOutcome(
    input: Omit<DreamAgentRequestOutcomeInput, "requestId" | "policyVariant" | "latencyMs">,
  ) {
    if (requestOutcomeRecorded) return;
    requestOutcomeRecorded = true;
    scheduleDreamAgentRequestOutcome(userId, {
      requestId,
      policyVariant,
      latencyMs: Math.max(0, Date.now() - requestStartedAt),
      ...input,
    });
  }
  const contextLines = buildContextLines(lang, preSleepMeal, preSleepActivity);
  const conversationContext = deriveDreamAgentConversationContext(messages, lang, Boolean(contextLines));
  const deterministicResponse = resolveDeterministicAgentResponse(conversationContext, lang, guardedRecall);
  if (deterministicResponse) {
    const meta = createDreamAgentResponseMeta(
      "deterministic-v1",
      "deterministic",
      Date.now() - requestStartedAt,
      userId,
      "deterministic",
      policyVariant,
    );
    logDreamAgentCompletion(deterministicResponse, meta);
    scheduleDreamAgentInteraction(userId, deterministicResponse, meta);
    recordRequestOutcome({
      outcome: "success",
      source: "deterministic",
      provider: "deterministic",
      providerAttempts: 0,
      fallbackUsed: false,
    });
    return NextResponse.json({ ...deterministicResponse, meta });
  }
  const modelProviders = configuredModelProviders();
  if (!modelProviders.length) {
    recordRequestOutcome({
      outcome: "configuration_error",
      source: "none",
      provider: "none",
      providerAttempts: 0,
      fallbackUsed: false,
    });
    return NextResponse.json({ error: API_ERROR_CODES.configurationError }, { status: 500 });
  }
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwardedFor || req.headers.get("x-real-ip")?.trim() || "unknown";
  const rateLimit = await checkAiRateLimit(userId, ipAddress);
  if (!rateLimit.allowed) {
    recordRequestOutcome({
      outcome: "app_rate_limited",
      source: "none",
      provider: "none",
      providerAttempts: 0,
      fallbackUsed: false,
    });
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
    recordRequestOutcome({
      outcome: "quota_exceeded",
      source: "none",
      provider: "none",
      providerAttempts: 0,
      fallbackUsed: false,
    });
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
  const stage = inferAgentStageFromConversation(messages, lang, conversationContext, guardedRecall);
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

  let lastFailureWasTimeout = false;
  let providerAttempts = 0;
  let lastProvider: ModelProvider["name"] | "none" = "none";
  let sawProviderRateLimit = false;
  for (const provider of modelProviders) {
    lastFailureWasTimeout = false;
    providerAttempts += 1;
    lastProvider = provider.name;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
      let upstream: Response;
      try {
        upstream = await fetch(provider.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "system", content: systemPrompt }, ...upstreamMessages],
            max_completion_tokens: provider.name === "groq" ? 1600 : 800,
            reasoning_effort: provider.name === "groq" && provider.model.startsWith("openai/gpt-oss-") ? "low" : undefined,
            response_format: variant === "json-schema-v1" ? dreamAgentStrictResponseFormat : { type: "json_object" },
          }),
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!upstream.ok) {
        if (upstream.status === 429) sawProviderRateLimit = true;
        console.error("POST /api/chat-dream provider failed", {
          provider: provider.name,
          status: upstream.status,
        });
        continue;
      }

      const payload = (await upstream.json()) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) {
        console.error("POST /api/chat-dream provider returned empty content", {
          provider: provider.name,
        });
        continue;
      }
      const result = parseDreamAgentContent(content, lang, stage, conversationContext, guardedRecall);
      const meta = createDreamAgentResponseMeta(
        variant,
        "model",
        Date.now() - requestStartedAt,
        userId,
        provider.name,
        policyVariant,
      );
      const tokenUsage = {
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
      };
      logDreamAgentCompletion(result, meta, tokenUsage);
      scheduleDreamAgentInteraction(userId, result, meta, tokenUsage);
      recordRequestOutcome({
        outcome: "success",
        source: "model",
        provider: provider.name,
        providerAttempts,
        fallbackUsed: providerAttempts > 1,
      });
      return NextResponse.json({ ...result, meta });
    } catch (err) {
      lastFailureWasTimeout = err instanceof Error && err.name === "AbortError";
      console.error("POST /api/chat-dream provider request failed", {
        provider: provider.name,
        ...safeErrorMetadata(err),
      });
    }
  }

  await refundChatUsageOnce();
  recordRequestOutcome({
    outcome: lastFailureWasTimeout
      ? "timeout"
      : sawProviderRateLimit ? "provider_rate_limited" : "upstream_error",
    source: "model",
    provider: lastProvider,
    providerAttempts,
    fallbackUsed: providerAttempts > 1,
  });
  if (lastFailureWasTimeout) {
    return NextResponse.json({ error: API_ERROR_CODES.timeout }, { status: 504 });
  }
  return NextResponse.json({ error: API_ERROR_CODES.upstreamError }, { status: 502 });
}
