"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, ChevronDown, ArrowUpRight } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OpsKpi } from "@/components/inventory/ops-ui";
import { operatingFacts, type OperatingSku } from "@/lib/inventory/dashboard-view-model";
import { resolveOperatingRules, type OperatingRules } from "@/lib/inventory/operating-rules";
import type { OperatingPage } from "@/lib/inventory/operating-query";
import { fullCurrency } from "@/lib/inventory/presentation";

const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const money = (value: number | null | undefined, currency: string) => value == null ? "—" : fullCurrency(value, currency);
const fieldClass = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm";
export function RevenueOverviewDashboard({ initial, brief = false }: { initial: OperatingPage; brief?: boolean }) {
  const [page, setPage] = useState(initial);
  const [market, setMarket] = useState(initial.market), [period, setPeriod] = useState(initial.period);
  const [query, setQuery] = useState(initial.query), [filter, setFilter] = useState(initial.filter);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const model = page.model, currency = page.currency, snapshot = model.snapshots.find(item => item.market === market);
  const { revenue, profit, units, returns, adSales, coverage, delta } = page.summary;
  const search = query.trim(), shown = model.rows, loading = market !== page.market || period !== page.period || query.trim().toLowerCase() !== page.query || filter !== page.filter;
  function endpoint(offset = 0, version?: string) {
    const params = new URLSearchParams({ market, period, query, filter, brief: String(brief), offset: String(offset) });
    if (version) params.set("version", version);
    return "/api/inventory/operating-data?" + params;
  }
  useEffect(() => {
    if (market === page.market && period === page.period && query.trim().toLowerCase() === page.query && filter === page.filter) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ market, period, query, filter, brief: String(brief) });
      void fetch("/api/inventory/operating-data?" + params, { signal: controller.signal, cache: "no-store" }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "加载失败。");
        if (!controller.signal.aborted) { setPage(payload); setError(""); }
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败。"); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [market, period, query, filter, brief, page.market, page.period, page.query, page.filter]);
  async function more() {
    if (busy || loading || page.nextOffset === null) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint(page.nextOffset, page.model.dataVersion), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "加载失败。");
      setPage(current => current.market === payload.market && current.period === payload.period && current.query === payload.query && current.filter === payload.filter && current.model.dataVersion === payload.model.dataVersion
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
  return <div className="space-y-5">
    <section className="flex flex-wrap items-center gap-3" aria-label="经营筛选">
      <label className="text-xs text-slate-500">站点 <select aria-label="站点" value={market} onChange={event => { setMarket(event.target.value); reset(); }} className={fieldClass + " ml-2"}>{(model.markets.length ? model.markets : ["US"]).map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs text-slate-500">月份 <select aria-label="月份" value={period} onChange={event => { setPeriod(event.target.value); reset(); }} className={fieldClass + " ml-2"}>{model.periods.length ? model.periods.map(item => <option key={item}>{item}</option>) : <option value="">暂无经营报告</option>}</select></label>
      <span className="text-xs text-slate-500">{model.storeName ? `${model.storeName} · ` : ""}{currency} 原币种 · {page.summary.reportedCount} 个有经营报告的 SKU</span>
      <span className="ml-auto text-xs text-slate-500">发布版本：{model.publishedVersion ?? model.dataVersion.slice(0, 12)}</span>
    </section>
    {(model.warnings.length > 0 || snapshot?.stale) && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">{model.warnings.map(item => <p key={item}>{item}</p>)}{snapshot?.stale && <p>{market} 库存快照 {snapshot.date} 已过期；库存覆盖仅作为历史参考，请先更新数据。</p>}</div>}
    <p className="text-xs leading-5 text-slate-500">经营周期 {period || "未提供"}；库存日期 {snapshot?.date || "未提供"}{snapshot?.awdAvailable ? `，AWD ${snapshot.awdDate}` : "，AWD 来源未提供"}。经营指标与库存是两类时间口径，缺失项显示“—”。</p>
    {!brief && <>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6" aria-label="经营指标">
        <OpsKpi label="销售额" value={money(revenue, currency)} detail={delta === null ? "环比待补上月报告" : `环比 ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`} />
        <OpsKpi label={page.summary.profitVerified ? "实际利润" : "来源利润（待对账）"} value={money(profit, currency)} detail={period || "无报告"} tone={profit !== null && profit < 0 ? "danger" : "positive"} />
        <OpsKpi label="利润率" value={percent(revenue !== null && revenue > 0 && profit !== null ? profit / revenue : null)} detail={page.summary.profitVerified ? "实际利润 ÷ 销售额" : "来源利润口径，费用待对账"} />
        <OpsKpi label="广告销售占比" value={percent(adSales !== null && revenue !== null && revenue > 0 ? adSales / revenue : null)} detail={adSales === null ? "待补同月广告销售额" : "广告销售额 ÷ 总销售额"} />
        <OpsKpi label="退货率" value={percent(units !== null && units > 0 && returns !== null ? returns / units : null)} detail="退货件数 ÷ 销售件数；口径以已核验报告为准" />
        <OpsKpi label="库存覆盖" value={percent(coverage)} detail={`按配置覆盖目标达标占比；${page.summary.unknownCoverageCount} 个未能计算`} tone={snapshot?.stale ? "warning" : "default"} />
      </section>
      <div>
        <section className="rounded-2xl border border-black/5 bg-white p-5"><h2 className="text-sm font-semibold">销售额变化</h2><p className="mt-1 text-xs text-slate-500">销售额和来源利润均使用原币种月报金额；利润未经费用对账时仅作来源参考。缺失月份留空，不用销量推算金额。</p>{page.chart.filter(point => point.revenue !== null).length > 1 ? <div className="mt-5 h-60"><ResponsiveContainer width="100%" height="100%"><AreaChart data={page.chart}><CartesianGrid vertical={false} stroke="#e5edef" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} width={60} /><Tooltip formatter={value => money(Number(value), currency)} /><Area dataKey="revenue" name="销售额" stroke="#0071e3" fill="#e4f0fc" strokeWidth={2} connectNulls={false} /><Area dataKey="profit" name="来源利润（待对账）" stroke="#6e6e73" fill="transparent" strokeWidth={2} strokeDasharray="5 5" connectNulls={false} /></AreaChart></ResponsiveContainer></div> : <div className="mt-5 rounded-xl bg-[#f5f5f7] p-5"><p className="text-sm leading-7 text-slate-500">目前只有 {page.chart.filter(point => point.revenue !== null).length} 个月的金额报告，暂不绘制趋势。补充历史月报后，将显示真实销售额变化。</p></div>}</section>
      </div>
    </>}
    {!brief && <nav aria-label="经营变化入口" className="flex flex-wrap gap-2">{([["decline", "销售下降"], ["loss", "亏损复核"], ["advertising", "广告复核"], ["stock", "供货复核"], ["missing", "数据核查"]] as const).map(([kind, label]) => <Link key={kind} href={`/inventory/brief?market=${market}&period=${period}&filter=${kind}`} className="inline-flex min-h-11 items-center rounded-full border bg-white px-4 text-sm text-[#0071e3]">{label} {page.counts[kind]}</Link>)}</nav>}
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold tracking-tight">{brief ? "SKU 经营卡片" : "查看一个 SKU"}</h2>{!brief && <Link href={`/inventory/brief?market=${market}&period=${period}&query=${encodeURIComponent(query)}`} className="text-sm text-[#0071e3]">浏览经营简报</Link>}</div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]"><label className="relative"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input aria-label="搜索 SKU、产品或 ASIN" value={query} onChange={event => { setQuery(event.target.value); reset(); }} placeholder="搜索 SKU、产品或 ASIN" className={fieldClass + " w-full pl-10"} /></label><label className="relative"><SlidersHorizontal size={15} className="absolute left-3 top-3.5 text-slate-400" /><select aria-label="关注类型" value={filter} onChange={event => { setFilter(event.target.value); reset(); }} className={fieldClass + " w-full pl-9"}><option value="focus">优先关注</option><option value="revenue">销售额贡献</option><option value="loss">利润为负</option><option value="advertising">广告待核查</option><option value="returns">退货复核</option><option value="decline">销售下降</option><option value="stock">供货复核</option><option value="missing">数据核查</option><option value="all">全部（按需加载）</option></select></label></div>
      <p className="text-xs text-slate-500">{brief ? `匹配 ${page.total} 个，当前展示 ${shown.length} 个。搜索或按需加载更多。` : search ? `匹配 ${page.total} 个，先展示 ${shown.length} 个。` : "输入 SKU 或产品名称查看经营卡片，不在总览罗列全部产品。"}</p>
      <div className="grid items-start gap-4 xl:grid-cols-2">{!loading && shown.map(item => <SkuOperatingCard key={item.market + item.sku} row={item} period={period} rules={resolveOperatingRules(item.market, item.sku, model.ruleOverrides)} rulesAvailable={model.rulesAvailable} />)}</div>
      {!loading && (brief || search) && !shown.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">没有匹配产品。请更换站点、月份或清除筛选。</div>}
      {loading && <p role="status" className="text-sm text-slate-500">正在加载经营数据…</p>}
      {error && <div role="alert" className="text-sm text-rose-700"><p>{error}</p><button onClick={() => window.location.reload()} className="mt-2 min-h-11 rounded-lg border px-4">重新加载当前筛选</button></div>}
      <div ref={sentinel} aria-hidden="true" />
      {brief && page.nextOffset !== null && <button disabled={busy || loading} onClick={() => void more()} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white text-sm disabled:opacity-50">{busy ? "正在加载…" : "加载更多 20 张卡片"}</button>}
    </section>
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-500"><summary className="cursor-pointer font-medium text-slate-700">数据来源与口径</summary><p className="mt-3">经营报告按已审核发布的积加数据优先、未覆盖期间沿用 Excel 展示。API 授权不等于已经同步；只有后台对账确认并发布后才切换。缺失费用留空，来源利润未经对账不当作完整实际利润。</p><p>库存覆盖由当前库存快照计算，不随经营月份变化。国内库存与采购订单在业务后台查看；历史销量只能解释件数趋势，不代替历史销售额或售价。</p><p>报表更新时间：{model.generatedAt || "未提供"}。缺失报告不会按零经营处理。</p></details>
  </div>;
}

export function SkuOperatingCard({ row, period, rules, rulesAvailable = true }: { row: OperatingSku; period: string; rules?: OperatingRules; rulesAvailable?: boolean }) {
  const facts = operatingFacts(row, period, rules, new Date(), rulesAvailable);
  const current = facts.current, displayCurrency = current?.currency || row.currency;
  const history = row.unitHistory.filter(point => point.month <= period).slice(-6);
  const maxUnits = Math.max(1, ...history.map(point => point.units));
  const priceHistory = row.history.filter(point => point.reportMonth <= period).slice(-6);
  const source = current?.sourceKind === "gerpgo" ? "积加快照" : "Excel 快照";
  return <article className="overflow-hidden rounded-2xl border border-black/5 bg-white">
    <header className="flex items-start justify-between gap-3 p-5 pb-3"><div className="min-w-0"><h3 className="text-base font-semibold text-[#1d1d1f]">{row.sku}<span className="ml-2 text-xs font-normal text-slate-400">{row.market}</span></h3><p className="mt-1 break-words text-xs leading-5 text-slate-500">{row.productName}</p><p className="mt-1 text-[11px] text-slate-400">{period || "无报告"} · {source}</p></div><Link aria-label={`查看 ${row.sku} 业务明细`} href={`/inventory/sku/${encodeURIComponent(row.sku)}?market=${row.market}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500"><ArrowUpRight size={18} /></Link></header>
    <div className="grid grid-cols-3 gap-x-3 gap-y-4 px-5 py-3">
      <Metric label="销售额" value={money(current?.productSales, displayCurrency)} />
      <Metric label={current?.quality?.profitVerified ? "实际利润" : "来源利润（待对账）"} value={money(current?.actualProfit, displayCurrency)} negative={current?.actualProfit != null && current.actualProfit < 0} />
      <Metric label="利润率" value={percent(current && current.productSales > 0 && current.actualProfit !== null ? current.actualProfit / current.productSales : null)} />
      <Metric label="平均成交价" value={money(facts.averagePrice, displayCurrency)} />
      <Metric label="广告销售占比" value={percent(facts.advertisingShare)} />
      <Metric label={current?.quality?.returnsVerified ? "退货率" : "来源退货率（待核验）"} value={percent(facts.returnRate)} />
    </div>
    {facts.dataIssues.length > 0 && <p className="mx-5 mt-3 text-xs leading-6 text-amber-800">{facts.dataIssues.join(" · ")}</p>}
    <div className="mx-5 my-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5"><p className="text-xs font-medium text-[#1d1d1f]">建议复核</p><p className="mt-1 text-xs leading-6 text-slate-600">{facts.suggestion}</p></div>
    <details className="group border-t border-slate-100"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-xs font-medium text-slate-600">展开经营依据<ChevronDown size={15} className="transition-transform group-open:rotate-180" /></summary><div className="space-y-5 px-5 pb-5">
      <div className="grid grid-cols-2 gap-4"><Metric label="当前售价（报告值）" value={money(current?.currentPrice, displayCurrency)} /><Metric label="销售额环比" value={facts.revenueChange === null ? "待补相邻月报" : `${facts.revenueChange >= 0 ? "+" : ""}${facts.revenueChange.toFixed(1)}%`} /><Metric label="ACOS" value={percent(facts.acos)} /><Metric label="当前 FBA 覆盖" value={facts.fbaCover === null ? "—" : `${Math.round(facts.fbaCover)} 天`} /><Metric label="广告投入 / 销售额" value={percent(facts.advertisingSpendShare)} /><Metric label="当月仓储费" value={money(current?.storageCost, displayCurrency)} /><Metric label="库存与在途覆盖" value={row.stock?.cover == null ? "—" : `${Math.round(row.stock.cover)} 天`} /><Metric label="当月退货数量" value={current?.returns != null ? `${current.returns} 件` : "—"} /></div>
      <section><h4 className="text-xs font-medium">历史成交均价</h4><div className="mt-2 flex flex-wrap gap-2">{priceHistory.map(point => <span key={point.reportMonth} className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{point.reportMonth}：{money(point.averagePrice ?? (point.units > 0 ? point.productSales / point.units : null), point.currency)}</span>)}</div><p className="mt-2 text-[11px] leading-5 text-slate-400">销售额 ÷ 件数是计算均价，不是当时 Listing 标价；不足两个月不判断价格趋势。</p></section>
      <section><h4 className="text-xs font-medium">最近六个月销量（辅助证据）</h4>{history.length ? <div className="mt-3 flex h-24 items-end gap-2">{history.map(point => <div key={point.month} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center"><span className="text-[10px] text-slate-500">{point.units}</span><div className="mx-auto w-full max-w-12 rounded-t bg-[#86b9ed]" style={{ height: `${Math.max(2, point.units / maxUnits * 55)}px` }} /><span className="text-[10px] text-slate-400">{point.month.slice(5)}</span></div>)}</div> : <p className="mt-2 text-xs text-slate-500">暂无历史件数数据。</p>}</section>
      <p className="text-xs leading-6 text-slate-600">季节性：{row.seasonality.evidenceMonths < 12 ? "不足 12 个月，不判断旺淡季。" : `历史高销量月份 ${row.seasonality.peakMonths.join("、")} 月；未来三个月相对历史月均系数 ${row.seasonality.nextQuarterFactor ?? "—"}。仅为件数规律，不是销售额预测。`}</p>
      <p className="text-[11px] leading-5 text-slate-400">经营来源 {current?.sourceKind === "gerpgo" ? "积加 API（已审核发布）" : "Excel 报告"}，业务截止 {current?.quality?.businessAsOf || "原报告未提供"}；审核发布不等于费用口径已对账。</p>
      <p className="text-[11px] leading-5 text-slate-400">FBA {row.inventoryDate || "未提供"}；AWD {row.awdDate || "未提供"}。库存覆盖目标 {row.stock?.target ?? 90} 天，不含国内现货与未完工订单。退货原因、退款率及未提供的广告销售额待积加接入后补充。</p>
    </div></details>
  </article>;
}
function Metric({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return <div className="min-w-0"><p className="text-[11px] leading-5 text-slate-500">{label}</p><p className={`mt-1 break-words text-sm font-semibold tabular-nums ${negative ? "text-rose-700" : "text-slate-900"}`}>{value}</p></div>;
}
