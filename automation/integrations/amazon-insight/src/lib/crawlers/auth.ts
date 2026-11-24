import { createHash, timingSafeEqual } from "node:crypto";

import { requireApiAuth } from "@/lib/auth";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyCrawlerBearerToken(
  authorizationHeader: string | null | undefined,
  configuredToken: string | undefined = process.env.CRAWLER_INGEST_TOKEN,
): boolean {
  const expected = configuredToken?.trim();
  const raw = authorizationHeader?.trim();
  if (!expected || !raw) return false;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return false;
  return timingSafeEqual(sha256(token), sha256(expected));
}

export async function requireCrawlerOrUserAuth(request: Request): Promise<{ actor: string } | { response: Response }> {
  const authHeader = request.headers.get("authorization");
  if (verifyCrawlerBearerToken(authHeader)) {
    return { actor: "crawler-token" };
  }

  const sessionAuth = await requireApiAuth();
  if ("response" in sessionAuth) {
    return { response: sessionAuth.response };
  }
  return { actor: sessionAuth.user.email };
}
