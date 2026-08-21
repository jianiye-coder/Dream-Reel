import { describe, expect, it } from "vitest";
import { buildDreamFollowUpAgentPrompt, buildImmediateSafetyResponse, deriveDreamAgentConversationContext, inferAgentStageFromConversation, resolveDeterministicAgentResponse, sanitizeDreamAgentResult } from "@/lib/dreamFollowUpAgent";
import { dreamAgentEvalCases } from "../../evals/dream-agent/cases";

describe("dream follow-up conversation context", () => {
  it("prioritizes accompaniment over extracting more dream details", () => {
    const prompt = buildDreamFollowUpAgentPrompt("zh", 1, "exploring", "");
    expect(prompt).toContain("让用户感到被听见、被在意、被温柔地接住");
    expect(prompt).toContain("可以不问任何问题");
    expect(prompt).toContain("不要追问精确身体部位、气味、光线、声音");
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

  it("normalizes contradictory ready actions and stages", () => {
    expect(sanitizeDreamAgentResult({
      message: "Enough to organize.", questions: [], stage: "exploring", nextAction: "ready_to_analyze",
    }, "en", "exploring")).toMatchObject({ stage: "ready", nextAction: "ready_to_analyze" });
    expect(sanitizeDreamAgentResult({
      message: "One more detail.", questions: ["What changed?"], stage: "ready", nextAction: "summarize",
    }, "en", "ready")).toMatchObject({ stage: "deepening", nextAction: "summarize" });
  });
});
