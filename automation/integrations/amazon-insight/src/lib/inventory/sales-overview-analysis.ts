import type { OperatingModel, OperatingSku } from "@/lib/inventory/dashboard-view-model";

type Point = OperatingSku["history"][number];
type Entry = { row: OperatingSku; point: Point };
export type SalesComparison = { currentPeriod: string; previousPeriod: string; current: number; previous: number; delta: number; percent: number | null };
export type SalesDecomposition = { volume: number; price: number; otherMatched: number; coverageDifference: number; total: number; matchedSkuCount: number; decomposedSkuCount: number };
export type SalesMover = { sku: string; productName: string; current: number; previous: number; delta: number; percent: number | null };
export type SalesAdvertisingComparison = {
  period: string; previousPeriod: string; currentCost: number; previousCost: number | null; costDelta: number | null;
  spendShare: number | null; previousSpendShare: number | null; spendSharePointChange: number | null;
  acos: number | null; previousAcos: number | null; acosPointChange: number | null;
};
export type SalesProfitComparison = { current: number; previous: number | null; delta: number | null; margin: number | null; previousMargin: number | null; marginPointChange: number | null };
export type SalesOverviewAnalysis = {
  market: string; currency: string; requestedPeriod: string; period: string | null; fallback: boolean;
  status: "available" | "incomplete" | "unavailable"; revenue: number | null; skuCount: number;
  comparisons: { month: SalesComparison | null; quarter: SalesComparison | null; year: SalesComparison | null };
  decomposition: SalesDecomposition | null; movers: { gainers: SalesMover[]; decliners: SalesMover[] };
  advertising: SalesAdvertisingComparison | null; profit: SalesProfitComparison | null;
  topFive: { revenue: number; share: number; skuCount: number; previousShare: number | null; pointChange: number | null } | null;
  conclusions: string[];
  basis: {
    version: string | null; generatedAt: string | null; sources: string[]; notes: string[];
    currentSkuCount: number; previousSkuCount: number; matchedSkuCount: number; currentOnlySkuCount: number; previousOnlySkuCount: number;
  };
};

const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const monthShift = (month: string, amount: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
};
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
const sourceName = (point: Point) => point.sourceKind === "gerpgo" ? "积加经营报告" : "月度 Excel 报告";
const changePercent = (current: number, previous: number) => previous > 0 ? (current - previous) / previous * 100 : null;
const ratio = (numerator: number | null, denominator: number | null) => numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
const pointChange = (current: number | null, previous: number | null) => current !== null && previous !== null ? (current - previous) * 100 : null;
const comparison = (currentPeriod: string, previousPeriod: string, current: number, previous: number): SalesComparison => ({ currentPeriod, previousPeriod, current, previous, delta: current - previous, percent: changePercent(current, previous) });

type Snapshot = { month: string; entries: Entry[]; bySku: Map<string, Entry>; revenue: number | null; complete: boolean; notes: string[]; sources: string[] };

/** Computes compact, site-isolated facts from a single published model; never infers a cause from correlation. */
export function buildSalesOverviewAnalysis(model: OperatingModel, market: string, requestedPeriod: string, now = new Date()): SalesOverviewAnalysis {
  const result: SalesOverviewAnalysis = {
    market, currency: market === "CA" ? "CAD" : "USD", requestedPeriod, period: null, fallback: false,
    status: "unavailable", revenue: null, skuCount: 0, comparisons: { month: null, quarter: null, year: null },
    decomposition: null, movers: { gainers: [], decliners: [] }, advertising: null, profit: null, topFive: null, conclusions: [],
    basis: { version: model.publishedVersion ?? model.dataVersion ?? null, generatedAt: model.generatedAt,
      sources: [], notes: [], currentSkuCount: 0, previousSkuCount: 0, matchedSkuCount: 0, currentOnlySkuCount: 0, previousOnlySkuCount: 0 },
  };
  const notes = new Set<string>();
  if (!["US", "CA"].includes(market) || !validMonth(requestedPeriod) || !finite(now.getTime())) {
    result.basis.notes.push("站点或分析期间无效。");
    return result;
  }
  const currentMonth = now.toISOString().slice(0, 7);
  const rows = model.rows.filter(row => row.market === market);
  const cache = new Map<string, Snapshot>();
  const snapshot = (month: string): Snapshot => {
    const cached = cache.get(month);
    if (cached) return cached;
    const entries = rows.flatMap(row => row.history.filter(point => point.reportMonth === month).map(point => ({ row, point })));
    const bySku = new Map<string, Entry>();
    const problems = new Set<string>();
    if (!entries.length) {
      const summaries = (model.salesHistory ?? []).filter(item => item.market === market && item.reportMonth === month);
      if (summaries.length) {
        const summary = summaries[0];
        const valid = summaries.length === 1 && summary.currency === result.currency && finite(summary.productSales);
        const complete = valid && month < currentMonth && summary.businessAsOf === monthEnd(month);
        const value: Snapshot = { month, entries, bySku, revenue: valid ? summary.productSales : null, complete,
          notes: [`${month} 使用历史月度销售汇总，仅用于整体金额趋势，没有该月 SKU 明细。`,
            ...(!complete ? [`${month} 月汇总重复、币种不一致或期间不完整，未用于月份比较。`] : [])], sources: ["历史月度销售汇总"] };
        cache.set(month, value);
        return value;
      }
    }
    const sources = [...new Set(entries.map(entry => sourceName(entry.point)))].sort();
    let amountsValid = entries.length > 0;
    let complete = month < currentMonth && entries.length > 0;
    let legacyPeriod = false;
    for (const entry of entries) {
      const { point, row } = entry;
      if (bySku.has(row.sku)) { problems.add(`${month} 存在重复 SKU 月记录，未汇总该月。`); amountsValid = false; }
      bySku.set(row.sku, entry);
      if (point.market !== market || point.sku !== row.sku || point.currency !== result.currency) {
        amountsValid = false; problems.add(`${month} 存在站点、SKU 或币种不一致，未汇总该月。`);
      }
      if (!finite(point.productSales)) { amountsValid = false; problems.add(`${month} 存在缺失或无效销售额，未汇总该月。`); }
      const asOf = point.quality?.businessAsOf;
      if (point.quality?.completePeriod === false || asOf !== undefined && asOf !== monthEnd(month)
        || point.sourceKind === "gerpgo" && point.quality?.completePeriod !== true) complete = false;
      if (point.sourceKind !== "gerpgo" && point.quality?.completePeriod === undefined) legacyPeriod = true;
    }
    if (legacyPeriod) problems.add(`${month} 旧版 Excel 未标注期间完整性，按已结束的月度报告读取。`);
    if (entries.length && !complete) problems.add(`${month} 尚未结束、截止日期不完整或缺少期间确认，未用于月份比较。`);
    const value: Snapshot = { month, entries, bySku, revenue: amountsValid ? entries.reduce((total, entry) => total + entry.point.productSales, 0) : null,
      complete: complete && amountsValid, notes: [...problems], sources };
    cache.set(month, value);
    return value;
  };
  let period: string | null = requestedPeriod;
  if (requestedPeriod >= currentMonth) {
    period = [...new Set([...rows.flatMap(row => row.history.map(point => point.reportMonth)), ...(model.salesHistory ?? []).filter(item => item.market === market).map(item => item.reportMonth)])]
      .filter(month => validMonth(month) && month <= requestedPeriod && snapshot(month).complete).sort().at(-1) ?? null;
    result.fallback = period !== requestedPeriod;
    notes.add(period ? `所选 ${requestedPeriod} 为未结束期间，历史分析使用最近完整月 ${period}。` : `所选 ${requestedPeriod} 之前没有可用的完整月。`);
  }
  result.period = period;
  if (!period) { result.basis.notes = [...notes]; return result; }
  const current = snapshot(period);
  const previousPeriod = monthShift(period, -1);
  const previous = snapshot(previousPeriod);
  current.notes.forEach(note => notes.add(note));
  previous.notes.forEach(note => notes.add(note));
  result.revenue = current.revenue;
  result.skuCount = current.bySku.size;
  result.status = current.complete ? "available" : current.entries.length || current.revenue !== null ? "incomplete" : "unavailable";
  result.basis.sources = [...new Set([...current.sources, ...previous.sources])];
  result.basis.currentSkuCount = current.bySku.size;
  result.basis.previousSkuCount = previous.bySku.size;
  const matched = [...current.bySku.keys()].filter(sku => previous.bySku.has(sku));
  result.basis.matchedSkuCount = matched.length;
  result.basis.currentOnlySkuCount = current.bySku.size - matched.length;
  result.basis.previousOnlySkuCount = previous.bySku.size - matched.length;
  if (!current.complete) {
    if (!current.entries.length && current.revenue === null) notes.add(`${period} 没有可用的已发布经营记录。`);
    result.basis.notes = [...notes];
    return result;
  }
  notes.add(current.entries.length
    ? "本期金额为当前发布版本内的已报 SKU 汇总；某月未出现的 SKU 不视为零销售、新增或流失。"
    : "本期金额来自历史月度汇总，缺少 SKU 明细，不能拆解产品贡献。");
  const topFive = (value: Snapshot) => {
    if (!value.complete || !value.entries.length || value.revenue === null || value.revenue <= 0 || value.entries.some(entry => entry.point.productSales < 0)) return null;
    const top = [...value.entries].sort((a, b) => b.point.productSales - a.point.productSales).slice(0, 5);
    const revenue = top.reduce((total, entry) => total + entry.point.productSales, 0);
    return { revenue, share: revenue / value.revenue, skuCount: top.length };
  };
  const top = topFive(current), priorTop = topFive(previous);
  if (top) result.topFive = { ...top, previousShare: priorTop?.share ?? null, pointChange: pointChange(top.share, priorTop?.share ?? null) };
  if (previous.complete && previous.revenue !== null) {
    result.comparisons.month = comparison(period, previousPeriod, current.revenue!, previous.revenue);
    if (current.entries.length && previous.entries.length) {
    const movers: SalesMover[] = [];
    let volume = 0, matchedDelta = 0, otherMatched = 0, decomposedSkuCount = 0;
    for (const sku of matched) {
      const entry = current.bySku.get(sku)!, prior = previous.bySku.get(sku)!;
      const c = entry.point, p = prior.point, delta = c.productSales - p.productSales;
      movers.push({ sku, productName: entry.row.productName, current: c.productSales, previous: p.productSales, delta, percent: changePercent(c.productSales, p.productSales) });
      if (finite(c.units) && finite(p.units) && c.units > 0 && p.units > 0 && c.productSales >= 0 && p.productSales >= 0) {
        const currentPrice = c.productSales / c.units, previousPrice = p.productSales / p.units;
        volume += (c.units - p.units) * (currentPrice + previousPrice) / 2;
        matchedDelta += delta;
        decomposedSkuCount++;
      } else otherMatched += delta;
    }
    // Symmetric price effect: (p1-p0)*(q1+q0)/2. Subtracting the symmetric volume effect from
    // the exact matched change avoids accumulating an independent floating-point residual.
    const price = matchedDelta - volume;
    const total = current.revenue! - previous.revenue;
    const coverageDifference = total - (volume + price + otherMatched);
    result.decomposition = { volume, price, otherMatched, coverageDifference, total, matchedSkuCount: matched.length, decomposedSkuCount };
    result.movers.gainers = movers.filter(item => item.delta > 0).sort((a, b) => b.delta - a.delta || a.sku.localeCompare(b.sku)).slice(0, 3);
    result.movers.decliners = movers.filter(item => item.delta < 0).sort((a, b) => a.delta - b.delta || a.sku.localeCompare(b.sku)).slice(0, 3);
    if (result.basis.currentOnlySkuCount || result.basis.previousOnlySkuCount) notes.add(`相邻月匹配 ${matched.length} 个 SKU；仅本期有记录 ${result.basis.currentOnlySkuCount} 个，仅上期有记录 ${result.basis.previousOnlySkuCount} 个，其金额归入“记录范围差异”。`);
    if (otherMatched !== 0 || decomposedSkuCount < matched.length) notes.add(`${matched.length - decomposedSkuCount} 个同 SKU 因销量为零、缺失或销售额为负，仅计金额变化，归入“其他同 SKU”。`);
    if (current.sources.join() !== previous.sources.join() || matched.some(sku => sourceName(current.bySku.get(sku)!.point) !== sourceName(previous.bySku.get(sku)!.point))) notes.add("相邻月经营报告来源有变化，金额变化可能包含来源口径影响。");
    notes.add("量价分解逐 SKU 使用销售额 ÷ 销量的成交均价，采用对称分解；反映金额构成，不等同于调价或广告的因果效果。");
    } else notes.add("相邻月包含整店月汇总，缺少两期 SKU 明细，未计算量价分解和 SKU 涨跌贡献。" );
  } else notes.add(`相邻月 ${previousPeriod} 缺少完整可比经营记录。`);

  const sixMonths = Array.from({ length: 6 }, (_, index) => monthShift(period, index - 5)).map(snapshot);
  if (sixMonths.every(value => value.complete)) {
    result.basis.sources = [...new Set([...result.basis.sources, ...sixMonths.flatMap(value => value.sources)])];
    const before = sixMonths.slice(0, 3), recent = sixMonths.slice(3);
    result.comparisons.quarter = comparison(`${recent[0].month}–${recent[2].month}`, `${before[0].month}–${before[2].month}`,
      recent.reduce((total, item) => total + item.revenue!, 0), before.reduce((total, item) => total + item.revenue!, 0));
    if (sixMonths.some(value => !value.entries.length)) notes.add("三个月比较包含历史月度销售汇总，仅比较整体金额，不能核验全部月份的 SKU 覆盖一致性。" );
    else if (new Set(sixMonths.map(value => [...value.bySku.keys()].sort().join("\u0000"))).size > 1) notes.add("近六个月已报 SKU 范围有变化，三个月比较为各期已报销售额之和。");
  } else notes.add("近三个月对前三个月需要六个连续完整月，目前未齐。" );
  const yearPeriod = monthShift(period, -12), year = snapshot(yearPeriod);
  if (year.complete) {
    result.basis.sources = [...new Set([...result.basis.sources, ...year.sources])];
    result.comparisons.year = comparison(period, yearPeriod, current.revenue!, year.revenue!);
    if (!current.entries.length || !year.entries.length) notes.add("同比包含历史月度销售汇总，仅比较整体金额。" );
    else if ([...current.bySku.keys()].sort().join("\u0000") !== [...year.bySku.keys()].sort().join("\u0000")) notes.add("同比两期已报 SKU 范围不同，比较为各期已报销售额。" );
  } else notes.add(`同比所需 ${yearPeriod} 完整月记录未齐。`);

  const profit = (value: Snapshot) => value.complete && value.entries.length > 0 && value.entries.every(entry => entry.point.quality?.profitVerified === true && finite(entry.point.actualProfit))
    ? value.entries.reduce((total, entry) => total + entry.point.actualProfit!, 0) : null;
  const currentProfit = profit(current), previousProfit = profit(previous);
  if (currentProfit !== null) {
    const margin = ratio(currentProfit, current.revenue), previousMargin = ratio(previousProfit, previous.revenue);
    result.profit = { current: currentProfit, previous: previousProfit, delta: previousProfit !== null ? currentProfit - previousProfit : null,
      margin, previousMargin, marginPointChange: pointChange(margin, previousMargin) };
  } else notes.add("本期未全部具备已核验实际利润，不计算整体利润变化。" );
  const advertising = (value: Snapshot) => {
    if (!value.complete) return null;
    const scopes = (model.advertisingScopes ?? []).filter(scope => scope.market === market && scope.reportMonth === value.month);
    if (scopes.length !== 1) return null;
    const scope = scopes[0];
    if (scope.currency !== result.currency || scope.startDate !== `${value.month}-01` || scope.businessAsOf !== monthEnd(value.month)
      || !finite(scope.dayCount) || scope.dayCount < Number(monthEnd(value.month).slice(8)) || !finite(scope.cost) || scope.cost < 0) return null;
    return { cost: scope.cost, spendShare: ratio(scope.cost, value.revenue), acos: finite(scope.sales) && scope.sales > 0 ? scope.cost / scope.sales : null };
  };
  const ads = advertising(current), priorAds = advertising(previous);
  if (ads) {
    result.advertising = { period, previousPeriod, currentCost: ads.cost, previousCost: priorAds?.cost ?? null,
      costDelta: priorAds ? ads.cost - priorAds.cost : null, spendShare: ads.spendShare, previousSpendShare: priorAds?.spendShare ?? null,
      spendSharePointChange: pointChange(ads.spendShare, priorAds?.spendShare ?? null), acos: ads.acos, previousAcos: priorAds?.acos ?? null,
      acosPointChange: pointChange(ads.acos, priorAds?.acos ?? null) };
    result.basis.sources.push("积加站点广告汇总");
    if (!priorAds) notes.add(`上期 ${previousPeriod} 缺少同期完整广告数据，不比较广告变化。`);
    notes.add("广告投入占比 = 同期广告花费 ÷ 商品销售额；ACOS = 广告花费 ÷ 广告归因销售额，不代表自然销售占比。" );
  } else notes.add("本期缺少同站点、同币种、整月完整的广告汇总，不延用其他月份广告数据。" );

  const money = (value: number) => `${result.currency} ${value.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const month = result.comparisons.month;
  if (month) {
    result.conclusions.push(`${period} 已报销售额 ${money(month.current)}，较上月${month.delta === 0 ? "持平" : `${month.delta > 0 ? "增加" : "减少"} ${money(Math.abs(month.delta))}${month.percent !== null ? `（${Math.abs(month.percent).toFixed(1)}%）` : ""}`}。`);
    const d = result.decomposition;
    if (d) {
      const effects = [{ label: "销量变化", value: d.volume }, { label: "成交均价变化", value: d.price }].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      if (d.decomposedSkuCount && Math.abs(effects[0].value) >= .01) result.conclusions.push(`同 SKU 量价分解中，${effects[0].label}对应${effects[0].value > 0 ? "增加" : "减少"} ${money(Math.abs(effects[0].value))}，金额影响较大。`);
      if (result.basis.currentOnlySkuCount || result.basis.previousOnlySkuCount) result.conclusions.push(`记录范围差异另对应${d.coverageDifference >= 0 ? "增加" : "减少"} ${money(Math.abs(d.coverageDifference))}。`);
    }
  } else result.conclusions.push(`${period} 已报销售额 ${money(current.revenue!)}${current.entries.length ? `，覆盖 ${current.bySku.size} 个 SKU` : ""}。`);
  result.basis.notes = [...notes];
  return result;
}
