import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    integrationConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
  },
}));

import { verifyCrawlerBearerToken } from "@/lib/crawlers/auth";
import { getJungleScoutCredentialStatus } from "@/lib/junglescout/settings";
import { checkRateLimit, clearAllRateLimits, resetRateLimit } from "@/lib/rate-limit";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { signSessionToken, verifySignedSessionCookie } from "@/lib/session-signature";

describe("security and authentication primitives", () => {
  const originalSecret = process.env.SECRET_KEY;
  const originalJsKey = process.env.JS_API_KEY;
  const originalJsKeyName = process.env.JS_API_KEY_NAME;

  afterEach(() => {
    clearAllRateLimits();
    if (originalSecret === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = originalSecret;
    if (originalJsKey === undefined) delete process.env.JS_API_KEY;
    else process.env.JS_API_KEY = originalJsKey;
    if (originalJsKeyName === undefined) delete process.env.JS_API_KEY_NAME;
    else process.env.JS_API_KEY_NAME = originalJsKeyName;
  });

  it("signs and verifies session cookies and rejects forged values", () => {
    const secret = "test-super-secret-key-at-least-32-chars";
    const token = "abcdefghijklmnopqrstuvwx123456";
    const signed = signSessionToken(token, secret);

    expect(signed).toContain(".");
    expect(verifySignedSessionCookie(signed, secret)).toBe(token);
    expect(verifySignedSessionCookie("1", secret)).toBeNull();
    expect(verifySignedSessionCookie(`${token}.tampered-signature`, secret)).toBeNull();
    expect(verifySignedSessionCookie(token, secret)).toBeNull();
  });

  it("encrypts and decrypts secrets with AES-256-GCM", () => {
    process.env.SECRET_KEY = "test-secret-box-key";
    const cipher = encryptSecret("my-gerpgo-app-key-123");
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(cipher).not.toContain("my-gerpgo-app-key-123");
    expect(decryptSecret(cipher)).toBe("my-gerpgo-app-key-123");
    const flippedLastChar = cipher.endsWith("A") ? `${cipher.slice(0, -1)}B` : `${cipher.slice(0, -1)}A`;
    expect(() => decryptSecret(`${cipher}x`)).toThrow();
    expect(() => decryptSecret(flippedLastChar)).toThrow();
  });

  it("enforces and resets login rate limits", () => {
    const key = "login:127.0.0.1:admin@example.com";
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit(key, { maxAttempts: 3, windowMs: 60_000, now: 1000 + i }).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, { maxAttempts: 3, windowMs: 60_000, now: 1005 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    resetRateLimit(key);
    expect(checkRateLimit(key, { maxAttempts: 3, windowMs: 60_000, now: 1006 }).allowed).toBe(true);
  });

  it("never leaks plaintext JungleScout authorization in public status", async () => {
    process.env.JS_API_KEY_NAME = "demo-key-name";
    process.env.JS_API_KEY = "super-secret-js-api-key";
    const status = await getJungleScoutCredentialStatus();
    expect(status.sourceStatus).toBe("configured");
    expect(status.keyNamePreview).toBe("dem***me");
    expect("authorization" in status).toBe(false);
    expect(JSON.stringify(status)).not.toContain("super-secret-js-api-key");
  });

  it("validates crawler bearer tokens with constant-time comparison", () => {
    expect(verifyCrawlerBearerToken("Bearer secret-crawler-token", "secret-crawler-token")).toBe(true);
    expect(verifyCrawlerBearerToken("bearer secret-crawler-token", "secret-crawler-token")).toBe(true);
    expect(verifyCrawlerBearerToken("Bearer wrong-token", "secret-crawler-token")).toBe(false);
    expect(verifyCrawlerBearerToken("Bearer secret-crawler-token", "")).toBe(false);
    expect(verifyCrawlerBearerToken(null, "secret-crawler-token")).toBe(false);
  });
});
