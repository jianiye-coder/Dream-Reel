"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchBillingStatus, needsPaymentFix, openStripe, useBillingReturn, type ClientBillingStatus } from "@/lib/billingClient";
import css from "./pricing.module.css";

export function PricingView({ checkoutAvailable }: { checkoutAvailable: boolean }) {
  const { lang, T } = useLanguage();
  const L = T.landing;
  const P = T.nbPaper;
  const B = T.billing;
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const fors = [P.planFreeFor, P.planPlusFor];

  const [billing, setBilling] = useState<ClientBillingStatus | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState<"" | "upgradePending" | "upgradeSlow" | "upgraded" | "checkoutCancelled">("");
  useEffect(() => {
    if (signedIn) fetchBillingStatus().then(setBilling).catch(() => undefined);
  }, [signedIn]);
  useBillingReturn({
    pending: () => setNote("upgradePending"),
    active: () => setNote("upgraded"),
    slow: () => setNote("upgradeSlow"),
    cancelled: () => setNote("checkoutCancelled"),
    isPlus: async () => {
      const s = await fetchBillingStatus();
      if (s) setBilling(s);
      return s?.plan === "plus";
    },
  });

  async function upgrade() {
    setError("");
    setOpening(true);
    try {
      await openStripe("checkout", lang, "/pricing", B.checkoutError);
    } catch (e) {
      setError(e instanceof Error ? e.message : B.checkoutError);
      setOpening(false);
    }
  }

  const available = billing?.checkoutAvailable ?? checkoutAvailable;
  const hasSubscription = !billing?.isUnlimited && (billing?.plan === "plus" || needsPaymentFix(billing));
  const arrow = <span aria-hidden>→</span>;
  function plusAction(cta: string) {
    if (hasSubscription) return <Link className="nb-act" href="/account">{B.manage} {arrow}</Link>;
    if (!available) {
      return <p className={css.soon}><b>{B.comingSoon}</b><span>{B.comingSoonNote}</span></p>;
    }
    if (!signedIn) return <Link className="nb-act" href="/login?callbackUrl=%2Fpricing">{cta} {arrow}</Link>;
    return <button type="button" className="nb-act" onClick={() => void upgrade()} disabled={opening}>{opening ? B.opening : cta} {arrow}</button>;
  }

  return (
    <NotebookShell surface="paper">
      <main className="nb-paper-main" id="main">
        <div className="nb-pricing-head">
          <span className="nb-kicker">{P.pricingKicker}</span>
          <h1>{P.pricingTitle}</h1>
          <p className="nb-body">{P.pricingBody}</p>
          {note && <p className="nb-msg nb-ok" role="status" style={{ marginTop: 18 }}>{B[note]}</p>}
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
                <div className="nb-price"><b><i className="nb-currency">{currency}</i>{amount}</b><span>{plan.cadence}</span></div>
                <p className="nb-for">{fors[i]}</p>
                <ul className="nb-items">
                  {plan.items.map(([label, value]) => <li key={label}>{label}<span className="nb-lead" /><b>{value}</b></li>)}
                  <li>{P.planAlways}<span className="nb-lead" /><b>{P.planAlwaysValue}</b></li>
                </ul>
                {i === 0
                  ? <Link className="nb-act" href={signedIn ? "/journal" : "/login?callbackUrl=%2Fjournal"}>{plan.cta} {arrow}</Link>
                  : plusAction(plan.cta)}
                {i === 1 && error && <p className="nb-msg" role="alert" style={{ marginTop: 12 }}>{error}</p>}
              </section>,
            ];
          })}
        </div>

        <div className="nb-faq">
          {P.faq.map((f) => <div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>)}
        </div>

        <LegalLinks note={T.legal.pricingNote} />
      </main>
    </NotebookShell>
  );
}
