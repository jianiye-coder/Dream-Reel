import { describe, expect, it } from "vitest";
import { deriveDreamAgentConversationContext } from "@/lib/dreamFollowUpAgent";
import { buildConsultationNotes, buildDreamSupportPrompt, parseDreamSupportResponse, resolveDreamSupportResponse } from "@/lib/dreamSupport";

describe("emotional support journaling", () => {
  it.each(["zh", "en"] as const)("sets non-diagnostic, non-suggestive boundaries for %s", (lang) => {
    const prompt = buildDreamSupportPrompt(lang, "");
    expect(prompt).toContain("not a therapist or medical professional");
    expect(prompt).toContain("No dream recall is required");
    expect(prompt).toContain("Dreams cannot establish a mental or physical diagnosis");
    expect(prompt).toContain("Ask permission");
    expect(prompt).toContain("affect sleep or daily life");
    expect(prompt).toContain("severe waking physical symptoms");
    expect(prompt).toContain("never press for trauma details");
  });

  it.each([
    ["en", "I cannot remember anything more, but want to talk about how I feel."],
    ["zh", "我想不起来更多，但想聊聊醒来后的感受。"],
  ] as const)("does not force analysis when recall runs out (%s)", (lang, content) => {
    const context = deriveDreamAgentConversationContext([{ role: "user", content }], lang);
    expect(context.interactionMode).toBe("no_more_recall");
    expect(resolveDreamSupportResponse(context, lang)).toBeNull();
  });

  it.each([["en", "I may hurt myself tonight."], ["zh", "我今晚想伤害自己。"]] as const)("prioritizes real-world safety (%s)", (lang, content) => {
    const result = resolveDreamSupportResponse(deriveDreamAgentConversationContext([{ role: "user", content }], lang), lang);
    expect(result?.nextAction).toBe("summarize");
    expect(result?.message).toMatch(/emergency|急救/);
  });

  it("respects stopping and trauma boundaries without requiring analysis", () => {
    const stop = resolveDreamSupportResponse(deriveDreamAgentConversationContext([{ role: "user", content: "Please stop here." }], "en"), "en");
    expect(stop).toMatchObject({ nextAction: "summarize", questions: [] });
    const trauma = resolveDreamSupportResponse(deriveDreamAgentConversationContext([{ role: "user", content: "I had a traumatic dream but do not want to describe details." }], "en"), "en");
    expect(trauma?.message).toContain("do not need to describe");
    expect(trauma?.questions).toHaveLength(1);
  });

  it("does not promise that autosaved text is never stored", () => {
    const result = resolveDreamSupportResponse(deriveDreamAgentConversationContext([{ role: "user", content: "Will you automatically save this?" }], "en"), "en");
    expect(result?.message).toContain("autosaves");
    expect(result?.message).toContain("not automatically sent");
  });

  it("keeps support separate from readiness and discards inferred clinical memory", () => {
    const result = parseDreamSupportResponse(JSON.stringify({ message: "That sounds difficult.", questions: [], stage: "ready", nextAction: "ready_to_analyze", memory: { observedSignals: ["diagnosis"] } }), "en");
    expect(result).toMatchObject({ stage: "deepening", nextAction: "summarize", memory: { observedSignals: [] } });
  });

  it.each(["raw unstructured advice", "{}", JSON.stringify({ message: "Hello", questions: ["One?", "Two?"] })])("does not show malformed model output", (raw) => {
    const result = parseDreamSupportResponse(raw, "en");
    expect(result.message).toContain("did not come through correctly");
    expect(result.questions).toEqual([]);
  });

  it("exports attributed self-report rather than invented clinical findings", () => {
    const result = buildConsultationNotes(["I only remember feeling worried.", ""], "2026-09-15", "en");
    expect(result).toContain("1. I only remember feeling worried.");
    expect(result).toContain("not clinically verified");
    expect(result).toContain("AI interpretations are excluded");
    expect(result).toContain("Frequency and duration:\n");
  });
});
