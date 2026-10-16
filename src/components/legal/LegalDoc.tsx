"use client";

import Link from "next/link";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";
import css from "./legal.module.css";

// the same address as the landing page footer
export const CONTACT_EMAIL = "yejiani0831@gmail.com";

export type LegalDocId = "terms" | "privacy" | "refund";

/* Terms, privacy and refunds: one plain sheet of paper each, with the other two a turn away.
   The wording lives in i18n (`legal`). The owner must review it before payments go live. */
export function LegalDoc({ doc }: { doc: LegalDocId }) {
  const { T } = useLanguage();
  const G = T.legal;
  const D = G[doc];
  const withEmail = (text: string) => {
    const [before, after] = text.split("{email}");
    return after === undefined ? text : <>{before}<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{after}</>;
  };

  return (
    <NotebookShell surface="paper">
      <main className="nb-paper-main" id="main">
        <div className={css.sheet}>
          <nav className={css.tabs} aria-label={G.label}>
            {G.nav.map((item) => (
              <Link key={item.href} href={item.href} aria-current={item.href === `/${doc}` ? "page" : undefined}>{item.label}</Link>
            ))}
          </nav>

          <header className="nb-pricing-head">
            <span className="nb-kicker">{D.kicker}</span>
            <h1>{D.title}</h1>
            <p className="nb-body">{D.intro}</p>
            <p className={css.updated}>{G.updated}</p>
          </header>

          <ol className={css.sections}>
            {D.sections.map((section) => (
              <li key={section.h}>
                <h2>{section.h}</h2>
                {section.p.map((text) => <p key={text}>{withEmail(text)}</p>)}
              </li>
            ))}
          </ol>

          <p className={css.contact}>
            <span>{G.contactLabel}</span>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </div>
      </main>
    </NotebookShell>
  );
}
