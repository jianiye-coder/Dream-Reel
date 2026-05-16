"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/journal";
  const { T } = useLanguage();
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
          setError(d.error ?? L.registerFailed);
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
        setError(L.wrongCredentials);
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
    <div className="journal-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="grain-overlay" aria-hidden />
      <div className="dream-orb orb-1" aria-hidden />
      <div className="dream-orb orb-2" aria-hidden />
      <div className="dream-orb orb-3" aria-hidden />

      {/* Lang toggle — top right */}
      <div style={{ position: "fixed", top: "1.25rem", right: "1.5rem", zIndex: 20 }}>
        <LangToggle className="nav-btn" />
      </div>

      <div style={{
        position: "relative",
        zIndex: 10,
        width: "100%",
        maxWidth: "420px",
        margin: "0 1.5rem",
        background: "linear-gradient(160deg, rgba(22, 14, 48, 0.88), rgba(14, 10, 32, 0.92))",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(178, 148, 226, 0.2)",
        borderRadius: "1.75rem",
        padding: "2.5rem 2.25rem 2rem",
        boxShadow: "0 0 80px rgba(100, 72, 180, 0.18), 0 2px 0 rgba(255,255,255,0.04) inset",
        animation: "msg-in 0.5s cubic-bezier(0.22,1,0.36,1) both",
      }}>
        {/* Logo */}
        <Link href="/" className="nav-logo" style={{ display: "inline-flex", marginBottom: "1.75rem", gap: "0.55rem", textDecoration: "none" }}>
          <span className="logo-moon" style={{ fontSize: "1.2rem" }}>☾</span>
          <span className="logo-text" style={{ fontSize: "1rem", letterSpacing: "0.06em" }}>Dream Reel</span>
        </Link>

        {/* Heading */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{
            fontSize: "1.35rem",
            fontWeight: 500,
            fontFamily: "Georgia, 'Times New Roman', serif",
            color: "rgba(234, 224, 255, 0.96)",
            marginBottom: "0.3rem",
            letterSpacing: "0.01em",
          }}>
            {isRegister ? L.createAccount : L.welcomeBack}
          </h1>
          <p style={{ fontSize: "0.8rem", color: "rgba(185, 168, 225, 0.52)" }}>
            {isRegister ? L.createAccountDesc : L.welcomeBackDesc}
          </p>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: "flex",
          background: "rgba(30, 18, 62, 0.55)",
          borderRadius: "0.75rem",
          padding: "0.22rem",
          marginBottom: "1.5rem",
          border: "1px solid rgba(140, 115, 200, 0.14)",
        }}>
          {(["signin", "register"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(""); }}
              style={{
                flex: 1,
                padding: "0.42rem 0.5rem",
                borderRadius: "0.55rem",
                border: "none",
                fontSize: "0.77rem",
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s",
                background: tab === t
                  ? "linear-gradient(135deg, rgba(108, 78, 190, 0.72), rgba(72, 90, 175, 0.6))"
                  : "transparent",
                color: tab === t ? "rgba(230, 218, 255, 0.95)" : "rgba(168, 148, 215, 0.5)",
                boxShadow: tab === t ? "0 0 14px rgba(110, 78, 188, 0.22)" : "none",
              }}
            >
              {t === "signin" ? L.signIn : L.register}
            </button>
          ))}
        </div>

        {/* Credentials form */}
        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {isRegister && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={L.name}
              required={isRegister}
              className="dream-input-sm"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={L.email}
            required
            className="dream-input-sm"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={L.password}
            required
            minLength={6}
            className="dream-input-sm"
            style={{ width: "100%", boxSizing: "border-box" }}
          />

          {error && (
            <p style={{ fontSize: "0.77rem", color: "rgba(220, 130, 148, 0.9)", margin: "0.1rem 0" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="tool-btn action-primary"
            style={{ width: "100%", marginTop: "0.25rem", justifyContent: "center", opacity: isLoading ? 0.6 : 1 }}
          >
            {isLoading ? L.loading : isRegister ? L.submitRegister : L.submitSignIn}
          </button>
        </form>

        <p style={{ marginTop: "1.25rem", textAlign: "center", fontSize: "0.77rem", color: "rgba(165, 148, 215, 0.5)" }}>
          {isRegister ? L.hasAccount : L.noAccount}
          <button
            type="button"
            onClick={() => { setTab(isRegister ? "signin" : "register"); setError(""); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(185, 165, 238, 0.78)", fontSize: "0.77rem",
              textDecoration: "underline", textUnderlineOffset: "2px", padding: "0 0 0 0.3rem",
            }}
          >
            {isRegister ? L.goSignIn : L.goRegister}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
