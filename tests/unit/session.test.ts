import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { parseUserId, requireUserId, sessionUserId } from "@/lib/session";

describe("parseUserId", () => {
  it("accepts positive integer ids within the Postgres integer range", () => {
    expect(parseUserId("1")).toBe(1);
    expect(parseUserId("42")).toBe(42);
    expect(parseUserId("2147483647")).toBe(2_147_483_647);
  });

  it("rejects anything else", () => {
    for (const id of [undefined, null, "", "0", "-3", "007", "4.2", "42abc", " 42", "2147483648", "99999999999", 42]) {
      expect(parseUserId(id)).toBeNull();
    }
  });
});

describe("sessionUserId / requireUserId", () => {
  beforeEach(() => auth.mockReset());

  it("returns the signed-in user's id", async () => {
    auth.mockResolvedValue({ user: { id: "7" } });
    expect(await sessionUserId()).toBe(7);
    expect(await requireUserId()).toBe(7);
  });

  it("answers 401 with the UNAUTHORIZED code without a valid session", async () => {
    for (const session of [null, {}, { user: {} }, { user: { id: "abc" } }]) {
      auth.mockResolvedValue(session);
      expect(await sessionUserId()).toBeNull();
      const response = await requireUserId();
      expect(response).toBeInstanceOf(NextResponse);
      const res = response as NextResponse;
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    }
  });

  it("can carry a route's own body and headers", async () => {
    auth.mockResolvedValue(null);
    const res = (await requireUserId({ error: "请先登录", headers: { "Cache-Control": "no-store" } })) as NextResponse;
    expect(await res.json()).toEqual({ error: "请先登录" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
