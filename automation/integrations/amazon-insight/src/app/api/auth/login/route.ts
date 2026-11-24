import { z } from "zod";

import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const email = normalizeEmail(payload.email);
    const rateKey = `login:${clientIp(request)}:${email}`;
    const limit = checkRateLimit(rateKey, { maxAttempts: 10, windowMs: 15 * 60_000 });
    if (!limit.allowed) {
      return Response.json(
        { error: `尝试次数过多，请 ${limit.retryAfterSec} 秒后重试。` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(payload.password, user.passwordHash))) {
      return Response.json({ error: "邮箱或密码不正确。" }, { status: 401 });
    }

    resetRateLimit(rateKey);
    await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return Response.json(
      { error: error instanceof z.ZodError ? "请输入有效邮箱和至少 8 位密码。" : "登录失败，请稍后重试。" },
      { status: 400 },
    );
  }
}
