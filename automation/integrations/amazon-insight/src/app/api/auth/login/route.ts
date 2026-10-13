import { z } from "zod";

import { createSession, getSharedLoginUser, normalizeEmail, verifyPassword } from "@/lib/auth";
import { consumeLoginAttempt } from "@/lib/login-throttle";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const budget = consumeLoginAttempt();
    if (!budget.allowed) return Response.json({ error: "登录尝试过于频繁，请按提示稍后重试。" }, { status: 429, headers: { "Retry-After": String(budget.retryAfter), "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "登录保护暂不可用，请稍后重试；已有登录会话不受影响。" }, { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  }
  try {
    const payload = schema.parse(await request.json());
    const user = await getSharedLoginUser();
    if (!user || user.email !== normalizeEmail(payload.email) || !verifyPassword(payload.password, user.passwordHash)) return Response.json({ error: "共用账号邮箱或密码不正确。" }, { status: 401 });
    await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "请输入有效邮箱和至少 8 位密码。" : "登录失败，请稍后重试。" }, { status: 400 });
  }
}
