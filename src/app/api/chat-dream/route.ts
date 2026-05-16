import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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
const REALITY_QUESTION_ZH = "这跟你最近现实生活所发生的事情，有没有什么关系？";
const REALITY_QUESTION_EN = "Does this connect to anything that has happened in your real life recently?";

function ensureRealityQuestion(questions: string[], lang: "zh" | "en") {
  const requiredQuestion = lang === "en" ? REALITY_QUESTION_EN : REALITY_QUESTION_ZH;
  const alreadyIncluded = questions.some((question) =>
    lang === "en"
      ? question.toLowerCase().includes("real life") || question.toLowerCase().includes("recently")
      : question.includes("现实生活") || question.includes("最近"),
  );

  if (alreadyIncluded) return questions.slice(0, 3);
  return [...questions.slice(0, 2), requiredQuestion];
}

function buildSystemPrompt(
  lang: "zh" | "en",
  userTurns: number,
  stage: "exploring" | "deepening" | "ready",
  contextLines: string,
) {
  if (lang === "en") {
    const readyNote =
      stage === "ready"
        ? "\nYou've been present for a while. At the end of your response, gently ask if they'd like to explore this dream more deeply."
        : "";
    return `You are a quiet dream companion in the late-night hours.

Your style:
- Calm, gentle, curious, unhurried
- Like a private late-night conversation — not therapy, not an AI tool
- Short sentences with breathing room; don't say too much at once
- Don't interpret or analyze the dream's "meaning" unless asked
- Help the user slowly re-enter the dream and expand details and emotions
- Empathize occasionally, but keep it genuine${contextLines ? `\n\nPre-sleep context: ${contextLines}` : ""}

This is turn ${userTurns} of the conversation.${readyNote}

Return ONLY valid JSON, nothing outside it:
{"message":"your response (3-5 sentences, calm and gentle — reflect on what the user shared, notice something specific, help them re-enter the feeling or scene)","questions":["follow-up 1","follow-up 2"]}

questions contains 1-3 follow-ups to help recall:
- Sensory details (colors, light, smells, sounds, textures)
- Emotional layers and shifts
- Details or relationships of dream characters
- Forgotten scenes or endings
- One follow-up MUST ask whether this dream connects to anything that has happened in the user's real life recently.

Each follow-up: max 20 words, gentle and conversational.`;
  }

  const readyNote =
    stage === "ready"
      ? "\n你已陪伴一段时间，可以在回应末尾轻轻问用户是否想深入整理这个梦了。"
      : "";
  return `你是一个深夜里温柔的梦境倾听者。

你的风格：
- 安静、温柔、好奇、有呼吸感
- 像深夜里的私人对话，不是心理咨询或 AI 分析工具
- 用极简的语言，留出余白，不要一次说太多
- 不要主动解读或分析梦境的"含义"
- 帮助用户慢慢重新进入梦境，展开细节与情绪
- 偶尔可以共情，但不要假惺惺${contextLines ? `\n\n用户的睡前情境：\n${contextLines}` : ""}

当前已经对话了 ${userTurns} 轮。${readyNote}

你必须只返回合法 JSON，不要任何 JSON 之外的文字：
{"message":"你的回应（3 到 5 句，安静温柔——回应用户分享的内容，注意到某个具体细节，帮助他们重新进入那个感受或场景）","questions":["追问 1","追问 2"]}

questions 包含 1 到 3 个追问，帮助用户回忆：
- 感官细节（颜色、光线、气味、声音、触感）
- 情绪的层次和转变
- 梦中人物的细节或关系
- 被遗忘的场景或结局
- 必须包含这一条追问：「这跟你最近现实生活所发生的事情，有没有什么关系？」

每个追问不超过 20 字，温柔口语化。`;
}

export async function POST(req: NextRequest) {
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
  const userTurns = messages.filter((m) => m.role === "user").length;
  const stage: "exploring" | "deepening" | "ready" =
    userTurns <= 2 ? "exploring" : userTurns <= 5 ? "deepening" : "ready";

  const contextLines = [
    preSleepMeal?.trim() &&
      (lang === "en" ? `ate: ${preSleepMeal.trim()}` : `睡前吃了：${preSleepMeal.trim()}`),
    preSleepActivity?.trim() &&
      (lang === "en"
        ? `did before sleep: ${preSleepActivity.trim()}`
        : `睡前活动：${preSleepActivity.trim()}`),
  ]
    .filter(Boolean)
    .join(lang === "en" ? ", " : "\n");

  const systemPrompt = buildSystemPrompt(lang, userTurns, stage, contextLines);

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
      return NextResponse.json({ error: text || "AI service unavailable" }, { status: 502 });
    }

    const payload = (await upstream.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      return NextResponse.json({ message: content.trim() || "……", questions: [], stage });
    }

    let result: { message?: unknown; questions?: unknown[] };
    try {
      result = JSON.parse(match[0]) as typeof result;
    } catch {
      return NextResponse.json({ message: content.trim() || "……", questions: [], stage });
    }

    const questions = Array.isArray(result.questions)
      ? result.questions.filter((q): q is string => typeof q === "string")
      : [];

    return NextResponse.json({
      message: typeof result.message === "string" ? result.message : "……",
      questions: ensureRealityQuestion(questions, lang),
      stage,
    });
  } catch (err) {
    console.error("POST /api/chat-dream failed", err);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 504 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Conversation failed" },
      { status: 500 },
    );
  }
}
