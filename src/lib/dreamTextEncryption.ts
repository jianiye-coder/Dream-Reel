import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENCRYPTION_PREFIX = "dre1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function base64UrlEncode(value: Buffer) {
  return value.toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function getEncryptionKey() {
  const secret =
    process.env.DREAM_TEXT_ENCRYPTION_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error("DREAM_TEXT_ENCRYPTION_KEY is missing. Refusing to store dream text in plaintext.");
  }

  const decoded = Buffer.from(secret, "base64");
  if (decoded.length === 32) {
    return decoded;
  }

  return createHash("sha256").update(secret).digest();
}

export function isEncryptedDreamText(value: string) {
  return value.startsWith(ENCRYPTION_PREFIX);
}

export function encryptDreamText(plainText: string) {
  if (isEncryptedDreamText(plainText)) {
    return plainText;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv, {
    authTagLength: TAG_LENGTH,
  });
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${base64UrlEncode(iv)}.${base64UrlEncode(tag)}.${base64UrlEncode(encrypted)}`;
}

export function decryptDreamText(storedText: string) {
  if (!isEncryptedDreamText(storedText)) {
    return storedText;
  }

  const payload = storedText.slice(ENCRYPTION_PREFIX.length);
  const [ivValue, tagValue, encryptedValue] = payload.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted dream text is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), base64UrlDecode(ivValue), {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(base64UrlDecode(tagValue));

  return Buffer.concat([
    decipher.update(base64UrlDecode(encryptedValue)),
    decipher.final(),
  ]).toString("utf8");
}
