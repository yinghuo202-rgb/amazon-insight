import { z } from "zod";
import { requireCurrentUser, workspaceForUser } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { loadOperatingModel } from "@/lib/inventory/data";
import { appendTaskHistory, buildReviewEvidence, preserveReviewBaseline, reviewContextSchema, reviewRequestSchema, taskHistorySchema } from "@/lib/inventory/operating-review";

export const runtime = "nodejs";
const marketSchema = z.enum(["US", "CA", "MX"]);
const taskSchema = z.object({ sku: z.string().trim().toUpperCase().min(1).max(64), market: marketSchema.optional(), title: z.string().trim().min(1).max(160), note: z.string().trim().max(500).optional(), assigneeId: z.string().cuid().nullable().optional() });
const updateSchema = z.object({ id: z.string().cuid(), expectedUpdatedAt: z.iso.datetime(), status: z.enum(["OPEN", "REVIEW", "IN_PROGRESS", "DONE", "DISMISSED"]).optional(), assigneeId: z.string().cuid().nullable().optional(), note: z.string().trim().max(500).optional() });
async function context() { const user = await requireCurrentUser(); return { user, workspace: await workspaceForUser(user.id) }; }
function writeGuard(request: Request) {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  return request.headers.get("origin") === origin && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHENTICATED") return Response.json({ error: "请先登录。" }, { status: 401 });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "记录参数或存储格式不正确，请检查输入和数据库。" }, { status: 422 });
  if (["REVIEW_VERSION_CHANGED", "TASK_CHANGED"].includes(message)) return Response.json({ error: "数据或记录已更新，请重新加载后复核。" }, { status: 409 });
  if (message === "REVIEW_NOTE_REQUIRED") return Response.json({ error: "请先填写复核依据，再标记已处理或无需处理。" }, { status: 422 });
  if (["REVIEW_NOT_FOUND", "REVIEW_NOT_TRIGGERED"].includes(message)) return Response.json({ error: "当前版本未找到该项提醒，请重新查看 SKU 依据。" }, { status: 409 });
  return Response.json({ error: "协作记录暂不可用，已有记录未被删除。" }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const { workspace } = await context(), params = new URL(request.url).searchParams;
    const market = params.has("market") ? marketSchema.parse(params.get("market")) : undefined;
    const sku = params.has("sku") ? z.string().trim().toUpperCase().min(1).max(64).parse(params.get("sku")) : undefined;
    const [members, tasks] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { joinedAt: "asc" } }),
      prisma.collaborationTask.findMany({ where: { workspaceId: workspace.id, sku, ...(market ? { market } : {}) }, include: { assignee: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    ]);
    return Response.json({ workspace: { name: workspace.name }, members: members.map(({ user, role }) => ({ id: user.id, name: user.name, email: user.email, role })), tasks: tasks.map(task => ({
      id: task.id, sku: task.sku, market: task.market, title: task.title, note: task.note, status: task.status, assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      createdBy: "共用账号", updatedAt: task.updatedAt.toISOString(), context: task.contextJson ? reviewContextSchema.parse(JSON.parse(task.contextJson)) : null, history: taskHistorySchema.parse(JSON.parse(task.historyJson)),
    })), limited: tasks.length === 100 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { user, workspace } = await context();
    if (!writeGuard(request)) return Response.json({ error: "请从本站保存记录。" }, { status: 403 });
    const body = z.object({ kind: z.string().optional() }).passthrough().parse(await request.json());
    if (body.kind === "member") return Response.json({ error: "当前使用共用账号，不再创建成员账号。" }, { status: 410 });
    if (body.kind === "review") {
      const input = reviewRequestSchema.parse(body), review = buildReviewEvidence(await loadOperatingModel(), input, new Date(), true);
      const task = await prisma.$transaction(async tx => {
        const existing = await tx.collaborationTask.findUnique({ where: { workspaceId_issueKey: { workspaceId: workspace.id, issueKey: review.issueKey } } });
        if (!existing && !review.triggered) throw new Error("REVIEW_NOT_TRIGGERED");
        const historyJson = appendTaskHistory(existing?.historyJson ?? "[]", { at: new Date().toISOString(), actor: "shared-account", userId: user.id, action: existing ? "refresh-evidence" : "create-review", status: existing?.status ?? "OPEN", note: null });
        const contextJson = JSON.stringify(preserveReviewBaseline(existing?.contextJson ?? null, review.context));
        return existing ? tx.collaborationTask.update({ where: { id: existing.id }, data: { contextJson, historyJson, updatedById: user.id } })
          : tx.collaborationTask.create({ data: { workspaceId: workspace.id, sku: input.sku, market: input.market, issueKey: review.issueKey, title: input.issue, contextJson, historyJson, createdById: user.id, updatedById: user.id } });
      });
      return Response.json({ task: { id: task.id } }, { status: 200 });
    }
    const payload = taskSchema.parse(body);
    if (payload.assigneeId) await assertMember(workspace.id, payload.assigneeId);
    const task = await prisma.collaborationTask.create({ data: { workspaceId: workspace.id, ...payload, note: payload.note || null, assigneeId: payload.assigneeId ?? null, createdById: user.id, updatedById: user.id,
      historyJson: appendTaskHistory("[]", { at: new Date().toISOString(), actor: "shared-account", userId: user.id, action: "create-task", status: "OPEN", note: payload.note || null }) } });
    return Response.json({ task: { id: task.id } }, { status: 201 });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { user, workspace } = await context();
    if (!writeGuard(request)) return Response.json({ error: "请从本站修改记录。" }, { status: 403 });
    const payload = updateSchema.parse(await request.json());
    if (payload.assigneeId) await assertMember(workspace.id, payload.assigneeId);
    const found = await prisma.$transaction(async tx => {
      const existing = await tx.collaborationTask.findFirst({ where: { id: payload.id, workspaceId: workspace.id } });
      if (!existing) return false;
      if (existing.updatedAt.toISOString() !== payload.expectedUpdatedAt) throw new Error("TASK_CHANGED");
      if (existing.contextJson && ["DONE", "DISMISSED"].includes(payload.status || "") && !(payload.note ?? existing.note)?.trim()) throw new Error("REVIEW_NOTE_REQUIRED");
      const historyJson = appendTaskHistory(existing.historyJson, { at: new Date().toISOString(), actor: "shared-account", userId: user.id, action: "update-task", status: payload.status ?? existing.status, note: payload.note ?? existing.note });
      const changed = await tx.collaborationTask.updateMany({ where: { id: existing.id, workspaceId: workspace.id, updatedAt: existing.updatedAt }, data: { status: payload.status, assigneeId: payload.assigneeId, note: payload.note, historyJson, updatedById: user.id } });
      if (changed.count !== 1) throw new Error("TASK_CHANGED");
      return true;
    });
    return Response.json(found ? { status: "updated" } : { error: "记录不存在。" }, { status: found ? 200 : 404 });
  } catch (error) { return failure(error); }
}
async function assertMember(workspaceId: string, userId: string) {
  if (!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }))) throw new Error("协作者不在当前空间。");
}
