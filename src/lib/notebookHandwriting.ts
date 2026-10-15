"use client";

import { writeChar } from "@/lib/notebookSound";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Write text into an element one character at a time, in fountain-pen ink with its sound, like someone half-awake:
    pauses between thoughts, and a word crossed out when `strike` is set. */
export async function handwrite(
  el: HTMLElement,
  parts: { text: string; strike?: boolean; pause?: number }[],
  { speed = 1, cancelled = () => false }: { speed?: number; cancelled?: () => boolean } = {},
) {
  const caret = document.createElement("span");
  caret.className = "nb-caret";
  el.appendChild(caret);
  for (const part of parts) {
    if (cancelled()) return;
    if (part.pause) await sleep(part.pause);
    const node = document.createElement("span");
    if (part.strike) node.className = "nb-struck";
    el.insertBefore(node, caret);
    for (const ch of part.text) {
      if (cancelled()) return;
      // each character lands wet and dries into the page (.nb-wet)
      const glyph = document.createElement("span");
      glyph.className = "nb-wet";
      glyph.textContent = ch;
      node.appendChild(glyph);
      const d = writeChar(ch);
      await sleep((Math.max(d * 1000, 40) + 40 + Math.random() * 70) / speed);
    }
    await sleep(180 / speed);
  }
}
