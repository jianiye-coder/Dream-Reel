"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";
import { getApiErrorMessage } from "@/lib/apiErrors";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/journal";
  const { lang, T } = useLanguage();
  const L = T.login;

  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isRegister = tab === "register";

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
    <main className="auth-page">
      <header className="auth-header">
        <Link href="/" className="morning-brand">
          <Image src="/dream-reel-logo.png" width={40} height={40} alt="" aria-hidden />
          <span>Dream Reel</span>
        </Link>
        <LangToggle className="morning-language" />
      </header>

      <section className="auth-shell" aria-labelledby="auth-title">
        <div className="auth-intro">
          <p className="morning-eyebrow">{lang === "zh" ? "你的晨间梦境档案" : "Your morning dream archive"}</p>
          <h1>{lang === "zh" ? "醒来后，从这里继续。" : "Continue from here when you wake."}</h1>
          <p>{lang === "zh" ? "安全地保存梦境，与 Agent 一起回忆，并观察只属于你的长期线索。" : "Keep dreams safely, recall them with the Agent, and notice patterns that belong only to you."}</p>
        </div>

        <div className="auth-card">
          <Link href="/" className="auth-card-brand" aria-label="Dream Reel home">
            <Image src="/dream-reel-logo.png" width={32} height={32} alt="" aria-hidden />
            <span>Dream Reel</span>
          </Link>

          <div className="auth-card-heading">
            <h2 id="auth-title">
              {isRegister ? L.createAccount : L.welcomeBack}
            </h2>
            <p>
              {isRegister ? L.createAccountDesc : L.welcomeBackDesc}
            </p>
          </div>

        <div className="auth-tabs" role="tablist" aria-label={lang === "zh" ? "账号操作" : "Account action"}>
          {(["signin", "register"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(""); }}
              className={tab === t ? "is-active" : ""}
              role="tab"
              aria-selected={tab === t}
            >
              {t === "signin" ? L.signIn : L.register}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="auth-form">
          {isRegister && (
            <label className="auth-field">
              <span>{L.name}</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required={isRegister} />
            </label>
          )}
          <label className="auth-field">
            <span>{L.email}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="auth-field">
            <span>{L.password}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isRegister ? "new-password" : "current-password"} required minLength={6} />
          </label>

          {error && (
            <p className="auth-error" role="alert">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="auth-submit"
          >
            {isLoading ? L.loading : isRegister ? L.submitRegister : L.submitSignIn}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? L.hasAccount : L.noAccount}
          <button
            type="button"
            onClick={() => { setTab(isRegister ? "signin" : "register"); setError(""); }}
          >
            {isRegister ? L.goSignIn : L.goRegister}
          </button>
        </p>
      </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
