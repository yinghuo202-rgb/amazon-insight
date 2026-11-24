import { readFile } from "node:fs/promises";

import { requireApiAuth } from "@/lib/auth";
import { exportFilePath } from "@/lib/inventory/document-exports";
import { recordDownloadEvent } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/inventory/exports/[exportId]/[filename]">) {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  const { exportId, filename } = await context.params;
  try {
    const decoded = decodeURIComponent(filename);
    const content = await readFile(exportFilePath(exportId, decoded));
    recordDownloadEvent("documents", exportId, decoded);
    return new Response(content, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(decoded)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "导出文件不存在或已被清理" }, { status: 404 });
  }
}
