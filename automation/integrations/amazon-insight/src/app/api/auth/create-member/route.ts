import { z } from "zod";

import { hashPassword, normalizeEmail, verifyPassword, workspaceForUser } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const schema = z.object({
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const admin = await prisma.user.findUnique({ where: { email: normalizeEmail(payload.adminEmail) } });
    if (!admin || admin.role !== "ADMIN" || !verifyPassword(payload.adminPassword, admin.passwordHash)) {
      return Response.json({ error: "管理员账号或密码不正确。" }, { status: 403 });
    }

    const email = normalizeEmail(payload.email);
    if (await prisma.user.findUnique({ where: { email } })) {
      return Response.json({ error: "该成员邮箱已经存在。" }, { status: 409 });
    }

    const workspace = await workspaceForUser(admin.id);
    await prisma.$transaction(async (tx) => {
      const member = await tx.user.create({
        data: { name: payload.name, email, passwordHash: hashPassword(payload.password), role: "MEMBER" },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
      });
    });
    return Response.json({ status: "created", email }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "请完整填写管理员验证和成员信息。" : "成员账号创建失败，请稍后重试。" }, { status: 400 });
  }
}
