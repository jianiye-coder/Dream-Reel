"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { LangToggle } from "@/components/LangToggle";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchBillingStatus, needsPaymentFix, openStripe, useBillingReturn, type ClientBillingStatus } from "@/lib/billingClient";

type Quota = ClientBillingStatus["limits"];

// usage drawn as ten little inked boxes
function Boxes({ used, total }: { used: number; total: number }) {
  const filled = total > 0 ? Math.min(10, Math.round((used / total) * 10)) : 0;
  return <span className="nb-boxes" aria-hidden>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < filled ? "nb-f" : undefined} />)}</span>;
}

export default function AccountPage() {
  const { lang, T } = useLanguage();
  const P = T.nbPaper;
  const B = T.billing;
  const { data: session, status, update: updateSession } = useSession();

  // ── Name ──────────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState("");
  const [nameErr, setNameErr] = useState("");

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
  }, [session?.user?.name]);

  async function saveName() {
    if (!name.trim()) return;
    setNameSaving(true); setNameMsg(""); setNameErr("");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        await updateSession({ name: name.trim() });
        setNameMsg(P.nameSaved);
      } else {
        const d = (await res.json()) as { error?: string };
        setNameErr(d.error ?? P.updateFailed);
      }
    } catch { setNameErr(P.networkError); }
    finally { setNameSaving(false); }
  }

  // ── Gender (device-local, used for image prompts) ─────────────────────────
  const [userGender, setUserGenderState] = useState("");
  useEffect(() => {
    try { setUserGenderState(localStorage.getItem("dreamReel_userGender") ?? ""); } catch {}
  }, []);
  function setUserGender(value: string) {
    try {
      if (value) localStorage.setItem("dreamReel_userGender", value);
      else localStorage.removeItem("dreamReel_userGender");
    } catch {}
    setUserGenderState(value);
  }

  // ── Password ──────────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  async function savePassword() {
    if (!currentPw || !newPw) return;
    setPwSaving(true); setPwMsg(""); setPwErr("");
    try {
      const res = await fetch("/api/user/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (res.ok) {
        setCurrentPw(""); setNewPw("");
        setPwMsg(P.passwordSaved);
      } else {
        const d = (await res.json()) as { error?: string };
        setPwErr(d.error ?? P.updateFailed);
      }
    } catch { setPwErr(P.networkError); }
    finally { setPwSaving(false); }
  }

  // ── Allowance (library card) ──────────────────────────────────────────────
  const [billing, setBilling] = useState<ClientBillingStatus | null>(null);
  const [billingState, setBillingState] = useState<"loading" | "ready" | "error">("loading");
  const [billingErr, setBillingErr] = useState("");
  const [billingNote, setBillingNote] = useState<"" | "upgradePending" | "upgradeSlow" | "upgraded" | "checkoutCancelled">("");
  const [opening, setOpening] = useState(false);
  async function loadBilling() {
    const s = await fetchBillingStatus();
    if (!s) throw new Error("status");
    setBilling(s); setBillingState("ready");
    return s;
  }
  useEffect(() => {
    if (!session?.user) return;
    loadBilling().catch(() => setBillingState("error"));
  }, [session?.user]);
  useBillingReturn({
    pending: () => setBillingNote("upgradePending"),
    active: () => setBillingNote("upgraded"),
    slow: () => setBillingNote("upgradeSlow"),
    cancelled: () => setBillingNote("checkoutCancelled"),
    isPlus: async () => (await loadBilling()).plan === "plus",
  });

  // the portal for a live subscription (also to fix a failed payment), checkout otherwise
  const managesSubscription = billing?.plan === "plus" || needsPaymentFix(billing);
  async function openBilling() {
    setBillingErr("");
    setOpening(true);
    const fallbackError = managesSubscription ? B.portalError : B.checkoutError;
    try {
      await openStripe(managesSubscription ? "portal" : "checkout", lang, "/account", fallbackError);
    } catch (error) {
      setBillingErr(error instanceof Error ? error.message : fallbackError);
      setOpening(false);
    }
  }

  const rows: [string, keyof Quota][] = [[P.cardDreams, "dreamEntries"], [P.cardAnalysis, "analysis"], [P.cardImages, "imageGenerations"]];
  const planLabel = billing?.isUnlimited ? B.planAdmin : billing?.plan === "plus" ? B.planPlus : B.planFree;
  // Free periods are UTC month boundaries, so show that calendar date; Plus periods end at the
  // Stripe timestamp, which is best shown in the reader's own time zone.
  const resetDate = billing
    ? new Date(billing.periodEnd).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "long", day: "numeric", ...(billing.plan === "plus" ? {} : { timeZone: "UTC" }),
    })
    : "";

  return (
    <NotebookShell surface="paper">
      <main className="nb-paper-main" id="main">
        <div className="nb-account">
          <section>
            <span className="nb-kicker">{P.accountKicker}</span>
            <div className="nb-owner">{status === "loading" ? "\u3000" : session?.user?.name || P.accountUnnamed}</div>
            <dl className="nb-facts">
              {session?.user?.email && <><dt>{P.email}</dt><dd>{session.user.email}<small>{P.emailFixed}</small></dd></>}
              <dt>{P.language}</dt><dd><LangToggle className="nb-act-quiet" /></dd>
            </dl>

            <div className="nb-account-block">
              <h2>{P.displayName}</h2>
              <label className="nb-field">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={P.namePlaceholder} onKeyDown={(e) => e.key === "Enter" && void saveName()} />
              </label>
              <div className="nb-row">
                <button type="button" className="nb-act" onClick={() => void saveName()} disabled={nameSaving || !name.trim()}>{nameSaving ? P.saving : P.save}</button>
                <p className={`nb-msg${nameMsg ? " nb-ok" : ""}`} role="status">{nameMsg || nameErr}</p>
              </div>
            </div>

            <div className="nb-account-block">
              <h2>{P.gender}</h2>
              <p className="nb-hint">{P.genderHint}</p>
              <div className="nb-ink-tabs">
                {P.genders.map(({ v, label }) => (
                  <button key={v} type="button" aria-pressed={userGender === v} onClick={() => setUserGender(userGender === v ? "" : v)}>{label}</button>
                ))}
                {userGender && <button type="button" className="nb-act-quiet" onClick={() => setUserGender("")}>{P.clear}</button>}
              </div>
            </div>

            <div className="nb-account-block">
              <h2>{P.password}</h2>
              <label className="nb-field"><span>{P.currentPassword}</span>
                <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
              </label>
              <label className="nb-field"><span>{P.newPassword}</span>
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && void savePassword()} />
              </label>
              <div className="nb-row">
                <button type="button" className="nb-act" onClick={() => void savePassword()} disabled={pwSaving || !currentPw || newPw.length < 6}>{pwSaving ? P.saving : P.updatePassword}</button>
                <p className={`nb-msg${pwMsg ? " nb-ok" : ""}`} role="status">{pwMsg || pwErr}</p>
              </div>
            </div>

            {session?.user && (
              <div className="nb-account-block">
                <button type="button" className="nb-act-quiet" onClick={() => void signOut({ callbackUrl: "/" })}>{P.signOut}</button>
              </div>
            )}
          </section>

          <section>
            <span className="nb-kicker">{B.usageLabel}</span>
            <div className="nb-card">
              <div className="nb-card-head"><b>{P.cardTitle}</b><span className="nb-mono" style={{ color: "var(--ink-faint)" }}>{billing ? planLabel.toUpperCase() : ""}</span></div>
              {billingState === "ready" && billing ? (
                <>
                  <table>
                    <thead><tr><th>{P.cardItem}</th><th>{P.cardUsed}</th><th style={{ textAlign: "right" }}>{P.cardLeft}</th></tr></thead>
                    <tbody>
                      {rows.map(([label, key]) => (
                        <tr key={key}>
                          <td>{label}</td>
                          <td>{billing.isUnlimited ? null : <Boxes used={billing.usage[key]} total={billing.limits[key]} />}</td>
                          <td className="nb-hand">{billing.isUnlimited ? P.cardUnlimited : billing.remaining[key]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="nb-card-foot"><span className="nb-mono">{P.cardResets.replace("{date}", resetDate)}</span></div>
                </>
              ) : (
                <p className="nb-msg" role="status" style={{ marginTop: 16 }}>{billingState === "error" ? P.cardError : P.cardLoading}</p>
              )}
            </div>
            {billing && !billing.isUnlimited && (
              <div className="nb-upsell">
                <p className="nb-body" style={{ maxWidth: "20em" }}>
                  {needsPaymentFix(billing) ? B.pastDue
                    : billing.plan === "plus" ? (billing.cancelAtPeriodEnd ? B.endsOn.replace("{date}", resetDate) : "")
                    : billing.checkoutAvailable ? P.upsell : B.comingSoonNote}
                </p>
                <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
                  {managesSubscription || billing.checkoutAvailable ? (
                    <button type="button" className="nb-act" onClick={() => void openBilling()} disabled={opening}>
                      {opening ? B.opening : managesSubscription ? B.manage : B.upgrade} <span aria-hidden>→</span>
                    </button>
                  ) : (
                    <span className="nb-mono" style={{ color: "var(--ink-faint)" }}>{B.comingSoon}</span>
                  )}
                  {!managesSubscription && <Link className="nb-act-quiet" href="/pricing">{P.seePlans}</Link>}
                </div>
              </div>
            )}
            {billingNote && <p className="nb-msg nb-ok" role="status" style={{ marginTop: 12 }}>{B[billingNote]}</p>}
            {billingErr && <p className="nb-msg" role="alert" style={{ marginTop: 12 }}>{billingErr}</p>}
          </section>
        </div>
      </main>
    </NotebookShell>
  );
}
