import { getDataRefreshStatus, runFullDataRefresh } from "@/lib/inventory/data-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getDataRefreshStatus());
}

export async function POST() {
  try {
    return Response.json(await runFullDataRefresh());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据重建失败。" }, { status: 500 });
  }
}
