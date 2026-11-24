import { requireApiAuth } from "@/lib/auth";
import { DataRefreshConflictError, getDataRefreshStatus, runFullDataRefresh } from "@/lib/inventory/data-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  return Response.json(await getDataRefreshStatus());
}

export async function POST() {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    return Response.json(await runFullDataRefresh());
  } catch (error) {
    if (error instanceof DataRefreshConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "数据重建失败。" }, { status: 500 });
  }
}
