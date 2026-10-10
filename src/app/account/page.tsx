"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { LangToggle } from "@/components/LangToggle";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiErrorMessage } from "@/lib/apiErrors";

type Quota = { dreamEntries: number; analysis: number; imageGenerations: number };
type BillingStatus = { plan: "free" | "plus"; isUnlimited: boolean; periodEnd: string; limits: Quota; usage: Quota; remaining: Quota };

// usage drawn as ten little pencil boxes
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
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingState, setBillingState] = useState<"loading" | "ready" | "error">("loading");
  const [billingErr, setBillingErr] = useState("");
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/billing/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() as Promise<BillingStatus> : Promise.reject(new Error("status"))))
      .then((s) => { setBilling(s); setBillingState("ready"); })
      .catch(() => setBillingState("error"));
  }, [session?.user]);

  async function openBilling() {
    setBillingErr("");
    const endpoint = billing?.plan === "plus" ? "/api/billing/portal" : "/api/billing/checkout";
    const fallbackError = billing?.plan === "plus" ? B.portalError : B.checkoutError;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, currency: lang === "zh" ? "cny" : "usd" }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(getApiErrorMessage(data.error, lang, fallbackError));
      window.location.href = data.url;
    } catch (error) {
      setBillingErr(error instanceof Error ? error.message : fallbackError);
    }
  }

  const rows: [string, keyof Quota][] = [[P.cardDreams, "dreamEntries"], [P.cardAnalysis, "analysis"], [P.cardImages, "imageGenerations"]];
  const planLabel = billing?.isUnlimited ? B.planAdmin : billing?.plan === "plus" ? B.planPlus : B.planFree;
  const resetDate = billing ? new Date(billing.periodEnd).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "";

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
              <div className="nb-pencil-tabs">
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
                <p className="nb-body" style={{ maxWidth: "20em" }}>{billing.plan === "plus" ? "" : P.upsell}</p>
                <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
                  <button type="button" className="nb-act" onClick={() => void openBilling()}>{billing.plan === "plus" ? B.manage : B.upgrade} <span aria-hidden>→</span></button>
                  {billing.plan !== "plus" && <Link className="nb-act-quiet" href="/pricing">{P.seePlans}</Link>}
                </div>
              </div>
            )}
            {billingErr && <p className="nb-msg" role="alert" style={{ marginTop: 12 }}>{billingErr}</p>}
          </section>
        </div>
      </main>
    </NotebookShell>
  );
}
