import { readFile } from "node:fs/promises";

import { purchasePlanDownloadPath, recordDownloadEvent } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/inventory/downloads/purchase-plan/[exportId]/[filename]">) {
  const { exportId, filename } = await context.params;
  try {
    const decoded = decodeURIComponent(filename);
    const content = await readFile(purchasePlanDownloadPath(exportId, decoded));
    recordDownloadEvent("purchase", exportId, decoded);
    return new Response(content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(decoded)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "采购表不存在或已被清理" }, { status: 404 });
  }
}
