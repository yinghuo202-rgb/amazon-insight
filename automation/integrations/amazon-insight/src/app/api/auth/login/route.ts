import { z } from "zod";

import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(payload.email) } });
    if (!user || !verifyPassword(payload.password, user.passwordHash)) return Response.json({ error: "邮箱或密码不正确。" }, { status: 401 });
    await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "请输入有效邮箱和至少 8 位密码。" : "登录失败，请稍后重试。" }, { status: 400 });
  }
}
