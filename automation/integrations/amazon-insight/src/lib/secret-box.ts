import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";
const DEV_FALLBACK_SEED = "measureman-local-dev-secret-do-not-use-in-prod";

function decodeBase64UrlStrict(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url segment.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Non-canonical base64url segment.");
  }
  return decoded;
}

function deriveKey(): Buffer {
  const configured = process.env.SECRET_KEY?.trim();
  if (configured) {
    return createHash("sha256").update(`measureman-secret-box:${configured}`).digest();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SECRET_KEY is required in production for secret encryption.");
  }
  return createHash("sha256").update(DEV_FALLBACK_SEED).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("Unsupported secret payload format.");
  }
  const body = payload.slice(PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("Malformed encrypted secret payload.");
  }
  const iv = decodeBase64UrlStrict(parts[0]);
  const tag = decodeBase64UrlStrict(parts[1]);
  const ciphertext = decodeBase64UrlStrict(parts[2]);
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid encrypted secret metadata.");
  }

  const key = deriveKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
