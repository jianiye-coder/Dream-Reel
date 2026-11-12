import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  listDreamEntriesPage: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ ensureSchema: vi.fn(), getPool: () => ({ query: mocks.query }) }));
vi.mock("@/lib/authRateLimit", () => ({
  consumeAuthAttempt: vi.fn(async () => ({ allowed: true })),
  clearAuthAttempts: vi.fn(),
  getTrustedClientIp: vi.fn(() => null),
}));
vi.mock("@/lib/dreams", () => ({
  listDreamEntriesPage: mocks.listDreamEntriesPage,
  dreamEntryInputSchema: {}, dreamEntryTagsPatchSchema: {}, dreamEntryUpdateSchema: {},
}));
vi.mock("@/lib/billing", () => ({ checkAndConsumeUsage: vi.fn(), refundConsumedUsage: vi.fn() }));
vi.mock("@/lib/dreamAgentMetrics", () => ({ scheduleDreamAgentJournalSaved: vi.fn() }));

import { POST as register } from "@/app/api/auth/register/route";
import { GET as listDreams } from "@/app/api/dreams/route";
import { PUT as changePassword } from "@/app/api/user/password/route";

describe("route error codes", () => {
  it("answers a sign-up that loses the race for an address like any taken address", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT")) return { rows: [] };
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    });
    const res = await register(new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "A", email: "race@example.test", password: "123456" }),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "EMAIL_TAKEN" });
  });

  it("answers a malformed archive cursor with a code, not the error message", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "7" } });
    mocks.listDreamEntriesPage.mockRejectedValue(new RangeError("Invalid archive cursor"));
    const res = await listDreams(new NextRequest("http://localhost/api/dreams?cursor=garbage"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("only blames the new password when the new password is what's wrong", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "7" } });
    const put = (body: string) => changePassword(new NextRequest("http://localhost/api/user/password", { method: "PUT", body }));
    expect(await (await put(JSON.stringify({ currentPassword: "old", newPassword: "123" }))).json()).toEqual({ error: "INVALID_NEW_PASSWORD" });
    expect(await (await put(JSON.stringify({ currentPassword: "", newPassword: "123456" }))).json()).toEqual({ error: "INVALID_REQUEST" });
    const malformed = await put("not json");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("password_hash"), expect.anything());
  });
});
