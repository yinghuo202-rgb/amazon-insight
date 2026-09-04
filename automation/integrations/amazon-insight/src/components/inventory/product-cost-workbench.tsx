"use client";

import { Calculator, CheckCircle2, RotateCcw, Save, Search, Sigma } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { PRODUCT_COST_VAT_RATE } from "@/lib/inventory/product-cost-policy";
import type { ProductCostOverride, ProductCostValues } from "@/lib/inventory/product-cost-store";
import { calculateCostsFromTaxIncluded, type ProductCostRow, type ProductCostSeries } from "@/lib/inventory/product-costs";

type ProductCostView = {
  rows: ProductCostRow[];
  series: ProductCostSeries[];
  parameters: { vatRate: number; exchangeRate: number };
};

export function ProductCostWorkbench({ view }: { view: ProductCostView }) {
  const pageSize = 30;
  const rowBySku = useMemo(() => new Map(view.rows.map((row) => [row.sku, row] as const)), [view.rows]);
  const [drafts, setDrafts] = useState<Record<string, ProductCostValues>>(() => valuesBySku(view.rows));
  const [savedValues, setSavedValues] = useState<Record<string, ProductCostValues>>(() => valuesBySku(view.rows));
  const [overrideMeta, setOverrideMeta] = useState<Record<string, string>>(() => Object.fromEntries(view.rows.flatMap((row) => row.updatedAt ? [[row.sku, row.updatedAt]] : [])));
  const [seriesFilter, setSeriesFilter] = useState("ALL");
  const [query, setQuery] = useState("");
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
  const costCoverage = filteredRows.filter((row) => drafts[row.sku]?.purchaseCostRmbTaxIncluded !== null).length;
  const averageCost = average(filteredRows.flatMap((row) => {
    const value = drafts[row.sku]?.purchaseCostRmbTaxIncluded;
    return value === null || value === undefined ? [] : [value];
  }));
  const filteredOverrides = filteredRows.filter((row) => overrideMeta[row.sku]).length;

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
    setMessage(`已将“${selectedSeries?.name ?? "当前系列"}”含税成本调整 ${signed(batchPercent)}%，未税和美元成本已按当前参数重新换算；保存后生效。`);
  }

  async function saveChanges() {
    if (!dirtySkus.length) return;
    setBusy("save"); setMessage("");
    try {
      const response = await fetch("/api/inventory/product-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: dirtySkus.map((sku) => ({ sku, ...drafts[sku] })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "产品成本保存失败。");
      const meta = Object.fromEntries((payload.items as ProductCostOverride[]).map((item) => [item.sku, item.updatedAt]));
      setOverrideMeta(meta);
      setSavedValues((current) => ({ ...current, ...Object.fromEntries(dirtySkus.map((sku) => [sku, drafts[sku]])) }));
      setMessage(`已保存 ${dirtySkus.length} 个 SKU 的成本，后续产品与清货页面将读取新成本。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "产品成本保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function restoreSourceCosts() {
    const skus = filteredRows.filter((row) => overrideMeta[row.sku]).map((row) => row.sku);
    if (!skus.length) {
      setMessage("当前筛选范围没有需要恢复的人工成本。");
      return;
    }
    setBusy("restore"); setMessage("");
    try {
      const response = await fetch("/api/inventory/product-costs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "恢复源成本失败。");
      const sourceValues = Object.fromEntries(skus.map((sku) => [sku, rowBySku.get(sku)!.source]));
      setDrafts((current) => ({ ...current, ...sourceValues }));
      setSavedValues((current) => ({ ...current, ...sourceValues }));
      setOverrideMeta(Object.fromEntries((payload.items as ProductCostOverride[]).map((item) => [item.sku, item.updatedAt])));
      setMessage(`已将 ${skus.length} 个 SKU 恢复为产品目录源成本。`);
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
      <OpsKpi label="人工成本版本" value={`${filteredOverrides} SKU`} detail={`${dirtySkus.length} 个未保存修改`} tone={dirtySkus.length ? "warning" : filteredOverrides ? "positive" : "default"} />
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
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button type="button" onClick={() => void saveChanges()} disabled={!dirtySkus.length || busy !== ""} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{busy === "save" ? "保存中…" : `保存修改${dirtySkus.length ? `（${dirtySkus.length}）` : ""}`}</button>
        <button type="button" onClick={() => void restoreSourceCosts()} disabled={!filteredOverrides || busy !== ""} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />恢复当前筛选的源成本</button>
        <p className="ml-auto text-[11px] text-slate-500">修改含税成本时，系统固定按 13% 增值税换算未税成本，再按汇率换算不含税美元成本。</p>
      </div>
      {message ? <p role="status" className={`border-t px-4 py-2.5 text-xs ${message.startsWith("已") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800"}`}>{message}</p> : null}
    </OpsCard>

    <OpsCard>
      <OpsCardHeader title="SKU 成本明细" description={`${filteredRows.length} 个 SKU 平均含税成本${averageCost === null ? "暂无" : ` ¥${money(averageCost)}`}，当前有 ${dirtySkus.length} 个修改待保存、${filteredOverrides} 个采用人工成本。`} action={<OpsBadge tone={dirtySkus.length ? "amber" : "emerald"}>{dirtySkus.length ? `${dirtySkus.length} 项待保存` : "成本已同步"}</OpsBadge>} />
      <div className="overflow-x-auto"><table className="w-full min-w-[1260px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">产品系列 / 变体</th><th className="px-3 py-3">成本状态</th><th className="px-3 py-3 text-right">含税人民币</th><th className="px-3 py-3 text-right">未税人民币</th><th className="px-3 py-3 text-right">美元成本</th><th className="px-3 py-3 text-right">推算税率</th><th className="px-4 py-3">最后修改</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row) => {
        const values = drafts[row.sku];
        const dirty = !sameCosts(values, savedValues[row.sku]);
        return <tr key={row.sku} className={dirty ? "bg-amber-50/40" : "hover:bg-slate-50"}><td className="px-4 py-3"><Link href={`/inventory/sku/${encodeURIComponent(row.sku)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{row.sku}</Link><p className="mt-1 max-w-72 truncate text-slate-600" title={row.productName}>{row.productName}</p><p className="mt-1 text-[10px] text-slate-400">{row.category}</p></td><td className="px-3 py-3"><p className="max-w-64 truncate font-medium text-slate-700" title={row.seriesName}>{row.seriesName}</p><p className="mt-1 text-[10px] text-slate-400">{row.parentSku ? `${row.parentSku} · ${row.variantValue || "变体待补"}` : "尚未建立父子系列"}</p></td><td className="px-3 py-3"><OpsBadge tone={dirty ? "amber" : overrideMeta[row.sku] ? "blue" : values.purchaseCostRmbTaxIncluded === null ? "rose" : "slate"}>{dirty ? "待保存" : overrideMeta[row.sku] ? "人工成本" : values.purchaseCostRmbTaxIncluded === null ? "成本缺失" : "源数据"}</OpsBadge></td><CostInput ariaLabel={`${row.sku} 含税人民币成本`} value={values.purchaseCostRmbTaxIncluded} onChange={(value) => patchCost(row.sku, "purchaseCostRmbTaxIncluded", value)} /><CostInput ariaLabel={`${row.sku} 未税人民币成本`} value={values.purchaseCostRmbTaxExcluded} onChange={(value) => patchCost(row.sku, "purchaseCostRmbTaxExcluded", value)} /><CostInput ariaLabel={`${row.sku} 美元成本`} value={values.purchaseCostUsd} onChange={(value) => patchCost(row.sku, "purchaseCostUsd", value)} /><td className="px-3 py-3 text-right font-mono text-slate-500">{inferredVat(values)}</td><td className="px-4 py-3"><p className="text-[11px] text-slate-600">{overrideMeta[row.sku] ? dateTime(overrideMeta[row.sku]) : "产品目录"}</p>{dirty ? <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-700"><CheckCircle2 className="h-3 w-3" />保存后覆盖</p> : null}</td></tr>;
      })}</tbody></table></div>
      <div ref={loadMoreRef} className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">显示 {visibleRows.length} / {filteredRows.length} 项 · {hasMore ? "继续下滑加载" : "已显示全部"}</div>
    </OpsCard>

    <details className="border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">成本口径与系列分组说明</summary><div className="grid gap-3 border-t border-slate-100 p-4 text-xs leading-5 text-slate-600 md:grid-cols-3"><p><strong className="text-slate-900">含税 → 未税：</strong>固定按 13% 增值税计算，即含税人民币 ÷ 1.13；保存时后台会再次校验该口径。</p><p><strong className="text-slate-900">人民币 → 美元：</strong>不含税人民币 ÷ 当前人民币/美元汇率；页面默认汇率按现有不含税美元成本中位数反推。</p><p><strong className="text-slate-900">系列：</strong>优先采用真实父子系列；未建父子关系的产品暂按品类分组，并标记为“待归系列”。</p></div></details>
  </div>;
}

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
