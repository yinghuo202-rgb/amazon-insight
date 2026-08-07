import { loadInventoryDashboardData, loadProfitabilityData } from "@/lib/inventory/data";
import { buildSeasonalInventoryPlan } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalInventoryCsv, type SeasonalInventoryExportKind, type SeasonalInventoryExportMarket } from "@/lib/inventory/seasonal-clearance-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get("kind");
  const market = searchParams.get("market") ?? "ALL";
  if (kind !== "replenishment" && kind !== "clearance") {
    return Response.json({ error: "下载类型必须是 replenishment 或 clearance" }, { status: 400 });
  }
  if (market !== "ALL" && market !== "US" && market !== "CA") {
    return Response.json({ error: "市场必须是 ALL、US 或 CA" }, { status: 400 });
  }

  try {
    const [us, ca, profitability] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA"), loadProfitabilityData()]);
    const result = buildSeasonalInventoryPlan(us, ca, profitability);
    const file = buildSeasonalInventoryCsv(result, kind as SeasonalInventoryExportKind, market as SeasonalInventoryExportMarket);
    return new Response(file.content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "季节库存表导出失败" }, { status: 500 });
  }
}
