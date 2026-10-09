"use client";

import { writeChar } from "@/lib/notebookSound";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Write text into an element one character at a time, with pencil sound, like someone half-awake:
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
    const node: Text | HTMLSpanElement = part.strike ? document.createElement("span") : document.createTextNode("");
    if (part.strike) (node as HTMLSpanElement).className = "nb-struck";
    el.insertBefore(node, caret);
    for (const ch of part.text) {
      if (cancelled()) return;
      if (node instanceof Text) node.data += ch;
      else node.textContent += ch;
      const d = writeChar(ch);
      await sleep((Math.max(d * 1000, 40) + 40 + Math.random() * 70) / speed);
    }
    await sleep(180 / speed);
  }
}
