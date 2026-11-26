import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const CURRENT_PREFIX = "dre2:";
const DEFAULT_KEY_ID = "primary";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

type EncryptionKey = { id: string; key: Buffer };

function base64UrlEncode(value: Buffer) {
  return value.toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function deriveKey(secret: string) {
  const decoded = Buffer.from(secret, "base64");
  return decoded.length === 32 ? decoded : createHash("sha256").update(secret).digest();
}

function validateKeyId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
    throw new Error("DREAM_TEXT_ENCRYPTION_KEY_ID must contain only letters, numbers, _ or -.");
  }
  return value;
}

function getCurrentKey(): EncryptionKey {
  const dedicatedSecret = process.env.DREAM_TEXT_ENCRYPTION_KEY;
  if (dedicatedSecret) {
    return {
      id: validateKeyId(process.env.DREAM_TEXT_ENCRYPTION_KEY_ID || DEFAULT_KEY_ID),
      key: deriveKey(dedicatedSecret),
    };
  }

  // Local development may borrow the auth secret; production never does.
  const developmentSecret = process.env.NODE_ENV === "production"
    ? undefined
    : process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!developmentSecret) {
    throw new Error("DREAM_TEXT_ENCRYPTION_KEY is missing. Refusing to store dream text in plaintext.");
  }
  return { id: "development", key: deriveKey(developmentSecret) };
}

function getPreviousKeys(): EncryptionKey[] {
  const configured = process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS;
  if (!configured?.trim()) return [];

  return configured.split(",").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error("DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS must use key-id=secret entries.");
    }
    return {
      id: validateKeyId(entry.slice(0, separator).trim()),
      key: deriveKey(entry.slice(separator + 1).trim()),
    };
  });
}

function getDecryptionKeys() {
  const keys = [getCurrentKey(), ...getPreviousKeys()];
  return keys.filter((candidate, index, all) =>
    all.findIndex((item) => item.key.equals(candidate.key)) === index,
  );
}

export function hasDedicatedDreamEncryptionKey() {
  return Boolean(process.env.DREAM_TEXT_ENCRYPTION_KEY);
}

function decryptPayload(payload: string, key: Buffer) {
  const [ivValue, tagValue, encryptedValue] = payload.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted dream text is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, base64UrlDecode(ivValue), {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(base64UrlDecode(tagValue));
  return Buffer.concat([
    decipher.update(base64UrlDecode(encryptedValue)),
    decipher.final(),
  ]).toString("utf8");
}

export function getCurrentDreamEncryptionKeyId() {
  return getCurrentKey().id;
}

function isEncryptedDreamText(value: string) {
  return value.startsWith(CURRENT_PREFIX);
}

/** Whether a key rotation is in progress, i.e. stored text may still use an older key. */
export function hasPreviousDreamEncryptionKeys() {
  return Boolean(process.env.DREAM_TEXT_PREVIOUS_ENCRYPTION_KEYS?.trim());
}

export function needsDreamTextReencryption(value: string) {
  return !value.startsWith(`${CURRENT_PREFIX}${getCurrentDreamEncryptionKeyId()}:`);
}

// Always encrypts: a dream that happens to start with "dre2:" is still the reader's text.
export function encryptDreamText(plainText: string) {
  const { id, key } = getCurrentKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${CURRENT_PREFIX}${id}:${base64UrlEncode(iv)}.${base64UrlEncode(tag)}.${base64UrlEncode(encrypted)}`;
}

// Every stored row is dre2 (checked in production 2026-11-25: 42 dreams, 2 morning pages), so
// anything else is corrupt data, not an old format to pass through.
export function decryptDreamText(storedText: string) {
  if (!isEncryptedDreamText(storedText)) {
    throw new Error("Stored dream text is not encrypted.");
  }

  const payloadWithId = storedText.slice(CURRENT_PREFIX.length);
  const separator = payloadWithId.indexOf(":");
  if (separator <= 0) {
    throw new Error("Encrypted dream text is malformed.");
  }
  const keyId = payloadWithId.slice(0, separator);
  const payload = payloadWithId.slice(separator + 1);
  const keys = getDecryptionKeys();
  const candidates = [...keys.filter((item) => item.id === keyId), ...keys.filter((item) => item.id !== keyId)];

  for (const candidate of candidates) {
    try {
      return decryptPayload(payload, candidate.key);
    } catch {
      // Try the next configured key without logging sensitive ciphertext.
    }
  }
  throw new Error(`Unable to decrypt dream text with the configured key ring (${keyId}).`);
}

export function reencryptDreamText(storedText: string) {
  if (!needsDreamTextReencryption(storedText)) return storedText;
  return encryptDreamText(decryptDreamText(storedText));
}
