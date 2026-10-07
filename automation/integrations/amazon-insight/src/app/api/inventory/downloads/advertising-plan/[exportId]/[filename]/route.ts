import { getCurrentUser } from "@/lib/auth";
import { readFile } from "node:fs/promises";

import { advertisingPlanDownloadPath, recordDownloadEvent } from "@/lib/inventory/download-center";

export const runtime = "nodejs";
export async function GET(_request: Request, context: RouteContext<"/api/inventory/downloads/advertising-plan/[exportId]/[filename]">) {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  try { const { exportId, filename } = await context.params; const decoded = decodeURIComponent(filename); const file = await readFile(advertisingPlanDownloadPath(exportId, decoded)); recordDownloadEvent("advertising", exportId, decoded); return new Response(file, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(decoded)}`, "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "广告调整表不存在或下载路径无效。" }, { status: 404 }); }
}
