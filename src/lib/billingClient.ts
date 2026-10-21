"use client";

import { useEffect, useRef } from "react";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { Lang } from "@/lib/i18n";

/* Browser side of billing: what /api/billing/status returns, opening Stripe, and the notice
   shown when Stripe sends the reader back. */

type Quota = { dreamEntries: number; analysis: number; imageGenerations: number };

export type ClientBillingStatus = {
  plan: "free" | "plus";
  isUnlimited: boolean;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: string;
  limits: Quota;
  usage: Quota;
  remaining: Quota;
  /** false until payments are switched on; upgrade buttons then say "coming soon" */
  checkoutAvailable: boolean;
};

/** Plus dream entries are "unlimited", stored as a 9999 cap (PLAN_LIMITS in billing.ts); never show the number. */
export const UNLIMITED_QUOTA = 9999;
export const isUnlimitedQuota = (status: Pick<ClientBillingStatus, "isUnlimited" | "limits">, key: keyof Quota) =>
  status.isUnlimited || status.limits[key] >= UNLIMITED_QUOTA;

export type BillingFrom = "/pricing" | "/account" | "/journal";

/** A Stripe subscription the reader still has to settle (it's theirs, but Plus is paused). */
export const needsPaymentFix = (status: { subscriptionStatus?: string | null } | null) =>
  status?.subscriptionStatus === "past_due" || status?.subscriptionStatus === "unpaid";

export async function fetchBillingStatus(): Promise<ClientBillingStatus | null> {
  const res = await fetch("/api/billing/status", { cache: "no-store" });
  return res.ok ? (await res.json()) as ClientBillingStatus : null;
}

/** Sends the reader to Stripe Checkout or the customer portal; throws a readable message. */
export async function openStripe(kind: "checkout" | "portal", lang: Lang, from: BillingFrom, fallback: string) {
  let data: { url?: string; error?: string } = {};
  let ok = false;
  try {
    const res = await fetch(`/api/billing/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang, from }),
    });
    ok = res.ok;
    data = await res.json().catch(() => ({}));
  } catch {
    throw new Error(fallback);
  }
  if (!ok || !data.url) throw new Error(getApiErrorMessage(data.error, lang, fallback));
  window.location.assign(data.url);
}

/**
 * Handles `?upgraded=1` and `?billing=cancelled` once: tidies the address bar, tells the page,
 * and after a payment keeps asking `isPlus` for a little while, because the webhook that turns
 * Plus on can land a few seconds after Stripe redirects back.
 */
export function useBillingReturn(handlers: {
  pending: () => void;
  active: () => void;
  /** the webhook hasn't landed after ~25 s */
  slow: () => void;
  cancelled: () => void;
  isPlus: () => Promise<boolean>;
}) {
  const ref = useRef(handlers);
  useEffect(() => { ref.current = handlers; });
  // read once per mount (survives the dev-mode double effect after the URL is tidied)
  const outcome = useRef<"upgraded" | "cancelled" | "none" | null>(null);

  useEffect(() => {
    if (outcome.current === null) {
      const url = new URL(window.location.href);
      outcome.current = url.searchParams.get("upgraded") === "1"
        ? "upgraded"
        : url.searchParams.get("billing") === "cancelled" ? "cancelled" : "none";
      if (outcome.current !== "none") {
        url.searchParams.delete("upgraded");
        url.searchParams.delete("billing");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
    if (outcome.current === "cancelled") { ref.current.cancelled(); return; }
    if (outcome.current !== "upgraded") return;

    ref.current.pending();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const check = async () => {
      const plus = await ref.current.isPlus().catch(() => false);
      if (stopped) return;
      if (plus) { ref.current.active(); return; }
      if (++tries < 10) timer = setTimeout(() => void check(), 2500);
      else ref.current.slow();
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
}
