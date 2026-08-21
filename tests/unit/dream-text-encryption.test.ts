import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptDreamText,
  encryptDreamText,
  needsDreamTextReencryption,
  reencryptDreamText,
} from "@/lib/dreamTextEncryption";
import { migrateDreamTextEncryption } from "@/lib/db";

const original = {
  key: process.env.DREAM_TEXT_ENCRYPTION_KEY,
  id: process.env.DREAM_TEXT_ENCRYPTION_KEY_ID,
  previous: process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS,
  auth: process.env.AUTH_SECRET,
  nodeEnv: process.env.NODE_ENV,
};

afterEach(() => {
  if (original.key === undefined) delete process.env.DREAM_TEXT_ENCRYPTION_KEY;
  else process.env.DREAM_TEXT_ENCRYPTION_KEY = original.key;
  if (original.id === undefined) delete process.env.DREAM_TEXT_ENCRYPTION_KEY_ID;
  else process.env.DREAM_TEXT_ENCRYPTION_KEY_ID = original.id;
  if (original.previous === undefined) delete process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS;
  else process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS = original.previous;
  if (original.auth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = original.auth;
  vi.stubEnv("NODE_ENV", original.nodeEnv ?? "test");
});

describe("dream text key rotation", () => {
  it("reads an old key and rewrites ciphertext with the current key id", () => {
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "old-encryption-secret";
    process.env.DREAM_TEXT_ENCRYPTION_KEY_ID = "old";
    const oldCiphertext = encryptDreamText("a private dream");

    process.env.DREAM_TEXT_ENCRYPTION_KEY = "new-encryption-secret";
    process.env.DREAM_TEXT_ENCRYPTION_KEY_ID = "new";
    process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS = "old=old-encryption-secret";

    expect(decryptDreamText(oldCiphertext)).toBe("a private dream");
    expect(needsDreamTextReencryption(oldCiphertext)).toBe(true);
    const rotated = reencryptDreamText(oldCiphertext);
    expect(rotated).toMatch(/^dre2:new:/);
    expect(decryptDreamText(rotated)).toBe("a private dream");
  });

  it("re-encrypts a locked batch inside a transaction", async () => {
    process.env.DREAM_TEXT_ENCRYPTION_KEY = "old-encryption-secret";
    process.env.DREAM_TEXT_ENCRYPTION_KEY_ID = "old";
    const rawText = encryptDreamText("raw private dream");
    const cleanText = encryptDreamText("clean private dream");

    process.env.DREAM_TEXT_ENCRYPTION_KEY = "new-encryption-secret";
    process.env.DREAM_TEXT_ENCRYPTION_KEY_ID = "new";
    process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS = "old=old-encryption-secret";

    let selected = false;
    const updates: unknown[][] = [];
    const transactionStatements: string[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        const normalized = sql.trim();
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
          transactionStatements.push(normalized);
          return { rows: [] };
        }
        if (normalized.startsWith("SELECT id")) {
          if (selected) return { rows: [] };
          selected = true;
          return { rows: [{ id: "1", raw_text: rawText, clean_text: cleanText }] };
        }
        if (normalized.startsWith("UPDATE dream_entries")) {
          updates.push(params ?? []);
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${normalized}`);
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client };

    await migrateDreamTextEncryption(pool as never);

    expect(transactionStatements).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
    expect(updates).toHaveLength(1);
    expect(String(updates[0][1])).toMatch(/^dre2:new:/);
    expect(String(updates[0][2])).toMatch(/^dre2:new:/);
    expect(decryptDreamText(String(updates[0][1]))).toBe("raw private dream");
    expect(decryptDreamText(String(updates[0][2]))).toBe("clean private dream");
  });

  it("keeps production authentication available during key provisioning", () => {
    delete process.env.DREAM_TEXT_ENCRYPTION_KEY;
    delete process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS;
    process.env.AUTH_SECRET = "production-auth-transition-secret";
    vi.stubEnv("NODE_ENV", "production");

    const encrypted = encryptDreamText("transition dream");
    expect(encrypted).toMatch(/^dre2:auth-transition:/);
    expect(decryptDreamText(encrypted)).toBe("transition dream");
  });
});
