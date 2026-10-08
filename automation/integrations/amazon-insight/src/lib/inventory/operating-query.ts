import { operatingFacts, type OperatingModel } from "@/lib/inventory/dashboard-view-model";
import { resolveOperatingRules } from "@/lib/inventory/operating-rules";
import { operatingMarkets } from "@/lib/inventory/operating-performance";

export const operatingFilters = ["focus", "revenue", "loss", "advertising", "returns", "decline", "stock", "missing", "all"] as const;
export type OperatingFilter = typeof operatingFilters[number];
export function queryOperatingModel(model: OperatingModel, input: { market?: string; period?: string; query?: string; filter?: string; offset?: number; brief?: boolean }, now = new Date()) {
  const market = input.market || (model.markets.includes("US") ? "US" : model.markets[0] || "US");
  const period = input.period || model.periods[0] || "", query = (input.query || "").trim().toLowerCase();
  const filter = input.filter || "focus";
  if (!(operatingFilters as readonly string[]).includes(filter) || !(operatingMarkets as readonly string[]).includes(market)) throw new Error("筛选参数无效。");
  const currency = market === "CA" ? "CAD" : market === "MX" ? "MXN" : market === "AU" ? "AUD" : "USD";
  const rows = model.rows.filter(row => row.market === market);
  const facts = rows.map(row => ({ row, ...operatingFacts(row, period, resolveOperatingRules(market, row.sku, model.ruleOverrides), now, model.rulesAvailable) }));
  const reported = facts.filter(item => item.current && item.current.currency === currency);
  const sum = (key: "productSales" | "actualProfit" | "units" | "returns") => reported.length && reported.every(item => item.current![key] !== null) ? reported.reduce((total, item) => total + item.current![key]!, 0) : null;
  const revenue = sum("productSales"), profit = sum("actualProfit"), units = sum("units"), returns = sum("returns");
  const adSales = reported.length && reported.every(item => item.current!.advertisingSales != null) ? reported.reduce((total, item) => total + item.current!.advertisingSales!, 0) : null;
  const covered = facts.filter(item => item.supplyFresh && item.row.stock?.cover != null);
  const coverage = covered.length ? covered.filter(item => item.row.stock!.cover! >= resolveOperatingRules(market, item.row.sku, model.ruleOverrides).supplyCoverDays).length / covered.length : null;
  const matches = (item: typeof facts[number], kind: string) => kind === "all" || kind === "revenue"
    || kind === "focus" && (item.issues.length > 0 || item.dataIssues.length > 0)
    || kind === "loss" && item.issues.includes("利润为负")
    || kind === "advertising" && item.issues.includes("广告待核查")
    || kind === "returns" && item.issues.includes("退货待核查")
    || kind === "decline" && item.issues.includes("销售额下降")
    || kind === "stock" && item.issues.some(issue => issue === "当前供货风险" || issue === "供应覆盖不足")
    || kind === "missing" && item.dataIssues.length > 0;
  // Searching a specific product is independent of attention thresholds.
  const matched = facts.filter(item => query ? [item.row.sku, item.row.productName, item.current?.asin, item.current?.msku].some(value => value?.toLowerCase().includes(query)) : matches(item, filter));
  const impact = (item: typeof facts[number]) => {
    if (filter === "revenue") return item.current?.productSales ?? 0;
    if (item.complete && item.current?.quality?.profitVerified && item.previous?.quality?.profitVerified && item.current.actualProfit !== null && item.previous.actualProfit !== null && item.previous.currency === item.current.currency) return Math.abs(item.current.actualProfit - item.previous.actualProfit);
    // Missing prior profit is not zero profit. Use a known revenue fact instead.
    return item.current?.productSales ?? 0;
  };
  matched.sort((a, b) => Number(b.issues.includes("利润为负")) - Number(a.issues.includes("利润为负"))
    || impact(b) - impact(a)
    || a.row.sku.localeCompare(b.row.sku));
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("加载位置无效。");
  const limit = input.brief ? 20 : query ? 3 : 0;
  const shown = matched.slice(offset, offset + limit).map(item => ({ ...item.row, history: item.row.history.filter(point => point.reportMonth <= period).slice(-6), unitHistory: item.row.unitHistory.filter(point => point.month <= period).slice(-6) }));
  const selected = { ...model, rows: shown };
  const priorDate = /^\d{4}-\d{2}$/.test(period) ? new Date(`${period}-01T00:00:00Z`) : null;
  priorDate?.setUTCMonth(priorDate.getUTCMonth() - 1);
  const previousMonth = priorDate?.toISOString().slice(0, 7);
  const previousRows = rows.flatMap(row => row.history.filter(item => item.reportMonth === previousMonth && item.currency === currency));
  const priorRevenue = previousRows.reduce((total, item) => total + item.productSales, 0);
  const complete = period < now.toISOString().slice(0, 7) && reported.length > 0 && reported.every(item => item.complete);
  const sameSkus = reported.every(item => item.previous !== null && item.previous.reportMonth === previousMonth && item.previous.currency === currency && item.previous.quality?.completePeriod !== false);
  const delta = complete && sameSkus && previousRows.length === reported.length && priorRevenue > 0 && revenue !== null ? (revenue / priorRevenue - 1) * 100 : null;
  const earliest = model.periods.filter(month => month <= period).sort()[0];
  const months: string[] = [];
  if (earliest && priorDate) {
    const cursor = new Date(`${period}-01T00:00:00Z`);
    while (months.length < 12 && cursor.toISOString().slice(0, 7) >= earliest) {
      months.unshift(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
  }
  const chart = months.map(month => {
    const points = rows.flatMap(row => row.history.filter(point => point.reportMonth === month && point.currency === currency));
    return { month, revenue: points.length ? points.reduce((total, point) => total + point.productSales, 0) : null, profit: points.length && points.every(point => point.actualProfit !== null) ? points.reduce((total, point) => total + point.actualProfit!, 0) : null };
  });
  return { model: selected, market, period, query, filter, currency, total: matched.length, nextOffset: limit && offset + limit < matched.length ? offset + limit : null,
    summary: { revenue, profit, units, returns, adSales, coverage, delta, complete, reportedCount: reported.length, profitVerified: reported.length > 0 && reported.every(item => item.current?.quality?.profitVerified),
      coveredCount: covered.length, unknownCoverageCount: facts.length - covered.length }, chart,
    counts: Object.fromEntries(operatingFilters.map(kind => [kind, facts.filter(item => matches(item, kind)).length])) };
}
export type OperatingPage = ReturnType<typeof queryOperatingModel>;
