import { z } from "zod";

import { hashPassword, requireApiAuth, workspaceForUser } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const memberSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});
const taskSchema = z.object({
  sku: z.string().trim().toUpperCase().min(3).max(32),
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(500).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
});
const updateSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function GET() {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    const workspace = await workspaceForUser(auth.user.id);
    const [members, tasks] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { joinedAt: "asc" } }),
      prisma.collaborationTask.findMany({ where: { workspaceId: workspace.id }, include: { assignee: true, createdBy: true }, orderBy: { updatedAt: "desc" } }),
    ]);
    return Response.json({
      workspace: { id: workspace.id, name: workspace.name },
      members: members.map(({ user, role, joinedAt }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        joinedAt: joinedAt.toISOString(),
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        sku: task.sku,
        title: task.title,
        note: task.note,
        status: task.status,
        assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
        createdBy: task.createdBy.name,
        updatedAt: task.updatedAt.toISOString(),
      })),
    });
  } catch {
    return Response.json({ error: "协作数据读取失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    const workspace = await workspaceForUser(auth.user.id);
    const body = await request.json();
    if (body.kind === "member") {
      if (auth.user.role !== "ADMIN") return Response.json({ error: "只有管理员可以添加协作者。" }, { status: 403 });
      const payload = memberSchema.parse(body);
      const email = payload.email.trim().toLowerCase();
      const passwordHash = await hashPassword(payload.password);
      const member = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { name: payload.name, email, passwordHash, role: payload.role } });
        await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: created.id, role: payload.role } });
        return created;
      });
      return Response.json({ member: { id: member.id, name: member.name, email: member.email, role: member.role } }, { status: 201 });
    }
    const payload = taskSchema.parse(body);
    if (payload.assigneeId) await assertMember(workspace.id, payload.assigneeId);
    const task = await prisma.collaborationTask.create({
      data: {
        workspaceId: workspace.id,
        sku: payload.sku,
        title: payload.title,
        note: payload.note || null,
        assigneeId: payload.assigneeId ?? null,
        createdById: auth.user.id,
        updatedById: auth.user.id,
      },
    });
    return Response.json({ task: { id: task.id } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "协作任务字段不完整。" }, { status: 400 });
    if (error instanceof Error && error.message.includes("Unique")) return Response.json({ error: "该邮箱已经存在。" }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "协作数据保存失败。" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    const workspace = await workspaceForUser(auth.user.id);
    const payload = updateSchema.parse(await request.json());
    const existing = await prisma.collaborationTask.findFirst({ where: { id: payload.id, workspaceId: workspace.id } });
    if (!existing) return Response.json({ error: "协作任务不存在。" }, { status: 404 });
    if (payload.assigneeId) await assertMember(workspace.id, payload.assigneeId);
    await prisma.collaborationTask.update({
      where: { id: existing.id },
      data: { status: payload.status, assigneeId: payload.assigneeId, note: payload.note, updatedById: auth.user.id },
    });
    return Response.json({ status: "updated" });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "协作任务参数不正确。" : "协作任务更新失败。" }, { status: 400 });
  }
}

async function assertMember(workspaceId: string, userId: string) {
  if (!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }))) {
    throw new Error("协作者不在当前空间。");
  }
}
