"use client";

import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";

export default function PricingPage() {
  const { lang, T } = useLanguage();
  const L = T.landing;

  return (
    <main className="dream-landing" style={{ minHeight: "100svh" }}>
      <div className="dream-sky" aria-hidden>
        <span className="moon-glow" />
        <span className="dream-cloud cloud-one" />
        <span className="dream-cloud cloud-two" />
      </div>

      <nav className="landing-nav" aria-label="Main navigation">
        <Link href="/" className="landing-logo" aria-label="Dream Reel home">
          <Image src="/dream-reel-logo.png" alt="" aria-hidden width={36} height={36} className="logo-img" />
          <span>Dream Reel</span>
        </Link>
        <div className="landing-nav-actions">
          <LangToggle className="nav-cta" />
          <Link href="/journal" className="nav-cta">{L.navCta}</Link>
        </div>
      </nav>

      <section className="pricing-stream" style={{ marginTop: "clamp(4rem, 8vw, 7rem)", marginBottom: "clamp(4rem, 8vw, 7rem)" }}>
        <div className="pricing-copy">
          <p>{L.pricingEyebrow}</p>
          <h2>{L.pricingTitle}</h2>
          <span>{L.pricingBody}</span>
        </div>

        <div className="pricing-reels">
          {L.pricingPlans.map((plan, i) => (
            <article key={plan.name} className={`pricing-reel ${i === 1 ? "pricing-reel-plus" : ""}`}>
              <div className="pricing-reel-head">
                <span>{plan.badge}</span>
                <h3>{plan.name}</h3>
                <p>
                  <strong>{plan.price}</strong>
                  <small>{plan.cadence}</small>
                </p>
              </div>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link href="/journal" className="pricing-cta">
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
