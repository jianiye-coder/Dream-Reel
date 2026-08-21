import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const counts = new Map<string, { count: number; windowStartedAt: number }>();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        const key = String(params?.[0]);
        const windowMs = Number(params?.[1]) * 1000;
        const previous = counts.get(key);
        const next = !previous || previous.windowStartedAt <= Date.now() - windowMs
          ? { count: 1, windowStartedAt: Date.now() }
          : { ...previous, count: previous.count + 1 };
        counts.set(key, next);
        return { rows: [{ request_count: next.count }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      for (const key of (params?.[0] as string[] | undefined) ?? []) counts.delete(key);
      return { rows: [] };
    }),
  };
  return {
    counts,
    client,
    ensureSchema: vi.fn(async () => undefined),
    getPool: vi.fn(() => pool),
  };
});

vi.mock("@/lib/db", () => ({
  ensureSchema: database.ensureSchema,
  getPool: database.getPool,
}));

import { clearAuthAttempts, consumeAuthAttempt, getTrustedClientIp } from "@/lib/authRateLimit";

describe("authentication rate limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    database.counts.clear();
    delete process.env.VERCEL;
  });

  afterEach(() => vi.useRealTimers());

  it("blocks the eleventh login attempt for the same normalized identifier", async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(consumeAuthAttempt("login", " User@Example.com ", `10.0.0.${attempt}`))
        .resolves.toMatchObject({ allowed: true });
    }
    await expect(consumeAuthAttempt("login", "user@example.com", "10.0.0.99"))
      .resolves.toMatchObject({ allowed: false, retryAfterSeconds: 900 });
  });

  it("does not trust a spoofed forwarded address outside Vercel", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.2",
      "x-real-ip": "203.0.113.5",
    });
    expect(getTrustedClientIp(headers)).toBe("203.0.113.5");
  });

  it("starts a fresh window after the policy duration", async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await consumeAuthAttempt("login", "window@example.com", `10.0.1.${attempt}`);
    }
    vi.advanceTimersByTime(901_000);
    await expect(consumeAuthAttempt("login", "window@example.com", "10.0.1.99"))
      .resolves.toMatchObject({ allowed: true });
  });

  it("clears account and IP counters after successful authentication", async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await consumeAuthAttempt("login", "recovered@example.com", "10.0.2.1");
    }
    await clearAuthAttempts("login", "recovered@example.com", "10.0.2.1");
    await expect(consumeAuthAttempt("login", "recovered@example.com", "10.0.2.1"))
      .resolves.toMatchObject({ allowed: true });
  });
});
