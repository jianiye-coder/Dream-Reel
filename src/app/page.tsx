"use client";

import Image from "next/image";
import Link from "next/link";
import type { PointerEvent } from "react";
import { useEffect, useRef } from "react";
import { LangToggle } from "@/components/LangToggle";
import { useLanguage } from "@/contexts/LanguageContext";

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

export default function LandingPage() {
  const { lang, T } = useLanguage();
  const L = T.landing;
  const pageRef = useRef<HTMLElement>(null);
  const manifesto =
    lang === "zh"
      ? [
          "梦境不总是从清晰开始。它先是一段失焦的街道、一句醒来后还在耳边的话，再慢慢变成可以被回看、显影和理解的线索。",
          "Dream Reel 是你的梦境影像档案：记录晨间碎片，读出情绪与重复意象，再把那些说不清的感觉变成一帧可以停留的画面。",
        ]
      : [
          "Dreams rarely begin with clarity. First comes a blurred street, a sentence still ringing after waking, then a trace you can revisit, develop, and understand.",
          "Dream Reel is a cinematic archive for your inner life: capture morning fragments, surface mood and recurring symbols, and turn the hard-to-name feeling into a frame that stays.",
        ];

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

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty("--mx", x.toFixed(3));
    event.currentTarget.style.setProperty("--my", y.toFixed(3));
  };

  return (
    <main ref={pageRef} className="dream-landing dream-reel-landing" onPointerMove={handlePointerMove}>
      <section className="reel-hero" aria-label="Dream Reel landing">
        <Image
          src="/dream-photo-3.jpg"
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="reel-hero-image"
        />

        <div className="reel-atmosphere" aria-hidden>
          <span className="reel-orbit reel-orbit-one" />
          <span className="reel-orbit reel-orbit-two" />
          <span className="reel-star reel-star-one" />
          <span className="reel-star reel-star-two" />
          <span className="reel-star reel-star-three" />
          <span className="reel-figure-glow" />
        </div>

        <nav className="reel-nav" aria-label="Main navigation">
          <Link href="/" className="reel-brand" aria-label="Dream Reel home">
            <Image src="/dream-reel-logo.png" alt="" aria-hidden width={34} height={34} />
          </Link>

          <div className="reel-nav-links">
            {L.navItems.map((item) => (
              <Link key={item.label} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>

          <LangToggle className="reel-lang" />
        </nav>

        <div className="reel-hero-grid">
          <div className="reel-title-block">
            <p>{L.heroKicker}</p>
            <h1>Dream Reel</h1>
            <span>{L.heroSubtitle}</span>
          </div>

          <div className="reel-primary-action">
            <Link href="/journal">{L.heroCta1}</Link>
          </div>

          <aside className="reel-manifesto" aria-label="Dream Reel introduction">
            {manifesto.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </aside>
        </div>

        <div className="reel-footer-line" aria-hidden>
          <span>Dreams begin before language.</span>
          <span>Dream Reel ©2026</span>
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
  );
}
