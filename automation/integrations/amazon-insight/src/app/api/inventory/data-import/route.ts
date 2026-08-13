import { requireCurrentUser } from "@/lib/auth";
import { appendImportChunk, finalizeChunkedImport, initializeChunkedImport, listDataVersions, listImportBatches, publishImportBatch, restoreDataVersion } from "@/lib/inventory/data-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return user;
}

export async function GET() {
  try {
    await requireAdmin();
    const [batches, versions] = await Promise.all([listImportBatches(), listDataVersions()]);
    return Response.json({ batches, versions });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "FORBIDDEN" ? "只有管理员可以管理数据上传。" : "无法读取上传记录。" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json() as { action?: string; batchId?: string; files?: Array<{ name: string; size: number }> };
    if (body.action === "initialize") return Response.json({ upload: await initializeChunkedImport(body.files ?? []) }, { status: 201 });
    if (body.action === "finalize" && body.batchId) return Response.json({ batch: await finalizeChunkedImport(body.batchId) });
    return Response.json({ error: "上传操作参数不正确。" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "文件上传失败。" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const batchId = url.searchParams.get("batchId") ?? "";
    const fileIndex = Number(url.searchParams.get("fileIndex"));
    const offset = Number(url.searchParams.get("offset"));
    if (!Number.isInteger(fileIndex) || !Number.isInteger(offset) || offset < 0) return Response.json({ error: "上传分片参数不正确。" }, { status: 400 });
    return Response.json(await appendImportChunk(batchId, fileIndex, offset, Buffer.from(await request.arrayBuffer())));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "文件分片上传失败。" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json() as { batchId?: string; version?: string; action?: string };
    if (body.action === "restore" && body.version) return Response.json({ restored: await restoreDataVersion(body.version) });
    if (!body.batchId) return Response.json({ error: "缺少上传批次编号。" }, { status: 400 });
    return Response.json({ batch: await publishImportBatch(body.batchId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据发布失败。" }, { status: 400 });
  }
}
