"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";
import DreamGrid from "./DreamGrid";
import type { DreamEntry } from "@/lib/dreams";

type CountItem = { item: string; count: number };
type BillingStatus = { plan: "free" | "plus" };

interface WeeklyRecapShape {
  weekStart: string;
  entryCount: number;
  topMoods: CountItem[];
  topPeople: CountItem[];
  topLocations: CountItem[];
  topSymbols: CountItem[];
  stressByMood: unknown[];
}

function formatCountItems(items: CountItem[], noData: string): string {
  if (items.length === 0) return noData;
  return items.map((i) => `${i.item} (${i.count})`).join(" · ");
}

export default function ArchiveShell({
  entries,
  recap,
  dataError,
  user,
}: {
  entries: DreamEntry[];
  recap: WeeklyRecapShape;
  dataError: string;
  user: { name?: string | null; email?: string | null; image?: string | null } | null;
}) {
  const { lang, T } = useLanguage();
  const { archive: A } = T;
  const B = T.billing;
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState("");

  useEffect(() => {
    if (!user) return;
    fetch("/api/billing/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setBillingStatus(data as BillingStatus);
      })
      .catch(() => undefined);
  }, [user]);

  async function openBilling() {
    setBillingError("");
    const endpoint = billingStatus?.plan === "plus" ? "/api/billing/portal" : "/api/billing/checkout";
    const fallbackError = billingStatus?.plan === "plus" ? B.portalError : B.checkoutError;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, currency: lang === "zh" ? "cny" : "usd" }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || fallbackError);
      window.location.href = data.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : fallbackError);
    }
  }

  return (
    <div className="mist-page archive-page">
      <div className="mist-orb left-[-8rem] top-[-5rem] h-[20rem] w-[20rem] bg-[#d7c9ea]/80" aria-hidden />
      <div className="mist-orb right-[-4rem] top-[6rem] h-[18rem] w-[18rem] bg-[#bfd2e6]/72" aria-hidden />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="landing-logo">
          <Image src="/dream-reel-logo.png" alt="" aria-hidden width={36} height={36} className="logo-img" />
          <span>Dream Reel</span>
        </Link>
        <div className="flex items-center gap-2">
          <LangToggle className="mist-button-secondary rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-white/48" />
          <Link href="/pricing" className="mist-button-secondary rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-white/48">
            {lang === "zh" ? "订阅" : "Pricing"}
          </Link>
          <Link href="/journal" className="mist-button-secondary rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-white/48">
            {A.recordBtn}
          </Link>
          {user && (
            <Link href="/account" className="mist-button-secondary rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-white/48">
              {lang === "zh" ? "账号" : "Account"}
            </Link>
          )}
        </div>
      </nav>

      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-20 pt-2 sm:px-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[#5d5471]">
            {A.title}
          </h1>
          <p className="mist-muted mt-3 max-w-2xl text-sm leading-7">{A.desc}</p>
        </div>

        {dataError ? (
          <div className="mist-card mb-6 rounded-[1.8rem] border-[#decdb2]/60 bg-[linear-gradient(180deg,rgba(255,250,239,0.72),rgba(247,239,223,0.56))] p-4">
            <p className="text-sm font-medium text-[#aa8e67]">{A.dbErrorTitle}</p>
            <p className="mt-1 text-sm leading-relaxed text-[#8e7d66]">{dataError}</p>
            <p className="mt-2 text-xs text-[#9b8d78]">{A.dbErrorHint}</p>
          </div>
        ) : null}

        {billingError ? (
          <div className="mist-card mb-6 rounded-[1.8rem] p-4">
            <p className="text-sm font-medium text-[#b88a95]">{billingError}</p>
          </div>
        ) : null}

        <div className="mist-card mb-8 rounded-[1.8rem] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#988cb9]">
            {A.recap.title}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <p className="mist-soft">{A.recap.entries}</p>
              <p className="mt-1 text-2xl font-semibold text-[#5f5673]">{recap.entryCount}</p>
            </div>
            <div>
              <p className="mist-soft">{A.recap.moods}</p>
              <p className="mt-1 text-sm text-[#675e7c]">
                {formatCountItems(recap.topMoods, T.common.noData)}
              </p>
            </div>
            <div>
              <p className="mist-soft">{A.recap.locations}</p>
              <p className="mt-1 text-sm text-[#675e7c]">
                {formatCountItems(recap.topLocations, T.common.noData)}
              </p>
            </div>
            <div>
              <p className="mist-soft">{A.recap.symbols}</p>
              <p className="mt-1 text-sm text-[#675e7c]">
                {formatCountItems(recap.topSymbols, T.common.noData)}
              </p>
            </div>
          </div>
        </div>

        <DreamGrid entries={entries} />
      </main>
    </div>
  );
}
