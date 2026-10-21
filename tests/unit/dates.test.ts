import { describe, expect, it } from "vitest";
import { cnNumber, localDayKey, writtenDate } from "@/lib/dates";

describe("cnNumber", () => {
  it("writes every month and day number the way a date is written", () => {
    const cases: [number, string][] = [
      [1, "一"], [5, "五"], [9, "九"], [10, "十"], [11, "十一"], [15, "十五"], [19, "十九"],
      [20, "二十"], [21, "二十一"], [29, "二十九"], [30, "三十"], [31, "三十一"],
    ];
    for (const [n, text] of cases) expect(cnNumber(n)).toBe(text);
  });
});

describe("localDayKey", () => {
  it("formats the local calendar day with zero padding", () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDayKey(new Date(2026, 9, 15, 0, 1))).toBe("2026-10-15");
  });

  it("defaults to today", () => {
    expect(localDayKey()).toBe(localDayKey(new Date()));
  });
});

describe("writtenDate", () => {
  it("writes a Chinese date in numerals with its weekday", () => {
    expect(writtenDate(new Date(2026, 9, 15), "zh")).toEqual({ day: "十月十五日", weekday: "周四" });
    expect(writtenDate(new Date(2026, 11, 31), "zh")).toEqual({ day: "十二月三十一日", weekday: "周四" });
    expect(writtenDate(new Date(2026, 1, 1), "zh")).toEqual({ day: "二月一日", weekday: "周日" });
  });

  it("matches the zh-CN short weekday for every day of the week", () => {
    for (let d = 11; d <= 17; d++) {
      const date = new Date(2026, 9, d);
      expect(writtenDate(date, "zh").weekday).toBe(date.toLocaleDateString("zh-CN", { weekday: "short" }));
    }
  });

  it("writes an English date as month, day and full weekday", () => {
    expect(writtenDate(new Date(2026, 9, 15), "en")).toEqual({ day: "October 15", weekday: "Thursday" });
  });
});
