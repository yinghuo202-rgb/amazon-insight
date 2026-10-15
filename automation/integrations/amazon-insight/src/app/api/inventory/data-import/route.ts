import { cookies } from "next/headers";
import { z } from "zod";
import { getSharedLoginUser, requireCurrentUser, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { appendImportChunk, DataImportValidationError, finalizeChunkedImport, initializeChunkedImport, listDataVersions, listImportBatches, publishImportBatch, restoreDataVersion } from "@/lib/inventory/data-import";
import { DataConfirmationError, DataOperationConfirmationStore, readDataOperationBinding, validateDataOperationTarget, type DataOperation } from "@/lib/inventory/data-operation-confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const inventoryImportSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("planning") }).strict(),
  z.object({ scope: z.literal("actual"), businessAsOf: z.iso.date() }).strict(),
]);
function failure(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return Response.json({ error: "请先登录。" }, { status: 401, headers: noStore });
  if (error instanceof DataConfirmationError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof DataImportValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  return Response.json({ error: "数据操作未完成，请检查预览并重新验证。" }, { status: 400, headers: noStore });
}
function requireBrowserWrite(request: Request, type = "application/json") {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url);
  if (request.headers.get("origin") !== origin.origin || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== type) throw new DataConfirmationError("请从本站数据更新页面操作。", 403);
  return origin;
}
function requireSecure(origin: URL) {
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new DataConfirmationError("再次密码验证需要 HTTPS 或本机可信环境。", 403);
}
async function jsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 65536) throw new DataConfirmationError("数据操作请求过大。", 413);
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DataConfirmationError("数据操作参数无效。", 422);
  return body;
}
async function actorFor(userId: string) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) throw new Error("UNAUTHENTICATED");
  return { userId, sessionToken };
}
function targetFor(body: { operation?: unknown; action?: unknown; batchId?: unknown; version?: unknown }) {
  const operation: DataOperation = body.operation === "restore" || body.action === "restore" ? "restore" : "publish";
  const target = operation === "restore" ? body.version : body.batchId;
  if (typeof target !== "string") throw new DataConfirmationError("缺少操作目标。", 422);
  validateDataOperationTarget(operation, target);
  return { operation, target };
}
export async function GET() {
  try {
    await requireCurrentUser();
    const [batches, versions] = await Promise.all([listImportBatches(), listDataVersions()]);
    return Response.json({ batches, versions }, { headers: noStore });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(), origin = requireBrowserWrite(request), body = await jsonBody(request);
    if (body.action === "confirm_operation") {
      requireSecure(origin);
      const parsed = z.object({ action: z.literal("confirm_operation"), operation: z.enum(["publish", "restore"]), batchId: z.string().optional(), version: z.string().optional(), currentPassword: z.string().min(1).max(1024) }).strict().safeParse(body);
      if (!parsed.success) throw new DataConfirmationError("请填写当前共用账号密码及唯一操作目标。", 422);
      const { operation, target } = targetFor(parsed.data);
      if (operation === "publish" && parsed.data.version || operation === "restore" && parsed.data.batchId) throw new DataConfirmationError("操作目标不唯一。", 422);
      const actor = await actorFor(user.id), store = new DataOperationConfirmationStore();
      store.reservePasswordAttempt(actor);
      const shared = await getSharedLoginUser();
      if (!shared || shared.id !== user.id || !verifyPassword(parsed.data.currentPassword, shared.passwordHash)) {
        store.audit(actor, { operation, target }, "password_rejected");
        throw new DataConfirmationError("当前密码验证失败。", 403);
      }
      const binding = await readDataOperationBinding(operation, target);
      return Response.json({ confirmation: store.issue(binding, actor) }, { headers: noStore });
    }
    if (body.action === "initialize") {
      const files = z.array(z.object({ name: z.string().min(1).max(500), size: z.number().int().positive() }).strict()).min(1).max(100).parse(body.files);
      return Response.json({ upload: await initializeChunkedImport(files) }, { status: 201, headers: noStore });
    }
    if (body.action === "finalize") {
      const parsed = z.object({ action: z.literal("finalize"), batchId: z.string(), inventory: inventoryImportSchema.default({ scope: "planning" }) }).strict().safeParse(body);
      if (!parsed.success) throw new DataConfirmationError("请选择库存导入方式；实际库存需要有效业务日期，规划导入不填写日期。", 422);
      return Response.json({ batch: await finalizeChunkedImport(parsed.data.batchId, parsed.data.inventory) }, { headers: noStore });
    }
    throw new DataConfirmationError("上传操作参数不正确。", 422);
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    await requireCurrentUser(); requireBrowserWrite(request, "application/octet-stream");
    const url = new URL(request.url), batchId = url.searchParams.get("batchId") ?? "";
    const fileIndex = Number(url.searchParams.get("fileIndex")), offset = Number(url.searchParams.get("offset"));
    if (!url.searchParams.has("fileIndex") || !url.searchParams.has("offset") || !Number.isInteger(fileIndex) || fileIndex < 0 || !Number.isInteger(offset) || offset < 0) throw new DataConfirmationError("上传分片参数不正确。", 422);
    return Response.json(await appendImportChunk(batchId, fileIndex, offset, Buffer.from(await request.arrayBuffer())), { headers: noStore });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireCurrentUser(); requireSecure(requireBrowserWrite(request));
    const body = await jsonBody(request);
    const parsed = z.object({ action: z.enum(["publish", "restore"]).optional(), batchId: z.string().optional(), version: z.string().optional(), confirmationToken: z.string().max(128).optional() }).strict().safeParse(body);
    if (!parsed.success) throw new DataConfirmationError("发布确认参数无效。", 422);
    const { operation, target } = targetFor(parsed.data);
    if (operation === "publish" && parsed.data.version || operation === "restore" && parsed.data.batchId) throw new DataConfirmationError("操作目标不唯一。", 422);
    if (!parsed.data.confirmationToken) throw new DataConfirmationError("请重新验证密码并确认操作。");
    const actor = await actorFor(user.id), store = new DataOperationConfirmationStore();
    const confirmed = store.consume(parsed.data.confirmationToken, { operation, target }, actor);
    // Consumption is final even on failure; Python rechecks the binding under its report lock.
    try {
      const binding = await readDataOperationBinding(operation, target);
      if (binding.baseline !== confirmed.baseline || binding.targetFingerprint !== confirmed.targetFingerprint) throw new DataConfirmationError("确认后的报告基线或操作目标已变化，请重新验证。");
      const guard = { expectedBaseline: binding.baseline, expectedTarget: binding.targetFingerprint };
      const result = operation === "restore" ? { restored: await restoreDataVersion(target, guard) } : { batch: await publishImportBatch(target, guard) };
      store.audit(actor, binding, operation === "restore" ? "restored" : "published");
      return Response.json(result, { headers: noStore });
    } catch (error) { store.audit(actor, { operation, target }, "failed"); throw error; }
  } catch (error) { return failure(error); }
}
