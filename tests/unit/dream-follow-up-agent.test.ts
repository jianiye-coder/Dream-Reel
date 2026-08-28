import { describe, expect, it } from "vitest";
import { buildDreamFollowUpAgentPrompt, buildImmediateSafetyResponse, deriveDreamAgentConversationContext, inferAgentStageFromConversation, resolveDeterministicAgentResponse, sanitizeDreamAgentResult } from "@/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "../../evals/dream-agent/cases";

describe("dream follow-up conversation context", () => {
  it("prioritizes accompaniment over extracting more dream details", () => {
    const prompt = buildDreamFollowUpAgentPrompt("zh", 1, "exploring", "");
    expect(prompt).toContain("让用户感到被听见、被在意、被温柔地接住");
    expect(prompt).toContain("可以不问任何问题");
    expect(prompt).toContain("不要追问精确身体部位、气味、光线、声音");
    expect(prompt).toContain("模糊、不确定和身份缺失视为有效的梦境信息");
    expect(prompt).toContain("清晨安静陪用户回看梦境");
  });

  it("accepts an unclear dream figure without turning recall into identification", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "梦里有一个模糊的人影，我看不清脸，也不知道是谁。" },
    ], "zh");

    expect(context).toMatchObject({ vagueRecall: true, vaguePerson: true });
    expect(resolveDeterministicAgentResponse(context, "zh")).toMatchObject({
      nextAction: "ask_followup",
      message: expect.stringMatching(/不代表你漏掉|空白可以保留/),
      questions: [expect.stringMatching(/安心|不安/)],
    });
  });

  it("uses an easy high-level continuation when emotion is already known but recall stays vague", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "The figure was blurry and I could not make out the face. I felt anxious." },
    ], "en");

    expect(context).toMatchObject({ vagueRecall: true, vaguePerson: true, emotionDetailVolunteered: true });
    expect(resolveDeterministicAgentResponse(context, "en")).toMatchObject({
      questions: [expect.stringMatching(/move the dream forward|pause/i)],
      message: expect.stringMatching(/does not mean you missed|uncertainty/i),
    });
  });

  it("does not repeat the vagueness acknowledgment after the user answers", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "There was a vague figure and I could not see the face." },
      { role: "assistant", content: "The uncertainty can stay. Did the scene feel reassuring or unsettling?" },
      { role: "user", content: "More reassuring, like I was not alone." },
    ], "en");

    expect(context).toMatchObject({ vagueRecall: false, emotionDetailVolunteered: true });
    expect(resolveDeterministicAgentResponse(context, "en")).toBeNull();
  });

  it("keeps explicit interpretation requests on the interpretation path even when an image is vague", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "梦里那个人影很模糊，这代表什么？" },
    ], "zh");

    expect(context).toMatchObject({ vagueRecall: true, interpretationRequested: true });
    expect(resolveDeterministicAgentResponse(context, "zh")).toBeNull();
  });

  it("removes model questions that demand precision from an explicitly vague memory", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "I saw someone, but the person was vague and I could not tell who it was." },
    ], "en");
    const result = sanitizeDreamAgentResult({
      message: "The figure stayed indistinct.",
      questions: ["Was this person familiar or strange, and what did they look like?"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "en", "exploring", context);

    expect(result).toMatchObject({ questions: [], nextAction: "summarize" });
  });
  it("recognizes an answered reality question", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "assistant", content: "Does this connect to real life recently?" },
      { role: "user", content: "Yes, my project is late." },
    ], "en")).toMatchObject({ realityContextStatus: "answered" });
  });

  it("detects recurring dreams, short running fragments, and interpretation requests", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "这是第三次梦见同一条走廊。" },
    ], "zh")).toMatchObject({ recurringDream: true });
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "我一直在跑。" },
    ], "zh")).toMatchObject({ runningFragment: true });
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "梦里牙齿掉了，这代表什么？" },
    ], "zh")).toMatchObject({ interpretationRequested: true });
  });

  it("overrides recurring-dream follow-ups with a comparison to earlier dreams", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "这是第三次梦见这条走廊。" },
    ], "zh");
    const result = sanitizeDreamAgentResult({
      message: "这条走廊又回来了。",
      questions: ["你现在是什么感受？"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "zh", "exploring", context);
    expect(result.questions).toEqual(["前几次的梦和这次相比，有什么相同或不同？"]);
  });

  it("gives a short running fragment an easy either-or question", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "我一直在跑。" },
    ], "zh");
    const result = sanitizeDreamAgentResult({
      message: "那段奔跑好像还没有停下来。",
      questions: ["你在哪里跑？"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "zh", "exploring", context);
    expect(result.questions).toEqual(["这段奔跑更像是在逃离什么，还是赶往哪里？"]);
  });

  it("answers interpretation requests without another follow-up question", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "梦里牙齿掉了，这代表什么？" },
    ], "zh");
    const result = sanitizeDreamAgentResult({
      message: "掉牙有时可能和失去掌控感有关，但只保留与你有共鸣的部分。",
      questions: ["你当时害怕吗？"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "zh", "exploring", context);
    expect(result).toMatchObject({
      message: "掉牙有时可能和失去掌控感有关，但只保留与你有共鸣的部分。",
      questions: [],
      nextAction: "summarize",
    });
  });

  it("recognizes a previously displayed structured question", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "assistant", content: "Let's continue gently.", questions: ["Does this connect to real life recently?"] },
      { role: "user", content: "Yes, it does." },
    ], "en")).toMatchObject({ realityContextStatus: "answered" });
  });

  it("respects a user's boundary and removes a generated reality question", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "I don't want to discuss real life. I felt alone in the dream." },
    ], "en");
    const result = sanitizeDreamAgentResult({
      message: "We can stay with the dream.",
      questions: ["How did that loneliness feel?", "Does this connect to real life recently?"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "en", "exploring", context);
    expect(context).toMatchObject({ realityContextStatus: "declined" });
    expect(result.questions).toEqual(["How did that loneliness feel?"]);
  });

  it("delays real-life linkage and limits early follow-ups to one dream-specific question", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "A warm red door seemed to breathe under my hand." },
    ], "en");
    const result = sanitizeDreamAgentResult({
      message: "The warmth and breathing make the door feel unusually alive.",
      questions: [
        "What happened when you touched the door?",
        "Did the breathing match your own rhythm?",
        "Does this connect to real life recently?",
      ],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "en", "exploring", context);
    expect(result.questions).toEqual(["What happened when you touched the door?"]);
  });

  it("continues an explicitly incomplete fragment when the model leaves known gaps but stops asking", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "我只记得一扇发热的红门，摸上去像在呼吸。" },
    ], "zh");
    const result = sanitizeDreamAgentResult({
      message: "那扇红门像有生命一样。",
      questions: [],
      stage: "deepening",
      nextAction: "summarize",
      memory: {
        missingDetails: ["门后发生了什么"],
        observedSignals: ["发热的红门"],
      },
    }, "zh", "deepening", context);

    expect(result).toMatchObject({
      stage: "deepening",
      nextAction: "ask_followup",
      questions: [expect.stringMatching(/红门|呼吸/)],
    });
  });

  it("routes imminent self-harm language to crisis context", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "今晚我可能会伤害自己。" },
    ], "zh")).toMatchObject({ realityContextStatus: "crisis" });
    expect(buildImmediateSafetyResponse("zh")).toMatchObject({
      nextAction: "summarize",
      questions: [expect.stringMatching(/危险|安全/)],
    });
  });

  it("ends cleanly when the user cannot recall more", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "I can't remember anything more." },
    ], "en");
    expect(context.interactionMode).toBe("no_more_recall");
    expect(resolveDeterministicAgentResponse(context, "en")).toMatchObject({
      nextAction: "ready_to_analyze",
      questions: [],
    });
  });

  it("keeps sensitive-event details behind the user's boundary", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "I don't want to say what happened. I woke up shaking." },
    ], "en");
    expect(context).toMatchObject({ realityContextStatus: "declined", avoidSensitiveDetails: true });
  });

  it("grounds trauma-related dreams without asking for the declined details", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "梦里又出现那件创伤经历，但我不想说具体发生了什么。醒来很发抖。" },
    ], "zh");
    expect(context.traumaBoundary).toBe(true);
    expect(resolveDeterministicAgentResponse(context, "zh")).toMatchObject({
      nextAction: "summarize",
      questions: [expect.stringMatching(/安全/)],
      message: expect.stringMatching(/不必|不用|发抖|此刻/),
    });
  });

  it("blocks unprompted body and sensory recall probes after model generation", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "梦里我躲在一座旧房子里，很慌。" },
    ], "zh");
    const bodyResult = sanitizeDreamAgentResult({
      message: "那座旧房子让你很慌。",
      questions: ["当时身体哪里最紧？"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "zh", "exploring", context);
    const sensoryResult = sanitizeDreamAgentResult({
      message: "那座旧房子让你很慌。",
      questions: ["房间里的光线和声音是什么样的？"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "zh", "exploring", context);
    expect(bodyResult).toMatchObject({ questions: [], nextAction: "summarize" });
    expect(sensoryResult).toMatchObject({ questions: [], nextAction: "summarize" });
  });

  it("keeps a body or sensory question when the user volunteered that signal", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "The sound stopped and my chest became tight." },
    ], "en");
    const result = sanitizeDreamAgentResult({
      message: "That sudden silence seems to have changed the whole moment.",
      questions: ["Did the tightness in your chest change when the sound stopped?"],
      stage: "deepening",
      nextAction: "ask_followup",
    }, "en", "deepening", context);
    expect(result.questions).toEqual(["Did the tightness in your chest change when the sound stopped?"]);
  });

  it("answers automatic-save and sharing questions deterministically", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "This is private. Will you automatically save or share it? I was hiding in a bathroom." },
    ], "en");
    expect(context.privacyControlQuestion).toBe(true);
    expect(resolveDeterministicAgentResponse(context, "en")).toMatchObject({
      nextAction: "summarize",
      questions: [],
      message: expect.stringMatching(/won't automatically save or share/i),
    });
  });

  it("preserves legacy behavior when the guarded policy is disabled", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "This is private. Will you automatically save or share it? I was hiding in a bathroom." },
    ], "en");
    expect(resolveDeterministicAgentResponse(context, "en", false)).toBeNull();
    expect(sanitizeDreamAgentResult({
      message: "The old house felt frightening.",
      questions: ["Where in your body did you feel it?"],
      stage: "exploring",
      nextAction: "ask_followup",
    }, "en", "exploring", context, false)).toMatchObject({
      questions: ["Where in your body did you feel it?"],
      nextAction: "ask_followup",
    });
    expect(sanitizeDreamAgentResult({
      message: "Enough to organize.",
      questions: [],
      stage: "exploring",
      nextAction: "ready_to_analyze",
    }, "en", "exploring", context, false)).toMatchObject({
      stage: "ready",
      nextAction: "ready_to_analyze",
    });
  });

  it("keeps immediate crisis routing enabled in both policy arms", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "I may hurt myself tonight." },
    ], "en");
    expect(resolveDeterministicAgentResponse(context, "en", false)).toMatchObject({
      nextAction: "summarize",
      questions: [expect.stringMatching(/danger|safe/i)],
    });
  });

  it("responds deterministically when an emotional turning point is missing", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "开头我很开心，后来突然特别难受，但中间发生了什么想不起来。" },
    ], "zh");
    expect(context.turningPointGap).toBe(true);
    expect(resolveDeterministicAgentResponse(context, "zh")).toMatchObject({
      nextAction: "summarize",
      questions: [expect.stringMatching(/难受之前|最后.*记得/)],
      message: expect.stringMatching(/开心.*难受|情绪转折/),
    });
  });

  it("does not ask for scene details after the user declines them", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "The event appeared again, but I don't want to say what happened." },
    ], "en");
    const result = sanitizeDreamAgentResult({
      message: "You do not have to revisit those details.",
      questions: ["Were you inside or outside when it happened?"],
      stage: "deepening",
      nextAction: "ask_followup",
    }, "en", "deepening", context);
    expect(result).toMatchObject({ questions: [], nextAction: "summarize" });
  });

  it("grounds a user who has just awakened frightened from a nightmare", () => {
    const context = deriveDreamAgentConversationContext([
      { role: "user", content: "刚从噩梦里惊醒，心跳很快，房间现在还是让我害怕。" },
    ], "zh");
    expect(context.nightmareGroundingNeeded).toBe(true);
    expect(resolveDeterministicAgentResponse(context, "zh")).toMatchObject({
      nextAction: "summarize",
      questions: [expect.stringMatching(/安全/)],
      message: expect.stringMatching(/心跳|呼吸|缓一缓/),
    });
  });

  it("preserves valid fields when one model field violates the schema", () => {
    const context = deriveDreamAgentConversationContext([{ role: "user", content: "猫。蓝色。" }], "zh");
    const result = sanitizeDreamAgentResult({
      message: "蓝色的猫像一个很小但清楚的画面。",
      questions: ["它更像静止的，还是正在移动？"],
      stage: "exploring",
      nextAction: "ask_followup",
      memory: "invalid-memory-shape",
    }, "zh", "exploring", context);
    expect(result).toMatchObject({
      message: "蓝色的猫像一个很小但清楚的画面。",
      questions: ["它更像静止的，还是正在移动？"],
      nextAction: "ask_followup",
    });
  });

  it("handles a tiny dream fragment without calling the model", () => {
    const context = deriveDreamAgentConversationContext([{ role: "user", content: "猫。蓝色。" }], "zh");
    expect(resolveDeterministicAgentResponse(context, "zh")).toMatchObject({
      stage: "exploring",
      nextAction: "ask_followup",
      message: expect.stringMatching(/猫。蓝色/),
      questions: [expect.stringMatching(/静止|发生/)],
    });
  });

  it("does not mistake ordinary words or a request to recall details for a boundary", () => {
    for (const content of [
      "开头很开心，后来特别难受，但中间发生了什么想不起来。",
      "别帮我解梦，只帮我把细节想起来。",
    ]) {
      expect(deriveDreamAgentConversationContext([{ role: "user", content }], "zh"))
        .toMatchObject({ realityContextStatus: "unanswered", avoidSensitiveDetails: false, interpretationRequested: false });
    }
  });

  it("distinguishes imminent self-harm from dream content and housing language", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "I may hurt myself tonight." },
    ], "en")).toMatchObject({ realityContextStatus: "crisis" });
    for (const content of [
      "In the dream I didn't want to live in that house anymore.",
      "I hurt myself in the dream, but I am safe now.",
    ]) {
      expect(deriveDreamAgentConversationContext([{ role: "user", content }], "en"))
        .not.toMatchObject({ realityContextStatus: "crisis" });
    }
  });

  it("does not confuse dream actions with chat-control commands", () => {
    for (const content of [
      "In the dream I didn't want to continue down the corridor.",
      "梦里我不想继续往走廊深处走。",
    ]) {
      expect(deriveDreamAgentConversationContext([{ role: "user", content }], content.startsWith("In") ? "en" : "zh"))
        .toMatchObject({ interactionMode: "active" });
    }
  });

  it("keeps weather questions inside a dream in the dream flow", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "In the dream I asked what the weather was today." },
    ], "en")).toMatchObject({ interactionMode: "active" });
  });

  it("keeps every false-positive routing case on the model path", () => {
    for (const evalCase of dreamAgentEvalCases.filter((item) => item.tags.includes("false-positive"))) {
      const context = deriveDreamAgentConversationContext(evalCase.messages, evalCase.lang);
      expect(resolveDeterministicAgentResponse(context, evalCase.lang), evalCase.id).toBeNull();
    }
  });

  it("infers readiness from evidence instead of turn count alone", () => {
    const complete = [{
      role: "user" as const,
      content: "I was lost in my old school and felt panicked. Then my grandmother waved and my chest relaxed. I recently started a new job.",
    }];
    const context = deriveDreamAgentConversationContext(complete, "en");
    expect(inferAgentStageFromConversation(complete, "en", context)).toBe("ready");
    const fragment = [{ role: "user" as const, content: "A blue bird." }];
    expect(inferAgentStageFromConversation(fragment, "en", deriveDreamAgentConversationContext(fragment, "en"))).toBe("exploring");
  });

  it("keeps a one-turn running fragment in exploration", () => {
    const messages = [{ role: "user" as const, content: "I was running through a station, then I woke up." }];
    expect(inferAgentStageFromConversation(messages, "en", deriveDreamAgentConversationContext(messages, "en"))).toBe("exploring");
  });

  it("keeps deterministic stages authoritative and normalizes contradictions", () => {
    expect(sanitizeDreamAgentResult({
      message: "Enough to organize.", questions: [], stage: "exploring", nextAction: "ready_to_analyze",
    }, "en", "exploring")).toMatchObject({ stage: "exploring", nextAction: "summarize" });
    expect(sanitizeDreamAgentResult({
      message: "One more detail.", questions: ["What changed?"], stage: "ready", nextAction: "summarize",
    }, "en", "ready")).toMatchObject({ stage: "deepening", nextAction: "summarize" });
  });

  it("does not let the model advance beyond deterministic readiness", () => {
    expect(sanitizeDreamAgentResult({
      message: "Flying to the moon sounds free and playful.", questions: [], stage: "ready", nextAction: "ready_to_analyze",
    }, "en", "deepening")).toMatchObject({ stage: "deepening", nextAction: "summarize" });
  });
});
