import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { POST as register } from "@/app/api/auth/register/route";
import { PUT as changePassword } from "@/app/api/user/password/route";
import { PUT as updateProfile } from "@/app/api/user/profile/route";
import { ensureSchema, getPool } from "@/lib/db";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function request(method: "POST" | "PUT", path: string, body: unknown, ip = "203.0.113.7") {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
  });
}

databaseDescribe("account routes in PostgreSQL", () => {
  const run = Date.now();
  let n = 0;
  const email = () => `account-${run}-${++n}@example.test`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "integration-encryption-secret";
    await ensureSchema();
  });

  beforeEach(async () => {
    auth.mockResolvedValue(null);
    await getPool().query("DELETE FROM auth_rate_limits");
  });

  afterAll(async () => {
    await getPool().query("DELETE FROM users WHERE email LIKE $1", [`account-${run}-%`]);
    await getPool().query("DELETE FROM auth_rate_limits");
    await getPool().end();
    globalThis.dreamPool = undefined;
  });

  async function userRow(address: string) {
    const { rows } = await getPool().query<{ id: number; name: string; email: string; password_hash: string | null }>(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [address],
    );
    return rows[0];
  }

  async function registered(password = "old-password") {
    const address = email();
    expect((await register(request("POST", "/api/auth/register", { name: "Reader", email: address, password }))).status).toBe(201);
    const user = await userRow(address);
    auth.mockResolvedValue({ user: { id: String(user.id) } });
    return user;
  }

  describe("POST /api/auth/register", () => {
    it("stores a normalised address and a bcrypt hash, never the password", async () => {
      const address = email();
      const res = await register(request("POST", "/api/auth/register", {
        name: "  Night Writer  ",
        email: `  ${address.toUpperCase()}  `,
        password: "correct-horse",
      }));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });

      const user = await userRow(address);
      expect(user).toMatchObject({ name: "Night Writer", email: address });
      expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/);
      expect(user.password_hash).not.toContain("correct-horse");
      await expect(bcrypt.compare("correct-horse", user.password_hash!)).resolves.toBe(true);
    });

    it.each([
      ["a blank name", { name: "   ", email: "x@example.test", password: "123456" }],
      ["a malformed address", { name: "A", email: "not-an-email", password: "123456" }],
      ["a five-character password", { name: "A", email: "x@example.test", password: "12345" }],
      ["a password over 100 characters", { name: "A", email: "x@example.test", password: "p".repeat(101) }],
    ])("answers INVALID_REQUEST for %s without creating a user", async (_case, body) => {
      const res = await register(request("POST", "/api/auth/register", body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_REQUEST" });
      expect(await userRow(body.email.trim().toLowerCase())).toBeUndefined();
    });

    it("refuses an address that is already registered, whatever its case", async () => {
      const address = email();
      const body = { name: "First", email: address, password: "123456" };
      expect((await register(request("POST", "/api/auth/register", body))).status).toBe(201);
      const res = await register(request("POST", "/api/auth/register", { ...body, name: "Second", email: address.toUpperCase() }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "EMAIL_TAKEN" });
      expect((await userRow(address)).name).toBe("First");
    });

    it("rate-limits the fourth attempt for one address with Retry-After", async () => {
      const address = email();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await register(request("POST", "/api/auth/register", { name: "A", email: address, password: "123456" }, `198.51.100.${attempt}`));
        expect(res.status).not.toBe(429);
      }
      const res = await register(request("POST", "/api/auth/register", { name: "A", email: address, password: "123456" }, "198.51.100.99"));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(await res.json()).toEqual({ error: "RATE_LIMITED" });
    });
  });

  describe("PUT /api/user/password", () => {
    it("requires a session", async () => {
      const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "a", newPassword: "123456" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    });

    it("rejects a new password under six characters and keeps the hash", async () => {
      const user = await registered();
      const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "old-password", newPassword: "12345" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_NEW_PASSWORD" });
      expect((await userRow(user.email)).password_hash).toBe(user.password_hash);
    });

    it("keeps the hash when the current password is wrong", async () => {
      const user = await registered();
      const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "wrong-password", newPassword: "new-password" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "WRONG_PASSWORD" });
      expect((await userRow(user.email)).password_hash).toBe(user.password_hash);
    });

    it("replaces the hash so only the new password verifies, and resets the attempt count", async () => {
      const user = await registered();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await changePassword(request("PUT", "/api/user/password", { currentPassword: "wrong-password", newPassword: "new-password" }));
      }
      const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "old-password", newPassword: "new-password" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const { password_hash: hash } = await userRow(user.email);
      expect(hash).toMatch(/^\$2[aby]\$12\$/);
      await expect(bcrypt.compare("new-password", hash!)).resolves.toBe(true);
      await expect(bcrypt.compare("old-password", hash!)).resolves.toBe(false);
      // a success clears the five-per-window budget, so a later typo is not locked out
      const next = await changePassword(request("PUT", "/api/user/password", { currentPassword: "typo", newPassword: "newer-password" }));
      expect(next.status).toBe(400);
    });

    it("rate-limits the sixth attempt for one account, even from new addresses", async () => {
      const user = await registered();
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "wrong-password", newPassword: "new-password" }, `192.0.2.${attempt}`));
        expect(res.status).toBe(400);
      }
      const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "old-password", newPassword: "new-password" }, "192.0.2.99"));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("900");
      expect(await res.json()).toEqual({ error: "RATE_LIMITED" });
      expect((await userRow(user.email)).password_hash).toBe(user.password_hash);
    });

    it("refuses accounts that sign in with a provider and have no password", async () => {
      const address = email();
      const { rows } = await getPool().query<{ id: number }>("INSERT INTO users (email, name) VALUES ($1, 'OAuth') RETURNING id", [address]);
      auth.mockResolvedValue({ user: { id: String(rows[0].id) } });
      const res = await changePassword(request("PUT", "/api/user/password", { currentPassword: "anything", newPassword: "new-password" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "NO_PASSWORD" });
      expect((await userRow(address)).password_hash).toBeNull();
    });
  });

  describe("PUT /api/user/profile", () => {
    it("requires a session", async () => {
      const res = await updateProfile(request("PUT", "/api/user/profile", { name: "Someone" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    });

    it.each([["blank", "   "], ["over 100 characters", "n".repeat(101)], ["missing", undefined]])(
      "rejects a %s name and leaves the old one", async (_case, name) => {
        const user = await registered();
        const res = await updateProfile(request("PUT", "/api/user/profile", { name }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "INVALID_NAME" });
        expect((await userRow(user.email)).name).toBe("Reader");
      },
    );

    it("saves the trimmed name on the signed-in account only", async () => {
      const other = await registered();
      const user = await registered();
      const res = await updateProfile(request("PUT", "/api/user/profile", { name: "  Renamed Dreamer  " }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect((await userRow(user.email)).name).toBe("Renamed Dreamer");
      expect((await userRow(other.email)).name).toBe("Reader");
    });
  });
});
