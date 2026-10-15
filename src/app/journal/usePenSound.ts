"use client";

import { useMemo, useRef } from "react";
import { writeChar } from "@/lib/notebookSound";

/* The sound of the pen while someone types into a writing field.
   - Only committed characters make a sound: while an IME is composing (pinyin, kana…) nothing
     plays, and the whole committed phrase is written out when composition ends.
   - Strokes never stack: a new character waits until the previous one has (mostly) finished,
     so fast typing sounds like quick writing rather than a burst of noise.
   notebookSound already honours the reader's sound switch and the autoplay unlock. */
export function usePenSound() {
  const composing = useRef(false);
  const busyUntil = useRef(0);

  return useMemo(() => {
    function write(text: string | null | undefined) {
      if (!text) return;
      const now = performance.now();
      if (now < busyUntil.current) return;
      // a pasted or committed phrase: write its first few characters, one after another
      const chars = [...text].filter((ch) => !/\s/.test(ch)).slice(0, 4);
      let offset = 0;
      for (const ch of chars) offset += writeChar(ch, offset) * 0.85;
      if (offset > 0) busyUntil.current = now + Math.min(offset * 1000, 420) * 0.7;
    }

    return {
      onCompositionStart() { composing.current = true; },
      onCompositionEnd(e: React.CompositionEvent<HTMLElement>) {
        composing.current = false;
        write(e.data);
      },
      /** call from onChange */
      onInput(e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) {
        const native = e.nativeEvent as InputEvent;
        if (composing.current || native.isComposing) return;
        const type = native.inputType ?? "";
        // composition text is handled at compositionend; deletions and line breaks are silent
        if (!type.startsWith("insert") || type.includes("Composition")) return;
        // a paste carries no data on text fields: one short stroke, not the whole passage
        write(type === "insertFromPaste" || type === "insertFromDrop" ? (native.data ?? "一") : native.data);
      },
    };
  }, []);
}
