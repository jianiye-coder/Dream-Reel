"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LangToggle } from "@/components/LangToggle";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mist-card rounded-[2rem] p-5 sm:p-6">
      <h2 className="mb-5 text-base font-semibold text-[#5f5673]">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="mist-label text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "mist-input w-full rounded-[1rem] px-3.5 py-2.5 text-sm transition";

export default function AccountPage() {
  const { lang, T } = useLanguage();
  const { data: session, update: updateSession } = useSession();

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
        setNameMsg(lang === "zh" ? "用户名已更新" : "Name updated");
      } else {
        const d = (await res.json()) as { error?: string };
        setNameErr(d.error ?? (lang === "zh" ? "更新失败" : "Update failed"));
      }
    } catch { setNameErr(lang === "zh" ? "网络错误" : "Network error"); }
    finally { setNameSaving(false); }
  }

  // ── Gender ────────────────────────────────────────────────────────────────
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
        setPwMsg(lang === "zh" ? "密码已更新" : "Password updated");
      } else {
        const d = (await res.json()) as { error?: string };
        setPwErr(d.error ?? (lang === "zh" ? "修改失败" : "Update failed"));
      }
    } catch { setPwErr(lang === "zh" ? "网络错误" : "Network error"); }
    finally { setPwSaving(false); }
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
          <Link href="/journal" className="mist-button-secondary rounded-full px-4 py-2 text-sm font-medium transition hover:bg-white/48">
            {T.nav.journal}
          </Link>
          <Link href="/archive" className="mist-button-secondary rounded-full px-4 py-2 text-sm font-medium transition hover:bg-white/48">
            {T.nav.archive}
          </Link>
          {session?.user && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="mist-button-secondary rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-white/48"
            >
              {T.login.signOut}
            </button>
          )}
        </div>
      </nav>

      <main className="relative z-10 mx-auto w-full max-w-2xl space-y-5 px-4 pb-20 pt-4 sm:px-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#978abd]">
            {lang === "zh" ? "账号设置" : "Account"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#5d5471]">
            {lang === "zh" ? "个人信息" : "Profile"}
          </h1>
        </div>

        {/* Gender */}
        <Section title={lang === "zh" ? "性别" : "Gender"}>
          <p className="mist-muted mb-3 text-sm leading-7">
            {lang === "zh"
              ? "设置你的性别后，Dream Reel 在生成梦境图像时会更准确地呈现画面中的你。"
              : "Setting your gender helps Dream Reel generate more accurate dream images."}
          </p>
          <div className="flex gap-2">
            {(lang === "zh"
              ? [{ v: "male", label: "男性" }, { v: "female", label: "女性" }, { v: "other", label: "其他" }]
              : [{ v: "male", label: "Male" }, { v: "female", label: "Female" }, { v: "other", label: "Other" }]
            ).map(({ v, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => setUserGender(userGender === v ? "" : v)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${userGender === v ? "mist-button" : "mist-button-secondary hover:bg-white/48"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {userGender && (
            <button type="button" onClick={() => setUserGender("")} className="mist-soft mt-2 text-xs hover:text-[#c58aa0]">
              {lang === "zh" ? "清除" : "Clear"}
            </button>
          )}
        </Section>

        {/* Username */}
        <Section title={lang === "zh" ? "用户名" : "Display Name"}>
          <div className="grid gap-3">
            <Field label={lang === "zh" ? "当前用户名" : "Name"}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder={lang === "zh" ? "你的名字" : "Your name"}
                onKeyDown={(e) => e.key === "Enter" && void saveName()}
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={nameSaving || !name.trim()}
                className="mist-button rounded-full px-5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {nameSaving ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "保存" : "Save")}
              </button>
              {nameMsg && <p className="text-sm text-[#7f9c8b]">{nameMsg}</p>}
              {nameErr && <p className="text-sm text-[#bb7f94]">{nameErr}</p>}
            </div>
          </div>
        </Section>

        {/* Account info (email read-only) */}
        {session?.user?.email && (
          <Section title={lang === "zh" ? "邮箱" : "Email"}>
            <p className="mist-input w-full rounded-[1rem] px-3.5 py-2.5 text-sm text-[#8b82a0]">
              {session.user.email}
            </p>
            <p className="mist-soft mt-2 text-xs">
              {lang === "zh" ? "邮箱目前不支持修改" : "Email cannot be changed at this time"}
            </p>
          </Section>
        )}

        {/* Password */}
        <Section title={lang === "zh" ? "修改密码" : "Change Password"}>
          <div className="grid gap-3">
            <Field label={lang === "zh" ? "当前密码" : "Current password"}>
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className={inputCls}
                autoComplete="current-password"
              />
            </Field>
            <Field label={lang === "zh" ? "新密码（至少 6 位）" : "New password (min. 6 chars)"}>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className={inputCls}
                autoComplete="new-password"
                onKeyDown={(e) => e.key === "Enter" && void savePassword()}
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void savePassword()}
                disabled={pwSaving || !currentPw || newPw.length < 6}
                className="mist-button rounded-full px-5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {pwSaving ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "更新密码" : "Update password")}
              </button>
              {pwMsg && <p className="text-sm text-[#7f9c8b]">{pwMsg}</p>}
              {pwErr && <p className="text-sm text-[#bb7f94]">{pwErr}</p>}
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
