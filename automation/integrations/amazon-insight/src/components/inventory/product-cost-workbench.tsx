"use client";

import { Calculator, CheckCircle2, RotateCcw, Save, Search, Sigma } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { PRODUCT_COST_VAT_RATE } from "@/lib/inventory/product-cost-policy";
import type { ProductCostOverride, ProductCostValues } from "@/lib/inventory/product-cost-store";
import { calculateCostsFromTaxIncluded, type ProductCostPageEditState, type ProductCostPageVersion, type ProductCostRow, type ProductCostSeries } from "@/lib/inventory/product-costs";

type ProductCostView = {
  rows: ProductCostRow[];
  series: ProductCostSeries[];
  parameters: { vatRate: number; exchangeRate: number };
  editStates?: ProductCostPageEditState[];
};

type CurrentCostPayload = { items: ProductCostOverride[]; editStates: ProductCostPageEditState[];
  sourceCosts?: Record<string, ProductCostValues>; sourceReportVersion?: string | null };

export function ProductCostWorkbench({ view, initialQuery = "" }: { view: ProductCostView; initialQuery?: string }) {
  const pageSize = 30;
  const [drafts, setDrafts] = useState<Record<string, ProductCostValues>>(() => valuesBySku(view.rows));
  const [savedValues, setSavedValues] = useState<Record<string, ProductCostValues>>(() => valuesBySku(view.rows));
  const [sourceCosts, setSourceCosts] = useState<Record<string, ProductCostValues>>(() => Object.fromEntries(view.rows.map((row) => [row.sku, row.source])));
  const [sourceReportVersion, setSourceReportVersion] = useState<string | null>(null);
  const [overrideMeta, setOverrideMeta] = useState<Record<string, string>>(() => Object.fromEntries(view.rows.flatMap((row) => row.updatedAt ? [[row.sku, row.updatedAt]] : [])));
  const [editStates, setEditStates] = useState<Record<string, ProductCostPageEditState>>(() => Object.fromEntries((view.editStates ?? []).map((state) => [state.sku, state])));
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [source, setSource] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const [seriesFilter, setSeriesFilter] = useState("ALL");
  const [query, setQuery] = useState(initialQuery);
  const [exchangeRate, setExchangeRate] = useState(view.parameters.exchangeRate);
  const [batchPercent, setBatchPercent] = useState(0);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return view.rows.filter((row) =>
      (seriesFilter === "ALL" || row.seriesId === seriesFilter)
      && (!normalized || `${row.sku} ${row.productName} ${row.seriesName} ${row.category} ${row.variantValue}`.toUpperCase().includes(normalized)),
    );
  }, [query, seriesFilter, view.rows]);
  const dirtySkus = useMemo(() => view.rows
    .filter((row) => !sameCosts(drafts[row.sku], savedValues[row.sku]))
    .map((row) => row.sku), [drafts, savedValues, view.rows]);
  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasMore = visibleRows.length < filteredRows.length;
  const selectedSeries = view.series.find((item) => item.id === seriesFilter);
  const scopeLabel = `${selectedSeries?.name ?? "全部系列"}${query.trim() ? ` · 搜索“${query.trim()}”` : ""}`;
  const costCoverage = filteredRows.filter((row) => drafts[row.sku]?.purchaseCostRmbTaxIncluded !== null).length;
  const averageCost = average(filteredRows.flatMap((row) => {
    const value = drafts[row.sku]?.purchaseCostRmbTaxIncluded;
    return value === null || value === undefined ? [] : [value];
  }));
  const filteredOverrides = filteredRows.filter((row) => overrideMeta[row.sku]).length;
  const restorableSkus = filteredRows.filter((row) => overrideMeta[row.sku] || editStates[row.sku]?.latest).map((row) => row.sku);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((current) => Math.min(current + pageSize, filteredRows.length));
    }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredRows.length, hasMore]);

  function patchCost(sku: string, field: keyof ProductCostValues, value: number | null) {
    setDrafts((current) => ({
      ...current,
      [sku]: field === "purchaseCostRmbTaxIncluded"
        ? calculateCostsFromTaxIncluded(value, exchangeRate)
        : { ...current[sku], [field]: value },
    }));
    setMessage("");
  }

  function applySeriesAdjustment() {
    if (seriesFilter === "ALL") {
      setMessage("请先选择一个具体系列，再进行整系列调整。");
      return;
    }
    const ratio = 1 + batchPercent / 100;
    setDrafts((current) => {
      const next = { ...current };
      for (const row of filteredRows) {
        const value = current[row.sku]?.purchaseCostRmbTaxIncluded;
        if (value === null || value === undefined) continue;
        next[row.sku] = calculateCostsFromTaxIncluded(Math.max(0, value * ratio), exchangeRate);
      }
      return next;
    });
    setMessage(`已将“${selectedSeries?.name ?? "当前系列"}”含税成本调整 ${signed(batchPercent)}%，未税和美元成本已按当前参数重新换算；保存后按指定日期生效。`);
  }

  function writeMetadata(skus: string[]) {
    return { effectiveFrom, effectiveTo: effectiveTo || null, source: source.trim(),
      expectedVersions: Object.fromEntries(skus.map((sku) => [sku, editStates[sku]?.editVersion ?? "none"])) };
  }

  function validateMetadata() {
    if (!effectiveFrom || !source.trim() || (effectiveTo && effectiveTo < effectiveFrom)) {
      setMessage("请填写生效日期与成本来源；截止日期不得早于生效日期。");
      return false;
    }
    return true;
  }

  function acceptCurrent(payload: CurrentCostPayload, submitted?: Record<string, ProductCostValues>) {
    const overrides = new Map(payload.items.map((item) => [item.sku, item]));
    // A report may have changed since SSR. Restore follows the response's published
    // source, not its historical restore snapshot or the initial page's source.
    const latestSourceCosts = { ...sourceCosts, ...(payload.sourceCosts ?? {}) };
    const currentValues = Object.fromEntries(view.rows.map((row) => [row.sku, costValues(overrides.get(row.sku) ?? latestSourceCosts[row.sku] ?? row.source)]));
    setDrafts((current) => Object.fromEntries(view.rows.map((row) => [row.sku,
      sameCosts(current[row.sku], submitted?.[row.sku] ?? savedValues[row.sku]) ? currentValues[row.sku] : current[row.sku],
    ])));
    setSavedValues(currentValues);
    setSourceCosts(latestSourceCosts);
    if (payload.sourceReportVersion !== undefined) setSourceReportVersion(payload.sourceReportVersion);
    setOverrideMeta(Object.fromEntries(payload.items.map((item) => [item.sku, item.updatedAt])));
    setEditStates(Object.fromEntries(payload.editStates.map((state) => [state.sku, state])));
    setConflicted(false);
  }

  async function reviewLatestVersions() {
    setBusy("review");
    try {
      const response = await fetch("/api/inventory/product-costs");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "读取最新成本失败。");
      acceptCurrent(payload);
      setMessage("已读取最新版本并保留草稿；请核对各 SKU 当前有效成本，再决定是否重新保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取最新成本失败。");
    } finally { setBusy(""); }
  }

  async function saveChanges(saveFilteredVersion = false) {
    if (saveFilteredVersion && dirtySkus.length) return;
    const skus = saveFilteredVersion ? filteredRows.map((row) => row.sku) : dirtySkus;
    if (!skus.length || !validateMetadata()) return;
    if (saveFilteredVersion && skus.length > 1 && !window.confirm(`确认按当前筛选（${scopeLabel}）保存 ${skus.length} 个 SKU 的同价成本版本？\n生效 ${effectiveFrom}${effectiveTo ? ` 至 ${effectiveTo}（含截止日）` : "，无截止日期"}\n来源：${source.trim()}\nSKU：${skus.slice(0, 10).join("、")}${skus.length > 10 ? ` 等，共 ${skus.length} 个` : ""}\n金额采用页面已读取的当前有效成本，追加日期/来源历史。`)) return;
    const submitted = Object.fromEntries(skus.map((sku) => [sku, { ...(saveFilteredVersion ? savedValues[sku] : drafts[sku]) }]));
    setBusy("save"); setMessage("");
    try {
      const response = await fetch("/api/inventory/product-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: skus.map((sku) => ({ sku, ...submitted[sku] })), ...writeMetadata(skus) }),
      });
      const payload = await response.json();
      if (!response.ok) { if (response.status === 409) setConflicted(true); throw new Error(payload.error || "产品成本保存失败。"); }
      acceptCurrent(payload, submitted);
      setMessage(`已保存 ${skus.length} 个 SKU 的${saveFilteredVersion ? "同价" : ""}成本版本（${effectiveFrom} 起${effectiveTo ? `，至 ${effectiveTo}，含截止日` : ""}）；页面已回显当前有效成本，未来或已失效版本不用于当前产品与试算。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "产品成本保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function restoreSourceCosts() {
    const skus = restorableSkus;
    if (!skus.length) {
      setMessage("当前筛选范围没有需要恢复的人工成本。");
      return;
    }
    if (!validateMetadata()) return;
    if (!window.confirm(`确认将当前筛选（${scopeLabel}）的 ${skus.length} 个 SKU 从 ${effectiveFrom} 起${effectiveTo ? `至 ${effectiveTo}（含截止日）` : "，无截止日期"}恢复为已发布目录源成本？\n来源：${source.trim()}\n这会追加恢复版本，保留全部历史，不删除审计。\n恢复不会取消更晚生效的既有计划，后来版本仍按生效日适用。`)) return;
    const submitted = Object.fromEntries(skus.map((sku) => [sku, { ...drafts[sku] }]));
    setBusy("restore"); setMessage("");
    try {
      const response = await fetch("/api/inventory/product-costs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus, ...writeMetadata(skus) }),
      });
      const payload = await response.json();
      if (!response.ok) { if (response.status === 409) setConflicted(true); throw new Error(payload.error || "恢复源成本失败。"); }
      acceptCurrent(payload, submitted);
      setMessage(`已追加 ${skus.length} 个 SKU 的恢复版本（${effectiveFrom} 起${effectiveTo ? `，至 ${effectiveTo}` : ""}），历史已保留；页面回显当前有效成本，不提前使用未来恢复值。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复源成本失败。");
    } finally {
      setBusy("");
    }
  }

  return <div className="space-y-5">
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="当前筛选" value={`${filteredRows.length} SKU`} detail={selectedSeries ? `${selectedSeries.name} · ${selectedSeries.kind === "variant" ? "父子系列" : "待归系列"}` : `${view.series.length} 个系列分组`} />
      <OpsKpi label="含税成本覆盖" value={`${costCoverage}/${filteredRows.length}`} detail={`${filteredRows.length ? Math.round(costCoverage / filteredRows.length * 100) : 0}% 已有人民币含税成本`} tone={costCoverage === filteredRows.length ? "positive" : "warning"} />
      <OpsKpi label="平均含税成本" value={averageCost === null ? "—" : `¥${money(averageCost)}`} detail="按当前筛选中已有成本的 SKU 等权计算" />
      <OpsKpi label="人工覆盖SKU" value={`${filteredOverrides} SKU`} detail={`${dirtySkus.length} 个未保存修改 · 不代表历史版本数`} tone={dirtySkus.length ? "warning" : filteredOverrides ? "positive" : "default"} />
    </div>

    <OpsCard>
      <OpsCardHeader title="系列筛选与成本换算" description={`当前筛选 ${filteredRows.length} 个 SKU，含税成本覆盖 ${filteredRows.length ? Math.round(costCoverage / filteredRows.length * 100) : 0}%，${filteredRows.length - costCoverage ? `仍有 ${filteredRows.length - costCoverage} 个待补成本` : "成本已全部覆盖"}。`} action={<Calculator className="h-5 w-5 text-emerald-700" />} />
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6 xl:items-end">
        <label className="xl:col-span-2"><span className="mb-1.5 block text-[11px] font-medium text-slate-500">产品系列</span><select aria-label="产品系列筛选" value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)} className="w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600"><option value="ALL">全部系列 · {view.rows.length} SKU</option>{view.series.map((series) => <option key={series.id} value={series.id}>{series.kind === "variant" ? "系列" : "待归"} · {series.name} · {series.skuCount}</option>)}</select></label>
        <label className="relative xl:col-span-2"><span className="mb-1.5 block text-[11px] font-medium text-slate-500">搜索</span><Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" /><input aria-label="搜索产品成本" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU、产品、变体" className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600" /></label>
        <div><span className="mb-1.5 block text-[11px] font-medium text-slate-500">增值税率</span><div aria-label="增值税率 13% 固定" className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-right font-mono text-sm font-semibold text-emerald-800">{PRODUCT_COST_VAT_RATE}%（固定）</div></div>
        <NumberControl label="人民币 / 美元" ariaLabel="人民币美元汇率" value={exchangeRate} step={0.0001} onChange={setExchangeRate} />
        <NumberControl label="整系列调整 %" ariaLabel="整系列成本调整百分比" value={batchPercent} step={1} onChange={setBatchPercent} />
        <button type="button" onClick={applySeriesAdjustment} disabled={seriesFilter === "ALL" || busy !== ""} className="inline-flex h-[38px] items-center justify-center gap-2 border border-emerald-700 bg-emerald-700 px-4 text-xs font-semibold text-white disabled:opacity-40"><Sigma className="h-3.5 w-3.5" />应用到系列</button>
      </div>
      <div className="grid gap-3 border-t border-slate-100 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-slate-500">生效日期（UTC 日历日）</span><input aria-label="成本生效日期" type="date" required value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="min-w-0 w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600" /></label>
        <label className="min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-slate-500">截止日期（可选，含当天）</span><input aria-label="成本截止日期（可选）" type="date" min={effectiveFrom} value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} className="min-w-0 w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600" /></label>
        <label className="min-w-0 sm:col-span-2"><span className="mb-1.5 block text-[11px] font-medium text-slate-500">本次版本来源（保存 / 恢复必填）</span><input aria-label="成本来源说明" value={source} maxLength={500} onChange={(event) => setSource(event.target.value)} placeholder="报价、调整或恢复依据；不填密码和密钥" className="w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600" /></label>
        <p className="text-[11px] leading-5 text-slate-500 sm:col-span-2 xl:col-span-4">日期与来源应用于本次待保存 SKU / 当前筛选恢复范围。未来不提前、失效不延用；新版本生效后旧成本不自动复活。所有操作均按共用账号留痕。</p>
        {sourceReportVersion ? <p className="break-all font-mono text-[10px] text-slate-400 sm:col-span-2 xl:col-span-4">当前目录来源版本：{sourceReportVersion}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button type="button" onClick={() => void saveChanges()} disabled={!dirtySkus.length || busy !== ""} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{busy === "save" ? "保存中…" : `保存修改${dirtySkus.length ? `（${dirtySkus.length}）` : ""}`}</button>
        {!dirtySkus.length ? <button type="button" onClick={() => void saveChanges(true)} disabled={!filteredRows.length || !source.trim() || !effectiveFrom || Boolean(effectiveTo && effectiveTo < effectiveFrom) || busy !== ""} className="inline-flex items-center gap-2 border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-40">保存当前筛选成本版本（{filteredRows.length} SKU）</button> : null}
        <button type="button" onClick={() => void restoreSourceCosts()} disabled={!restorableSkus.length || busy !== ""} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />恢复当前筛选的源成本</button>
        {conflicted ? <button type="button" onClick={() => void reviewLatestVersions()} disabled={busy !== ""} className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-40">核对最新版本（保留草稿）</button> : null}
        <p className="ml-auto text-[11px] text-slate-500">修改含税成本时，系统固定按 13% 增值税换算未税成本，再按汇率换算不含税美元成本。</p>
      </div>
      {!dirtySkus.length ? <p className="border-t border-slate-100 px-4 py-2 text-[11px] leading-5 text-slate-500">同价版本目标：{scopeLabel} · {filteredRows.length} SKU。金额使用已读取的当前有效值；填写来源与日期后，需点击“保存当前筛选成本版本”才会追加历史，多 SKU 需再次确认。</p> : null}
      {message ? <p role="status" className={`border-t px-4 py-2.5 text-xs ${message.startsWith("已") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800"}`}>{message}</p> : null}
    </OpsCard>

    <OpsCard>
      <OpsCardHeader title="SKU 成本明细" description={`${filteredRows.length} 个 SKU 平均含税成本${averageCost === null ? "暂无" : ` ¥${money(averageCost)}`}，当前有 ${dirtySkus.length} 个修改待保存、${filteredOverrides} 个采用人工成本。`} action={<OpsBadge tone={dirtySkus.length ? "amber" : "emerald"}>{dirtySkus.length ? `${dirtySkus.length} 项待保存` : "成本已同步"}</OpsBadge>} />
      <div className="overflow-x-auto" style={{ containerType: "inline-size" }}><table className="w-full min-w-[1260px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">产品系列 / 变体</th><th className="px-3 py-3">成本状态</th><th className="px-3 py-3 text-right">含税人民币</th><th className="px-3 py-3 text-right">未税人民币</th><th className="px-3 py-3 text-right">美元成本</th><th className="px-3 py-3 text-right">推算税率</th><th className="px-4 py-3">最后修改</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row) => {
        const values = drafts[row.sku];
        const dirty = !sameCosts(values, savedValues[row.sku]);
        const editState = editStates[row.sku];
        const latest = editState?.latest;
        return <Fragment key={row.sku}><tr className={dirty ? "bg-amber-50/40" : "hover:bg-slate-50"}>
          <td className="px-4 py-3"><Link href={`/inventory/sku/${encodeURIComponent(row.sku)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{row.sku}</Link><p className="mt-1 max-w-72 truncate text-slate-600" title={row.productName}>{row.productName}</p><p className="mt-1 text-[10px] text-slate-400">{row.category}</p></td>
          <td className="px-3 py-3"><p className="max-w-64 truncate font-medium text-slate-700" title={row.seriesName}>{row.seriesName}</p><p className="mt-1 text-[10px] text-slate-400">{row.parentSku ? `${row.parentSku} · ${row.variantValue || "变体待补"}` : "尚未建立父子系列"}</p></td>
          <td className="px-3 py-3"><OpsBadge tone={dirty ? "amber" : overrideMeta[row.sku] ? "blue" : values.purchaseCostRmbTaxIncluded === null ? "rose" : "slate"}>{dirty ? "待保存" : overrideMeta[row.sku] ? "人工成本" : values.purchaseCostRmbTaxIncluded === null ? "成本缺失" : "源数据"}</OpsBadge>
            {latest ? <p className="mt-1 max-w-52 text-[10px] leading-4 text-slate-500">最新版本 · {versionStatus(latest)}{latest.effectiveFrom ? ` · ${latest.effectiveFrom}` : ""}{latest.effectiveTo ? ` 至 ${latest.effectiveTo}` : ""}</p> : null}
            {dirty ? <p className="mt-1 text-[10px] text-slate-500">当前有效含税成本：{savedValues[row.sku].purchaseCostRmbTaxIncluded === null ? "缺失" : `¥${money(savedValues[row.sku].purchaseCostRmbTaxIncluded!)}`}</p> : null}
          </td>
          <CostInput ariaLabel={`${row.sku} 含税人民币成本`} value={values.purchaseCostRmbTaxIncluded} onChange={(value) => patchCost(row.sku, "purchaseCostRmbTaxIncluded", value)} />
          <CostInput ariaLabel={`${row.sku} 未税人民币成本`} value={values.purchaseCostRmbTaxExcluded} onChange={(value) => patchCost(row.sku, "purchaseCostRmbTaxExcluded", value)} />
          <CostInput ariaLabel={`${row.sku} 美元成本`} value={values.purchaseCostUsd} onChange={(value) => patchCost(row.sku, "purchaseCostUsd", value)} />
          <td className="px-3 py-3 text-right font-mono text-slate-500">{inferredVat(values)}</td>
          <td className="px-4 py-3"><p className="text-[11px] text-slate-600">{overrideMeta[row.sku] ? dateTime(overrideMeta[row.sku]) : "产品目录"}</p>{editState?.current?.effectiveFrom ? <p className="mt-1 text-[10px] text-slate-500">当前生效 · {editState.current.effectiveFrom}{editState.current.effectiveTo ? ` 至 ${editState.current.effectiveTo}` : ""}</p> : null}{dirty ? <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-700"><CheckCircle2 className="h-3 w-3" />保存后按指定日期生效</p> : null}</td>
        </tr><CostHistory key={`${row.sku}:${editState?.editVersion ?? "none"}`} sku={row.sku} /></Fragment>;
      })}</tbody></table></div>
      <div ref={loadMoreRef} className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">显示 {visibleRows.length} / {filteredRows.length} 项 · {hasMore ? "继续下滑加载" : "已显示全部"}</div>
    </OpsCard>

    <details className="border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">成本口径与系列分组说明</summary><div className="grid gap-3 border-t border-slate-100 p-4 text-xs leading-5 text-slate-600 md:grid-cols-2 xl:grid-cols-4"><p><strong className="text-slate-900">含税 → 未税：</strong>固定按 13% 增值税计算，即含税人民币 ÷ 1.13；保存时后台会再次校验该口径。</p><p><strong className="text-slate-900">人民币 → 美元：</strong>不含税人民币 ÷ 当前人民币/美元汇率；页面默认汇率按现有不含税美元成本中位数反推。</p><p><strong className="text-slate-900">系列：</strong>优先采用真实父子系列；未建父子关系的产品暂按品类分组，并标记为“待归系列”。</p><p><strong className="text-slate-900">版本：</strong>当前产品与试算只用当前有效成本；恢复追加历史且跟随已发布目录源值，不重算历史实际利润，也不会取消更晚生效的既有计划，后来版本仍按生效日适用。旧导入明确历史生效时间未知。</p></div></details>
  </div>;
}

function CostHistory({ sku }: { sku: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ProductCostPageVersion[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  async function load(nextCursor: string | null = null) {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ sku, limit: "20" });
      if (nextCursor) query.set("cursor", nextCursor);
      const response = await fetch(`/api/inventory/product-costs?${query}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "成本历史读取失败。");
      setItems((current) => {
        const history = nextCursor ? [...(current ?? []), ...payload.items] : payload.items as ProductCostPageVersion[];
        return [...new Map(history.map((item: ProductCostPageVersion) => [item.versionId, item])).values()];
      });
      setCursor(payload.nextCursor ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "成本历史读取失败。"); }
    finally { loadingRef.current = false; setLoading(false); }
  }

  return <tr><td colSpan={8} className="px-4 pb-2">
    <button type="button" aria-label={`${sku} 成本历史`} aria-expanded={open} onClick={() => { setOpen(!open); if (!open && items === null) void load(); }} className="text-[11px] text-emerald-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600">{open ? "收起" : "查看"}成本历史</button>
    {open ? <div role="region" aria-label={`${sku} 成本历史记录`} style={{ width: "calc(100cqw - 2rem)" }} className="mt-2 max-w-5xl border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-[11px] text-slate-500">按记录顺序连续加载 · 共用账号操作，不代表自然人身份 · 日期按 UTC 日历日，截止含当天</p>
      {items?.map((item) => <div key={item.versionId} className="grid gap-2 border-t border-slate-200 py-3 sm:grid-cols-3">
        <div><p className="font-semibold text-slate-700">{item.action === "restore" ? "恢复源成本" : item.action === "legacy" ? "旧成本导入" : "人工成本覆盖"} · {versionStatus(item)}</p><p className="mt-1 text-slate-500">{item.effectiveFrom ? `${item.effectiveFrom} 起${item.effectiveTo ? `，至 ${item.effectiveTo}` : "，无截止日期"}` : "历史生效时间未知"}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-400">版本 {item.versionId}</p></div>
        <div><p>含税 RMB {costText(item.purchaseCostRmbTaxIncluded)} · 未税 RMB {costText(item.purchaseCostRmbTaxExcluded)} · USD {costText(item.purchaseCostUsd)}</p>{item.action === "restore" ? <p className="mt-1 text-slate-500">此处为恢复时源成本快照；当前值跟随已发布目录。</p> : null}</div>
        <div className="min-w-0"><p className="break-words">{item.source || "来源未记录"}</p><p className="mt-1 text-slate-500">{dateTime(item.recordedAt)} · 共用账号</p>{item.sourceReportVersion ? <p className="mt-1 break-all text-[10px] text-slate-400">来源报告版本 {item.sourceReportVersion}</p> : null}</div>
      </div>)}
      {items?.length === 0 ? <p className="py-2 text-slate-500">暂无成本版本历史。</p> : null}
      {error ? <p role="alert" className="py-2 text-amber-800">{error}<button type="button" onClick={() => void load(cursor)} className="ml-3 underline">重试历史读取</button></p> : null}
      {loading ? <p role="status" className="py-2 text-slate-500">正在读取成本历史…</p> : null}
      {cursor && !error ? <button type="button" disabled={loading} onClick={() => void load(cursor)} className="mt-2 border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-40">继续加载成本历史</button> : null}
    </div> : null}
  </td></tr>;
}

function costValues(values: ProductCostValues): ProductCostValues {
  return { purchaseCostRmbTaxIncluded: values.purchaseCostRmbTaxIncluded,
    purchaseCostRmbTaxExcluded: values.purchaseCostRmbTaxExcluded, purchaseCostUsd: values.purchaseCostUsd };
}

function versionStatus(version: ProductCostPageVersion) {
  return ({ current: "当前有效", scheduled: "未来生效", expired: "已失效", superseded: "已被后续版本替代", legacy_unknown: "旧版日期未知" })[version.status];
}

function costText(value: number | null) { return value === null ? "缺失" : money(value); }

function valuesBySku(rows: ProductCostRow[]) {
  return Object.fromEntries(rows.map((row) => [row.sku, {
    purchaseCostRmbTaxIncluded: row.purchaseCostRmbTaxIncluded,
    purchaseCostRmbTaxExcluded: row.purchaseCostRmbTaxExcluded,
    purchaseCostUsd: row.purchaseCostUsd,
  }]));
}

function CostInput({ ariaLabel, value, onChange }: { ariaLabel: string; value: number | null; onChange: (value: number | null) => void }) {
  return <td className="px-3 py-3 text-right"><input aria-label={ariaLabel} type="number" min={0} max={1_000_000} step={0.01} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))} className="w-28 border border-slate-200 bg-white px-2 py-1.5 text-right font-mono outline-none focus:border-emerald-600" /></td>;
}

function NumberControl({ label, ariaLabel, value, step, onChange }: { label: string; ariaLabel: string; value: number; step: number; onChange: (value: number) => void }) {
  return <label><span className="mb-1.5 block text-[11px] font-medium text-slate-500">{label}</span><input aria-label={ariaLabel} type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} className="w-full border border-slate-200 bg-white px-3 py-2 text-right font-mono text-sm outline-none focus:border-emerald-600" /></label>;
}

function sameCosts(left: ProductCostValues | undefined, right: ProductCostValues | undefined) {
  return left?.purchaseCostRmbTaxIncluded === right?.purchaseCostRmbTaxIncluded
    && left?.purchaseCostRmbTaxExcluded === right?.purchaseCostRmbTaxExcluded
    && left?.purchaseCostUsd === right?.purchaseCostUsd;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function inferredVat(values: ProductCostValues) {
  const included = values.purchaseCostRmbTaxIncluded;
  const excluded = values.purchaseCostRmbTaxExcluded;
  if (!included || !excluded) return "—";
  return `${((included / excluded - 1) * 100).toFixed(1)}%`;
}

function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
