"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";

export default function PricingPage() {
  const { T } = useLanguage();
  const L = T.landing;
  const P = T.nbPaper;
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const fors = [P.planFreeFor, P.planPlusFor];
  // upgrading happens from the account page, where the Stripe checkout lives
  const hrefs = signedIn ? ["/journal", "/account"] : ["/login?callbackUrl=%2Fjournal", "/login?callbackUrl=%2Faccount"];

  return (
    <NotebookShell surface="paper">
      <main className="nb-paper-main" id="main">
        <div className="nb-pricing-head">
          <span className="nb-kicker">{P.pricingKicker}</span>
          <h1>{P.pricingTitle}</h1>
          <p className="nb-body">{P.pricingBody}</p>
        </div>

        <div className="nb-plans">
          {L.pricingPlans.map((plan, i) => {
            const [amount] = plan.price.match(/[\d.]+/) ?? ["0"];
            const currency = plan.price.replace(amount, "");
            return [
              i === 1 && <span key="rule" className="nb-rule" />,
              <section key={plan.name} className="nb-plan">
                {i === 1 && <span className="nb-stamp">{P.recommended}</span>}
                <div className="nb-plan-name">{plan.name}</div>
                <div className="nb-price"><b><i className="nb-yen">{currency}</i>{amount}</b><span>{plan.cadence}</span></div>
                <p className="nb-for">{fors[i]}</p>
                <ul className="nb-items">
                  {plan.items.map(([label, value]) => <li key={label}>{label}<span className="nb-lead" /><b>{value}</b></li>)}
                  <li>{P.planAlways}<span className="nb-lead" /><b>{P.planAlwaysValue}</b></li>
                </ul>
                <Link className="nb-act" href={hrefs[i]}>{plan.cta} <span aria-hidden>→</span></Link>
              </section>,
            ];
          })}
        </div>

        <div className="nb-faq">
          {P.faq.map((f) => <div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>)}
        </div>
      </main>
    </NotebookShell>
  );
}
