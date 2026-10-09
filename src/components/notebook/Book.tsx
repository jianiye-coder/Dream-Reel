"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// page edges: irregular striations, darker toward the outer side where the block curves away
function edgeTexture(outerLeft: boolean) {
  const w = 48, h = 4, c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return "none";
  for (let x = 0; x < w; x++) {
    const k = outerLeft ? 1 - x / (w - 1) : x / (w - 1);
    const tone = Math.max(120, 238 - Math.random() * 46 - (Math.random() < 0.16 ? 46 : 0) - Math.pow(k, 1.5) * 85);
    g.fillStyle = `rgb(${tone}, ${tone - 9}, ${tone - 24})`;
    g.fillRect(x, 0, 1, h);
  }
  return `url(${c.toDataURL()})`;
}

/* An open book lying on the desk: cloth boards, page blocks, spine crease, ribbon tail.
   Children are the two <BookPage>s (plus anything that should sit on the book, like a cover). */
export const Book = forwardRef<HTMLDivElement, {
  className?: string;
  ribbon?: boolean;
  pencil?: boolean;
  tilt?: boolean;
  children: React.ReactNode;
}>(function Book({ className, ribbon = true, pencil = false, tilt = true, children }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => el.current as HTMLDivElement);

  useEffect(() => {
    const root = document.documentElement.style;
    if (!root.getPropertyValue("--edge-l")) {
      root.setProperty("--edge-l", edgeTexture(true));
      root.setProperty("--edge-r", edgeTexture(false));
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
      {pencil && <div className="nb-pencil" />}
    </div>
  );
});

export function BookPage({ side, ruled, indent, folio, curl, className, padClassName, children, ...rest }: {
  side: "l" | "r";
  ruled?: boolean;
  indent?: boolean;
  folio?: string;
  curl?: boolean;
  className?: string;
  padClassName?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children">) {
  return (
    <section className={["nb-page", `nb-page-${side}`, ruled && "nb-ruled", className].filter(Boolean).join(" ")} {...rest}>
      <div className={["nb-pad", indent && "nb-indent", padClassName].filter(Boolean).join(" ")}>{children}</div>
      {folio && <span className="nb-folio">{folio}</span>}
      {curl && side === "r" && <span className="nb-curl" />}
    </section>
  );
}
