import { requireApiAuth } from "@/lib/auth";
import { listDownloadHistory } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  return Response.json({ items: await listDownloadHistory() });
}
