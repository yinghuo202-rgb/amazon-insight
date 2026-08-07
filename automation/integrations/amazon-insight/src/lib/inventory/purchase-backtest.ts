import type { InventoryDashboardData } from "@/lib/inventory/contracts";

export type ForecastMethod = "recent3" | "seasonal" | "croston";
export type BacktestMethodResult = { method: ForecastMethod; label: string; weightedErrorPercent: number; biasPercent: number; evaluatedPoints: number; winningSkuCount: number };
export type PurchaseBacktestResult = {
  months: string[];
  skuCount: number;
  intermittentSkuCount: number;
  methods: BacktestMethodResult[];
  recommendedMethod: ForecastMethod;
  recommendedLabel: string;
  topImprovements: Array<{ sku: string; productName: string; baselineError: number; bestError: number; bestMethod: ForecastMethod; bestLabel: string; zeroSharePercent: number }>;
};

const labels: Record<ForecastMethod, string> = { recent3: "近 3 月均值（当前基线）", seasonal: "去年同月季节模型", croston: "Croston 断续需求" };

export function backtestPurchaseDemand(us: InventoryDashboardData, ca: InventoryDashboardData): PurchaseBacktestResult {
  const usRows = new Map(us.rows.map((row) => [row.sku, row])); const caRows = new Map(ca.rows.map((row) => [row.sku, row]));
  const months = [...new Set([...us.sales.historyMonths, ...ca.sales.historyMonths])].sort();
  const methodTotals = new Map<ForecastMethod, { absolute: number; actual: number; signed: number; points: number; wins: number }>(["recent3", "seasonal", "croston"].map((method) => [method as ForecastMethod, { absolute: 0, actual: 0, signed: 0, points: 0, wins: 0 }]));
  const improvements: PurchaseBacktestResult["topImprovements"] = []; let skuCount = 0; let intermittentSkuCount = 0;
  for (const sku of [...new Set([...usRows.keys(), ...caRows.keys()])].sort()) {
    const usRow = usRows.get(sku); const caRow = caRows.get(sku); const byMonth = new Map<string, number>();
    for (const item of usRow?.salesHistoryByMonth ?? []) byMonth.set(item.month, (byMonth.get(item.month) ?? 0) + item.units);
    for (const item of caRow?.salesHistoryByMonth ?? []) byMonth.set(item.month, (byMonth.get(item.month) ?? 0) + item.units);
    const values = months.map((month) => byMonth.get(month) ?? 0); if (values.length < 13 || values.reduce((sum, value) => sum + value, 0) <= 0) continue;
    skuCount += 1; const zeroShare = values.filter((value) => value === 0).length / values.length; if (zeroShare >= 0.25) intermittentSkuCount += 1;
    const errors = new Map<ForecastMethod, { absolute: number; actual: number }>();
    for (const method of ["recent3", "seasonal", "croston"] as const) {
      let absolute = 0; let actualTotal = 0;
      for (let index = 6; index < values.length; index += 1) {
        const history = values.slice(0, index); const forecast = forecastByMethod(method, history, index); const actual = values[index]; const diff = forecast - actual;
        absolute += Math.abs(diff); actualTotal += actual; const total = methodTotals.get(method)!; total.absolute += Math.abs(diff); total.actual += actual; total.signed += diff; total.points += 1;
      }
      errors.set(method, { absolute, actual: actualTotal });
    }
    const best = ([...errors] as Array<[ForecastMethod, { absolute: number; actual: number }]>).sort((a, b) => a[1].absolute - b[1].absolute)[0]; methodTotals.get(best[0])!.wins += 1;
    const baseline = errors.get("recent3")!; const baselineError = percent(baseline.absolute, baseline.actual); const bestError = percent(best[1].absolute, best[1].actual);
    if (best[0] !== "recent3" && baselineError - bestError > 1) improvements.push({ sku, productName: usRow?.productName || caRow?.productName || "", baselineError, bestError, bestMethod: best[0], bestLabel: labels[best[0]], zeroSharePercent: zeroShare * 100 });
  }
  const methods = ([...methodTotals] as Array<[ForecastMethod, { absolute: number; actual: number; signed: number; points: number; wins: number }]>).map(([method, value]) => ({ method, label: labels[method], weightedErrorPercent: percent(value.absolute, value.actual), biasPercent: percent(value.signed, value.actual), evaluatedPoints: value.points, winningSkuCount: value.wins })).sort((a, b) => a.weightedErrorPercent - b.weightedErrorPercent);
  return { months, skuCount, intermittentSkuCount, methods, recommendedMethod: methods[0]?.method ?? "recent3", recommendedLabel: methods[0]?.label ?? labels.recent3, topImprovements: improvements.sort((a, b) => (b.baselineError - b.bestError) - (a.baselineError - a.bestError)).slice(0, 30) };
}

function forecastByMethod(method: ForecastMethod, history: number[], index: number) { if (method === "seasonal" && index >= 12) return history[index - 12]; if (method === "croston") return croston(history); const window = history.slice(-3); return window.reduce((sum, value) => sum + value, 0) / Math.max(1, window.length); }
function croston(history: number[], alpha = 0.2) { let demand = 0; let interval = 1; let gap = 1; let initialized = false; for (const value of history) { if (value > 0) { if (!initialized) { demand = value; interval = gap; initialized = true; } else { demand = alpha * value + (1 - alpha) * demand; interval = alpha * gap + (1 - alpha) * interval; } gap = 1; } else gap += 1; } return initialized ? demand / Math.max(1, interval) : 0; }
function percent(numerator: number, denominator: number) { return denominator > 0 ? Number((numerator / denominator * 100).toFixed(1)) : 0; }
