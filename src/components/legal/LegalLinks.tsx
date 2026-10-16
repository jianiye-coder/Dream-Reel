"use client";

import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import css from "./legal.module.css";

/** Terms · Privacy · Refunds, as a quiet line at the foot of a page. */
export function LegalLinks({ note, className }: { note?: string; className?: string }) {
  const { T } = useLanguage();
  return (
    <nav className={[css.links, className].filter(Boolean).join(" ")} aria-label={T.legal.label}>
      {note && <span>{note}</span>}
      {T.legal.nav.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
    </nav>
  );
}
