import { describe, expect, it } from "vitest";
import { buildImmediateSafetyResponse, deriveDreamAgentConversationContext, resolveDeterministicAgentResponse, sanitizeDreamAgentResult } from "@/lib/dreamFollowUpAgent";

describe("dream follow-up conversation context", () => {
  it("recognizes an answered reality question", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "assistant", content: "Does this connect to real life recently?" },
      { role: "user", content: "Yes, my project is late." },
    ], "en")).toMatchObject({ realityContextStatus: "answered" });
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
        .toMatchObject({ realityContextStatus: "unanswered", avoidSensitiveDetails: false });
    }
  });
});
