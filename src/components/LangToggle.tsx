"use client";

import { useLanguage } from "@/contexts/LanguageContext";

interface LangToggleProps {
  className?: string;
}

export function LangToggle({ className }: LangToggleProps) {
  const { lang, setLang } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      className={className}
      aria-label={lang === "zh" ? "Switch to English" : "切换中文"}
    >
      {lang === "zh" ? "EN" : "中"}
    </button>
  );
}
