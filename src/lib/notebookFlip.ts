"use client";

import { pageTurn } from "@/lib/notebookSound";

/* The turning page. The right page is cut into vertical strips; each strip hangs off the
   previous one, so a small rotation per strip bends the sheet. Early in the turn the outer
   edge leads (you lifted it), later it trails (air holds it back). Works on a DOM snapshot,
   so React state underneath can change freely while the sheet is in the air. */
export function flipPage(book: HTMLElement, { back, dur = 850, onStart, onEnd }: {
  back?: HTMLElement | null;
  dur?: number;
  onStart?: () => void;
  onEnd?: () => void;
} = {}) {
  const right = book.querySelector<HTMLElement>(".nb-page-r");
  if (!right || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onStart?.();
    onEnd?.();
    return;
  }
  const W = right.offsetWidth, H = right.offsetHeight, N = 14, sw = W / N;
  const wrap = document.createElement("div");
  wrap.className = "nb-flip";
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = `left:${right.offsetLeft}px;top:${right.offsetTop}px;width:${W}px;height:${H}px;`;

  const front = right.cloneNode(true) as HTMLElement;
  front.querySelectorAll("textarea,input,button,a,[tabindex]").forEach((el) => el.setAttribute("tabindex", "-1"));
  front.querySelector(".nb-curl")?.remove();

  const segs: { seg: HTMLElement; fShade: HTMLElement; bShade: HTMLElement }[] = [];
  let parent: HTMLElement = wrap;
  for (let i = 0; i < N; i++) {
    const seg = document.createElement("div");
    seg.className = "nb-seg";
    seg.style.cssText = `left:${i === 0 ? 0 : sw}px;width:${sw + 2.5}px;`;
    const f = document.createElement("div");
    f.className = "nb-face";
    const fs = document.createElement("div");
    fs.className = "nb-slice";
    fs.style.cssText = `left:${-i * sw}px;width:${W}px;`;
    fs.appendChild(front.cloneNode(true));
    const fShade = document.createElement("i");
    fShade.className = "nb-shade";
    f.append(fs, fShade);

    const b = document.createElement("div");
    b.className = "nb-face nb-back";
    if (back) {
      const bs = document.createElement("div");
      bs.className = "nb-slice";
      bs.style.cssText = `left:${-(N - 1 - i) * sw}px;width:${W}px;`;
      bs.appendChild(back.cloneNode(true));
      b.appendChild(bs);
    }
    const bShade = document.createElement("i");
    bShade.className = "nb-shade";
    b.appendChild(bShade);

    seg.append(f, b);
    parent.appendChild(seg);
    segs.push({ seg, fShade, bShade });
    parent = seg;
  }
  const shR = document.createElement("div");
  shR.className = "nb-flip-shadow nb-r";
  const shL = document.createElement("div");
  shL.className = "nb-flip-shadow nb-l";
  book.append(shR, shL, wrap);
  onStart?.();

  const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  // light falls from above: the more upright the paper stands, the darker it reads
  const shadeAt = (a: number, isFront: boolean) => {
    const x = Math.max(0, Math.min(180, a));
    const up = Math.sin(x * Math.PI / 180);
    return isFront ? (x < 90 ? up * 0.36 : 0.36) : (x >= 90 ? up * 0.32 : 0.32);
  };
  const t0 = performance.now();
  const frame = (now: number) => {
    const p = Math.min((now - t0) / dur, 1), e = ease(p);
    const bend = 62 * Math.sin(Math.PI * 2 * Math.min(p * 1.05, 1)) * (1 - p * 0.35);
    const root = Math.max(0, Math.min(180, 180 * e - bend * 0.45));
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const r = i === 0 ? root : (bend / N) * 2 * k;
      acc += r;
      const next = i < N - 1 ? acc + (bend / N) * 2 * ((i + 1) / (N - 1)) : acc;
      segs[i].seg.style.transform = `rotateY(${-r}deg)`;
      segs[i].fShade.style.background = `linear-gradient(90deg, rgba(43,29,13,${shadeAt(acc, true).toFixed(3)}), rgba(43,29,13,${shadeAt(next, true).toFixed(3)}))`;
      segs[i].bShade.style.background = `linear-gradient(270deg, rgba(43,29,13,${shadeAt(acc, false).toFixed(3)}), rgba(43,29,13,${shadeAt(next, false).toFixed(3)}))`;
    }
    shR.style.opacity = (Math.sin(Math.PI * Math.min(p / 0.55, 1)) * 0.9).toFixed(3);
    shL.style.opacity = (p > 0.5 ? Math.sin(Math.PI * (p - 0.5) / 0.5) * 0.7 : 0).toFixed(3);
    if (p < 1) requestAnimationFrame(frame);
    else { onEnd?.(); wrap.remove(); shR.remove(); shL.remove(); }
  };
  requestAnimationFrame(frame);
  pageTurn({ dur: dur / 1000 });
}
