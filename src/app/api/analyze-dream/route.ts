import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkAndConsumeUsage } from "@/lib/billing";
import { ZH_DREAM_EMOTION_CALIBRATION } from "@/lib/dreamEmotionCalibration";
import { getRealityQuestion, mentionsRealityContext } from "@/lib/dreamQuestions";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  lang: z.enum(["zh", "en"]).default("zh"),
  preSleepMeal: z.string().trim().max(500).optional(),
  preSleepActivity: z.string().trim().max(500).optional(),
});

const textValue = z.preprocess((value) => {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}, z.string());

const shortList = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[，,、;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(textValue).default([]));

const stressScoreValue = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(5, Math.max(1, Math.round(numeric)));
}, z.number().int().min(1).max(5).nullable().default(null));

const analysisSchema = z.object({
  title: textValue.default(""),
  mood: textValue.default(""),
  stressScore: stressScoreValue,
  people: shortList,
  locations: shortList,
  symbols: shortList,
  sleepInsight: textValue.default(""),
  followUpQuestions: shortList,
  visualBrief: textValue.default(""),
});

const ZH_SYSTEM_PROMPT = `你是一个梦境分析助手。用户会提供一段梦境描述，以及可选的睡前情境（昨晚吃的食物、睡前活动）。请从中提取以下信息并以 JSON 返回：

- mood（情绪）：用 2–4 个字概括梦境的主导情绪。必须参考下方“梦境情绪标注校准”，并从允许的主情绪标签中选最贴切的一个。若梦境情绪复杂，仍然只输出一个主导情绪；禁止输出“混合”。若实在无法判断则返回空字符串
${ZH_DREAM_EMOTION_CALIBRATION}
- title（标题）：为这场梦取一个短标题，4–10 个中文字符，像私人梦境档案标题，不要加书名号、引号或标点。标题要来自梦里的核心场景、人物或意象，例如"月光楼梯间""不存在的相册""海边教室"
- stressScore（压力评分）：1（平静舒适）到 5（极度紧张）的整数，若无法判断则返回 null
- people（人物）：梦境中出现的具体人物，每项不超过 6 字，最多 5 个，若无则返回空数组。归一化规则：
  · 同一个人只保留一个条目，使用梦中最常用的称呼（例如"陈阿姨"和"小陈阿姨"是同一人，只保留"陈阿姨"）
  · 若文中出现前后指向同一人的不同称谓，合并为一个
  · 无名字的人物用最简短的描述（"陌生男人"）
- locations（地点）：梦境中出现的具体地点或场景，每项不超过 6 字，最多 5 个，若无则返回空数组。归一化规则：
  · 去掉方位后缀（飞机上 → 飞机，教室里 → 教室，家门口 → 家）
  · 同一区域的不同部分合并为一个上级地点（登机口、机舱、飞机上 → 飞机；卧室、走廊、客厅 → 家里）
  · 优先使用最简洁的核心地点名，不要带"的""里""上"等助词
- symbols（符号/意象）：梦境中反复出现或有象征意义的物体/元素，每项不超过 6 字，最多 5 个，若无则返回空数组。归一化规则：
  · 只提取核心名词，去掉形容词修饰（大蛋糕 → 蛋糕，红色的花 → 花，破旧的电话 → 电话）
  · 不同形式的同一意象合并（手机/电话/手机屏幕 → 手机）
  · 优先选具有象征感或情绪感的意象
- sleepInsight（睡眠洞察）：2–3 句话，结合梦境内容与睡前情境（如有），分析可能影响梦境的原因，例如饮食、活动、情绪状态。若无睡前信息，则单纯从梦境情绪角度给出简短解读。使用中文。
- followUpQuestions（引导追问）：根据梦境中模糊或未展开的部分，提出 2–3 个简短问题，帮助用户回忆更多细节。问题方向可以是场景细节（颜色、氛围）、人物关系（那个人让你想到谁？）、情绪转折（最强烈的感受是什么时候？）、模糊结局（最后发生了什么？）、感官细节（有什么声音或气味？）。必须包含这一条：「这跟你最近现实生活所发生的事情，有没有什么关系？」每题不超过 25 字，用中文，口语化。若梦境已非常详细，可少问或从情绪深度追问。返回字符串数组。
- visualBrief（图像生成提示词）：根据这场梦的内容，用中文生成一段完整的 AI 图像生成提示词，专属于这场梦。包含以下所有部分（每部分用标签开头，换行分隔）：

  整体情绪：描述这场梦的情绪基调与氛围感，2-3句
  画面人物：梦中出现的具体人物（使用原名），以及他们的状态/神态/关系
  画面地点：梦境发生的空间/地点，如有转换场景，描述两者如何在梦中漂移融合
  关键意象：最核心的物体、道具与意象（直接来自梦境描述）
  视觉方向：整体画面风格定位（如轻微超现实、真实感梦境、空间漂浮感、时间停滞感）
  色彩方向：具体配色（使用色彩名称，如雾粉、月光白、暖金、湖蓝），避免"色彩丰富"或"鲜艳"等通用词
  光线方向：光线质感与来源（如自然发光、体积雾、晨间散射光、胶片颗粒、柔焦高光）
  镜头与构图：景别、构图方式、景深感（如中近景、浅景深、电影宽画面）
  风格参考：具体的艺术风格/导演/流派（如王家卫式情绪氛围、dreamcore、柔和超现实主义、电影记忆美学）
  严格禁止：文字、中文字符、英文、logo、水印、边框、海报排版；以及与梦境情绪不符的风格（列出具体禁止项）
  输出目标：1句话，说明这张图像最终要传递的核心情感或画面体验

  语气：直接写给 AI 图像生成模型，具体、无废话。总长度 300-500 字。

只返回 JSON，不要任何额外文字。格式：
{"title":"...","mood":"...","stressScore":3,"people":["..."],"locations":["..."],"symbols":["..."],"sleepInsight":"...","followUpQuestions":["...","..."],"visualBrief":"..."}`;

const EN_SYSTEM_PROMPT = `You are a dream analysis assistant. The user will provide a dream description and optional pre-sleep context. Extract the following and return as JSON:

- mood: 1-3 word English mood summary. Choose the closest from these categories (or a natural variant):
  · anxiety category: anxious, tense, scared, terrified, panicked, uneasy, dread, nightmare
  · sadness category: sad, melancholy, lonely, hopeless, heavy, grief, heartbroken, depressed
  · confusion category: confused, lost, disoriented, bizarre, surreal, chaotic, dreamlike
  · nostalgia category: nostalgic, wistful, longing, memory, bittersweet, childhood
  · excitement category: excited, curious, adventurous, wondrous, thrilled, mysterious, exhilarating
  · peaceful category: peaceful, calm, warm, serene, gentle, tranquil
  Pick the dominant mood. Return empty string if truly unclear
- title: a short poetic dream title, 2-6 words, based on the dream's core scene, person, or symbol. No quotation marks or punctuation. Examples: "Moonlit Stairwell", "The Last Classroom", "Album That Never Existed"
- stressScore: integer 1-5 (1=calm, 5=extremely tense), null if unclear
- people: specific people in the dream, max 3 words each, max 5 items, empty array if none. Normalization rules:
  · If two names clearly refer to the same person, keep only one — use the most common or specific name in the text
  · Unnamed people get a short generic label ("stranger", "old man")
- locations: locations or settings, max 3 words each, max 5 items, empty array if none. Normalization rules:
  · Strip positional words ("on the plane" → "plane", "in the classroom" → "classroom")
  · Group related sub-locations under one canonical name (gate / cabin / airplane aisle → airplane; bedroom / hallway / living room → home)
  · Use the simplest, most recognizable form
- symbols: recurring or symbolically significant objects/elements, max 3 words each, max 5 items, empty array if none. Normalization rules:
  · Extract the core noun only — drop adjectives and modifiers ("big cake" → "cake", "old broken phone" → "phone")
  · Merge variations of the same thing ("cellphone / phone screen / mobile" → "phone")
  · Prefer objects that carry emotional or symbolic weight
- sleepInsight: 2-3 sentences in English analyzing the dream considering pre-sleep context (if provided), or a brief emotional reading otherwise
- followUpQuestions: 2-3 short questions in English to help recall more details — ask about scene details, character relationships, emotional turning points, unclear endings, or sensory details. One question MUST ask whether the dream connects to anything that has happened in the user's real life recently. Max 25 words each, conversational tone.
- visualBrief: A complete AI image generation prompt for this specific dream, written in English. Include all of these sections (each starting with its label on a new line):

  Overall mood: 2-3 sentences on the emotional tone and atmosphere of this dream
  Characters: The specific people in the dream (use their actual names/descriptions), their states and relationships
  Setting: The dream's space and location; if scenes shift, describe how they merge or drift in the dreamlike way
  Key imagery: The most significant objects, props, and symbols directly from the dream
  Visual direction: Overall style (e.g. soft surrealism, grounded dreamscape, floating spatial quality, suspended time)
  Color palette: Specific color names (e.g. misty rose, moonlit ivory, warm amber, lake blue) — no generic terms like "colorful" or "vivid"
  Lighting: Light quality and sources (e.g. natural bloom, volumetric fog, scattered morning light, film grain, soft-focus highlight)
  Camera & composition: Shot type, framing, depth of field (e.g. medium close-up, shallow depth of field, cinematic wide angle)
  Style references: Specific art styles, directors, or movements (e.g. Wong Kar-wai atmospheric intimacy, dreamcore, soft surrealism, cinematic memory aesthetics)
  Strictly prohibited: Text, Chinese characters, English words, logos, watermarks, borders, poster layouts; and any styles mismatched with the dream's mood (list specifically)
  Output goal: One sentence on the core emotional experience or image this should convey

  Tone: Direct, specific, written for an AI image model. Total length 250-450 English words.

Return ONLY JSON, no extra text. Format:
{"title":"...","mood":"...","stressScore":3,"people":["..."],"locations":["..."],"symbols":["..."],"sleepInsight":"...","followUpQuestions":["...","..."],"visualBrief":"..."}`;

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 60_000;

function ensureRealityQuestion(questions: string[], lang: "zh" | "en") {
  const requiredQuestion = getRealityQuestion(lang);
  const alreadyIncluded = questions.some((question) =>
    mentionsRealityContext(question, lang),
  );

  if (alreadyIncluded) return questions.slice(0, 3);
  return [...questions.slice(0, 2), requiredQuestion];
}

function limitText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}

function cleanList(values: string[], limit: number, maxLength: number) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of values) {
    const item = limitText(value.trim(), maxLength);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
    if (cleaned.length >= limit) break;
  }

  return cleaned;
}

function unwrapAnalysisPayload(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  return record.analysis ?? record.result ?? record.data ?? raw;
}

export async function POST(request: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "缺少 OPENAI_API_KEY。" },
        { status: 500 },
      );
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Please provide dream content." }, { status: 400 });
    }

    const { text, lang, preSleepMeal, preSleepActivity } = parsed.data;
    const usage = await checkAndConsumeUsage(Number(session.user.id), "analysis");
    if (!usage.allowed) {
      return NextResponse.json(
        { error: lang === "en" ? "Your monthly AI analysis limit is used up. Upgrade to Plus or try again next month." : "本月 AI 分析额度已用完，请升级 Plus 或下月继续。", billingStatus: usage.status },
        { status: 402 },
      );
    }

    let userContent = lang === "en" ? `Dream description: ${text}` : `梦境描述：${text}`;
    if (preSleepMeal?.trim()) {
      userContent +=
        lang === "en"
          ? `\n\nAte before sleep: ${preSleepMeal.trim()}`
          : `\n\n昨晚吃的食物：${preSleepMeal.trim()}`;
    }
    if (preSleepActivity?.trim()) {
      userContent +=
        lang === "en"
          ? `\n\nDid before sleep: ${preSleepActivity.trim()}`
          : `\n\n睡前活动：${preSleepActivity.trim()}`;
    }

    const systemPrompt = lang === "en" ? EN_SYSTEM_PROMPT : ZH_SYSTEM_PROMPT;

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
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_completion_tokens: 2000,
          response_format: { type: "json_object" },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return NextResponse.json({ error: errorText || "OpenAI 分析服务暂时不可用。" }, { status: 502 });
    }

    const payload = (await upstream.json()) as OpenAIResponse;
    const content = payload.choices?.[0]?.message?.content ?? "";

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "模型返回格式异常，请重试。" }, { status: 422 });
    }

    const result = analysisSchema.safeParse(unwrapAnalysisPayload(raw));
    if (!result.success) {
      console.error("POST /api/analyze-dream parse failed", result.error.flatten(), raw);
      return NextResponse.json({ error: "分析结果解析失败，请重试。" }, { status: 422 });
    }

    const cleaned = {
      title: limitText(result.data.title, lang === "en" ? 80 : 40),
      mood: limitText(result.data.mood, 20),
      stressScore: result.data.stressScore,
      people: cleanList(result.data.people, 5, lang === "en" ? 40 : 12),
      locations: cleanList(result.data.locations, 5, lang === "en" ? 48 : 16),
      symbols: cleanList(result.data.symbols, 5, lang === "en" ? 40 : 12),
      sleepInsight: limitText(result.data.sleepInsight, 1000),
      followUpQuestions: ensureRealityQuestion(
        cleanList(result.data.followUpQuestions, 3, lang === "en" ? 160 : 80),
        lang,
      ),
      visualBrief: limitText(result.data.visualBrief, 2500),
    };

    return NextResponse.json({
      ...cleaned,
    });
  } catch (error) {
    console.error("POST /api/analyze-dream failed", error);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "OpenAI 响应超时，请稍后再试。" }, { status: 504 });
    }

    return NextResponse.json({ error: "梦境分析失败。" }, { status: 500 });
  }
}
