"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, ChevronDown, ArrowUpRight, ArrowRight } from "lucide-react";
import { OperatingHistoryChart } from "@/components/inventory/operating-history-chart";
import { ProductArtwork } from "@/components/inventory/product-artwork";
import { OpsKpi } from "@/components/inventory/ops-ui";
import { SalesOverviewAnalysisPanel } from "@/components/inventory/sales-overview-analysis-panel";
import { operatingFacts, type OperatingSku } from "@/lib/inventory/dashboard-view-model";
import { resolveOperatingRules, type OperatingRules } from "@/lib/inventory/operating-rules";
import type { OperatingPage } from "@/lib/inventory/operating-query";
import { fullCurrency } from "@/lib/inventory/presentation";
import { skuOperatingHref } from "@/lib/inventory/operating-navigation";
import { buildSkuActionRecommendations, type SkuActionEvidence, type SkuActionRecommendations } from "@/lib/inventory/sku-action-recommendations";

const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const money = (value: number | null | undefined, currency: string) => value == null ? "—" : fullCurrency(value, currency);
const fieldClass = "min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm";
const issueLabels: Record<string, string> = { "利润待核查": "利润偏低", "广告待核查": "广告投入偏高", "退货待核查": "退货偏高", "当前供货风险": "FBA 供货偏紧" };
const issueLabel = (issue: string) => issueLabels[issue] ?? issue;
const issueTone = (issue: string) => issue === "利润为负" || issue === "利润待核查" || issue === "退货待核查" ? "danger" : "warning";
const returnPages = new Map<string, { page: OperatingPage; scroll: number; analysisExpanded: boolean }>();
const pageKey = (p: OperatingPage, brief: boolean) => JSON.stringify([brief, p.market, p.period, p.query, p.filter, p.sort]);
export function RevenueOverviewDashboard({ initial, brief = false }: { initial: OperatingPage; brief?: boolean }) {
  const [page, setPage] = useState(initial);
  const [market, setMarket] = useState(initial.market), [period, setPeriod] = useState(initial.period);
  const [query, setQuery] = useState(initial.query), [filter, setFilter] = useState(initial.filter);
  const [sort, setSort] = useState(initial.sort);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const incomingPage = useRef("");
  const model = page.model, currency = page.currency, snapshot = model.snapshots.find(item => item.market === market);
  const { revenue, profit, units, returns, adSales, adCost, advertising, coverage, delta } = page.summary;
  const search = query.trim(), shown = model.rows, loading = market !== page.market || period !== page.period || query.trim().toLowerCase() !== page.query || filter !== page.filter || sort !== page.sort;
  const context = { filter, query, sort, origin: brief ? "brief" : "overview", returnPeriod: period };
  const focusPeriod = page.focusPeriod || period;
  function remember() {
    if (loading) return;
    returnPages.set(pageKey(page, brief), { page, scroll: window.scrollY, analysisExpanded });
    while (returnPages.size > 10) returnPages.delete(returnPages.keys().next().value!);
  }
  useEffect(() => {
    const identity = pageKey(initial, brief) + initial.model.dataVersion;
    if (incomingPage.current === identity) return;
    const firstVisit = incomingPage.current === "";
    incomingPage.current = identity;
    const previous = returnPages.get(pageKey(initial, brief));
    const restore = previous?.page.model.dataVersion === initial.model.dataVersion ? previous : null;
    if (firstVisit && !restore) return;
    const next = restore?.page ?? initial;
    const timer = setTimeout(() => {
      setPage(next); setMarket(next.market); setPeriod(next.period); setQuery(next.query); setFilter(next.filter); setSort(next.sort); setError("");
      setAnalysisExpanded(restore?.analysisExpanded ?? false);
      if (restore) requestAnimationFrame(() => window.scrollTo(0, restore.scroll));
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, brief]);
  useEffect(() => {
    const params = new URLSearchParams({ market: page.market, period: page.period, query: page.query, filter: page.filter, sort: page.sort });
    window.history.replaceState(window.history.state, "", `${brief ? "/inventory/brief" : "/inventory"}?${params}`);
  }, [page.market, page.period, page.query, page.filter, page.sort, brief]);
  function endpoint(offset = 0, version?: string) {
    const params = new URLSearchParams({ market, period, query, filter, sort, brief: String(brief), offset: String(offset) });
    if (version) params.set("version", version);
    return "/api/inventory/operating-data?" + params;
  }
  useEffect(() => {
    if (market === page.market && period === page.period && query.trim().toLowerCase() === page.query && filter === page.filter && sort === page.sort) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ market, period, query, filter, sort, brief: String(brief) });
      void fetch("/api/inventory/operating-data?" + params, { signal: controller.signal, cache: "no-store" }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "加载失败。");
        if (!controller.signal.aborted) { setPage(payload); setError(""); }
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败。"); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [market, period, query, filter, sort, brief, page.market, page.period, page.query, page.filter, page.sort]);
  async function more() {
    if (busy || loading || page.nextOffset === null) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint(page.nextOffset, page.model.dataVersion), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "加载失败。");
      setPage(current => current.market === payload.market && current.period === payload.period && current.query === payload.query && current.filter === payload.filter && current.sort === payload.sort && current.model.dataVersion === payload.model.dataVersion
        ? { ...payload, model: { ...payload.model, rows: [...current.model.rows, ...payload.model.rows] } } : current);
    } catch (error) { setError(error instanceof Error ? error.message : "加载失败。"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!brief || busy || loading || error || page.nextOffset === null || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { if (entries.some(item => item.isIntersecting)) void more(); }, { rootMargin: "150px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  });
  function reset() { setError(""); }
  return <div className={`ops-revenue space-y-5 ${brief ? "ops-brief" : "ops-overview"}`}>
    <section className="ops-period-controls flex flex-wrap items-center gap-3" aria-label="经营筛选">
      <label className="text-xs text-slate-500">站点 <select aria-label="站点" value={market} onChange={event => { setMarket(event.target.value); reset(); }} className={fieldClass + " ml-2"}>{(model.markets.length ? model.markets : ["US"]).map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs text-slate-500">月份 <select aria-label="月份" value={period} onChange={event => { setPeriod(event.target.value); reset(); }} className={fieldClass + " ml-2"}>{model.periods.length ? model.periods.map(item => <option key={item}>{item}</option>) : <option value="">暂无经营报告</option>}</select></label>
      <span className="text-xs text-slate-500">{model.storeName ? `${model.storeName} · ` : ""}{loading ? "正在更新筛选…" : <>{currency} · 有经营数据 {page.summary.reportedCount} 个 SKU{page.summary.reportedCount > 0 && !page.summary.complete ? period === new Date().toISOString().slice(0, 7) ? " · 月内累计" : " · 期间未齐" : ""}</>}</span>
    </section>
    {!brief && <div className="ops-stale-content" aria-busy={loading}>
      <div className="ops-stale-body space-y-5" inert={loading}>
      <section className="ops-overview-kpis grid grid-cols-2 gap-3" aria-label="经营指标">
        <OpsKpi label="销售额" value={money(revenue, currency)} detail={delta === null ? period || "" : `环比 ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`} />
        <OpsKpi label={page.summary.profitVerified ? "实际利润" : "报告利润"} value={money(profit, currency)} detail={profit !== null && !page.summary.profitVerified ? "未对账" : period || ""} tone={page.summary.profitVerified && profit !== null ? profit < 0 ? "danger" : "positive" : "default"} />
        <OpsKpi label={page.summary.profitVerified ? "利润率" : "报告利润率"} value={percent(revenue !== null && revenue > 0 && profit !== null ? profit / revenue : null)} detail="利润 / 销售额" />
        <OpsKpi label={advertising ? "广告花费" : "月报广告花费"} value={money(advertising ? advertising.cost : adCost, currency)} detail={advertising ? `${advertising.reportMonth} · 截至 ${advertising.businessAsOf.slice(5)}` : period} />
      </section>
      <div className="ops-overview-grid">
        <OperatingTrend page={page} />
        <aside aria-label="重点关注" className="ops-focus-panel ops-surface">
          <div className="flex items-start justify-between gap-3"><div><h2 className="ops-section-title">重点关注</h2><p className="ops-subtext mt-2">{page.focusPeriod ? `${page.focusPeriod} 经营 · 当前库存风险` : "当前库存风险 · 暂无完整经营月"}</p></div><span className="ops-status">{page.priorities.length} 项重点</span></div>
          <ul className="mt-4">{page.priorities.map((item, index) => <li key={item.listingId}><Link onClick={remember} href={skuOperatingHref(item.sku, market, item.period, { ...context, filter: item.filter, returnFilter: filter })} className="ops-focus-row"><span className="ops-focus-index">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.fact.split(" · ").map(issueLabel).join(" · ")} · {item.sku}</span><span className="ops-subtext mt-1 block">{`经营 ${item.operatingPeriod || "—"} · 库存 ${item.inventoryDate || "—"}${item.inventoryDate && !item.stockFresh ? "（过期或日期待核验）" : ""}`}</span><span className="ops-subtext mt-1 block">{item.suggestion}</span>{item.impact !== null && <span className="ops-subtext mt-1 block">{item.impactBasis} {money(item.impact, currency)}</span>}</span><ArrowRight size={15} /></Link></li>)}</ul>
          {page.priorities.length === 0 && <p className="ops-subtext py-10 text-center">暂无触发提醒的 SKU</p>}
          <div className="ops-focus-footer"><span className="ops-subtext">查看完整关注清单与依据</span><Link className="ops-text-link" href={`/inventory/brief?market=${market}&period=${focusPeriod}&filter=focus`}>查看简报 <ArrowRight size={14} /></Link></div>
        </aside>
      </div>
      {page.salesAnalysis && <SalesOverviewAnalysisPanel analysis={page.salesAnalysis} onNavigate={remember} context={context} expanded={analysisExpanded} onExpandedChange={setAnalysisExpanded} />}
      {advertising && <section aria-label="广告表现" className="ops-ad-strip ops-surface">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">广告表现</h2><span className="text-xs text-slate-400">{advertising.reportMonth}{advertising.reportMonth !== period ? " · 最近有数据月份" : ""} · 截至 {advertising.businessAsOf}</span></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5"><Metric label="广告归因销售" value={money(advertising.sales, currency)} /><Metric label="ACOS" value={percent(advertising.acos)} /><Metric label="广告归因比" value={percent(advertising.share)} /><Metric label="退货率" value={percent(units !== null && units > 0 && returns !== null ? returns / units : null)} /><Metric label="供应达标占比" value={percent(coverage)} /></div>
        <p className="ops-subtext mt-4">广告归因比 = 归因销售 / 同期商品销售；归因口径可能跨期或跨商品，不是销售构成。</p>
      </section>}
      {!advertising && adSales !== null && <p className="text-xs text-slate-500">广告归因比 {percent(revenue !== null && revenue > 0 ? adSales / revenue : null)}</p>}
      {!advertising && <section aria-label="辅助经营指标" className="ops-surface grid grid-cols-2 gap-4 p-5"><Metric label="退货率" value={percent(units !== null && units > 0 && returns !== null ? returns / units : null)} /><Metric label="供应达标占比" value={percent(coverage)} /></section>}

      <nav aria-label="经营变化入口" className="flex flex-wrap gap-2">{([["decline", "销售下降"], ["loss", "利润偏低"], ["advertising", "广告投入"], ["returns", "退货偏高"], ["stock", "供货偏紧"]] as const).filter(([kind]) => page.counts[kind] > 0).map(([kind, label]) => <Link key={kind} href={`/inventory/brief?market=${market}&period=${focusPeriod}&filter=${kind}`} className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-[#0071e3]">{label} · {page.counts[kind]}</Link>)}</nav>
      </div>
      {loading && <div role="status" className="ops-stale-status"><span>正在更新 {market} · {period} 的经营数据…</span></div>}
    </div>}
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold tracking-tight">{brief ? "SKU 经营卡片" : "查看一个 SKU"}</h2>{!brief && <Link href={`/inventory/brief?market=${market}&period=${period}&query=${encodeURIComponent(query)}`} className="text-sm text-[#0071e3]">浏览经营简报</Link>}</div>
      <div className={`ops-search-toolbar grid gap-3 ${brief ? "sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_170px_170px]" : ""}`}>
        <label className={`relative ${brief ? "sm:col-span-2 lg:col-span-1" : ""}`}><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input aria-label="搜索 SKU、产品或 ASIN" value={query} onChange={event => { setQuery(event.target.value); reset(); }} placeholder="搜索 SKU、产品或 ASIN" className={fieldClass + " w-full pl-10"} /></label>
        {brief ? <><label className="relative"><SlidersHorizontal size={15} className="absolute left-3 top-3.5 text-slate-400" /><select aria-label="关注类型" value={filter} onChange={event => { setFilter(event.target.value); if (event.target.value === "revenue") setSort("revenue"); reset(); }} className={fieldClass + " w-full pl-9"}><option value="focus">重点关注</option><option value="revenue">销售额贡献</option><option value="loss">利润偏低</option><option value="advertising">广告投入偏高</option><option value="returns">退货偏高</option><option value="decline">销售下降</option><option value="stock">供货偏紧</option><option value="missing">缺失数据</option><option value="all">全部</option></select></label>
        <select aria-label="经营排序" value={sort} onChange={event => { setSort(event.target.value); reset(); }} className={fieldClass + " w-full"}><option value="impact">按经营影响</option><option value="revenue">按销售额</option><option value="margin">按利润率升序</option></select></> : null}
      </div>
      {brief && <div className="ops-filter-chips" aria-label="快速筛选">{([["focus", "重点关注"], ["all", "全部"], ["decline", "销售下降"], ["loss", "利润偏低"], ["advertising", "广告投入"], ["returns", "退货偏高"], ["stock", "供货偏紧"]] as const).map(([kind, label]) => <button key={kind} aria-pressed={filter === kind} onClick={() => { setFilter(kind); reset(); }} className={filter === kind ? "active" : ""}>{label}{kind in page.counts && <span>{page.counts[kind as keyof typeof page.counts]}</span>}</button>)}</div>}
      {(brief || search) && <p className="text-xs text-slate-500">{page.total} 个 SKU · 已显示 {shown.length} 个{brief && !search && !["all", "revenue", "missing"].includes(filter) ? ` · 经营 ${page.focusPeriod || "—"} · 当前库存` : ""}</p>}
      <div className="ops-stale-content" aria-busy={loading}>
        <div className="ops-stale-body" inert={loading}>{brief ? <div className="ops-sku-grid grid items-start gap-4">{shown.map(item => <SkuOperatingCard key={item.market + item.sku} row={item} period={item.analysisPeriod} analysis={item.analysis} actionRecommendations={item.actionRecommendations} context={context} onNavigate={remember} rules={resolveOperatingRules(item.market, item.sku, model.ruleOverrides)} rulesAvailable={model.rulesAvailable} />)}</div> : <div className="ops-mini-grid">{shown.slice(0, 3).map(item => <Link key={item.market + item.sku} onClick={remember} href={skuOperatingHref(item.sku, market, period, context)} className="ops-mini-sku"><ProductArtwork sku={item.sku} available={item.imageAvailable} /><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.productName || item.sku}</strong><span className="ops-subtext mt-1 block">{item.sku} · {item.market}</span></span><span className="text-xs font-semibold">{money(item.analysis.current?.productSales, item.currency)}</span></Link>)}</div>}</div>
        {loading && <div role="status" className="ops-stale-status"><span>正在加载经营数据…</span></div>}
      </div>
      {!loading && (brief || search) && !shown.length && <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">{brief && !search && filter === "focus" ? "本期暂无触发提醒的 SKU" : "没有匹配的 SKU"}<Link href={`/inventory/brief?market=${market}&period=${period}&filter=all`} className="mt-3 block text-[#0071e3]">查看全部 SKU</Link></div>}
      {error && <div role="alert" className="text-sm text-rose-700"><p>{error}</p><button onClick={() => window.location.reload()} className="mt-2 min-h-11 rounded-lg border px-4">重新加载当前筛选</button></div>}
      <div ref={sentinel} aria-hidden="true" />
      {brief && page.nextOffset !== null && <button disabled={busy || loading} onClick={() => void more()} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white text-sm disabled:opacity-50">{busy ? "正在加载…" : "加载更多 20 张卡片"}</button>}
    </section>
    <details className="rounded-xl px-1 py-3 text-xs leading-6 text-slate-500"><summary className={`cursor-pointer ${model.warnings.length || snapshot?.stale ? "text-amber-700" : "text-slate-500"}`}>数据状态{model.warnings.length > 0 ? ` · ${model.warnings.length} 项读取异常` : ""}{snapshot?.stale ? " · 库存过期" : ""}</summary>
      <div className="mt-3 space-y-1">{model.warnings.map(item => <p key={item}>{item}</p>)}<p>经营 {period || "—"} · 库存 {snapshot?.date || "—"} · AWD {snapshot?.awdAvailable ? snapshot.awdDate : "—"}</p><p>更新 {model.generatedAt || "—"} · 版本 {model.publishedVersion ?? model.dataVersion.slice(0, 12)}</p><p>已发布积加报告优先，未覆盖月份沿用 Excel；未对账利润标为报告利润。缺失值显示 —。</p><p>覆盖使用最新库存快照；{page.summary.unknownCoverageCount} 个 SKU 未能计算。过期库存不触发补货建议，国内库存与采购订单不计入海外覆盖。</p><p>关注排序：亏损、FBA 供货、其他提醒；同组按可比利润变化，其余按销售额。</p></div>
      <div className="mt-3 space-y-2 break-words"><p className="break-all">当前解释：定义 {model.metricContract.metricDefinitionVersion} · 计算 {model.metricContract.calculationRuleVersion}</p><p className="break-all">发布来源：定义 {model.publishedMetricContract?.metricDefinitionVersion ?? "未知（旧报告无记录）"} · 计算 {model.publishedMetricContract?.calculationRuleVersion ?? "未知"}</p><p>{model.metricContract.scope}</p>
        <dl className="space-y-3">{model.metricContract.definitions.map(item => <div key={item.id}><dt className="font-medium">{item.name} · {item.unit}</dt><dd>{item.formula}；分母：{item.denominator}。{item.period}；{item.currencyIsolation}。来源：{item.source}。缺失：{item.missingRule}。{item.verificationBoundary}。</dd></div>)}</dl>
      </div>
    </details>
  </div>;
}

function OperatingTrend({ page }: { page: OperatingPage }) {
  const [metric, setMetric] = useState<"revenue" | "profit">("revenue");
  const points = page.chart.filter(point => point.month <= page.period).slice(-6);
  const value = page.summary[metric === "revenue" ? "revenue" : "profit"];
  return <section className="ops-trend-panel ops-surface">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="ops-section-title">销售与利润趋势</h2><p className="ops-subtext mt-2">{page.market} · 最近 {points.length} 个月 · {page.currency}</p></div><div className="ops-chart-control" aria-label="趋势指标">{(["revenue", "profit"] as const).map(key => <button key={key} aria-pressed={metric === key} className={metric === key ? "active" : ""} onClick={() => setMetric(key)}>{key === "revenue" ? "销售额" : "利润"}</button>)}</div></div>
    <p className="ops-trend-value">{money(value, page.currency)}<span className="ops-status ml-3">{page.period}{!page.summary.complete ? " · 累计" : ""}</span></p>
    <OperatingHistoryChart points={points} metric={metric} currency={page.currency} />
  </section>;
}

function actionEvidenceValue(evidence: SkuActionEvidence) {
  return evidence.unit === "currency" ? fullCurrency(evidence.value, evidence.currency || "USD") : `${evidence.value > 0 ? "+" : ""}${evidence.value.toFixed(1)}%`;
}

export function SkuOperatingCard({ row, period, analysis, actionRecommendations, rules, rulesAvailable = true, initialEvidenceOpen, context, onNavigate }: { row: OperatingSku; period: string; analysis?: ReturnType<typeof operatingFacts>; actionRecommendations?: SkuActionRecommendations | null; rules?: OperatingRules; rulesAvailable?: boolean; initialEvidenceOpen?: boolean; context?: { filter?: string; query?: string; sort?: string; origin?: string; returnPeriod?: string }; onNavigate?: () => void }) {
  const facts = analysis ?? operatingFacts(row, period, rules, new Date(), rulesAvailable);
  const actions = actionRecommendations === undefined && rulesAvailable ? buildSkuActionRecommendations(row, period, facts, rules ?? resolveOperatingRules(row.market, row.sku)) : actionRecommendations;
  const leadingAction = actions?.recommendations[0];
  const current = facts.current, displayCurrency = current?.currency || row.currency;
  const history = row.unitHistory.filter(point => point.month <= period).slice(-6);
  const maxUnits = Math.max(1, ...history.map(point => point.units));
  const priceHistory = row.history.filter(point => point.reportMonth <= period).slice(-6);
  const source = !current ? "" : current.sourceKind === "gerpgo" ? "积加" : "Excel";
  return <article className="ops-product-card overflow-hidden rounded-2xl border border-black/5 bg-white">
    <header className="flex items-start gap-3 p-5 pb-3"><ProductArtwork sku={row.sku} available={row.imageAvailable} /><div className="min-w-0 flex-1"><p className="ops-product-code"><Link onClick={onNavigate} href={skuOperatingHref(row.sku, row.market, period, context)}>{row.sku}</Link> · {row.market}</p><h3 className="mt-1 break-words text-sm font-semibold">{row.productName || row.sku}</h3><p className="mt-2 text-[11px] text-slate-400">{`经营 ${period || "—"}${source ? ` · ${source}` : " · 无当期数据"}`}</p><p className="mt-1 text-[11px] text-slate-400">{`当前库存 ${row.inventoryDate || "—"}${row.inventoryDate && !facts.stockFresh ? " · 过期或日期待核验" : ""}`}</p></div>{facts.issues[0] && <span className={`ops-status ops-status-${issueTone(facts.issues[0])}`}>{issueLabel(facts.issues[0])}</span>}</header>
    <div className="ops-product-primary grid grid-cols-3 gap-x-3 px-5 py-4">
      <Metric label="销售额" value={money(current?.productSales, displayCurrency)} />
      <Metric label={current?.quality?.profitVerified ? "实际利润" : "报告利润"} value={money(current?.actualProfit, displayCurrency)} negative={current?.quality?.profitVerified && current.actualProfit != null && current.actualProfit < 0} />
      <Metric label={current?.quality?.profitVerified ? "利润率" : "报告利润率"} value={percent(current && current.productSales > 0 && current.actualProfit !== null ? current.actualProfit / current.productSales : null)} />
    </div>
    <div className="ops-product-secondary mx-5 grid grid-cols-3 gap-x-3 py-3">
      <Metric label="平均成交价" value={money(facts.averagePrice, displayCurrency)} />
      <Metric label="广告花费" value={money(facts.advertisingCost, displayCurrency)} />
      <Metric label="退货率" value={percent(facts.returnRate)} />
    </div>
    <div className="ops-card-trend mx-5 flex flex-wrap items-center justify-between gap-3 py-3"><span className="ops-subtext">供应覆盖 {row.stock?.cover == null ? "—" : `${Math.round(row.stock.cover)} 天`}</span><RevenueSparkline row={row} period={period} /></div>
    {facts.advertisingPeriod && <p className="px-5 pb-2 text-[11px] text-slate-400">广告 {facts.advertisingPeriod}{facts.advertisingPeriod !== period ? " · 最近有数据月份" : ""}{facts.advertisingAsOf ? ` · 截至 ${facts.advertisingAsOf}` : ""}</p>}
    {leadingAction ? <div className="ops-action-preview mx-5 my-4 rounded-xl p-4 text-xs leading-6" data-kind={leadingAction.kind}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-[#1d1d1f]">调整建议 · {leadingAction.title}</p><span className="ops-badge ops-badge-slate">{period} 完整月</span></div>
      <p className="mt-2 text-slate-600">{leadingAction.suggestion}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2">{leadingAction.evidence.slice(0, 2).map(item => <div key={item.label} className="rounded-lg bg-white px-3 py-2"><dt className="text-slate-500">{item.label}</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{actionEvidenceValue(item)}</dd></div>)}</dl>
      {actions && actions.recommendations.length > 1 && <p className="mt-2 text-slate-500">还有 {actions.recommendations.length - 1} 项有依据的调整方向，见详情。</p>}
    </div> : facts.issues.length > 0 && <div className="ops-issue-preview mx-5 my-4 space-y-2 rounded-xl p-4 text-xs leading-6" data-tone={issueTone(facts.issues[0])}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-medium text-[#1d1d1f]">{facts.issues.map(issue => <span key={issue}>{issueLabel(issue)}</span>)}</div>
      {facts.hypotheses.slice(0, 2).map(text => <p key={text} className="text-slate-600">{text}</p>)}
      {facts.suggestion && <p className="text-slate-700">{facts.suggestion}</p>}
    </div>}
    <div className="flex justify-end px-5 pb-3"><Link onClick={onNavigate} href={skuOperatingHref(row.sku, row.market, period, context)} className="ops-text-link">查看详情 <ArrowUpRight size={14} /></Link></div>
    <details open={initialEvidenceOpen} className="group border-t border-slate-100"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-xs font-medium text-slate-600">经营依据<ChevronDown size={15} className="transition-transform group-open:rotate-180" /></summary><div className="space-y-5 px-5 pb-5">
      {facts.hypotheses.length > 2 && <div className="space-y-2 text-xs leading-6 text-slate-600">{facts.hypotheses.slice(2).map(text => <p key={text}>{text}</p>)}</div>}
      <div className="grid grid-cols-2 gap-4"><Metric label="当前售价" value={money(current?.currentPrice, displayCurrency)} /><Metric label="销售额环比" value={facts.revenueChange === null ? "—" : `${facts.revenueChange >= 0 ? "+" : ""}${facts.revenueChange.toFixed(1)}%`} /><Metric label="ACOS" value={percent(facts.acos)} /><Metric label="FBA 可售覆盖" value={facts.fbaCover === null ? "—" : `${Math.round(facts.fbaCover)} 天`} /><Metric label="广告投入 / 销售额" value={percent(facts.advertisingSpendShare)} /><Metric label="仓储费" value={money(current?.storageCost, displayCurrency)} /><Metric label="库存与在途覆盖" value={row.stock?.cover == null ? "—" : `${Math.round(row.stock.cover)} 天`} /><Metric label="退货数量" value={current?.returns != null ? `${current.returns} 件` : "—"} /></div>
      <div className="grid grid-cols-2 gap-4"><Metric label="广告归因销售" value={money(facts.advertisingSales, displayCurrency)} /><Metric label="广告归因比" value={percent(facts.advertisingShare)} /></div><p className="ops-subtext">归因销售 / 同期商品销售；可超过 100%，不用于拆分自然销售。</p>
      {priceHistory.length > 0 && <section><h4 className="text-xs font-medium">历史成交均价</h4><div className="mt-2 flex flex-wrap gap-2">{priceHistory.map(point => <span key={point.reportMonth} className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{point.reportMonth}：{money(point.averagePrice ?? (point.units > 0 ? point.productSales / point.units : null), point.currency)}</span>)}</div></section>}
      {history.length > 0 && <section><h4 className="text-xs font-medium">完整月份销量 · 最近 {history.length} 个月</h4><div className="mt-3 flex h-24 items-end gap-2">{history.map(point => <div key={point.month} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center"><span className="text-[10px] text-slate-500">{point.units}</span><div className="mx-auto w-full max-w-12 rounded-t bg-[#86b9ed]" style={{ height: `${Math.max(2, point.units / maxUnits * 55)}px` }} /><span className="text-[10px] text-slate-400">{point.month.slice(5)}</span></div>)}</div></section>}
      {row.seasonality.evidenceMonths >= 12 && <p className="text-xs leading-6 text-slate-600">历史高销量月份：{row.seasonality.peakMonths.join("、")} 月。</p>}
      <div className="space-y-1 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-400">
        {facts.dataIssues.length > 0 && <p>数据状态：{facts.dataIssues.join(" · ")}</p>}
        <p>{source || "无当期报告"} · 截止 {current?.quality?.businessAsOf || "—"}{current ? ` · 利润${current.quality?.profitVerified ? "已核验" : "未对账"} · 退货${current.quality?.returnsVerified ? "已核验" : "未核验"}` : ""}</p>
        {row.stock?.demandBasis ? <p>需求基线：{row.stock.demandBasis.label} · {row.stock.demandBasis.monthlySales === null ? `${row.stock.dailySales.toFixed(1)} 件/日` : `${row.stock.demandBasis.monthlySales} 件/月`} · {row.stock.demandBasis.date || "期间未知"} · {row.stock.demandBasis.method}{!row.stock.demandBasis.usable ? ` · ${row.stock.demandBasis.reason}` : ""}</p> : null}
        <p>库存快照：FBA {row.inventoryDate || "—"} · AWD {row.awdDate || "—"} · 覆盖目标 {rules?.supplyCoverDays ?? row.stock?.target ?? 90} 天</p>
      </div>
    </div></details>
  </article>;
}
function Metric({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return <div className="ops-metric min-w-0"><p className="text-[11px] leading-5 text-slate-500">{label}</p><p className={`ops-metric-value mt-1 break-words text-sm font-semibold tabular-nums ${negative ? "text-rose-700" : "text-slate-900"}`}>{value}</p></div>;
}

function RevenueSparkline({ row, period }: { row: OperatingSku; period: string }) {
  const history = row.history.filter(point => point.reportMonth <= period && point.reportMonth < new Date().toISOString().slice(0, 7) && point.quality?.completePeriod !== false).slice(-6);
  // A compact sparkline cannot explain a gap; keep it absent rather than joining missing months.
  if (history.some((point, index) => index > 0 && new Date(`${point.reportMonth}-01T00:00:00Z`).getTime() !== Date.UTC(Number(history[index - 1].reportMonth.slice(0, 4)), Number(history[index - 1].reportMonth.slice(5, 7)), 1))) return null;
  const values = history.map(point => point.productSales);
  if (values.length < 2) return null;
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const points = values.map((value, i) => `${3 + i * 98 / (values.length - 1)},${29 - (value - min) / range * 24}`).join(" ");
  return <svg width="104" height="34" viewBox="0 0 104 34" role="img" aria-label={`${row.sku} 最近${values.length}个完整月销售额趋势`}><path d="M2 32H102" stroke="var(--border)" /><polyline points={points} fill="none" stroke="var(--chart-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
