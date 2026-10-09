import { getCurrentUser } from "@/lib/auth";
import { loadOperatingModel } from "@/lib/inventory/data";
import { operatingFilters, operatingSorts, queryOperatingModel } from "@/lib/inventory/operating-query";
import { operatingMarkets } from "@/lib/inventory/operating-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const query = params.get("query") || "", period = params.get("period") || "";
  if (query.length > 100 || period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return Response.json({ error: "筛选参数无效。" }, { status: 400 });
  const offset = Number(params.get("offset") || 0), market = params.get("market") || undefined, filter = params.get("filter") || undefined;
  const sort = params.get("sort") || undefined;
  if (sort && !(operatingSorts as readonly string[]).includes(sort)) return Response.json({ error: "排序参数无效。" }, { status: 400 });
  if (!Number.isSafeInteger(offset) || offset < 0 || market && !(operatingMarkets as readonly string[]).includes(market) || filter && !(operatingFilters as readonly string[]).includes(filter)) return Response.json({ error: "筛选参数无效。" }, { status: 400 });
  try {
    const model = await loadOperatingModel();
    const expected = params.get("version");
    if (expected && expected !== model.dataVersion) return Response.json({ error: "经营数据已更新，请重新加载卡片。" }, { status: 409 });
    return Response.json(queryOperatingModel(model, { market, period: period || undefined, query, filter, sort, offset, brief: params.get("brief") === "true" }), { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "经营报告暂不可用，请检查数据更新页。" }, { status: 500 }); }
}
