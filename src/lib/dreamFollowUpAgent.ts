import { z } from "zod";
import { getRealityQuestion, mentionsRealityContext } from "./dreamQuestions";

export type DreamAgentStage = "exploring" | "deepening" | "ready";
export type DreamAgentNextAction = "ask_followup" | "summarize" | "ready_to_analyze";

export interface DreamAgentMemory {
  missingDetails: string[];
  observedSignals: string[];
}

export type RealityContextStatus = "unanswered" | "answered" | "declined" | "crisis";

export interface DreamAgentConversationContext {
  realityContextStatus: RealityContextStatus;
  interactionMode: "active" | "stop" | "no_more_recall" | "off_topic";
  avoidSensitiveDetails: boolean;
}

export interface DreamAgentResult {
  message: string;
  questions: string[];
  stage: DreamAgentStage;
  nextAction: DreamAgentNextAction;
  memory: DreamAgentMemory;
}

export function buildImmediateSafetyResponse(lang: "zh" | "en"): DreamAgentResult {
  if (lang === "en") {
    return {
      message: "I’m really sorry you’re carrying this right now. Your immediate safety matters more than exploring the dream. Please contact local emergency services or a crisis line now, and tell someone you trust who can stay with you. Move away from anything you could use to hurt yourself if you can.",
      questions: ["Are you in immediate danger right now?"],
      stage: "deepening",
      nextAction: "summarize",
      memory: { missingDetails: ["immediate safety"], observedSignals: ["urgent safety concern"] },
    };
  }
  return {
    message: "听起来你现在正承受非常沉重的痛苦。此刻你的安全比继续聊梦更重要。请立即联系当地急救或危机支持，也告诉一位能陪在你身边、你信任的人。如果可以，先远离任何可能伤害自己的东西。",
    questions: ["你现在有立即伤害自己的危险吗？"],
    stage: "deepening",
    nextAction: "summarize",
    memory: { missingDetails: ["当下是否安全"], observedSignals: ["紧急安全风险"] },
  };
}

export function resolveDeterministicAgentResponse(
  context: DreamAgentConversationContext,
  lang: "zh" | "en",
): DreamAgentResult | null {
  if (context.realityContextStatus === "crisis") return buildImmediateSafetyResponse(lang);
  if (context.interactionMode === "stop") {
    return lang === "en" ? {
      message: "Of course. We can stop here. What you shared can stay as it is, and you remain in control of whether to return to it later.",
      questions: [], stage: "ready", nextAction: "ready_to_analyze",
      memory: { missingDetails: [], observedSignals: ["user chose to stop"] },
    } : {
      message: "好，我们就停在这里。你已经说出的内容可以保持原样，之后要不要再回来，也完全由你决定。",
      questions: [], stage: "ready", nextAction: "ready_to_analyze",
      memory: { missingDetails: [], observedSignals: ["用户选择停止"] },
    };
  }
  if (context.interactionMode === "no_more_recall") {
    return lang === "en" ? {
      message: "That’s okay. What remains—a feeling, color, or fragment—is already enough to record. You do not have to force anything else back, and this can be organized whenever you’re ready.",
      questions: [], stage: "ready", nextAction: "ready_to_analyze",
      memory: { missingDetails: [], observedSignals: ["no more recall available"] },
    } : {
      message: "没关系。留下来的感觉、颜色或片段，已经足够被记录。你不必勉强自己再想起什么，准备好时就可以整理这些内容。",
      questions: [], stage: "ready", nextAction: "ready_to_analyze",
      memory: { missingDetails: [], observedSignals: ["已无更多可回忆内容"] },
    };
  }
  if (context.interactionMode === "off_topic") {
    return lang === "en" ? {
      message: "I’m here specifically to help you recall and record dreams, so I can’t provide a live weather report. If weather appeared in a dream, we can start there.",
      questions: ["Would you like to record a dream?"], stage: "exploring", nextAction: "summarize",
      memory: { missingDetails: ["dream content"], observedSignals: [] },
    } : {
      message: "我主要帮助你回忆和记录梦境，不能提供实时天气。如果天气出现在梦里，我们可以从那里开始。",
      questions: ["你想记录一个梦吗？"], stage: "exploring", nextAction: "summarize",
      memory: { missingDetails: ["梦境内容"], observedSignals: [] },
    };
  }
  return null;
}

const QUESTION_LIMIT_BY_ACTION: Record<DreamAgentNextAction, number> = {
  ask_followup: 3,
  summarize: 1,
  ready_to_analyze: 0,
};

const textListSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[，,、;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(z.string()).default([]));

const agentResponseSchema = z.object({
  message: z.string().trim().default("……"),
  questions: textListSchema,
  stage: z.enum(["exploring", "deepening", "ready"]).optional(),
  nextAction: z.enum(["ask_followup", "summarize", "ready_to_analyze"]).optional(),
  memory: z.object({
    missingDetails: textListSchema,
    observedSignals: textListSchema,
  }).optional(),
});

export const dreamAgentStrictResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "dream_agent_response",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string" },
        questions: { type: "array", items: { type: "string" } },
        stage: { type: "string", enum: ["exploring", "deepening", "ready"] },
        nextAction: { type: "string", enum: ["ask_followup", "summarize", "ready_to_analyze"] },
        memory: {
          type: "object",
          additionalProperties: false,
          properties: {
            missingDetails: { type: "array", items: { type: "string" } },
            observedSignals: { type: "array", items: { type: "string" } },
          },
          required: ["missingDetails", "observedSignals"],
        },
      },
      required: ["message", "questions", "stage", "nextAction", "memory"],
    },
  },
} as const;

type AgentResponsePayload = z.infer<typeof agentResponseSchema>;

function limitText(value: string, maxLength: number) {
  const text = value.trim();
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function cleanList(values: string[], limit: number, maxLength: number) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of values) {
    const item = limitText(value, maxLength);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
    if (cleaned.length >= limit) break;
  }

  return cleaned;
}

function ensureRealityQuestion(
  questions: string[],
  lang: "zh" | "en",
  conversationContext?: DreamAgentConversationContext,
) {
  if (conversationContext?.realityContextStatus !== undefined && conversationContext.realityContextStatus !== "unanswered") {
    return questions.filter((question) => !mentionsRealityContext(question, lang)).slice(0, 3);
  }
  const requiredQuestion = getRealityQuestion(lang);
  const alreadyIncluded = questions.some((question) =>
    mentionsRealityContext(question, lang),
  );

  if (alreadyIncluded) return questions.slice(0, 3);
  if (questions.length <= 1) return [requiredQuestion];
  return [...questions.slice(0, 2), requiredQuestion];
}

export function inferAgentStage(userTurns: number): DreamAgentStage {
  if (userTurns <= 2) return "exploring";
  if (userTurns <= 5) return "deepening";
  return "ready";
}

function fallbackNextAction(stage: DreamAgentStage, questions: string[]): DreamAgentNextAction {
  if (stage === "ready") return "ready_to_analyze";
  if (questions.length <= 1) return "summarize";
  return "ask_followup";
}

export function parseDreamAgentContent(
  content: string,
  lang: "zh" | "en",
  fallbackStage: DreamAgentStage,
  conversationContext?: DreamAgentConversationContext,
) {
  const fallback = { message: content.trim() || "……" };
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return sanitizeDreamAgentResult(fallback, lang, fallbackStage, conversationContext);

  try {
    return sanitizeDreamAgentResult(JSON.parse(match[0]) as unknown, lang, fallbackStage, conversationContext);
  } catch {
    return sanitizeDreamAgentResult(fallback, lang, fallbackStage, conversationContext);
  }
}

export function deriveDreamAgentConversationContext(
  messages: Array<{ role: "user" | "assistant"; content: string; questions?: string[] }>,
  lang: "zh" | "en",
  hasPreSleepContext = false,
): DreamAgentConversationContext {
  const userText = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
  const avoidSensitiveDetails = lang === "en"
    ? /(?:don't|do not|rather not|won't|will not)\s+(?:want to\s+)?(?:share|say|describe|discuss|remember)?\s*(?:the\s+)?(?:details|what happened|event)/i.test(userText)
    : /(?:不想|不要|别|不愿意)(?:再)?(?:说|讲|描述|透露|回忆)?(?:这件事的?|那些)?(?:细节|具体经过|具体发生了什么|发生了什么)/.test(userText);
  const declined = avoidSensitiveDetails || (lang === "en"
    ? /(?:do not|don't|dont|rather not|won't|will not).{0,30}(?:real life|waking life|personal)/i.test(userText)
    : /(?:不想|不要|别|不愿意).{0,12}(?:现实|生活|私人|个人)/.test(userText));
  const crisis = lang === "en"
    ? /(?:don't want to live|do not want to live|hurt myself|harm myself|kill myself|suicid)/i.test(userText)
    : /(?:不想活|伤害自己|自残|自杀|结束生命)/.test(userText);
  const stop = lang === "en"
    ? /(?:stop here|don't want to continue|do not want to continue|end (?:this|here)|that's enough)/i.test(userText)
    : /(?:到这里|不聊了|不想继续|停止吧|就这样吧)/.test(userText);
  const noMoreRecall = lang === "en"
    ? /(?:can't|cannot|don't|do not).{0,16}remember (?:anything )?more|nothing else (?:comes|remains)/i.test(userText)
    : /(?:想不起来|记不得|不记得)(?:更多|其他|别的)|只(?:记得|剩下)这些/.test(userText);
  const offTopic = lang === "en"
    ? /(?:what(?:'s| is) the weather|weather today|current weather|forecast today)/i.test(userText)
    : /(?:今天天气怎么样|现在天气|实时天气|天气预报)/.test(userText);
  const interactionMode = stop ? "stop" : noMoreRecall ? "no_more_recall" : offTopic ? "off_topic" : "active";
  if (crisis) return { realityContextStatus: "crisis", interactionMode, avoidSensitiveDetails };
  if (declined || offTopic || stop) return { realityContextStatus: "declined", interactionMode, avoidSensitiveDetails };

  const includesRealityQuestion = (message: (typeof messages)[number]) =>
    mentionsRealityContext([message.content, ...(message.questions ?? [])].join("\n"), lang);
  const assistantAsked = messages.some((message) => message.role === "assistant" && includesRealityQuestion(message));
  const lastRealityQuestionIndex = messages.findLastIndex((message) => message.role === "assistant" && includesRealityQuestion(message));
  const answeredAfterQuestion = assistantAsked && messages.slice(lastRealityQuestionIndex + 1).some((message) => message.role === "user");
  const volunteeredContext = lang === "en"
    ? /(?:recently|in real life|at work|my job|my project|before sleep)/i.test(userText)
    : /(?:最近|现实|工作|项目|睡前)/.test(userText);
  return {
    realityContextStatus: hasPreSleepContext || answeredAfterQuestion || volunteeredContext ? "answered" : "unanswered",
    interactionMode,
    avoidSensitiveDetails,
  };
}

export function buildDreamFollowUpAgentPrompt(
  lang: "zh" | "en",
  userTurns: number,
  stage: DreamAgentStage,
  contextLines: string,
  conversationContext?: DreamAgentConversationContext,
) {
  const realityStatus = conversationContext?.realityContextStatus ?? "unanswered";
  const interactionMode = conversationContext?.interactionMode ?? "active";
  const sensitiveBoundary = conversationContext?.avoidSensitiveDetails ?? false;
  if (lang === "en") {
    return `You are Dream Reel's follow-up agent for a dream journal.

Your job is not only to chat. You decide the next useful product action:
- ask_followup: ask targeted questions because important details are missing
- summarize: briefly reflect what is known and ask one useful next question
- ready_to_analyze: stop asking and tell the user the dream is ready to organize/analyze

Agent policy:
- Keep the user in control; never save, analyze, or generate images yourself
- Use the conversation history as working memory
- Track missingDetails: what is still unclear and worth asking
- Track observedSignals: concrete dream signals already present, especially emotions, emotional shifts, body sensations, people, places, symbols, sensory details, or real-life context
- Prioritize emotional exploration over factual inventory: ask what the user felt, when that feeling changed, where it was felt in the body, and what waking-life situation it may echo
- If the user has provided a dream, the dominant emotion, an emotional turning point, at least one concrete signal, and some real-life or sleep context, prefer ready_to_analyze
- If the user is still giving fragments, prefer ask_followup
- If the user seems between states, summarize what is known and ask one precise question

Tone:
- Calm, gentle, curious, unhurried
- Like a private late-night conversation, not therapy and not a generic AI tool
- Short sentences with breathing room
- Do not interpret the dream's meaning unless asked${contextLines ? `\n\nPre-sleep context: ${contextLines}` : ""}
- Reality-context status is ${realityStatus}. If it is answered, declined, or crisis, do not ask a real-life question again.
- Interaction mode is ${interactionMode}. Sensitive-detail boundary is ${sensitiveBoundary}. Never ask for event details when that boundary is true.
- If the user may imminently harm themselves, pause dream exploration. Respond directly and compassionately, encourage immediate local emergency/crisis help and contact with a trusted person, and ask only about immediate safety.

This is user turn ${userTurns}. Current inferred stage: ${stage}.

Return ONLY valid JSON:
{"message":"3-5 gentle sentences","questions":["follow-up 1","follow-up 2"],"stage":"exploring|deepening|ready","nextAction":"ask_followup|summarize|ready_to_analyze","memory":{"missingDetails":["..."],"observedSignals":["..."]}}

Question rules:
- 0 questions when nextAction is ready_to_analyze
- 1 question when nextAction is summarize
- 1-3 questions when nextAction is ask_followup
- Most questions should focus on emotion, emotional turning points, physical feeling, or real-life triggers
- One follow-up MUST ask whether this dream connects to anything that has happened in the user's real life recently, unless that has already been answered
- Each question max 20 words`;
  }

  return `你是 Dream Reel 的梦境追问 Agent。

你的任务不只是聊天，而是判断下一步产品动作：
- ask_followup：重要信息还缺失，需要继续精准追问
- summarize：先整理已知线索，再问一个最有价值的问题
- ready_to_analyze：信息已经足够，停止追问，提示用户可以整理/分析这场梦

Agent 策略：
- 保持用户控制权；不要自动保存、分析或生成图像
- 把对话历史当作工作记忆
- 维护 missingDetails：仍然模糊、值得继续问的细节
- 维护 observedSignals：已经出现的具体梦境线索，尤其是情绪、情绪转折、身体感受、人物、地点、意象、感官细节、现实生活关联
- 追问优先关注情绪，而不是单纯补事实：问用户当时什么感受、情绪何时变化、身体哪里有感觉、它可能呼应了现实中的什么处境
- 如果用户已经提供梦境、主导情绪、情绪转折、至少一个具体线索，以及现实生活或睡眠前情境，优先 ready_to_analyze
- 如果用户仍在给片段，优先 ask_followup
- 如果状态介于两者之间，先 summarize，再问一个精确问题

语气：
- 安静、温柔、好奇、有呼吸感
- 像深夜里的私人对话，不是心理咨询或通用 AI 工具
- 句子短一点，留出余白
- 不要主动解释梦的含义，除非用户明确要求${contextLines ? `\n\n用户的睡前情境：\n${contextLines}` : ""}
- 当前现实关联状态是 ${realityStatus}。如果状态为 answered、declined 或 crisis，不要再问现实关联。
- 当前互动模式是 ${interactionMode}。敏感细节边界为 ${sensitiveBoundary}；为 true 时绝不追问事件细节。
- 如果用户可能马上伤害自己，暂停梦境探索。直接、温和地回应，鼓励立即联系当地急救/危机支持和可信任的人，只询问当下是否安全。

当前是用户第 ${userTurns} 轮。当前推断阶段：${stage}。

你必须只返回合法 JSON：
{"message":"3 到 5 句温柔回应","questions":["追问 1","追问 2"],"stage":"exploring|deepening|ready","nextAction":"ask_followup|summarize|ready_to_analyze","memory":{"missingDetails":["..."],"observedSignals":["..."]}}

问题规则：
- nextAction 为 ready_to_analyze 时，questions 返回 []
- nextAction 为 summarize 时，只问 1 个问题
- nextAction 为 ask_followup 时，问 1 到 3 个问题
- 大多数追问应聚焦情绪、情绪转折、身体感受或现实触发
- 除非用户已经回答过现实关联，否则必须包含这一条追问：「这跟你最近现实生活所发生的事情，有没有什么关系？」
- 每个追问不超过 20 字`;
}

export function sanitizeDreamAgentResult(
  raw: unknown,
  lang: "zh" | "en",
  fallbackStage: DreamAgentStage,
  conversationContext?: DreamAgentConversationContext,
): DreamAgentResult {
  const parsed = agentResponseSchema.safeParse(raw);
  const data: Partial<AgentResponsePayload> = parsed.success ? parsed.data : {};
  const stage = data.stage ?? fallbackStage;
  const memory = {
    missingDetails: cleanList(data.memory?.missingDetails ?? [], 5, lang === "en" ? 80 : 40),
    observedSignals: cleanList(data.memory?.observedSignals ?? [], 8, lang === "en" ? 80 : 40),
  };
  const nextAction = data.nextAction ?? fallbackNextAction(stage, data.questions ?? []);
  const maxQuestions = QUESTION_LIMIT_BY_ACTION[nextAction];
  const cleanedQuestions = cleanList(data.questions ?? [], maxQuestions, lang === "en" ? 120 : 60);

  return {
    message: limitText(data.message ?? "……", 1000) || "……",
    questions: maxQuestions === 0 ? [] : ensureRealityQuestion(cleanedQuestions, lang, conversationContext).slice(0, maxQuestions),
    stage,
    nextAction,
    memory,
  };
}
