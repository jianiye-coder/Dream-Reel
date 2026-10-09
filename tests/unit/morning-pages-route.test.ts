import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => vi.fn());
const pages = vi.hoisted(() => ({
  getMorningPage: vi.fn(), listMorningPages: vi.fn(),
  putMorningPage: vi.fn(), deleteMorningPage: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ ensureSchema: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/morningPages", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/morningPages")>(), ...pages,
}));

import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "@/app/api/morning-pages/route";
import { MorningPageConflictError } from "@/lib/morningPages";

const date = "2026-10-07";
const entry = { date, content: "private writing", revision: 1, updatedAt: "2026-10-07T12:00:00.000Z" };
const input = { date, content: entry.content, revision: 0 };
const handlers = { GET, PUT, DELETE };
type Method = keyof typeof handlers;

function request(method: Method, body: unknown = input, query = "") {
  return new NextRequest(`http://localhost/api/morning-pages${query}`, {
    method,
    ...(method === "GET" ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

function expectPrivate(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ user: { id: "42" } });
  pages.getMorningPage.mockResolvedValue(entry);
  pages.listMorningPages.mockResolvedValue([{ date, updatedAt: entry.updatedAt }]);
  pages.putMorningPage.mockResolvedValue(entry);
  pages.deleteMorningPage.mockResolvedValue(undefined);
});

describe.each<Method>(["GET", "PUT", "DELETE"])("%s authentication and failures", (method) => {
  it.each([undefined, null, "", "0", "-1", "1.5", "42junk", "1e2", "0x2a", " 42", "42 ", "01", "+42", "Infinity", "9007199254740992", "2147483648", 42, true])(
    "rejects invalid auth id %j before accessing pages", async (id) => {
      auth.mockResolvedValue({ user: { id } });
      const response = await handlers[method](request(method));
      expectPrivate(response, 401);
      await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
      Object.values(pages).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    },
  );

  it("rejects a missing session", async () => {
    auth.mockResolvedValue(null);
    expectPrivate(await handlers[method](request(method)), 401);
  });

  it("keeps authentication failures private", async () => {
    auth.mockRejectedValue(new Error("sensitive session information"));
    const response = await handlers[method](request(method));
    expectPrivate(response, 500);
    await expect(response.json()).resolves.toEqual({ error: "INTERNAL_ERROR" });
  });

  it("does not log or return private error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.values(pages).forEach((fn) => fn.mockRejectedValue(new Error("private writing from database error")));
    const response = await handlers[method](request(method));
    expectPrivate(response, 500);
    await expect(response.json()).resolves.toEqual({ error: "INTERNAL_ERROR" });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("GET /api/morning-pages", () => {
  it("gets a date only for the authenticated owner", async () => {
    const response = await GET(request("GET", undefined, `?date=${date}&userId=999`));
    expectPrivate(response, 200);
    await expect(response.json()).resolves.toEqual({ entry });
    expect(pages.getMorningPage).toHaveBeenCalledWith(42, date);
    expect(pages.listMorningPages).not.toHaveBeenCalled();
  });

  it("returns null for a missing page", async () => {
    pages.getMorningPage.mockResolvedValue(null);
    const response = await GET(request("GET", undefined, `?date=${date}`));
    expectPrivate(response, 200);
    await expect(response.json()).resolves.toEqual({ entry: null });
  });

  it("returns owner-scoped metadata when no date is provided", async () => {
    const response = await GET(request("GET"));
    expectPrivate(response, 200);
    await expect(response.json()).resolves.toEqual({ entries: [{ date, updatedAt: entry.updatedAt }] });
    expect(pages.listMorningPages).toHaveBeenCalledWith(42);
    expect(pages.getMorningPage).not.toHaveBeenCalled();
  });

  it.each(["?date=", "?date=2026-02-29", "?date=2026-04-31", "?date=2026-1-1", "?date=2026-01-01&date=2026-01-02"])(
    "rejects invalid date query %s", async (query) => {
      expectPrivate(await GET(request("GET", undefined, query)), 400);
      Object.values(pages).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    },
  );
});

describe.each<"PUT" | "DELETE">(["PUT", "DELETE"])("%s mutations", (method) => {
  it("uses the session owner even if the request supplies another user", async () => {
    const response = await handlers[method](request(method, { ...input, userId: 999 }));
    expectPrivate(response, 200);
    if (method === "PUT") {
      expect(pages.putMorningPage).toHaveBeenCalledWith(42, input);
      await expect(response.json()).resolves.toEqual({ entry });
    } else {
      expect(pages.deleteMorningPage).toHaveBeenCalledWith(42, { date, revision: 0 });
      await expect(response.json()).resolves.toEqual({ ok: true });
    }
  });

  it("returns a private 409 for a stale revision", async () => {
    pages.putMorningPage.mockRejectedValue(new MorningPageConflictError());
    pages.deleteMorningPage.mockRejectedValue(new MorningPageConflictError());
    const response = await handlers[method](request(method));
    expectPrivate(response, 409);
    await expect(response.json()).resolves.toEqual({ error: "CONFLICT" });
  });

  it.each([
    null, {}, { ...input, date: "2026-02-29" }, { ...input, date: "0000-01-01" },
    { ...input, revision: -1 }, { ...input, revision: 1.1 }, { ...input, revision: "1" },
    { ...input, revision: null }, { ...input, revision: undefined }, { ...input, revision: 2_147_483_648 },
  ])("rejects invalid body %j", async (body) => {
    expectPrivate(await handlers[method](request(method, body)), 400);
    expect(pages.putMorningPage).not.toHaveBeenCalled();
    expect(pages.deleteMorningPage).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await handlers[method](new NextRequest("http://localhost/api/morning-pages", {
      method, body: "{broken",
    }));
    expectPrivate(response, 400);
  });
});

describe("PUT content validation", () => {
  it.each(["", "  keep whitespace\n", "a".repeat(50_000)])("accepts content within the limit (case %#)", async (content) => {
    expectPrivate(await PUT(request("PUT", { ...input, content })), 200);
    expect(pages.putMorningPage).toHaveBeenCalledWith(42, { ...input, content });
  });

  it.each([null, 123, undefined, "a".repeat(50_001)])("rejects invalid content (case %#)", async (content) => {
    expectPrivate(await PUT(request("PUT", { ...input, content })), 400);
    expect(pages.putMorningPage).not.toHaveBeenCalled();
  });
});

it("keeps unsupported methods and OPTIONS private", () => {
  expectPrivate(POST(), 405);
  expectPrivate(PATCH(), 405);
  const response = OPTIONS();
  expectPrivate(response, 204);
  expect(response.headers.get("Allow")).toBe("GET, HEAD, PUT, DELETE, OPTIONS");
});
