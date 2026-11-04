"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { Translations } from "@/lib/i18n";
import css from "./darkroom.module.css";

type RoomCopy = Translations["journal"]["nb"]["room"];

export type DarkroomAction = { label: string; onClick: () => void; disabled?: boolean; primary?: boolean };

type Props = {
  t: RoomCopy;
  imageUrl: string | null;
  generating: boolean;
  error: string;
  caption: string;
  fragments: string[];
  /** shown once the print hangs on the line */
  actions: DarkroomAction[];
  note?: string;
  alert?: string;
  /** shown when the print didn't come up */
  failureActions: DarkroomAction[];
  onClose: () => void;
};

// how many times this reader has stood in the darkroom; "skip" appears from the second time
const SEEN_KEY = "dreamReel_darkroomSeen";
// the easel, then the four trays, left to right on the bench (px, before --s scaling)
const SLOTS = [0, 400, 800, 1200, 1600];
// a white print, as the safelight shows it: no colour can be seen by it
const SAFELIGHT = [0.92 * 0.8, 0.74 * 0.8, 0.56 * 0.8];

/**
 * A print developing: each tone has its own induction time. Shadows (high final density) show
 * first, mid-tones follow, highlights last, and density keeps building toward full contrast.
 * Returns the feComponentTransfer table mapping a pixel's luminance to its grey at time t (0..1).
 */
function developTable(t: number): string {
  const values: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const lum = i / 20;
    const s = Math.min(1, Math.max(0, (t - lum * 0.62) / 0.38));
    const density = (1 - lum) * (1 - Math.pow(1 - s, 2.4)) * 0.97;
    values.push((1 - density).toFixed(3));
  }
  return values.join(" ");
}

function readSeen(): number {
  try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; }
}
function markSeen(count: number) {
  try { localStorage.setItem(SEEN_KEY, String(count)); } catch { /* private mode: skip just never shows */ }
}

/**
 * The darkroom, as a full ceremony: the enlarger exposes the paper, the print rocks in the
 * developer until the image arrives and comes up out of the white, then stop, fixer, lights on
 * for the wash, and it hangs on the line to dry. Mounted fresh for each print (the page keys it);
 * opened on a print that already exists, it goes straight to the line.
 */
export function Darkroom({ t, imageUrl, generating, error, caption, fragments, actions, note, alert, failureActions, onClose }: Props) {
  const filterId = `develop-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  // decided once per mount: a print being made now gets the ceremony
  const [ceremony] = useState(() => generating);
  const [seen] = useState(() => (ceremony ? readSeen() : 0));
  const [canSkip, setCanSkip] = useState(seen >= 1);
  const [stage, setStage] = useState(ceremony ? -1 : 5);
  const [slot, setSlot] = useState(0);
  const [beam, setBeam] = useState(false);
  const [lifted, setLifted] = useState(false);
  const [agitating, setAgitating] = useState(false);
  const [lights, setLights] = useState(!ceremony);
  const [hung, setHung] = useState(!ceremony);
  const [written, setWritten] = useState(!ceremony);
  const [done, setDone] = useState(!ceremony);

  const funcRefs = useRef<(SVGFEFuncRElement | SVGFEFuncGElement | SVGFEFuncBElement | null)[]>([]);
  const colourRef = useRef<SVGImageElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const latest = useRef({ imageUrl, generating, error });
  useEffect(() => { latest.current = { imageUrl, generating, error }; }, [imageUrl, generating, error]);
  const skipRef = useRef(false);
  const markedRef = useRef(false);
  const wakeRef = useRef(new Set<() => void>());

  // only this print's failure counts: an old error must not stand in front of a print that exists
  const failed = !!error && !generating && (ceremony || !imageUrl);

  useEffect(() => {
    if (!ceremony) return;
    let cancelled = false;
    // once per print, though StrictMode runs this effect twice in development
    if (!markedRef.current) { markedRef.current = true; markSeen(seen + 1); }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) skipRef.current = true;

    const wake = wakeRef.current;
    // a pause that cleanup (and, for beat, skip) can cut short
    const pause = (ms: number) => new Promise<void>((resolve) => {
      const end = () => { clearTimeout(timer); wake.delete(end); resolve(); };
      const timer = setTimeout(end, ms);
      wake.add(end);
    });
    const ready = () => !!latest.current.imageUrl && !latest.current.generating && !latest.current.error;
    // skipped, or the print didn't come up: no more motion either way
    const stopped = () => cancelled || skipRef.current || !!latest.current.error;
    const beat = (ms: number) => (stopped() ? Promise.resolve() : pause(ms));
    const paint = (dev: number, light: number) => {
      const table = developTable(dev);
      funcRefs.current.forEach((f) => f?.setAttribute("tableValues", table));
      if (colourRef.current) colourRef.current.style.opacity = String(light);
    };
    const animate = (ms: number, frame: (k: number) => void) => new Promise<void>((resolve) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (stopped()) return resolve();
        const k = Math.min(1, (now - t0) / ms);
        frame(k);
        if (k < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    const moveTo = async (next: number) => {
      setAgitating(false); setLifted(true);
      await beat(350); if (stopped()) return;
      setSlot(next);
      await beat(1300); if (stopped()) return;
      setLifted(false); setAgitating(true);
    };
    const waitForImage = async () => {
      while (!cancelled && !ready() && !latest.current.error) await pause(250);
    };
    // decode before developing, so the curve isn't half over when the pixels arrive (capped at 4 s)
    const preload = (url: string) => new Promise<void>((resolve) => {
      const img = new window.Image();
      const timer = setTimeout(resolve, 4000);
      img.onload = img.onerror = () => { clearTimeout(timer); resolve(); };
      img.src = url;
    });
    // skipped or failed: settle in the developer, then hang the print the moment it exists
    const settle = async () => {
      setBeam(false); setLifted(false); setSlot((s) => Math.max(s, 1)); setStage((s) => Math.max(s, 1));
      setAgitating(!latest.current.error);
      await waitForImage();
      if (cancelled) return;
      if (!ready()) { setAgitating(false); return; }   // didn't come up: the page says why
      paint(1, 1);
      setAgitating(false); setStage(5); setLights(true); setHung(true); setWritten(true); setDone(true);
    };

    (async () => {
      paint(0, 0);
      await beat(700); if (cancelled) return; if (stopped()) return settle();
      setStage(0); setBeam(true);
      await beat(2200); setBeam(false);
      await beat(500); if (cancelled) return; if (stopped()) return settle();
      setStage(1); await moveTo(1); if (cancelled) return; if (stopped()) return settle();
      // the print stays in the developer, rocking, for as long as the image takes to arrive
      await waitForImage(); if (cancelled) return; if (stopped()) return settle();
      await preload(latest.current.imageUrl as string); if (cancelled) return; if (stopped()) return settle();

      await animate(6500, (k) => paint(k, 0)); if (cancelled) return; if (stopped()) return settle();
      setStage(2); await moveTo(2); await beat(1400); if (cancelled) return; if (stopped()) return settle();
      setStage(3); await moveTo(3); await beat(2200); if (cancelled) return; if (stopped()) return settle();
      setStage(4); await moveTo(4); if (cancelled) return; if (stopped()) return settle();
      setLights(true);
      await animate(2200, (k) => paint(1, k)); await beat(800); if (cancelled) return; if (stopped()) return settle();
      setStage(5); setAgitating(false); paint(1, 1); setHung(true);
      await beat(900); if (cancelled) return; if (stopped()) return settle();
      setWritten(true);
      await beat(1600); if (cancelled) return; if (stopped()) return settle();
      setDone(true);
    })();

    return () => {
      cancelled = true;
      wake.forEach((w) => w());
    };
  }, [ceremony, seen]);

  function skip() {
    skipRef.current = true;
    setCanSkip(false);
    wakeRef.current.forEach((w) => w());
    closeRef.current?.focus();   // the skip button is about to go
  }

  const title = failed ? t.failed : done ? t.surfaced : stage >= 0 ? t.titles[stage] : t.titles[0];
  const rootClass = [css.root, lights && css.lights, hung && css.dry].filter(Boolean).join(" ");
  const printClass = [css.print, lifted && css.lifted, agitating && css.agitate].filter(Boolean).join(" ");
  const benchStyle = { transform: `translateX(${-SLOTS[slot]}px)` } as CSSProperties;
  const printStyle = { transform: `translate(${SLOTS[slot]}px, 0)` } as CSSProperties;

  return (
    <div className={rootClass}>
      <div className={css.dark} aria-hidden />
      <div className={css.desk} aria-hidden />
      <div className={css.grain} aria-hidden />
      <div className={css.lamp} aria-hidden><span>{t.safelight}</span></div>

      <div className={css.bar}>
        {ceremony && canSkip && !done && !failed && <button type="button" onClick={skip}>{t.skip}</button>}
        <button ref={closeRef} type="button" onClick={onClose}>{t.close}</button>
      </div>

      <header className={css.copy}>
        <p className={css.kicker}>{t.label}</p>
        <h2 aria-live={failed ? "off" : "polite"}>{title}</h2>
      </header>

      <div className={css.fragments} role="group" aria-label={t.fragmentsLabel}>
        {fragments.map((fragment, index) => (
          <span key={`${fragment}-${index}`} style={{ "--i": index } as CSSProperties}>{fragment}</span>
        ))}
      </div>

      <div className={css.stage} aria-hidden>
        <div className={css.bench} style={benchStyle}>
          <div className={`${css.slot} ${css.easel}`} style={{ left: SLOTS[0] }}>
            <div className={`${css.beam}${beam ? ` ${css.on}` : ""}`} />
          </div>
          {t.trays.map((label, i) => (
            <div key={label} className={`${css.slot} ${css.tray}${i === 3 ? ` ${css.wash}` : ""}`} style={{ left: SLOTS[i + 1] }}>
              <div className={css.liquid} />
              <div className={css.surface} />
              <p className={css.label}>{t.stages[i + 1]}<i>{label}</i></p>
            </div>
          ))}
          <div className={printClass} style={printStyle}>
            <div className={css.tongs} />
            <svg viewBox="0 0 100 100" className={css.emulsion}>
              <defs>
                <filter id={filterId} colorInterpolationFilters="sRGB">
                  <feColorMatrix type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncR ref={(el) => { funcRefs.current[0] = el; }} type="table" tableValues={developTable(ceremony ? 0 : 1)} />
                    <feFuncG ref={(el) => { funcRefs.current[1] = el; }} type="table" tableValues={developTable(ceremony ? 0 : 1)} />
                    <feFuncB ref={(el) => { funcRefs.current[2] = el; }} type="table" tableValues={developTable(ceremony ? 0 : 1)} />
                  </feComponentTransfer>
                  <feColorMatrix type="matrix" values={`${SAFELIGHT[0]} 0 0 0 0  0 ${SAFELIGHT[1]} 0 0 0  0 0 ${SAFELIGHT[2]} 0 0  0 0 0 1 0`} />
                </filter>
              </defs>
              <rect width="100" height="100" fill={`rgb(${SAFELIGHT.map((c) => Math.round(c * 255)).join(",")})`} />
              {imageUrl && (
                <>
                  <image href={imageUrl} width="100" height="100" preserveAspectRatio="xMidYMid slice" filter={`url(#${filterId})`} />
                  <image ref={colourRef} href={imageUrl} width="100" height="100" preserveAspectRatio="xMidYMid slice" style={{ opacity: ceremony ? 0 : 1 }} />
                </>
              )}
            </svg>
          </div>
        </div>
      </div>

      <div className={css.line} aria-hidden>
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none"><path d="M0 8 Q 500 26 1000 8" /></svg>
      </div>
      {imageUrl && (
        <figure className={`${css.hang}${hung ? ` ${css.show}` : ""}${written ? ` ${css.written}` : ""}`} aria-hidden={!hung}>
          <div className={css.sheet}>
            <Image src={imageUrl} alt={t.alt} width={1024} height={1024} unoptimized />
            <figcaption><span>{caption}</span></figcaption>
          </div>
          <div className={css.clip} aria-hidden />
        </figure>
      )}

      {!done && !failed && (
        <ol className={css.steps}>
          {t.stages.map((name, i) => (
            <li key={name} className={i === stage ? css.now : i < stage ? css.past : undefined} aria-current={i === stage ? "step" : undefined}>{name}</li>
          ))}
        </ol>
      )}

      {done && !failed && (
        <div className={css.next}>
          {note && <p role="status">{note}</p>}
          <div className={css.acts}>
            {actions.map((a, i) => (
              <button key={i} type="button" onClick={a.onClick} disabled={a.disabled} className={a.primary ? css.primary : undefined}>{a.label}</button>
            ))}
          </div>
          {alert && <p role="alert" className={css.error}>{alert}</p>}
        </div>
      )}

      {failed && (
        <div className={css.next}>
          <p role="alert" className={css.error}>{error}</p>
          <div className={css.acts}>
            {failureActions.map((a, i) => (
              <button key={i} type="button" onClick={a.onClick} disabled={a.disabled} className={a.primary ? css.primary : undefined}>{a.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
