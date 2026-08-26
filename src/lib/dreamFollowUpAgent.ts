import { z } from "zod";
import { mentionsRealityContext } from "./dreamQuestions";

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
  bodyDetailVolunteered: boolean;
  sensoryDetailVolunteered: boolean;
  privacyControlQuestion: boolean;
  turningPointGap: boolean;
  nightmareGroundingNeeded: boolean;
  traumaBoundary: boolean;
  latestDreamFragment: string | null;
  recurringDream: boolean;
  runningFragment: boolean;
  interpretationRequested: boolean;
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
  guardedRecall = true,
): DreamAgentResult | null {
  if (context.realityContextStatus === "crisis") return buildImmediateSafetyResponse(lang);
  if (guardedRecall && context.privacyControlQuestion) {
    return lang === "en" ? {
      message: "You remain in control. I won't automatically save or share this dream; it only becomes a journal entry if you choose to save it. The image of hiding in the bathroom is enough to leave as it is, and you do not have to add anything more.",
      questions: [], stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: [], observedSignals: ["user asked about privacy and control"] },
    } : {
      message: "控制权仍然在你手里。我不会替你自动保存或分享这段梦；只有你主动选择保存，它才会成为梦境记录。躲在浴室里的画面已经足够，你不必再补充任何内容。",
      questions: [], stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: [], observedSignals: ["用户询问隐私与控制权"] },
    };
  }
  if (guardedRecall && context.traumaBoundary) {
    return lang === "en" ? {
      message: "You do not have to describe what happened or return to those details. Waking up shaking means taking care of this moment matters more than recalling the dream. If it helps, orient to one steady thing around you and let yourself pause here.",
      questions: ["Do you feel safe where you are right now?"],
      stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: ["immediate sense of safety"], observedSignals: ["trauma-related dream", "user declined details", "woke up shaking"] },
    } : {
      message: "你不必讲那段经历具体发生了什么，也不用重新回到那些细节里。醒来后还在发抖，先照顾此刻比继续回忆梦更重要。可以看看身边一个稳定的东西，让自己先停在这里。",
      questions: ["你现在待的地方安全吗？"],
      stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: ["当下是否有安全感"], observedSignals: ["创伤相关梦境", "用户拒绝细节", "醒来后发抖"] },
    };
  }
  if (guardedRecall && context.turningPointGap) {
    return lang === "en" ? {
      message: "That sudden drop from happiness into misery feels important, even if the moment between them is blank. You do not need to force the missing piece back. We can stay with the last clear moment before the feeling changed.",
      questions: ["What is the last clear thing you remember before the feeling shifted?"],
      stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: ["emotional turning point"], observedSignals: ["happiness changed suddenly into misery"] },
    } : {
      message: "从开心突然落到难受，这个变化本身已经很显眼，即使中间是一段空白。你不必逼自己把缺失的部分想回来。我们可以只停在情绪转折之前最后清楚的片段。",
      questions: ["在变得难受之前，你最后清楚记得的画面是什么？"],
      stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: ["情绪转折点"], observedSignals: ["开心突然转为难受"] },
    };
  }
  if (guardedRecall && context.nightmareGroundingNeeded) {
    return lang === "en" ? {
      message: "You have just come out of something frightening, and your racing heart can take a little time to settle. You do not need to return to the dream right now. If it helps, notice one steady thing in the room and let your next breath be unforced.",
      questions: ["Do you feel safe where you are right now?"],
      stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: ["immediate sense of safety"], observedSignals: ["just woke from a nightmare", "heart racing", "room still feels frightening"] },
    } : {
      message: "你刚从很吓人的梦里出来，心跳可能还需要一点时间慢下来。现在不用重新回到梦里，也不必马上讲清楚。可以先看看房间里一个稳定的东西，让下一次呼吸自然发生，给自己缓一缓。",
      questions: ["你现在待的地方安全吗？"],
      stage: "deepening", nextAction: "summarize",
      memory: { missingDetails: ["当下是否有安全感"], observedSignals: ["刚从噩梦惊醒", "心跳很快", "房间仍令人害怕"] },
    };
  }
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
  const isTinyFragment = guardedRecall
    && context.latestDreamFragment !== null
    && context.latestDreamFragment.length <= (lang === "en" ? 20 : 10)
    && !context.interpretationRequested;
  if (isTinyFragment) {
    const fragment = context.latestDreamFragment as string;
    return lang === "en" ? {
      message: `“${fragment}” feels like a small piece left behind after waking. It can stay incomplete for now.`,
      questions: [context.runningFragment
        ? "Did the running feel more like escaping or moving toward somewhere?"
        : "Does this feel more like a still image or something in motion?"],
      stage: "exploring", nextAction: "ask_followup",
      memory: { missingDetails: ["whether the fragment is still or moving"], observedSignals: [fragment] },
    } : {
      message: `“${fragment}”像是梦醒后留下的一小块画面。它可以先保持不完整，不必急着补全。`,
      questions: [context.runningFragment
        ? "这段奔跑更像是在逃离什么，还是赶往哪里？"
        : "这个片段更像静止的画面，还是正在发生什么？"],
      stage: "exploring", nextAction: "ask_followup",
      memory: { missingDetails: ["片段是静止还是正在发生"], observedSignals: [fragment] },
    };
  }
  return null;
}

const QUESTION_LIMIT_BY_ACTION: Record<DreamAgentNextAction, number> = {
  ask_followup: 1,
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

function parseRelaxedAgentPayload(raw: unknown): Partial<AgentResponsePayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const candidate = raw as Record<string, unknown>;
  const message = z.string().trim().safeParse(candidate.message);
  const questions = textListSchema.safeParse(candidate.questions);
  const stage = z.enum(["exploring", "deepening", "ready"]).safeParse(candidate.stage);
  const nextAction = z.enum(["ask_followup", "summarize", "ready_to_analyze"]).safeParse(candidate.nextAction);
  const memoryCandidate = candidate.memory && typeof candidate.memory === "object" && !Array.isArray(candidate.memory)
    ? candidate.memory as Record<string, unknown>
    : {};
  const missingDetails = textListSchema.safeParse(memoryCandidate.missingDetails);
  const observedSignals = textListSchema.safeParse(memoryCandidate.observedSignals);
  return {
    ...(message.success ? { message: message.data } : {}),
    ...(questions.success ? { questions: questions.data } : {}),
    ...(stage.success ? { stage: stage.data } : {}),
    ...(nextAction.success ? { nextAction: nextAction.data } : {}),
    memory: {
      missingDetails: missingDetails.success ? missingDetails.data : [],
      observedSignals: observedSignals.success ? observedSignals.data : [],
    },
  };
}

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

function applyQuestionTimingPolicy(
  questions: string[],
  lang: "zh" | "en",
  stage: DreamAgentStage,
  conversationContext?: DreamAgentConversationContext,
) {
  if (conversationContext?.recurringDream) {
    return [lang === "en"
      ? "Compared with the earlier dreams, what stayed the same or changed this time?"
      : "前几次的梦和这次相比，有什么相同或不同？"];
  }
  if (conversationContext?.runningFragment) {
    return [lang === "en"
      ? "Did the running feel more like escaping something or trying to reach somewhere?"
      : "这段奔跑更像是在逃离什么，还是赶往哪里？"];
  }
  if (conversationContext?.realityContextStatus !== undefined && conversationContext.realityContextStatus !== "unanswered") {
    return questions.filter((question) => !mentionsRealityContext(question, lang)).slice(0, 2);
  }
  const timedQuestions = stage === "exploring"
    ? questions.filter((question) => !mentionsRealityContext(question, lang))
    : questions;
  if (timedQuestions.length) return timedQuestions.slice(0, 2);
  return [lang === "en" ? "What changed next in the dream?" : "梦里接下来发生了什么？"];
}

function isQuestionAllowedByRecallBoundary(
  question: string,
  lang: "zh" | "en",
  context?: DreamAgentConversationContext,
) {
  if (!context) return true;
  const asksBodyDetail = lang === "en"
    ? /\b(?:body|chest|shoulders?|jaw|heart|breath|stomach|hands?|feet)\b/i.test(question)
    : /(?:身体|胸口|肩膀|下巴|心跳|呼吸|胃|手|脚)/.test(question);
  if (asksBodyDetail && !context.bodyDetailVolunteered) return false;

  const asksSensoryDetail = lang === "en"
    ? /\b(?:smell|odor|scent|lighting|sound)\b/i.test(question)
    : /(?:气味|闻到|光线|声音)/.test(question);
  if (asksSensoryDetail && !context.sensoryDetailVolunteered) return false;

  if (context.avoidSensitiveDetails) {
    const asksForEventDetail = lang === "en"
      ? /\b(?:what (?:exactly )?happened|where|inside|outside|room|scene|event|details?)\b/i.test(question)
      : /(?:发生了什么|具体发生|哪里|室内|室外|房间|场景|经过|细节)/.test(question);
    if (asksForEventDetail) return false;
  }

  return lang === "en" ? question.trim().split(/\s+/).length <= 20 : question.length <= 60;
}

export function inferAgentStageFromConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  lang: "zh" | "en",
  context: DreamAgentConversationContext,
  guardedRecall = true,
): DreamAgentStage {
  const userTurns = messages.filter((message) => message.role === "user").length;
  if (userTurns > 5) return "ready";
  if (guardedRecall && userTurns === 1 && context.runningFragment) return "exploring";
  const text = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
  const hasNarrative = text.length >= (lang === "en" ? 50 : 20);
  const hasEmotion = lang === "en"
    ? /\b(?:felt|feel|afraid|fear|anxious|panicked|calm|happy|sad|lonely|excited|angry|ashamed|relief|unsettled)\b/i.test(text)
    : /(?:害怕|紧张|焦急|安心|开心|难过|孤单|兴奋|慌张|愤怒|悲伤|羞耻|委屈|不安|感到|感觉)/.test(text);
  const hasTurningPoint = lang === "en"
    ? /\b(?:then|suddenly|after|before|shifted|changed|at first|but)\b/i.test(text)
    : /(?:后来|然后|突然|之后|之前|起初|但是|却|变得)/.test(text);
  const hasConcreteSignal = lang === "en"
    ? /\b(?:body|chest|shoulder|stomach|heart|shaking|feet|hand|school|station|grandmother|manager|ocean|roof|train|door|bird|house|corridor)\b/i.test(text)
    : /(?:身体|胸口|肩膀|胃|心跳|发抖|脚|手|学校|车站|奶奶|老板|海|屋顶|火车|门|鸟|房子|走廊)/.test(text);
  const evidenceCount = [hasNarrative, hasEmotion, hasTurningPoint, hasConcreteSignal]
    .filter(Boolean).length;
  if (evidenceCount === 4 && context.realityContextStatus === "answered") return "ready";
  if (userTurns > 2 || evidenceCount >= 2) return "deepening";
  return "exploring";
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
  guardedRecall = true,
) {
  const fallback = { message: content.trim() || "……" };
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return sanitizeDreamAgentResult(fallback, lang, fallbackStage, conversationContext, guardedRecall);

  try {
    return sanitizeDreamAgentResult(JSON.parse(match[0]) as unknown, lang, fallbackStage, conversationContext, guardedRecall);
  } catch {
    return sanitizeDreamAgentResult(fallback, lang, fallbackStage, conversationContext, guardedRecall);
  }
}

export function deriveDreamAgentConversationContext(
  messages: Array<{ role: "user" | "assistant"; content: string; questions?: string[] }>,
  lang: "zh" | "en",
  hasPreSleepContext = false,
): DreamAgentConversationContext {
  const userMessages = messages.filter((message) => message.role === "user");
  const userText = userMessages.map((message) => message.content).join("\n");
  const latestUserText = userMessages.at(-1)?.content.trim() ?? "";
  const recurringDream = lang === "en"
    ? /\b(?:second|third|fourth|fifth|another)\s+time\b|\b(?:recurring|repeating)\s+dream\b|\bsame dream\b|\bdream(?:ed|t)? (?:it|this) again\b/i.test(userText)
    : /(?:第[二三四五六七八九十\d]+次|又梦见|反复梦见|重复的?梦|同一个梦|连续.{0,8}梦)/.test(userText);
  const runningFragment = latestUserText.length <= (lang === "en" ? 100 : 50) && (lang === "en"
    ? /\b(?:running|ran)\b/i.test(latestUserText)
    : /(?:一直在跑|不停地?跑|奔跑|跑着)/.test(latestUserText));
  const interpretationDeclined = lang === "en"
    ? /(?:don't|do not|rather not|no need to)\s+(?:interpret|analy[sz]e)/i.test(userText)
    : /(?:不要|不用|别|不想)(?:帮我)?(?:解梦|分析梦|解释梦)/.test(userText);
  const interpretationRequested = !interpretationDeclined && (lang === "en"
    ? /\b(?:what does .{0,80} mean|interpret(?:ation)?|meaning of (?:this|the) dream)\b/i.test(userText)
    : /(?:代表什么|什么意思|意味着什么|有什么含义|解梦|帮我分析.{0,8}梦)/.test(userText));
  const bodyDetailVolunteered = lang === "en"
    ? /\b(?:body|chest|shoulders?|jaw|heart|breath|stomach|hands?|feet)\b/i.test(userText)
    : /(?:身体|胸口|肩膀|下巴|心跳|呼吸|胃|手|脚)/.test(userText);
  const sensoryDetailVolunteered = lang === "en"
    ? /\b(?:smell|odor|scent|lighting|sound)\b/i.test(userText)
    : /(?:气味|闻到|光线|声音)/.test(userText);
  const privacyControlQuestion = lang === "en"
    ? /(?:automatically|auto).{0,20}(?:save|share)|(?:save|share).{0,20}(?:automatically|auto)|will you.{0,20}(?:save|share)/i.test(userText)
    : /(?:会不会|是否|会).{0,12}(?:自动)?(?:保存|分享)|自动.{0,8}(?:保存|分享)/.test(userText);
  const turningPointGap = lang === "en"
    ? /(?:happy|good|calm|relieved).{0,80}(?:then|suddenly).{0,80}(?:miserable|sad|afraid|anxious|bad).{0,120}(?:can't|cannot|don't|do not).{0,20}remember/i.test(userText)
    : /(?:开心|高兴|轻松|安心).{0,40}(?:后来|然后|突然).{0,40}(?:难受|难过|害怕|焦急|不安).{0,60}(?:想不起来|记不清|不记得)/.test(userText);
  const nightmareGroundingNeeded = lang === "en"
    ? /(?:just woke|woke up).{0,40}(?:nightmare|frightening dream)/i.test(userText) && /(?:heart.{0,12}(?:racing|pounding)|room.{0,30}(?:frightening|scary)|still.{0,20}(?:afraid|scared))/i.test(userText)
    : /(?:刚|才).{0,8}(?:噩梦|梦).{0,8}(?:惊醒|醒来)|(?:刚|才).{0,8}(?:惊醒|醒来).{0,8}(?:噩梦|梦)/.test(userText)
      && /(?:心跳.{0,6}(?:很快|加速)|房间.{0,12}(?:害怕|吓人)|现在.{0,12}(?:害怕|恐惧))/.test(userText);
  const avoidSensitiveDetails = lang === "en"
    ? /(?:don't|do not|rather not|won't|will not)\s+(?:want to\s+)?(?:share|say|describe|discuss|remember)?\s*(?:the\s+)?(?:details|what happened|event)/i.test(userText)
    : /(?:不想|不要|别|不愿意)(?:再)?(?:说|讲|描述|透露|回忆)?(?:这件事的?|那些)?(?:细节|具体经过|具体发生了什么|发生了什么)/.test(userText);
  const traumaBoundary = avoidSensitiveDetails && (lang === "en"
    ? /\b(?:trauma|traumatic)\b/i.test(userText)
    : /(?:创伤|创伤经历)/.test(userText));
  const explicitlyIncompleteFragment = lang === "en"
    ? /\b(?:only|just) remember\b/i.test(latestUserText)
    : /(?:只|仅仅?)记得/.test(latestUserText);
  const latestDreamFragment = latestUserText.length <= (lang === "en" ? 40 : 20) || explicitlyIncompleteFragment
    ? latestUserText
    : null;
  const detectedSignals = {
    recurringDream,
    runningFragment,
    interpretationRequested,
    bodyDetailVolunteered,
    sensoryDetailVolunteered,
    privacyControlQuestion,
    turningPointGap,
    nightmareGroundingNeeded,
    traumaBoundary,
    latestDreamFragment,
  };
  const declined = avoidSensitiveDetails || (lang === "en"
    ? /(?:do not|don't|dont|rather not|won't|will not).{0,30}(?:real life|waking life|personal)/i.test(userText)
    : /(?:不想|不要|别|不愿意).{0,12}(?:现实|生活|私人|个人)/.test(userText));
  const hasDreamFrame = lang === "en"
    ? /(?:in (?:the|my) dream|I dreamed|nightmare|while dreaming)/i.test(userText)
    : /(?:梦里|梦中|梦见|噩梦)/.test(userText);
  const crisisCandidate = lang === "en"
    ? /\bI\s+(?:(?:still\s+)?(?:don't|do not)\s+want\s+to\s+(?:live\b(?!\s+(?:in|with|here|there|at)\b)|be alive)|(?:may|might|will|plan to|want to|am going to|'m going to)\s+(?:hurt|harm|kill)\s+myself|(?:am|'m)\s+suicidal)/i.test(userText)
    : /我(?:(?:现在|此刻|还是|今晚|真的)?不想活(?:了|下去)?(?!在)|(?:现在|此刻|今晚|可能|想|要|准备|打算|会).{0,4}(?:伤害自己|自残|自杀|结束生命))/.test(userText);
  const currentRiskSignal = lang === "en"
    ? /(?:after waking|awake now|right now|tonight|still feel|outside the dream)/i.test(userText)
    : /(?:梦醒后|醒来后|现在|此刻|今晚|仍然|还是|现实中)/.test(userText);
  const crisis = crisisCandidate && (!hasDreamFrame || currentRiskSignal);
  const stop = lang === "en"
    ? /(?:(?:let's|please|I want to|I'd like to)\s+(?:stop|end)(?:\s+(?:here|this|the chat|talking))?|I\s+(?:don't|do not)\s+want\s+to\s+continue\s+(?:this|the chat|talking)|that's enough(?: for now)?)/i.test(userText)
    : /(?:不聊了|聊到这里|到这里吧|停止(?:聊天|追问)|别再问|就这样吧)/.test(userText);
  const noMoreRecall = lang === "en"
    ? /(?:can't|cannot|don't|do not).{0,16}remember (?:anything )?more|nothing else (?:comes|remains)/i.test(userText)
    : /(?:想不起来|记不得|不记得)(?:更多|其他|别的)|只(?:记得|剩下)这些/.test(userText);
  const offTopicCandidate = lang === "en"
    ? /(?:what(?:'s| is) the weather|weather today|current weather|forecast today)/i.test(userText)
    : /(?:今天天气怎么样|现在天气|实时天气|天气预报)/.test(userText);
  const offTopic = offTopicCandidate && !hasDreamFrame;
  const interactionMode = stop ? "stop" : noMoreRecall ? "no_more_recall" : offTopic ? "off_topic" : "active";
  if (crisis) return { realityContextStatus: "crisis", interactionMode, avoidSensitiveDetails, ...detectedSignals };
  if (declined || offTopic || stop) return { realityContextStatus: "declined", interactionMode, avoidSensitiveDetails, ...detectedSignals };

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
    ...detectedSignals,
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
- Your primary goal is emotional accompaniment: help the user feel heard, cared for, and gently held. Recalling more detail is secondary and never required.
- Respond to the person before processing the dream. Do not treat dream recall like an interview, inventory, or memory test.
- Keep the user in control; never save, analyze, or generate images yourself
- Use the conversation history as working memory
- Track missingDetails: what is still unclear and worth asking
- Track observedSignals: concrete dream signals already present, especially emotions, emotional shifts, body sensations, people, places, symbols, sensory details, or real-life context
- Before asking, offer a warm reflection grounded in this dream's specific image, contrast, action, or uncertainty. For emotional or long-form dreams, use 3-5 substantive sentences so the response does not feel abrupt.
- Offer one or two gentle, grounded possibilities when they could help the user associate or feel understood. Use language such as "might," "perhaps," or "I wonder if," and invite the user to keep only what resonates.
- Choose the most useful question axis for this particular dream: sequence or turning point, sensory detail, agency or choice, a character or relationship, an unusual contrast, differences across a recurring dream, emotion, or body sensation
- Vary the axis across turns. Never default to the same emotion + body + real-life checklist
- If emotion or body sensation is already known, do not ask for it again
- Do not ask for precise body sensations, smells, lighting, sounds, or other hard-to-recall sensory details unless the user already emphasized that detail
- For recurring dreams, the first and only question must compare what stayed the same or changed in earlier occurrences
- For a very short fragment, do not request an inventory of details. Offer an easy either/or possibility grounded in the fragment, or permission to leave it vague.
- If the user asks for interpretation, provide a small non-diagnostic hypothesis grounded in their imagery. Default to summarize with no question unless one answer is truly necessary.
- It is okay to ask no question. A caring reflection can be the complete response when another question would feel extractive.
- If the user has provided a dream, the dominant emotion, an emotional turning point, at least one concrete signal, and some real-life or sleep context, prefer ready_to_analyze
- If the user is still giving fragments, prefer ask_followup
- If the user seems between states, summarize what is known and ask one precise question

Tone:
- Calm, gentle, curious, unhurried
- Like a caring companion in a private late-night conversation, not therapy and not a generic AI tool
- Short sentences with breathing room
- Prefer plain warmth over decorative poetic language that is not grounded in what the user said
- Respond entirely in the user's language; do not casually mix languages
- Never present an interpretation as fact. Keep unrequested interpretation light and optional; when explicitly asked, offer a grounded hypothesis with uncertainty${contextLines ? `\n\nPre-sleep context: ${contextLines}` : ""}
- Reality-context status is ${realityStatus}. Never ask about real life during the exploring stage. In deepening, ask only when the link would clearly add value. If status is answered, declined, or crisis, do not ask again.
- Interaction mode is ${interactionMode}. Sensitive-detail boundary is ${sensitiveBoundary}. Never ask for event details when that boundary is true.
- If the user may imminently harm themselves, pause dream exploration. Respond directly and compassionately, encourage immediate local emergency/crisis help and contact with a trusted person, and ask only about immediate safety.

This is user turn ${userTurns}. Current inferred stage: ${stage}.

Return ONLY valid JSON:
{"message":"3-5 gentle sentences","questions":["follow-up 1","follow-up 2"],"stage":"exploring|deepening|ready","nextAction":"ask_followup|summarize|ready_to_analyze","memory":{"missingDetails":["..."],"observedSignals":["..."]}}

Question rules:
- 0 questions when nextAction is ready_to_analyze
- 0-1 question when nextAction is summarize
- Exactly 1 question when nextAction is ask_followup; never present a checklist
- Questions must use details from this dream and should not be interchangeable with another dream
- Do not combine emotion, body sensation, and real-life connection as a routine trio
- A real-life question is optional and belongs only in the deepening stage
- When inviting a connection, offer a gentle hint first instead of asking a dry generic question
- Prefer easy, high-level choices (for example, escaping versus moving toward something) over exact sensory recall
- Each question max 20 words`;
  }

  return `你是 Dream Reel 的梦境追问 Agent。

你的任务不只是聊天，而是判断下一步产品动作：
- ask_followup：重要信息还缺失，需要继续精准追问
- summarize：先整理已知线索，再问一个最有价值的问题
- ready_to_analyze：信息已经足够，停止追问，提示用户可以整理/分析这场梦

Agent 策略：
- 首要目标是情感陪伴：让用户感到被听见、被在意、被温柔地接住。回忆更多细节只是次要选择，绝不是任务要求
- 先回应这个人，再处理这场梦。不要把梦境回忆变成采访、信息盘点或记忆测试
- 保持用户控制权；不要自动保存、分析或生成图像
- 把对话历史当作工作记忆
- 维护 missingDetails：仍然模糊、值得继续问的细节
- 维护 observedSignals：已经出现的具体梦境线索，尤其是情绪、情绪转折、身体感受、人物、地点、意象、感官细节、现实生活关联
- 提问前，先根据这场梦独有的意象、反差、动作或不确定处，给出温暖回应。面对情绪浓度高或篇幅较长的梦，用 3 到 5 句有内容的回应，不要显得突然或敷衍
- 当联想可能帮助用户理解或感到被理解时，可以给一到两个有根据的温和可能性。使用“也许”“可能”“我在想会不会”等措辞，并提醒用户只保留有共鸣的部分
- 每轮只选择最有价值的一个追问方向：事件顺序或转折、感官细节、行动与选择、人物关系、异常反差、重复梦的变化、情绪或身体感受
- 不同轮次要更换追问方向，绝不默认使用“情绪 + 身体 + 现实关联”的固定清单
- 用户已经说过情绪或身体感受时，不要再问一遍
- 除非用户主动强调，否则不要追问精确身体部位、气味、光线、声音等难以回忆的细节
- 面对重复梦，唯一的追问必须优先比较前几次有哪些相同或不同，而不是再次盘问当前梦的情绪
- 面对极短的梦境片段，不要让用户盘点更多细节。根据已有片段给一个容易回答的二选一联想，或明确允许它保持模糊
- 用户主动要求解梦时，先基于梦中意象给出一个非诊断、非定论的小假设。默认 summarize 且不提问，除非一个答案确实不可缺少
- 可以不问任何问题；如果继续追问会像在索取信息，一段有陪伴感的回应本身就足够
- 如果用户已经提供梦境、主导情绪、情绪转折、至少一个具体线索，以及现实生活或睡眠前情境，优先 ready_to_analyze
- 如果用户仍在给片段，优先 ask_followup
- 如果状态介于两者之间，先 summarize，再问一个精确问题

语气：
- 安静、温柔、好奇、有呼吸感
- 像深夜里愿意陪伴用户的人，不是心理咨询或通用 AI 工具
- 句子短一点，留出余白
- 使用朴素、具体的温暖，避免脱离用户原话的装饰性诗意表达
- 完全使用用户正在使用的语言，不要随意中英混杂
- 绝不把解读当成事实。用户没有要求时，只给轻量、可忽略的可能性；用户明确要求时，可以给有根据且保留不确定性的假设${contextLines ? `\n\n用户的睡前情境：\n${contextLines}` : ""}
- 当前现实关联状态是 ${realityStatus}。exploring 阶段绝不问现实关联；deepening 阶段也只有在确实能增加价值时才问。如果状态为 answered、declined 或 crisis，不要再问。
- 当前互动模式是 ${interactionMode}。敏感细节边界为 ${sensitiveBoundary}；为 true 时绝不追问事件细节。
- 如果用户可能马上伤害自己，暂停梦境探索。直接、温和地回应，鼓励立即联系当地急救/危机支持和可信任的人，只询问当下是否安全。

当前是用户第 ${userTurns} 轮。当前推断阶段：${stage}。

你必须只返回合法 JSON：
{"message":"3 到 5 句温柔回应","questions":["追问 1","追问 2"],"stage":"exploring|deepening|ready","nextAction":"ask_followup|summarize|ready_to_analyze","memory":{"missingDetails":["..."],"observedSignals":["..."]}}

问题规则：
- nextAction 为 ready_to_analyze 时，questions 返回 []
- nextAction 为 summarize 时，可以不问，最多问 1 个问题
- nextAction 为 ask_followup 时，只问 1 个问题，绝不列清单
- 问题必须使用这场梦的具体细节，不能换到任何梦里都成立
- 不要把情绪、身体感受、现实关联组合成固定三连问
- 现实关联是可选项，只能在 deepening 阶段出现
- 邀请现实联想时，先给一个温和的联想 hint，不要干巴巴地问“和现实有什么关系”
- 优先提供容易回答的高层选择，例如“更像在逃离，还是在奔向什么”，不要要求精确感官回忆
- 每个追问不超过 20 字`;
}

export function sanitizeDreamAgentResult(
  raw: unknown,
  lang: "zh" | "en",
  fallbackStage: DreamAgentStage,
  conversationContext?: DreamAgentConversationContext,
  guardedRecall = true,
): DreamAgentResult {
  const parsed = agentResponseSchema.safeParse(raw);
  if (!guardedRecall) {
    const data: Partial<AgentResponsePayload> = parsed.success ? parsed.data : {};
    const stage = data.stage ?? fallbackStage;
    const memory = {
      missingDetails: cleanList(data.memory?.missingDetails ?? [], 5, lang === "en" ? 80 : 40),
      observedSignals: cleanList(data.memory?.observedSignals ?? [], 8, lang === "en" ? 80 : 40),
    };
    const nextAction = conversationContext?.interpretationRequested
      ? "summarize"
      : data.nextAction ?? fallbackNextAction(stage, data.questions ?? []);
    const normalizedStage: DreamAgentStage = nextAction === "ready_to_analyze"
      ? "ready"
      : stage === "ready" ? "deepening" : stage;
    const maxQuestions = QUESTION_LIMIT_BY_ACTION[nextAction];
    const cleanedQuestions = conversationContext?.interpretationRequested
      ? []
      : cleanList(data.questions ?? [], maxQuestions, lang === "en" ? 120 : 60);
    return {
      message: limitText(data.message ?? "……", 1000) || "……",
      questions: maxQuestions === 0 || conversationContext?.interpretationRequested
        ? []
        : applyQuestionTimingPolicy(cleanedQuestions, lang, normalizedStage, conversationContext).slice(0, maxQuestions),
      stage: normalizedStage,
      nextAction,
      memory,
    };
  }
  const data: Partial<AgentResponsePayload> = parsed.success ? parsed.data : parseRelaxedAgentPayload(raw);
  // Stage is a product state, so keep deterministic inference authoritative.
  // Model prose may vary, but identical evidence should not advance users differently.
  const stage = fallbackStage;
  const memory = {
    missingDetails: cleanList(data.memory?.missingDetails ?? [], 5, lang === "en" ? 80 : 40),
    observedSignals: cleanList(data.memory?.observedSignals ?? [], 8, lang === "en" ? 80 : 40),
  };
  const fragmentFallbackQuestion = !parsed.success && conversationContext?.latestDreamFragment
    ? (lang === "en"
      ? "Does this fragment feel more like a still image or something in motion?"
      : "这个片段更像静止的画面，还是正在发生什么？")
    : null;
  const modelQuestions = data.questions?.length ? data.questions : fragmentFallbackQuestion ? [fragmentFallbackQuestion] : [];
  const proposedNextAction = conversationContext?.interpretationRequested
    ? "summarize"
    : data.nextAction ?? (fragmentFallbackQuestion ? "ask_followup" : fallbackNextAction(stage, modelQuestions));
  const incompleteFragmentQuestion = conversationContext?.latestDreamFragment
    ? (lang === "en"
      ? `After “${limitText(conversationContext.latestDreamFragment, 80)},” what happened next in the dream?`
      : `在“${limitText(conversationContext.latestDreamFragment, 24)}”之后，梦里接下来发生了什么？`)
    : null;
  const shouldContinueIncompleteFragment = proposedNextAction === "summarize"
    && modelQuestions.length === 0
    && memory.missingDetails.length > 0
    && conversationContext?.interactionMode === "active"
    && Boolean(incompleteFragmentQuestion);
  const consistentNextAction = shouldContinueIncompleteFragment ? "ask_followup" : proposedNextAction;
  const nextAction = consistentNextAction === "ready_to_analyze" && fallbackStage !== "ready"
    ? "summarize"
    : consistentNextAction;
  const normalizedStage: DreamAgentStage = nextAction === "ready_to_analyze"
    ? "ready"
    : stage === "ready" ? "deepening" : stage;
  const maxQuestions = QUESTION_LIMIT_BY_ACTION[nextAction];
  const questionsForCleaning = shouldContinueIncompleteFragment && incompleteFragmentQuestion
    ? [incompleteFragmentQuestion]
    : modelQuestions;
  const cleanedQuestions = conversationContext?.interpretationRequested
    ? []
    : cleanList(questionsForCleaning, maxQuestions, lang === "en" ? 120 : 60);

  const questions = maxQuestions === 0 || conversationContext?.interpretationRequested
    ? []
    : applyQuestionTimingPolicy(cleanedQuestions, lang, normalizedStage, conversationContext)
      .filter((question) => isQuestionAllowedByRecallBoundary(question, lang, conversationContext))
      .slice(0, maxQuestions);
  const guardedNextAction = nextAction === "ask_followup" && questions.length === 0
    ? "summarize"
    : nextAction;

  return {
    message: limitText(data.message ?? (conversationContext?.latestDreamFragment
      ? (lang === "en"
        ? `“${conversationContext.latestDreamFragment}” feels like a small piece left behind after waking. It can stay incomplete for now.`
        : `“${conversationContext.latestDreamFragment}”像是梦醒后留下的一小块画面。它可以先保持不完整，不必急着补全。`)
      : "……"), 1000) || "……",
    questions,
    stage: normalizedStage,
    nextAction: guardedNextAction,
    memory,
  };
}
