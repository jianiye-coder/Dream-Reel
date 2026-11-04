import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { CredentialsSignin, type NextAuthConfig } from "next-auth";

// Auth.js itself doesn't load outside Next (it imports next/server); stand in for it and
// capture the config src/auth.ts hands it, so the credentials check and the JWT / session
// callbacks run as they do in production.
const captured = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error { code = "credentials"; },
  default: (config: unknown) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (options: unknown) => options }));

import "@/auth";
import { authConfig } from "@/auth.config";
import { ensureSchema, getPool } from "@/lib/db";

type Authorize = (credentials: unknown, request: Request) => Promise<{ id: string; name: string; email: string; image: string | null } | null>;
const config = () => captured.config as NextAuthConfig & { providers: Array<{ authorize: Authorize }> };
const authorize = (credentials: unknown, ip = "203.0.113.9") =>
  config().providers[0].authorize(credentials, new Request("http://localhost/api/auth/callback/credentials", { headers: { "x-real-ip": ip } }));
type Jwt = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
type SessionCallback = (params: Record<string, unknown>) => { user?: { id?: string } };

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describe("authConfig (shared with the proxy)", () => {
  const authorized = authConfig.callbacks!.authorized! as (params: { auth: unknown }) => boolean;

  it("lets a session with a user through and sends everyone else to /login", () => {
    expect(authorized({ auth: { user: { id: "1" } } })).toBe(true);
    expect(authorized({ auth: null })).toBe(false);
    expect(authorized({ auth: { expires: "2099-01-01" } })).toBe(false);
    expect(authConfig.pages?.signIn).toBe("/login");
  });
});

databaseDescribe("credentials sign-in in PostgreSQL", () => {
  const run = Date.now();
  let n = 0;
  const email = () => `signin-${run}-${++n}@example.test`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "integration-encryption-secret";
    await ensureSchema();
  });

  beforeEach(async () => {
    await getPool().query("DELETE FROM auth_rate_limits");
  });

  afterAll(async () => {
    await getPool().query("DELETE FROM users WHERE email LIKE $1", [`signin-${run}-%`]);
    await getPool().query("DELETE FROM auth_rate_limits");
    await getPool().end();
    globalThis.dreamPool = undefined;
  });

  async function createUser(password: string | null, name = "Sleeper") {
    const address = email();
    const hash = password === null ? null : await bcrypt.hash(password, 4);
    const { rows } = await getPool().query<{ id: number }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [address, name, hash],
    );
    return { id: rows[0].id, email: address };
  }

  it("signs in with the address in any case and spacing, returning only public fields", async () => {
    const user = await createUser("correct-horse");
    const signedIn = await authorize({ email: `  ${user.email.toUpperCase()} `, password: "correct-horse" });
    expect(signedIn).toEqual({ id: String(user.id), name: "Sleeper", email: user.email, image: null });
  });

  it("returns null for a wrong password, an unknown address and a provider-only account", async () => {
    const user = await createUser("correct-horse");
    const oauthOnly = await createUser(null);
    await expect(authorize({ email: user.email, password: "wrong-horse" })).resolves.toBeNull();
    await expect(authorize({ email: email(), password: "correct-horse" })).resolves.toBeNull();
    await expect(authorize({ email: oauthOnly.email, password: "correct-horse" })).resolves.toBeNull();
  });

  it("rejects malformed credentials before touching the rate limit", async () => {
    await expect(authorize({ email: "not-an-email", password: "correct-horse" })).resolves.toBeNull();
    await expect(authorize({ email: email(), password: "12345" })).resolves.toBeNull();
    const { rows } = await getPool().query("SELECT 1 FROM auth_rate_limits");
    expect(rows).toHaveLength(0);
  });

  it("locks an address after ten failures with a rate_limited sign-in error, even with the right password", async () => {
    const user = await createUser("correct-horse");
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(authorize({ email: user.email, password: "wrong-horse" }, `198.51.100.${attempt}`)).resolves.toBeNull();
    }
    const locked = authorize({ email: user.email, password: "correct-horse" }, "198.51.100.99");
    await expect(locked).rejects.toBeInstanceOf(CredentialsSignin);
    await expect(locked).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("clears the failure count after a successful sign-in", async () => {
    const user = await createUser("correct-horse");
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await authorize({ email: user.email, password: "wrong-horse" });
    }
    await expect(authorize({ email: user.email, password: "correct-horse" })).resolves.not.toBeNull();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(authorize({ email: user.email, password: "wrong-horse" })).resolves.toBeNull();
    }
  });

  it("puts the user id on the token and the session, and refreshes the name from the database on update", async () => {
    const user = await createUser("correct-horse", "Old Name");
    const jwt = config().callbacks!.jwt! as unknown as Jwt;
    const session = config().callbacks!.session! as unknown as SessionCallback;

    const token = await jwt({ token: { name: "Old Name" }, user: { id: String(user.id) } });
    expect(token.id).toBe(String(user.id));
    expect(session({ session: { user: {} }, token })).toMatchObject({ user: { id: String(user.id) } });

    await getPool().query("UPDATE users SET name = 'New Name' WHERE id = $1", [user.id]);
    // the client's update payload is ignored: the name comes from the users table
    await expect(jwt({ token, trigger: "update", session: { name: "Spoofed" } })).resolves.toMatchObject({ name: "New Name" });
  });

  it("keeps the old name instead of signing the user out when the refresh query fails", async () => {
    const jwt = config().callbacks!.jwt! as unknown as Jwt;
    const query = vi.spyOn(getPool(), "query").mockRejectedValueOnce(new Error("connection reset"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(jwt({ token: { id: "1", name: "Kept" }, trigger: "update" })).resolves.toMatchObject({ id: "1", name: "Kept" });
    expect(query).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalled();
  });
});
