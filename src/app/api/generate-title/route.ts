export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(3000),
  lang: z.enum(["zh", "en"]).default("zh"),
  mood: z.string().trim().max(80).optional(),
  people: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  symbols: z.array(z.string()).optional(),
});

const ZH_SYSTEM = `你是一个梦境档案命名助手。根据梦境内容，取一个4–8个中文字的私人标题。

命名原则：
- 抓住最具画面感、最独特的那个场景、人物或意象
- 像私人日记档案的标题，不是故事摘要
- 避免"一场梦"、"奇怪的"、"关于"等泛化词汇
- 不加书名号、引号、标点

示例（仅供风格参考，不要照抄）：
梦境：我在一座废弃的游乐场里，旋转木马还在转，但周围没有人，天色昏暗…
标题：废弃旋转木马

梦境：妈妈出现了，她穿着红色的旗袍，站在我小时候住的那栋楼前，笑着叫我的名字…
标题：红旗袍与旧楼

梦境：我在水下，可以呼吸，周围全是浮动的书…
标题：水下书海

梦境：我在追一列快要开走的火车，但腿怎么也跑不快…
标题：追不上的火车

只返回标题本身，不要任何解释或多余文字。`;

const EN_SYSTEM = `You are a dream archive naming assistant. Give this dream a title of 2–5 English words.

Naming rules:
- Capture the single most vivid, specific scene, person, or image
- Write like a private journal archive title, not a story summary
- Avoid generic words like "strange", "weird", "about", "dream"
- No quotation marks or punctuation

Examples (style reference only, do not copy):
Dream: I was in an abandoned amusement park, the carousel was still spinning but no one was around, the sky was dark…
Title: Spinning Carousel Alone

Dream: My mother appeared in a red dress, standing in front of the building where I grew up, calling my name…
Title: Mother in Red

Dream: I was underwater but could breathe, surrounded by floating books…
Title: Underwater Library

Dream: I was chasing a train that was about to leave but my legs wouldn't move fast enough…
Title: Train I Can't Catch

Return only the title itself, nothing else.`;

export async function POST(request: NextRequest) {
  const session = await auth() as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 500 });

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { text, lang, mood, people, locations, symbols } = parsed.data;

  const contextParts: string[] = [];
  if (mood) contextParts.push(lang === "zh" ? `情绪：${mood}` : `Mood: ${mood}`);
  if (people?.length) contextParts.push(lang === "zh" ? `人物：${people.join("、")}` : `People: ${people.join(", ")}`);
  if (locations?.length) contextParts.push(lang === "zh" ? `场景：${locations.join("、")}` : `Locations: ${locations.join(", ")}`);
  if (symbols?.length) contextParts.push(lang === "zh" ? `意象：${symbols.join("、")}` : `Symbols: ${symbols.join(", ")}`);

  const userContent = lang === "zh"
    ? `梦境：${text.slice(0, 1200)}${contextParts.length ? `\n\n补充信息：${contextParts.join("；")}` : ""}`
    : `Dream: ${text.slice(0, 1200)}${contextParts.length ? `\n\nContext: ${contextParts.join("; ")}` : ""}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: lang === "zh" ? ZH_SYSTEM : EN_SYSTEM },
          { role: "user", content: userContent },
        ],
        max_completion_tokens: 40,
        temperature: 0.85,
      }),
    });

    if (!res.ok) return NextResponse.json({ error: "AI unavailable" }, { status: 502 });

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const title = raw.replace(/^["""''「」『』【】《》\s]+|["""''「」『』】》\s]+$/g, "").trim();

    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
