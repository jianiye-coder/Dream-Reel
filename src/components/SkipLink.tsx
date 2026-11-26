"use client";

import { useLanguage } from "@/contexts/LanguageContext";

export function SkipLink() {
  const { lang } = useLanguage();
  return (
    <a className="skip-link" href="#main-content">
      {lang === "zh" ? "跳至主要内容" : "Skip to main content"}
    </a>
  );
}
