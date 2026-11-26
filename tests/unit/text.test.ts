import { describe, expect, it } from "vitest";
import { cleanList, limitText } from "@/lib/text";

describe("limitText", () => {
  it("trims, then cuts to the limit without a trailing space", () => {
    expect(limitText("  外婆家的走廊  ", 10)).toBe("外婆家的走廊");
    expect(limitText("a long title here", 7)).toBe("a long");
    expect(limitText("   ", 5)).toBe("");
  });
});

describe("cleanList", () => {
  it("drops blanks and case-insensitive repeats, limits each item and the count", () => {
    expect(cleanList([" Door ", "door", "", "  ", "Hallway", "Grandmother", "Stairs"], 3, 7))
      .toEqual(["Door", "Hallway", "Grandmo"]);
  });
});
