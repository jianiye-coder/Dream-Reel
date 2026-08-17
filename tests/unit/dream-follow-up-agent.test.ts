import { describe, expect, it } from "vitest";
import { buildImmediateSafetyResponse, deriveDreamAgentConversationContext, sanitizeDreamAgentResult } from "@/lib/dreamFollowUpAgent";

describe("dream follow-up conversation context", () => {
  it("recognizes an answered reality question", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "assistant", content: "Does this connect to real life recently?" },
      { role: "user", content: "Yes, my project is late." },
    ], "en")).toEqual({ realityContextStatus: "answered" });
  });

  it("recognizes a previously displayed structured question", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "assistant", content: "Let's continue gently.", questions: ["Does this connect to real life recently?"] },
      { role: "user", content: "Yes, it does." },
    ], "en")).toEqual({ realityContextStatus: "answered" });
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
    expect(context).toEqual({ realityContextStatus: "declined" });
    expect(result.questions).toEqual(["How did that loneliness feel?"]);
  });

  it("routes imminent self-harm language to crisis context", () => {
    expect(deriveDreamAgentConversationContext([
      { role: "user", content: "今晚我可能会伤害自己。" },
    ], "zh")).toEqual({ realityContextStatus: "crisis" });
    expect(buildImmediateSafetyResponse("zh")).toMatchObject({
      nextAction: "summarize",
      questions: [expect.stringMatching(/危险|安全/)],
    });
  });
});
