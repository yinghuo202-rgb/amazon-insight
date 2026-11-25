import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { requireApiAuth } from "@/lib/auth";

export const WORKER_TOKEN_PURPOSE = "measureman-internal-worker-v1";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function deriveWorkerToken(secretKey: string | undefined = process.env.SECRET_KEY): string | null {
  const trimmed = secretKey?.trim();
  if (!trimmed) return null;
  return createHmac("sha256", trimmed).update(WORKER_TOKEN_PURPOSE, "utf8").digest("hex");
}

export function resolveExpectedWorkerToken(
  explicitToken: string | undefined = process.env.WORKER_AUTH_TOKEN,
  secretKey: string | undefined = process.env.SECRET_KEY,
): string | null {
  const explicit = explicitToken?.trim();
  if (explicit) return explicit;
  return deriveWorkerToken(secretKey);
}

export function verifyWorkerBearerToken(
  authorizationHeader: string | null | undefined,
  expectedToken: string | null | undefined = resolveExpectedWorkerToken(),
): boolean {
  const expected = expectedToken?.trim();
  const raw = authorizationHeader?.trim();
  if (!expected || !raw) return false;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return false;
  return timingSafeEqual(sha256(token), sha256(expected));
}

export async function requireWorkerAuth(request: Request): Promise<{ actor: string } | { response: Response }> {
  const expected = resolveExpectedWorkerToken();
  if (!expected) {
    return {
      response: Response.json(
        { error: "未配置 WORKER_AUTH_TOKEN 或 SECRET_KEY，无法验证 Worker 身份。" },
        { status: 503 },
      ),
    };
  }
  if (verifyWorkerBearerToken(request.headers.get("authorization"), expected)) {
    return { actor: "worker-token" };
  }
  return {
    response: Response.json({ error: "Worker 鉴权失败。" }, { status: 401 }),
  };
}

export async function requireWorkerOrUserAuth(request: Request): Promise<{ actor: string } | { response: Response }> {
  if (verifyWorkerBearerToken(request.headers.get("authorization"))) {
    return { actor: "worker-token" };
  }

  const sessionAuth = await requireApiAuth();
  if ("response" in sessionAuth) {
    return { response: sessionAuth.response };
  }
  return { actor: sessionAuth.user.email };
}
