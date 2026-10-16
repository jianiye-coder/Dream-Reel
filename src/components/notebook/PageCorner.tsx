"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/* The right page's bottom corner as the way to turn it (BookPage `corner`).
   A small dog-ear at rest. Hovering lifts it (the paper's back curling over a soft shadow) and moving
   away lets it fall back; keyboard focus lifts it the same way. One click, tap or Enter/Space turns
   the page (`onTurn`). A touch has no hover, so a tap plays the lift quickly first and the turn still
   reads as a page being turned. With reduced motion there is no peel; a click still turns. */
export function PageCorner({ label, hint, onTurn, busy }: {
  /** accessible name, e.g. "翻到这一页 · 外婆家的走廊" */
  label: string;
  /** a red-ink note shown beside the corner while it has keyboard focus */
  hint: string;
  onTurn: () => void;
  busy?: boolean;
}) {
  // held up by a tap, for a moment before the turn (hover and focus lift it in CSS)
  const [lifted, setLifted] = useState(false);
  const touch = useRef(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  const turn = () => {
    // the turning sheet is a snapshot taken in onTurn: raise the corner in the DOM first,
    // so the sheet lifts from the raised corner (hover alone isn't copied into a snapshot)
    flushSync(() => setLifted(true));
    onTurn();
    setLifted(false);
  };

  return (
    <button
      type="button"
      className={`nb-corner${lifted ? " nb-lifted" : ""}`}
      aria-label={label}
      aria-disabled={busy || undefined}
      onPointerDown={(event) => { touch.current = event.pointerType !== "mouse"; }}
      onClick={(event) => {
        if (busy || timer.current !== null) return;
        const quick = touch.current && event.detail > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!quick) { turn(); return; }
        setLifted(true);
        timer.current = window.setTimeout(() => { timer.current = null; turn(); }, 220);
      }}
    >
      <span className="nb-curl" aria-hidden />
      <span className="nb-corner-hint" aria-hidden>{hint}</span>
    </button>
  );
}
