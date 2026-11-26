import { afterEach, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("pg", () => ({ Pool: class {
  query = database.query;
  async connect() {
    return { query: database.query, release: vi.fn() };
  }
} }));

afterEach(() => {
  globalThis.dreamPool = undefined;
  vi.unstubAllEnvs();
});

it("creates morning_pages with a separate owner/date key and cascading user reference", async () => {
  vi.resetModules();
  globalThis.dreamPool = undefined;
  vi.stubEnv("DATABASE_URL", "postgresql://invalid:invalid@localhost:1/no-real-database");
  vi.stubEnv("DREAM_TEXT_ENCRYPTION_KEY", "schema-unit-test-key");
  database.query.mockResolvedValue({ rows: [] });
  const { ensureSchema } = await import("@/lib/db");

  await ensureSchema();

  const ddl = database.query.mock.calls.find(([sql]) => sql.includes("CREATE TABLE IF NOT EXISTS morning_pages"))?.[0];
  expect(ddl).toContain("user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE");
  expect(ddl).toContain("PRIMARY KEY (user_id, date)");
  expect(ddl).toContain("content TEXT NOT NULL");
  expect(ddl).toContain("revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)");
  expect(database.query).toHaveBeenCalledWith(
    "INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING", [expect.any(Number)],
  );
});

it.each([
  ["skips", undefined, false],
  ["runs", "old=old-secret", true],
] as const)("%s the cold-start re-encryption scan (previous keys: %s)", async (_label, previous, expected) => {
  vi.resetModules();
  database.query.mockReset();
  globalThis.dreamPool = undefined;
  vi.stubEnv("DATABASE_URL", "postgresql://invalid:invalid@localhost:1/no-real-database");
  vi.stubEnv("DREAM_TEXT_ENCRYPTION_KEY", "schema-unit-test-key");
  if (previous) vi.stubEnv("DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS", previous);
  else vi.stubEnv("DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS", "");
  database.query.mockResolvedValue({ rows: [] });
  const { ensureSchema } = await import("@/lib/db");

  await ensureSchema();

  const scanned = database.query.mock.calls.some(([sql]) => String(sql).includes("FOR UPDATE SKIP LOCKED"));
  expect(scanned).toBe(expected);
});

it("drops the unused v12 tables without letting a failure block startup", async () => {
  vi.resetModules();
  database.query.mockReset();
  globalThis.dreamPool = undefined;
  vi.stubEnv("DATABASE_URL", "postgresql://invalid:invalid@localhost:1/no-real-database");
  vi.stubEnv("DREAM_TEXT_ENCRYPTION_KEY", "schema-unit-test-key");
  database.query.mockResolvedValue({ rows: [] });
  const { ensureSchema } = await import("@/lib/db");

  await ensureSchema();

  const drop = database.query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("DROP TABLE IF EXISTS"));
  expect(drop).toContain("user_credits, accounts, sessions, verification_tokens");
  expect(drop).toContain("EXCEPTION WHEN OTHERS THEN");
});
