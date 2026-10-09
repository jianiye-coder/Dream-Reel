"use client";

import { buildConsultationNotes, type DreamConversationGoal } from "@/lib/dreamSupport";

interface Props {
  goal: DreamConversationGoal;
  onGoalChange: (goal: DreamConversationGoal) => void;
  disabled: boolean;
  lang: "zh" | "en";
  date: string;
  statements: string[];
}

export function DreamConversationControls({ goal, onGoalChange, disabled, lang, date, statements }: Props) {
  const zh = lang === "zh";
  const notes = buildConsultationNotes(statements, date, lang);
  function downloadNotes() {
    const url = URL.createObjectURL(new Blob([notes], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `dream-reel-consultation-${date}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="dream-conversation-controls" aria-label={zh ? "对话方向" : "Conversation focus"}>
      <fieldset className="dream-conversation-goals" disabled={disabled}>
        <legend className="sr-only">{zh ? "对话方向" : "Conversation focus"}</legend>
        {(["recall", "support"] as const).map((value) => (
          <label key={value} className={goal === value ? "conversation-goal selected" : "conversation-goal"}>
            <input type="radio" name="conversationGoal" value={value} checked={goal === value} onChange={() => onGoalChange(value)} />
            <span>{value === "recall" ? (zh ? "回忆梦境" : "Dream recall") : (zh ? "情绪支持" : "Emotional support")}</span>
          </label>
        ))}
      </fieldset>
      {goal === "support" && (
        <>
          <p className="conversation-boundary" role="note">
            {zh ? "AI 情绪支持，不是心理治疗或诊断。文字会自动保存；不会自动分享给医生。" : "AI emotional support, not therapy or diagnosis. Text autosaves; nothing is automatically shared with a clinician."}
          </p>
          {statements.length > 0 && (
            <details className="consultation-notes">
              <summary>{zh ? "咨询准备记录" : "Consultation notes"}</summary>
              <textarea readOnly aria-label={zh ? "咨询准备记录预览" : "Consultation notes preview"} value={notes} rows={8} />
              <button type="button" className="mist-button-secondary" onClick={downloadNotes}>
                {zh ? "下载个人记录" : "Download personal notes"}
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
