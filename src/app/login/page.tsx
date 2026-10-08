"use client";

import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { stroke } from "@/lib/notebookSound";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/journal";
  const { lang, T } = useLanguage();
  const L = T.login;
  const P = T.nbPaper;

  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isRegister = tab === "register";
  // the bookplate shows the name being written, or the start of the email while signing in
  const owner = (isRegister && name) || email.split("@")[0] || "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isRegister) {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          setError(getApiErrorMessage(d.error, lang, L.registerFailed));
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        const authResult = result as typeof result & { code?: string };
        if (authResult.code === "rate_limited") {
          setError(L.rateLimited);
        } else if (result.error === "Configuration") {
          setError(L.serviceUnavailable);
        } else {
          setError(L.wrongCredentials);
        }
      } else if (result?.url) {
        window.location.assign(result.url);
      }
    } catch {
      setError(L.networkError);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <NotebookShell surface="paper">
      <main className="nb-auth" id="main">
        <div className="nb-plate" aria-hidden>
          <div className="nb-plate-in">
            <div className="nb-ex">{P.exLibris}</div>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#1f1c17" strokeWidth="1.2">
              <path d="M40 8a24 24 0 1 0 16 38A20 20 0 0 1 40 8z" />
              <path d="M14 52h36M20 57h24" strokeWidth=".9" />
              <circle cx="46" cy="20" r="1.4" fill="#b0432e" stroke="none" />
            </svg>
            <div className="nb-belongs">{P.belongsTo}</div>
            <div className="nb-owner">{owner || "　"}</div>
            <div className="nb-since">{P.plateSince}</div>
          </div>
        </div>

        <div className="nb-auth-form">
          <span className="nb-kicker">{P.authKicker}</span>
          <h1>{isRegister ? P.authTitleUp : P.authTitleIn}</h1>
          <div className="nb-pencil-tabs" role="tablist" aria-label={P.authTabs}>
            {(["signin", "register"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setError(""); stroke(0.5); }}>
                {t === "signin" ? L.signIn : L.register}
              </button>
            ))}
          </div>

          <form onSubmit={(e) => void handleSubmit(e)}>
            {isRegister && (
              <label className="nb-field">
                <span>{L.name} · {P.authNameHint}</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required={isRegister} />
              </label>
            )}
            <label className="nb-field">
              <span>{L.email}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>
            <label className="nb-field">
              <span>{L.password}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isRegister ? "new-password" : "current-password"} required minLength={6} />
            </label>

            <p className="nb-msg" role="alert">{error}</p>

            <div className="nb-submit">
              <button type="submit" className="nb-act" disabled={isLoading}>
                {isLoading ? L.loading : isRegister ? P.authSubmitUp : P.authSubmitIn} <span aria-hidden>→</span>
              </button>
              <span className="nb-act-quiet">
                {isRegister ? L.hasAccount : L.noAccount}{" "}
                <button type="button" onClick={() => { setTab(isRegister ? "signin" : "register"); setError(""); }}>
                  {isRegister ? L.goSignIn : L.goRegister}
                </button>
              </span>
            </div>
          </form>
          <p className="nb-fine">{P.authFine}</p>
        </div>
      </main>
    </NotebookShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
