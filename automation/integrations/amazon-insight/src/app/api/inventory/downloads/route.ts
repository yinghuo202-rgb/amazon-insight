import { getCurrentUser } from "@/lib/auth";
import { listDownloadHistory } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  return Response.json({ items: await listDownloadHistory() });
}
