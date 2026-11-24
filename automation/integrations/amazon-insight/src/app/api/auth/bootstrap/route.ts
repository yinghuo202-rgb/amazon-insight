import { z } from "zod";

import { createSession, hashPassword, normalizeEmail } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

class AlreadyBootstrappedError extends Error {}

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const email = normalizeEmail(payload.email);
    const passwordHash = await hashPassword(payload.password);

    const user = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.user.count();
      if (existingCount > 0) {
        throw new AlreadyBootstrappedError("管理员已经初始化，请直接登录。");
      }
      return tx.user.create({
        data: {
          name: payload.name,
          email,
          passwordHash,
          role: "ADMIN",
          memberships: {
            create: {
              role: "OWNER",
              workspace: { create: { name: "Measureman 运营协作空间" } },
            },
          },
        },
      });
    });

    await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, { status: 201 });
  } catch (error) {
    if (error instanceof AlreadyBootstrappedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof z.ZodError
      ? "请填写姓名、有效邮箱和至少 8 位密码。"
      : error instanceof Error && error.message.includes("Unique")
        ? "该邮箱已经存在。"
        : "管理员初始化失败。";
    return Response.json({ error: message }, { status: 400 });
  }
}
