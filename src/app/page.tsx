"use client";

import Image from "next/image";
import Link from "next/link";
import type { PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";

const fragmentClassNames = ["fragment-one", "fragment-two", "fragment-three", "fragment-four", "fragment-five"];

const archiveNodeClassNames = ["node-one", "node-two", "node-three", "node-four"];

const sleepNights = [
  { rem: 24, light: 34, deep: 22, awake: 12, logged: false },
  { rem: 34, light: 29, deep: 20, awake: 7, logged: true },
  { rem: 25, light: 33, deep: 19, awake: 11, logged: false },
  { rem: 36, light: 31, deep: 18, awake: 6, logged: true },
  { rem: 22, light: 28, deep: 27, awake: 21, logged: false },
  { rem: 40, light: 33, deep: 20, awake: 3, logged: true },
  { rem: 32, light: 35, deep: 18, awake: 5, logged: true },
];

const ZH_SPIRIT_MESSAGES = [
  "有些梦不是故事，是情绪留下的脚印。",
  "你以为你忘了，其实只是没被记录。",
  "今晚醒来以后，先别解锁手机。",
  "这个场景，好像不是第一次出现。",
  "昨晚你又去了哪里？",
];

const EN_SPIRIT_MESSAGES = [
  "Some dreams aren't stories. They're footprints of feeling.",
  "You didn't forget. It was just never written down.",
  "When you wake tonight, don't reach for your phone first.",
  "This scene feels familiar, doesn't it?",
  "Where did you go last night?",
];

export default function LandingPage() {
  const { lang, T } = useLanguage();
  const L = T.landing;
  const pageRef = useRef<HTMLElement>(null);
  const router = useRouter();

  // Spirit refs
  const spiritWrapRef = useRef<HTMLDivElement>(null);
  const targetPos = useRef({ x: -200, y: -200 });
  const currentPos = useRef({ x: -200, y: -200 });
  const [spiritMessage, setSpiritMessage] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Intro state
  const [introDone, setIntroDone] = useState(false);
  const [introFading, setIntroFading] = useState(false);

  const dismissIntro = useCallback(() => {
    setIntroFading(true);
    setTimeout(() => setIntroDone(true), 800);
  }, []);

  // Auto-dismiss intro
  useEffect(() => {
    const t1 = setTimeout(() => setIntroFading(true), 3800);
    const t2 = setTimeout(() => setIntroDone(true), 4600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Mouse lerp for spirit
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      targetPos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);

    let raf: number;
    const tick = () => {
      const lp = 0.06;
      currentPos.current.x += (targetPos.current.x - currentPos.current.x) * lp;
      currentPos.current.y += (targetPos.current.y - currentPos.current.y) * lp;
      if (spiritWrapRef.current) {
        spiritWrapRef.current.style.transform =
          `translate(${currentPos.current.x - 22}px, ${currentPos.current.y - 22}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const handleSpiritClick = useCallback(() => {
    const messages = lang === "zh" ? ZH_SPIRIT_MESSAGES : EN_SPIRIT_MESSAGES;
    const msg = messages[Math.floor(Math.random() * messages.length)];
    setSpiritMessage(msg);
    setShowMessage(true);
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(() => setShowMessage(false), 3000);
  }, [lang]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        });
      },
      { rootMargin: "-12% 0px -12% 0px", threshold: 0.18 },
    );

    root.querySelectorAll(".reveal-dream").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const openRoute = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href.startsWith("/")) return;
    event.preventDefault();
    router.push(href);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty("--mx", x.toFixed(3));
    event.currentTarget.style.setProperty("--my", y.toFixed(3));
  };

  const handleNavPointer = (event: PointerEvent<HTMLElement>) => {
    const links = document.querySelectorAll<HTMLAnchorElement>("[data-top-nav-link]");

    for (const link of links) {
      const rect = link.getBoundingClientRect();
      const hitPadding = 10;
      const isInsideX =
        event.clientX >= rect.left - hitPadding && event.clientX <= rect.right + hitPadding;
      const isInsideY =
        event.clientY >= rect.top - hitPadding && event.clientY <= rect.bottom + hitPadding;

      if (isInsideX && isInsideY) {
        event.preventDefault();
        router.push(new URL(link.href).pathname);
        return;
      }
    }
  };

  return (
    <>
      {/* Opening cinematic sequence */}
      {!introDone && (
        <div className={`dream-intro${introFading ? " dream-intro-fading" : ""}`} aria-hidden>
          <div className="intro-content">
            <div className="intro-copy">
              <span className="intro-line" style={{ animationDelay: "0.8s" }}>
                {lang === "zh" ? "你昨晚去过的地方" : "The places you visited last night"}
              </span>
              <span className="intro-line intro-line-2">
                {lang === "zh" ? "正在慢慢消失。" : "are already fading."}
              </span>
              <span className="intro-line intro-line-3">
                {lang === "zh" ? "但有些场景，其实一直在重复。" : "But some scenes keep coming back."}
              </span>
            </div>
            <div className="intro-spirit-large" aria-hidden>
              <div className="spirit-aura" />
              <div className="spirit-core" />
              <div className="spirit-orbit" />
              <div className="spirit-orbit-2" />
            </div>
          </div>
          <button className="intro-skip" onClick={dismissIntro}>
            {lang === "zh" ? "跳过" : "Skip"}
          </button>
        </div>
      )}

      {/* Spirit character — follows mouse */}
      {introDone && (
        <div ref={spiritWrapRef} className="dream-spirit-wrap" aria-hidden>
          <button
            type="button"
            className="dream-spirit"
            onClick={handleSpiritClick}
            tabIndex={-1}
            aria-label={lang === "zh" ? "梦境小精灵" : "Dream spirit"}
          >
            <div className="spirit-aura" />
            <div className="spirit-core" />
            <div className="spirit-orbit" />
            <div className="spirit-orbit-2" />
            {showMessage && (
              <div className="spirit-msg" role="status">
                {spiritMessage}
              </div>
            )}
          </button>
        </div>
      )}

      <main
        ref={pageRef}
        className="dream-landing"
        onPointerMove={handlePointerMove}
        onPointerUpCapture={handleNavPointer}
      >
        <div className="dream-sky" aria-hidden>
          <span className="moon-glow" />
          <span className="dream-cloud cloud-one" />
          <span className="dream-cloud cloud-two" />
          <span className="dream-cloud cloud-three" />
          <span className="film-ribbon ribbon-one" />
          <span className="film-ribbon ribbon-two" />
          <span className="memory-page page-one" />
          <span className="memory-page page-two" />
          <span className="bedroom-window" />
          <span className="landing-particle particle-one" />
          <span className="landing-particle particle-two" />
          <span className="landing-particle particle-three" />
          <span className="landing-particle particle-four" />
        </div>

        <nav className="landing-nav" aria-label="Main navigation">
          <Link
            href="/"
            className="landing-logo"
            aria-label="Dream Reel home"
            data-top-nav-link
            onClick={openRoute("/")}
          >
            <Image src="/dream-reel-logo.png" alt="" aria-hidden width={36} height={36} className="logo-img" />
            <span>Dream Reel</span>
          </Link>

          <div className="nav-center">
            {L.navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                data-top-nav-link
                onClick={openRoute(item.href)}
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="landing-nav-actions">
            <LangToggle className="nav-cta" />
            <a
              href="/journal"
              className="nav-cta"
              data-top-nav-link
              onClick={openRoute("/journal")}
            >
              {L.navCta}
            </a>
          </div>
        </nav>

        <section className="hero-section immersive-hero">
          <div className="hero-copy">
            <p className="hero-kicker">{L.heroKicker}</p>
            <h1>DREAM REEL</h1>
            <p className="hero-subtitle">{L.heroSubtitle}</p>
            <div className="hero-actions">
              <Link href="/journal" className="hero-button hero-button-primary">
                {L.heroCta1}
              </Link>
              <Link href="/archive" className="hero-button hero-button-secondary">
                {L.heroCta2}
              </Link>
            </div>
          </div>

          <div className="hero-memory-field" aria-label="Animated dream archive preview">
            <div className="dream-image-preview" aria-hidden>
              <span className="image-moon" />
              <span className="image-window" />
              <span className="image-page" />
            </div>

            <div className="dialogue-preview">
              <p>{L.dialogueLabel}</p>
              <span>{L.dialogueQuestion}</span>
            </div>

            {L.heroFragments.map((text, i) => (
              <span key={i} className={`hero-fragment ${fragmentClassNames[i]}`}>
                {text}
              </span>
            ))}
          </div>
        </section>

        <section className="features-section" aria-label="Features">
          <div className="features-intro reveal-dream">
            <p>{L.featuresIntroEyebrow}</p>
            <h2>{L.featuresIntroTitle}</h2>
          </div>

          {L.features.map((feature, i) => (
            <article key={i} className="feature-flow-step reveal-dream">
              <p className="feature-flow-eyebrow">{feature.eyebrow}</p>
              <h2 className="feature-flow-title">{feature.title}</h2>
              <span className="feature-flow-copy">{feature.copy}</span>
            </article>
          ))}
        </section>

        <section id="gallery" className="dream-archive-space" aria-label="Dream archive experience">
          <div className="archive-opening reveal-dream">
            {L.archiveIntroEyebrow ? <p>{L.archiveIntroEyebrow}</p> : null}
            <h2>{L.archiveIntroTitle}</h2>
            <span>{L.archiveIntroBody}</span>
          </div>

          <div className="archive-network" aria-label="Dream memory network">
            <svg className="archive-lines" viewBox="0 0 1000 680" preserveAspectRatio="none" aria-hidden>
              <path d="M120 180 C300 60 470 210 620 160 C760 120 840 220 900 330" />
              <path d="M150 470 C320 390 390 500 520 420 C680 320 760 440 890 520" />
              <path d="M260 230 C340 360 470 350 540 460 C610 570 760 560 850 470" />
            </svg>

            {L.archiveNodes.map((node, i) => (
              <article key={i} className={`archive-node ${archiveNodeClassNames[i]}`}>
                <p>{node.time}</p>
                <h3>{node.title}</h3>
                <span>{node.fragment}</span>
                <strong>{node.signal}</strong>
              </article>
            ))}

            <div className="signal-cloud" aria-label="Dream signals">
              {L.memorySignals.map((signal, index) => (
                <span key={index} className={`signal signal-${index + 1}`}>
                  {signal}
                </span>
              ))}
            </div>
          </div>

          <section className="night-soundtrack reveal-dream" aria-labelledby="night-soundtrack-title">
            <div className="soundtrack-copy">
              <p>{L.sleepEyebrow}</p>
              <h2 id="night-soundtrack-title">{L.sleepTitle}</h2>
              <span>{L.sleepBody}</span>
            </div>

            <div className="sleep-film-strip" aria-label="Past seven nights sleep stage preview">
              <div className="sleep-strip-header">
                <span>{L.sleepStripHeader}</span>
                <span className="sleep-live"><i /> {L.sleepContext}</span>
              </div>

              <div className="sleep-stage-board">
                <div className="stage-labels" aria-hidden>
                  <span>{L.stageAwake}</span>
                  <span>REM</span>
                  <span>{L.stageLight}</span>
                  <span>{L.stageDeep}</span>
                </div>

                <div className="sleep-bars">
                  {sleepNights.map((night, i) => (
                    <div className="sleep-night" key={i}>
                      <div className="dream-log-dot" data-logged={night.logged} aria-hidden />
                      <div className="sleep-bar" aria-label={`${L.sleepDays[i]} sleep stages`}>
                        <span className="stage stage-awake" style={{ height: `${night.awake}%` }} />
                        <span className="stage stage-rem" style={{ height: `${night.rem}%` }} />
                        <span className="stage stage-light" style={{ height: `${night.light}%` }} />
                        <span className="stage stage-deep" style={{ height: `${night.deep}%` }} />
                      </div>
                      <strong>{L.sleepDays[i]}</strong>
                    </div>
                  ))}
                </div>

                <svg className="recall-wave" viewBox="0 0 900 160" preserveAspectRatio="none" aria-hidden>
                  <path d="M20 92 C120 82 170 108 260 96 C360 82 420 66 520 88 C620 112 650 54 760 72 C825 82 850 104 880 92" />
                </svg>
              </div>

              <div className="sleep-legend" aria-hidden>
                <span><i className="legend-rem" /> REM</span>
                <span><i className="legend-light" /> {L.stageLight}</span>
                <span><i className="legend-deep" /> {L.stageDeep}</span>
                <span><i className="legend-awake" /> {L.stageAwake}</span>
                <span className="legend-logged"><i /> {L.legendLogged}</span>
              </div>
            </div>

            <div className="sleep-metrics">
              {L.sleepMetrics.map((metric, i) => (
                <article key={i}>
                  <p>{metric.label}</p>
                  <h3>{metric.value}</h3>
                  <span>{metric.note}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="privacy-reel reveal-dream" aria-labelledby="privacy-title">
            <div className="privacy-copy">
              <p>{L.privacyEyebrow}</p>
              <h2 id="privacy-title">{L.privacyTitle}</h2>
              <span>{L.privacyBody}</span>
            </div>
            <div className="privacy-notes" aria-label={L.privacyEyebrow}>
              {L.privacyNotes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </div>
          </section>

          <section className="voices-stream" aria-labelledby="voices-title">
            {(L.voicesEyebrow || L.voicesTitle) && (
              <div className="voices-intro reveal-dream">
                {L.voicesEyebrow ? <p>{L.voicesEyebrow}</p> : null}
                {L.voicesTitle ? <h2 id="voices-title">{L.voicesTitle}</h2> : null}
              </div>
            )}

            <div className="voice-current">
              {L.voices.map((voice, i) => (
                <article key={i} className="voice-item reveal-dream">
                  <h3>{voice.name}</h3>
                  <span>{voice.thought}</span>
                  {"source" in voice && voice.source ? <small>{voice.source}</small> : null}
                </article>
              ))}
            </div>
          </section>
        </section>
      </main>
    </>
  );
}
