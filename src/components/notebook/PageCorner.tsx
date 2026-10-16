"use client";

import { useEffect, useRef, useState } from "react";
import { tap } from "@/lib/notebookSound";

/* The right page's bottom corner as the way to turn it (BookPage `corner`).
   Hovering lifts it a hair; the first click or tap lifts it clearly, the paper's back showing over
   a soft shadow; clicking the lifted corner turns the page (`onTurn`). A click anywhere else or
   Escape lets it fall back; give it a `key` so it also falls back when the page shows something else.
   From the keyboard one press turns the page: focus already lifts the corner a hair and writes what
   it does beside it, so a second press would only hide the action. */
export function PageCorner({ label, hint, onTurn, busy }: {
  /** accessible name, e.g. "翻到这一页 · 外婆家的走廊" */
  label: string;
  /** a red-ink note shown beside the corner while it has keyboard focus */
  hint: string;
  onTurn: () => void;
  busy?: boolean;
}) {
  const [lifted, setLifted] = useState(false);
  const el = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!lifted) return;
    const away = (event: PointerEvent) => { if (!el.current?.contains(event.target as Node)) setLifted(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setLifted(false); };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", key);
    return () => { removeEventListener("pointerdown", away, true); removeEventListener("keydown", key); };
  }, [lifted]);

  return (
    <button
      ref={el}
      type="button"
      className={`nb-corner${lifted ? " nb-lifted" : ""}`}
      aria-label={label}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (busy) return;
        // a keyboard press (no pointer, detail 0) or a click on the lifted corner turns the page
        // (the turning sheet is a snapshot taken in onTurn, so it still lifts from the raised corner)
        if (event.detail === 0 || lifted) { onTurn(); setLifted(false); return; }
        tap();
        setLifted(true);
      }}
    >
      <span className="nb-curl" aria-hidden />
      <span className="nb-corner-hint" aria-hidden>{hint}</span>
    </button>
  );
}
