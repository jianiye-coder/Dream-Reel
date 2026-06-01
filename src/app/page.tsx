"use client";

import Image from "next/image";
import Link from "next/link";
import type { PointerEvent } from "react";
import { LangToggle } from "@/components/LangToggle";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LandingPage() {
  const { lang, T } = useLanguage();
  const L = T.landing;
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

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty("--mx", x.toFixed(3));
    event.currentTarget.style.setProperty("--my", y.toFixed(3));
  };

  return (
    <main className="dream-landing dream-reel-landing" onPointerMove={handlePointerMove}>
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

      <section className="reel-next" aria-label="Dream Reel features">
        <div className="reel-next-intro">
          <p>{L.featuresIntroEyebrow}</p>
          <h2>{L.featuresIntroTitle}</h2>
        </div>

        <div className="reel-feature-strip">
          {L.features.slice(0, 3).map((feature) => (
            <article key={feature.title}>
              <span>{feature.eyebrow}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>

        <div className="reel-secondary-actions">
          <Link href="/archive">{L.heroCta2}</Link>
          <Link href="/pricing">Plus</Link>
        </div>
      </section>
    </main>
  );
}
