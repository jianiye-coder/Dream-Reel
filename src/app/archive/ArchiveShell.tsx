"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";
import DreamGrid from "./DreamGrid";
import type { DreamEntry } from "@/lib/dreams";
import { getApiErrorMessage } from "@/lib/apiErrors";

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
  nextCursor,
  recap,
  dataError,
  user,
}: {
  entries: DreamEntry[];
  nextCursor: string | null;
  recap: WeeklyRecapShape;
  dataError: string;
  user: { name?: string | null; email?: string | null; image?: string | null } | null;
}) {
  const { lang, T } = useLanguage();
  const { archive: A } = T;
  const B = T.billing;
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState("");
  const [exporting, setExporting] = useState<"markdown" | "json" | null>(null);
  const [exportError, setExportError] = useState("");
  const [activeTab, setActiveTab] = useState<"calendar" | "tags" | "recent">(() => {
    try { return (localStorage.getItem("dream_archive_tab") as "calendar" | "tags" | "recent") ?? "calendar"; }
    catch { return "calendar"; }
  });
  useEffect(() => {
    try { localStorage.setItem("dream_archive_tab", activeTab); } catch {}
  }, [activeTab]);

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
      if (!res.ok || !data.url) {
        throw new Error(getApiErrorMessage(data.error, lang, fallbackError));
      }
      window.location.href = data.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : fallbackError);
    }
  }

  async function exportAllDreams(format: "markdown" | "json") {
    setExporting(format);
    setExportError("");
    try {
      const response = await fetch(`/api/dreams/export?format=${format}&lang=${lang}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(A.export.failed);

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `dream-reel-export-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "md"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch {
      setExportError(A.export.failed);
    } finally {
      setExporting(null);
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
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[#5d5471]">
              {A.title}
            </h1>
            <p className="mist-muted mt-3 max-w-2xl text-sm leading-7">{A.desc}</p>
          </div>
          <div className="archive-export-panel shrink-0 rounded-[1.25rem] border border-white/35 bg-white/28 p-2 backdrop-blur-md">
            <p className="archive-export-label px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9185ae]">
              {exporting ? A.export.exporting : A.export.title}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void exportAllDreams("markdown")}
                disabled={exporting !== null}
                className="archive-export-action mist-button-secondary rounded-full px-3 py-2 text-xs font-medium transition hover:bg-white/55 disabled:opacity-50"
              >
                ↓ {A.export.markdown}
              </button>
            </div>
            {exportError ? <p className="px-2 pt-2 text-xs text-[#b8758f]">{exportError}</p> : null}
          </div>
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

        {/* Full-page tab bar */}
        <div className="archive-tabs mb-6">
          {(["calendar", "tags", "recent"] as const).map((tab) => {
            const label = tab === "calendar" ? A.grid.tabCalendar : tab === "tags" ? A.grid.tabTags : A.grid.tabRecent;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`archive-tab ${activeTab === tab ? "archive-tab-active" : ""}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <DreamGrid entries={entries} nextCursor={nextCursor} activeTab={activeTab} />
      </main>
    </div>
  );
}
