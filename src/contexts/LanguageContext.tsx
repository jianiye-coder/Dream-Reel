"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type Lang, type Translations, translations } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  T: Translations;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  T: translations.en,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en"); // English first; a saved choice (dreamreel-lang) still wins

  useEffect(() => {
    const saved = localStorage.getItem("dreamreel-lang") as Lang | null;
    if (saved === "zh" || saved === "en") {
      setLangState(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  function setLang(next: Lang) {
    setLangState(next);
    localStorage.setItem("dreamreel-lang", next);
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, T: translations[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
