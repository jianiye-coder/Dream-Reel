"use client";

import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";

export default function PricingPage() {
  const { lang, T } = useLanguage();
  const L = T.landing;

  return (
    <main className="morning-landing morning-pricing-page">
      <nav className="morning-nav" aria-label={lang === "zh" ? "主导航" : "Main navigation"}>
        <Link href="/" className="morning-brand" aria-label="Dream Reel home">
          <Image src="/dream-reel-logo.png" alt="" aria-hidden width={40} height={40} />
          <span>Dream Reel</span>
        </Link>
        <div className="morning-nav-links">
          <Link href="/journal">{T.nav.journal}</Link>
          <Link href="/archive">{T.nav.archive}</Link>
        </div>
        <div className="morning-nav-actions">
          <LangToggle className="morning-language" />
          <Link href="/journal" className="morning-nav-cta">{L.navCta}</Link>
        </div>
      </nav>

      <section className="morning-pricing" aria-labelledby="pricing-title">
        <div className="morning-pricing-heading">
          <p className="morning-eyebrow">{L.pricingEyebrow}</p>
          <h1 id="pricing-title">{L.pricingTitle}</h1>
          <p>{L.pricingBody}</p>
        </div>

        <div className="morning-plan-grid">
          {L.pricingPlans.map((plan, i) => (
            <article key={plan.name} className={`morning-plan ${i === 1 ? "is-featured" : ""}`}>
              <div className="morning-plan-head">
                <span className="morning-plan-badge">{plan.badge}</span>
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
              <Link href="/journal" className="morning-button morning-button-primary">
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
