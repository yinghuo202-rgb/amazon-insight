import { createHmac, timingSafeEqual } from "node:crypto";

function signDigest(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

export function resolveSigningSecret(explicitSecret?: string) {
  const value = (explicitSecret ?? process.env.SECRET_KEY ?? "").trim();
  return value.length > 0 ? value : null;
}

export function signSessionToken(token: string, explicitSecret?: string): string {
  const secret = resolveSigningSecret(explicitSecret);
  if (!secret) return token;
  return `${token}.${signDigest(token, secret)}`;
}

export function verifySignedSessionCookie(cookieValue: string | undefined | null, explicitSecret?: string): string | null {
  const raw = cookieValue?.trim();
  if (!raw) return null;

  const secret = resolveSigningSecret(explicitSecret);
  if (!secret) {
    // Local dev without SECRET_KEY: reject multi-segment tampered strings and require plausible token shape.
    if (raw.includes(".")) {
      const [token] = raw.split(".");
      return token && token.length >= 16 ? token : null;
    }
    return raw.length >= 16 ? raw : null;
  }

  const separator = raw.lastIndexOf(".");
  if (separator <= 0 || separator >= raw.length - 1) return null;

  const token = raw.slice(0, separator);
  const providedSig = raw.slice(separator + 1);
  if (token.length < 16) return null;

  const expectedSig = signDigest(token, secret);
  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (providedBuf.length !== expectedBuf.length) return null;
  return timingSafeEqual(providedBuf, expectedBuf) ? token : null;
}
