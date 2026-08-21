import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/email";

describe("normalizeEmail", () => {
  it.each([
    ["User@example.com", "user@example.com"],
    ["  USER@EXAMPLE.COM  ", "user@example.com"],
    ["mixed.Case+tag@Example.com", "mixed.case+tag@example.com"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});
