"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Book, BookPage } from "@/components/notebook/Book";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { TurnLink } from "@/components/notebook/TurnLink";
import { useLanguage } from "@/contexts/LanguageContext";
import { handwrite, sleep } from "@/lib/notebookHandwriting";
import { pageTurn, stroke, unlock } from "@/lib/notebookSound";

const CN = "〇一二三四五六七八九";
function cnNum(n: number) {
  if (n <= 10) return n === 10 ? "十" : CN[n];
  if (n < 20) return "十" + CN[n % 10];
  return CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : "");
}

export default function LandingPage() {
  const { lang, T } = useLanguage();
  const L = T.nbLanding;
  const [closed, setClosed] = useState(true);
  const [coverGone, setCoverGone] = useState(false);
  const [lit, setLit] = useState(false);
  const [dateLine, setDateLine] = useState<string[]>([]);
  const entry = useRef<HTMLParagraphElement>(null);
  const cluesEl = useRef<HTMLDivElement>(null);
  const indexEl = useRef<HTMLOListElement>(null);
  const [thread, setThread] = useState<{ top: number; height: number } | null>(null);
  const opened = useRef(false);
  const writeDemoRef = useRef<() => Promise<void>>(async () => {});
  const run = useRef(0);

  useEffect(() => {
    const now = new Date();
    setDateLine(lang === "zh"
      ? [`${cnNum(now.getMonth() + 1)}月${cnNum(now.getDate())}日`, "周" + "日一二三四五六"[now.getDay()], "六点四十二分"]
      : [now.toLocaleDateString("en-US", { month: "long", day: "numeric" }), now.toLocaleDateString("en-US", { weekday: "long" }), "6:42 am"]);
  }, [lang]);

  // write the sample dream once the book is open; restart if the language changes mid-way
  const writeDemo = useCallback(async () => {
    const id = ++run.current;
    const p = entry.current, c = cluesEl.current;
    if (!p || !c) return;
    p.textContent = "";
    c.textContent = "";
    await handwrite(p, L.demo, { speed: 1.35, cancelled: () => id !== run.current });
    for (const line of L.clues) {
      if (id !== run.current) return;
      const el = document.createElement("p");
      el.className = "nb-note";
      c.appendChild(el);
      await sleep(350);
      for (const ch of line) {
        if (id !== run.current) return;
        el.textContent += ch;
        stroke(0.5);
        await sleep(55);
      }
    }
  }, [L]);

  useEffect(() => { writeDemoRef.current = writeDemo; }, [writeDemo]);

  const open = useCallback(async (instant = false) => {
    if (opened.current) return;
    opened.current = true;
    sessionStorage.setItem("dr-cover-seen", "1");
    if (!instant) { unlock(); pageTurn({ dur: 1.2, heavy: true }); } // a cover is stiffer and heavier than a page
    setClosed(false);
    window.setTimeout(() => setCoverGone(true), instant ? 0 : 520);
    await sleep(instant ? 250 : 1300);
    setLit(true);
    void writeDemoRef.current();
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("dr-cover-seen") || matchMedia("(max-width: 900px)").matches) void open(true);
  }, [open]);

  useEffect(() => {
    if (opened.current && lit) void writeDemo();
    // only when the language (and so the demo text) changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L]);

  useEffect(() => () => { run.current += 1; }, []);

  // the red thread joining the three nights with the sea
  useEffect(() => {
    const measure = () => {
      const li = indexEl.current?.querySelectorAll("li");
      if (!li || li.length < 7) return;
      const a = li[0].offsetTop + 30, b = li[6].offsetTop + 30;
      setThread({ top: a, height: b - a });
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [lang]);

  return (
    <NotebookShell>
      <main className="nb-stage" id="main">
          <Book className={`${closed ? "nb-closed " : ""}nb-r-first`} pencil>
            <BookPage side="l" ruled indent folio="p. 214">
              <div className="nb-date-line">{dateLine.map((d, i) => i === 0 ? <b key={i}>{d}</b> : <span key={i}>{d}</span>)}</div>
              <p className="nb-hand nb-entry" ref={entry} />
              <div className="nb-clues" ref={cluesEl} />
              <span className={`nb-note nb-margin-note nb-fade-in${lit ? " nb-on" : ""}`} aria-hidden>{L.marginNote}</span>
            </BookPage>

            <BookPage side="r" folio="p. 215" curl padClassName={`nb-hero-r${lit ? " nb-lit" : ""}`}>
              <span className="nb-kicker">{L.heroKicker}</span>
              <div>
                <h1>{L.heroTitleA}<br />{L.heroTitleB}<em>{L.heroTitleEm}</em>{L.heroTitleC}</h1>
                <p className="nb-body">{L.heroBody}</p>
              </div>
              <div className="nb-cta-row">
                <TurnLink className="nb-act" href="/journal">{L.heroCta} <span aria-hidden>→</span></TurnLink>
                <a className="nb-act-quiet" href="#later">{L.heroCtaQuiet}</a>
                <Link className="nb-act-quiet" href="/morning-pages">{T.morningPages.landingLink}</Link>
              </div>
            </BookPage>

            <div className="nb-thick nb-thick-b" /><div className="nb-thick nb-thick-r" />
            <Cover open={!closed} past={coverGone} label={L.coverAria} onOpen={() => void open()} />
            <span className="nb-open-hint" aria-hidden>{L.coverHint}</span>
          </Book>
      </main>

      <div className="nb-sheet-section" id="later">
        <section className="nb-morning">
          <div className="nb-m-head">
            <span className="nb-kicker">{L.morningKicker}</span>
            <h2>{L.morningTitleA}<br />{L.morningTitleB}</h2>
          </div>
          <ol className="nb-steps4">
            {L.steps.map((s, i) => (
              <li key={s.title}><span className="nb-n">0{i + 1}</span><h3>{s.title}</h3><p>{s.copy}</p></li>
            ))}
          </ol>
        </section>

        <section className="nb-later">
          <div>
            <span className="nb-kicker">{L.laterKicker}</span>
            <h2>{L.laterTitleA}<br />{L.laterTitleB}</h2>
            <p className="nb-body">{L.laterBody}</p>
            <p className="nb-body nb-small">{L.laterSmall}</p>
            <figure className="nb-print">
              <span className="nb-tape" />
              <Image src="/images/dream-doors.jpg" alt="" width={520} height={390} />
              <span className="nb-cap">{L.photoCaption}</span>
            </figure>
          </div>
          <div>
            <div className="nb-month"><b>{L.monthName}</b><span className="nb-kicker">{L.monthMeta}</span></div>
            <ol className="nb-index-list" ref={indexEl}>
              {L.index.map((row) => (
                <li key={row.d}><span className="nb-d">{row.d}</span><span className={`nb-t${row.blank ? " nb-blank" : ""}`}>{row.t}</span><span className="nb-n">{row.n}</span></li>
              ))}
              {thread && <span className="nb-thread" style={{ top: thread.top, height: thread.height }} aria-hidden />}
            </ol>
            <div className="nb-cta-row">
              <Link className="nb-act" href="/journal">{L.laterCta} <span aria-hidden>→</span></Link>
              <span className="nb-mono" style={{ color: "var(--ink-faint)" }}>{L.laterMeta}</span>
            </div>
          </div>
        </section>

        <section className="nb-price-line">
          <div className="nb-pl-in">
            <span className="nb-kicker">{L.priceKicker}</span>
            <p>{L.priceText}<span>{L.priceSoft}</span></p>
            <Link className="nb-act-quiet" href="/pricing">{L.priceLink}</Link>
          </div>
        </section>

        <section className="nb-trust">
          <div className="nb-trust-in">
            <span className="nb-stamp">{L.privateStamp}</span>
            <p>{L.privateText}</p>
            <Link className="nb-act-quiet" href="/blog/dreams-and-consciousness">{L.blogLink}</Link>
          </div>
        </section>
        <footer className="nb-landing-footer"><span>{L.footerA}</span><span>{L.footerB}</span><a href="mailto:yejiani0831@gmail.com">contact: yejiani0831@gmail.com</a></footer>
      </div>
    </NotebookShell>
  );
}

/* Full leather, softly padded, worn at the edges; gilt only in the corners and the title. */
function Cover({ open, past, label, onOpen }: { open: boolean; past: boolean; label: string; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={open ? -1 : 0}
      aria-hidden={open || undefined}
      className={`nb-cover${open ? " nb-open" : ""}${past ? " nb-past" : ""}`}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className="nb-out">
        <span className="nb-spine-edge" /><span className="nb-hinge" />
        <svg className="nb-tool" viewBox="0 0 740 1000" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="nb-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7a5822" /><stop offset=".25" stopColor="#c8a256" /><stop offset=".45" stopColor="#f0dc9f" />
              <stop offset=".6" stopColor="#b08638" /><stop offset=".8" stopColor="#e3c47c" /><stop offset="1" stopColor="#86622a" />
              <animateTransform attributeName="gradientTransform" type="translate" values="-.5 -.5; .5 .5; -.5 -.5" dur="10s" repeatCount="indefinite" />
            </linearGradient>
            <g id="nb-flourish" fill="none" stroke="url(#nb-gold)" strokeLinecap="round">
              <path d="M0 74 V0 H74" strokeWidth="1.5" />
              <path d="M10 58 C10 30 30 10 58 10" strokeWidth="1.3" />
              <path d="M58 10 C74 10 80 24 70 30 C62 35 56 26 63 22" strokeWidth="1.3" />
              <path d="M10 58 C10 74 24 80 30 70 C35 62 26 56 22 63" strokeWidth="1.3" />
              <path d="M20 20 C32 24 40 32 44 44 C32 40 24 32 20 20Z" fill="url(#nb-gold)" stroke="none" />
              <path d="M86 0 C96 6 104 6 112 2" strokeWidth="1.1" />
              <path d="M0 86 C6 96 6 104 2 112" strokeWidth="1.1" />
              <circle cx="120" cy="1" r="2" fill="url(#nb-gold)" stroke="none" />
              <circle cx="1" cy="120" r="2" fill="url(#nb-gold)" stroke="none" />
            </g>
          </defs>
          <g className="nb-blind" fill="none" stroke="rgba(8,12,22,.55)">
            <rect x="74" y="44" width="622" height="912" strokeWidth="2" />
            <rect x="86" y="56" width="598" height="888" strokeWidth=".8" />
          </g>
          <g className="nb-gilt">
            <use href="#nb-flourish" transform="translate(98 68)" />
            <use href="#nb-flourish" transform="translate(672 68) scale(-1 1)" />
            <use href="#nb-flourish" transform="translate(98 932) scale(1 -1)" />
            <use href="#nb-flourish" transform="translate(672 932) scale(-1 -1)" />
            <g fill="url(#nb-gold)">
              <path d="M396 330a40 40 0 1 0 26 70a33 33 0 1 1 -26 -70z" />
              <circle cx="438" cy="350" r="2.2" /><circle cx="352" cy="338" r="1.5" />
              <text className="nb-title" x="385" y="520" textAnchor="middle" fontSize="96">Dream Reel</text>
              <path d="M335 574 h40 M395 574 h40" stroke="url(#nb-gold)" strokeWidth="1" />
              <path d="M385 569 l4 5 -4 5 -4 -5z" />
            </g>
          </g>
        </svg>
        <span className="nb-ribbon-tail" />
      </div>
      <div className="nb-in" />
    </div>
  );
}
