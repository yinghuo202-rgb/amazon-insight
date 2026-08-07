import { readFile } from "node:fs/promises";

import { creativeHandoffFilePath } from "@/lib/inventory/creative-handoff";
import { recordDownloadEvent } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/inventory/content/creative-handoff/[exportId]/[filename]">) {
  const { exportId, filename } = await context.params;
  try {
    const decoded = decodeURIComponent(filename);
    const content = await readFile(creativeHandoffFilePath(exportId, decoded));
    recordDownloadEvent("creative", exportId, decoded);
    return new Response(content, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(decoded)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "美工对接表不存在或已被清理。" }, { status: 404 });
  }
}
