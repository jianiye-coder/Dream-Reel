import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const LEGACY_PREFIX = "dre1:";
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

  if (process.env.NODE_ENV === "production") {
    throw new Error("DREAM_TEXT_ENCRYPTION_KEY is required in production.");
  }

  const developmentSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
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
  const current = getCurrentKey();
  const keys = [current, ...getPreviousKeys()];

  // Read-only compatibility for dre1 ciphertext created before a dedicated key
  // was required. New ciphertext never uses an Auth.js secret.
  const legacyAuthSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (legacyAuthSecret) {
    keys.push({ id: "legacy-auth", key: deriveKey(legacyAuthSecret) });
  }

  return keys.filter((candidate, index, all) =>
    all.findIndex((item) => item.key.equals(candidate.key)) === index,
  );
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

export function isEncryptedDreamText(value: string) {
  return value.startsWith(LEGACY_PREFIX) || value.startsWith(CURRENT_PREFIX);
}

export function needsDreamTextReencryption(value: string) {
  return !value.startsWith(`${CURRENT_PREFIX}${getCurrentDreamEncryptionKeyId()}:`);
}

export function encryptDreamText(plainText: string) {
  if (isEncryptedDreamText(plainText)) return plainText;

  const { id, key } = getCurrentKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${CURRENT_PREFIX}${id}:${base64UrlEncode(iv)}.${base64UrlEncode(tag)}.${base64UrlEncode(encrypted)}`;
}

export function decryptDreamText(storedText: string) {
  if (!isEncryptedDreamText(storedText)) return storedText;

  const isCurrent = storedText.startsWith(CURRENT_PREFIX);
  const currentPayload = isCurrent ? storedText.slice(CURRENT_PREFIX.length) : "";
  const separator = currentPayload.indexOf(":");
  if (isCurrent && separator <= 0) {
    throw new Error("Encrypted dream text is malformed.");
  }
  const keyId = isCurrent && separator > 0 ? currentPayload.slice(0, separator) : null;
  const payload = isCurrent
    ? currentPayload.slice(separator + 1)
    : storedText.slice(LEGACY_PREFIX.length);
  const keys = getDecryptionKeys();
  const candidates = keyId
    ? [...keys.filter((item) => item.id === keyId), ...keys.filter((item) => item.id !== keyId)]
    : keys;

  for (const candidate of candidates) {
    try {
      return decryptPayload(payload, candidate.key);
    } catch {
      // Try the next configured key without logging sensitive ciphertext.
    }
  }
  throw new Error(`Unable to decrypt dream text with the configured key ring${keyId ? ` (${keyId})` : ""}.`);
}

export function reencryptDreamText(storedText: string) {
  if (!needsDreamTextReencryption(storedText)) return storedText;
  return encryptDreamText(decryptDreamText(storedText));
}
