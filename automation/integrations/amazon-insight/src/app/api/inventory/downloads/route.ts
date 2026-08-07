import { listDownloadHistory } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ items: await listDownloadHistory() });
}
