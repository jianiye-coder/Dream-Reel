import type { Lang } from "./i18n";

// Calendar helpers shared by the notebook pages. They read the browser's local calendar.

/** "2026-10-15": the local calendar day of `date` (default: now). */
export function localDayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const CN_DIGITS = "〇一二三四五六七八九";

/** 1–99 in Chinese numerals the way a date is written: 五, 十, 十五, 二十, 三十一. */
export function cnNumber(n: number): string {
  if (n <= 10) return n === 10 ? "十" : CN_DIGITS[n];
  if (n < 20) return "十" + CN_DIGITS[n % 10];
  return CN_DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? CN_DIGITS[n % 10] : "");
}

/** The date as you would write it at the top of a page: 十月十五日 / 周四, or October 15 / Thursday. */
export function writtenDate(date: Date, lang: Lang): { day: string; weekday: string } {
  if (lang === "zh") {
    return {
      day: `${cnNumber(date.getMonth() + 1)}月${cnNumber(date.getDate())}日`,
      weekday: "周" + "日一二三四五六"[date.getDay()],
    };
  }
  return {
    day: date.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
    weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
  };
}
