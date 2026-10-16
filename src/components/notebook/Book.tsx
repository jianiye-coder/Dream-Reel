"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/* The page block under each page: one stack of sheets whose edges show as irregular striations,
   darker toward the outside where the block curves down to the board. Each sheet keeps its tone
   all the way round: down the fore-edge (the strip), round the corner (concentric arcs) and along
   the head and tail (a thin band), so the top page sits on the stack instead of beside it.
   Geometry in CSS px; keep in step with .nb-edges / .nb-page-l / .nb-page-r in notebook.css:
   w = fore-edge band (page edge → stack edge), h = how far the stack steps out at head and tail,
   a × b = the top page's corner radius. The stack's corner radius is (a + w) × (b + h). */
const EDGE = { l: { w: 18, sheets: 34 }, r: { w: 26, sheets: 48 }, h: 2, a: 5, b: 18 };

function edgeTextures(): Record<string, string> {
  const K = 4; // canvas px per CSS px, so the arcs stay crisp under the lean zoom
  const out: Record<string, string> = {};
  const canvas = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = Math.round(w);
    c.height = Math.round(h);
    return [c, c.getContext("2d")] as const;
  };
  for (const side of ["l", "r"] as const) {
    const { w, sheets: n } = EDGE[side];
    // tone of sheet j, counted from the top page outward: lighter by the page, darker outside
    const tones = Array.from({ length: n }, (_, j) => {
      const k = j / (n - 1);
      return Math.round(Math.max(118, 228 - Math.random() * 32 - (Math.random() < 0.16 ? 34 : 0) - Math.pow(k, 1.4) * 84));
    });
    const rgb = (t: number) => `rgb(${t}, ${t - 9}, ${t - 23})`;

    // the fore-edge: one column per sheet, the top page's side first
    const [strip, sg] = canvas(n, 1);
    if (!sg) return {};
    tones.forEach((t, j) => { sg.fillStyle = rgb(t); sg.fillRect(side === "r" ? j : n - 1 - j, 0, 1, 1); });
    out[`--edge-${side}`] = `url(${strip.toDataURL()})`;

    // the corners: each sheet's edge turns round the corner, as a quarter ellipse
    const cw = EDGE.a + w, ch = EDGE.b + EDGE.h;
    for (const end of ["top", "bot"] as const) {
      const [c, g] = canvas(cw * K, ch * K);
      if (!g) return {};
      g.setTransform(side === "r" ? K : -K, 0, 0, end === "top" ? K : -K, side === "r" ? 0 : cw * K, end === "top" ? 0 : ch * K);
      for (let j = n - 1; j >= 0; j--) {
        const t = (j + 1) / n;
        g.beginPath();
        g.moveTo(0, ch);
        g.ellipse(0, ch, EDGE.a + w * t, EDGE.b + EDGE.h * t, 0, -Math.PI / 2, 0);
        g.closePath();
        g.fillStyle = rgb(tones[j]);
        g.fill();
      }
      out[`--edge-${side}-${end}`] = `url(${c.toDataURL()})`;
    }

    // head and tail: the same sheets, seen as a thin band along the top page
    for (const end of ["head", "tail"] as const) {
      const [band, bg] = canvas(1, EDGE.h * K);
      if (!bg) return {};
      for (let y = 0; y < EDGE.h * K; y++) {
        const j = n - 1 - Math.floor((y / (EDGE.h * K)) * n); // outermost sheet at the band's outer edge
        bg.fillStyle = rgb(tones[j]);
        bg.fillRect(0, end === "head" ? y : EDGE.h * K - 1 - y, 1, 1);
      }
      out[`--edge-${side}-${end}`] = `url(${band.toDataURL()})`;
    }
  }
  return out;
}

/* An open book lying on the desk: cloth boards, page blocks, spine crease, ribbon tail.
   Children are the two <BookPage>s (plus anything that should sit on the book, like a cover). */
export const Book = forwardRef<HTMLDivElement, {
  className?: string;
  ribbon?: boolean;
  pen?: boolean;
  tilt?: boolean;
  children: React.ReactNode;
}>(function Book({ className, ribbon = true, pen = false, tilt = true, children }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => el.current as HTMLDivElement);

  useEffect(() => {
    const root = document.documentElement.style;
    if (!root.getPropertyValue("--edge-r-top")) {
      for (const [name, value] of Object.entries(edgeTextures())) root.setProperty(name, value);
    }
  }, []);

  useEffect(() => {
    const book = el.current;
    if (!book || !tilt || matchMedia("(max-width: 900px), (prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // barely there: the book should feel lying still, just alive
        book.style.setProperty("--ry", ((e.clientX / innerWidth - 0.5) * 1.2).toFixed(2) + "deg");
        book.style.setProperty("--rx", ((e.clientY / innerHeight - 0.5) * -1).toFixed(2) + "deg");
      });
    };
    addEventListener("pointermove", move);
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, [tilt]);

  return (
    <div ref={el} className={["nb-book", className].filter(Boolean).join(" ")}>
      <div className="nb-board nb-l" /><div className="nb-board nb-r" />
      <div className="nb-edges nb-l" /><div className="nb-edges nb-r" />
      {children}
      <div className="nb-spine" />
      {ribbon && <div className="nb-ribbon" />}
      {pen && <div className="nb-pen" />}
    </div>
  );
});

export function BookPage({ side, ruled, indent, folio, curl, corner, className, padClassName, padInert, children, ...rest }: {
  side: "l" | "r";
  ruled?: boolean;
  indent?: boolean;
  folio?: string;
  /** the bottom corner lifts a little when the page is hovered: an invitation to turn */
  curl?: boolean;
  /** the bottom corner as a control instead (a <PageCorner>), set at the page's corner, outside the padding */
  corner?: React.ReactNode;
  className?: string;
  padClassName?: string;
  /** the page's content can't be reached for now (e.g. hidden while the page turns over) */
  padInert?: boolean;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children">) {
  return (
    <section className={["nb-page", `nb-page-${side}`, ruled && "nb-ruled", className].filter(Boolean).join(" ")} {...rest}>
      <div className={["nb-pad", indent && "nb-indent", padClassName].filter(Boolean).join(" ")} inert={padInert || undefined}>{children}</div>
      {folio && <span className="nb-folio" aria-hidden>{folio}</span>}
      {curl && !corner && side === "r" && <span className="nb-curl" aria-hidden />}
      {corner}
    </section>
  );
}
