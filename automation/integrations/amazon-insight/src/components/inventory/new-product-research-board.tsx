"use client";

import { ExternalLink, FlaskConical, PackagePlus, Pencil, Plus, Save, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { NewProductResearchData } from "@/lib/inventory/contracts";
import { calculateResearchCandidate, calculateResearchCostBreakdown, RESEARCH_RMB_PER_USD, RESEARCH_UNTAXED_FACTOR, type ResearchCandidate, type ResearchCandidateInput } from "@/lib/inventory/new-product-research";

const number = new Intl.NumberFormat("zh-CN");
const money = (value: number | null) => value === null ? "—" : `$${value.toFixed(2)}`;
const emptyCandidate: ResearchCandidateInput = { sku: "", name: "", amazonPrice: null, firstMile: null, storageFee: null, commission: null, orderFee: null, importDutyRate: null, purchaseCostRmb: null, untaxedPriceUsd: null, competitorUrl: "" };

export function NewProductResearchBoard({ data }: { data: NewProductResearchData }) {
  const [candidates, setCandidates] = useState<ResearchCandidate[]>(data.candidates);
  const [query, setQuery] = useState("");
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [draft, setDraft] = useState<ResearchCandidateInput>(emptyCandidate);
  const [calculatorDraft, setCalculatorDraft] = useState<ResearchCandidateInput>(emptyCandidate);
  const [visibleCount, setVisibleCount] = useState(40);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const latestOrders = data.monthlyOrders.filter((item) => item.month === data.summary.latestOrderMonth).slice(0, 8);
  const preview = calculateResearchCandidate(draft);
  const calculatorPreview = calculateResearchCostBreakdown(calculatorDraft);
  const filtered = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return [...candidates]
      .filter((item) => !normalized || `${item.sku} ${item.name}`.toUpperCase().includes(normalized))
      .sort((a, b) => (b.grossMargin ?? -1) - (a.grossMargin ?? -1));
  }, [candidates, query]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visible.length < filtered.length;
  const margins = candidates.flatMap((item) => item.grossMargin === null ? [] : [item.grossMargin]);
  const viableCount = margins.filter((margin) => margin >= 0.3).length;
  const averageMargin = margins.length ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length : 0;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((current) => Math.min(current + 40, filtered.length));
    }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [filtered.length, hasMore]);

  function openNew() {
    setEditingSku(""); setDraft(emptyCandidate); setMessage("");
  }

  function openEdit(item: ResearchCandidate) {
    setEditingSku(item.sku);
    setDraft({ sku: item.sku, name: item.name, amazonPrice: item.amazonPrice, firstMile: item.firstMile, storageFee: item.storageFee, commission: item.commission, orderFee: item.orderFee, importDutyRate: item.importDutyRate, purchaseCostRmb: item.purchaseCostRmb, untaxedPriceUsd: item.untaxedPriceUsd, competitorUrl: item.competitorUrl });
    setMessage("");
  }

  function patch<K extends keyof ResearchCandidateInput>(key: K, value: ResearchCandidateInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function patchCalculator<K extends keyof ResearchCandidateInput>(key: K, value: ResearchCandidateInput[K]) {
    setCalculatorDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!draft.sku.trim() || !draft.name.trim()) { setMessage("请填写 SKU 和产品名称。"); return; }
    if (editingSku === "" && candidates.some((item) => item.sku.toUpperCase() === draft.sku.trim().toUpperCase())) { setMessage("该 SKU 已存在，请关闭窗口后使用对应行的“编辑”。"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/inventory/new-product-research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, sku: draft.sku.trim(), name: draft.name.trim(), competitorUrl: draft.competitorUrl.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "新品资料保存失败。");
      const item = payload.item as ResearchCandidate;
      setCandidates((current) => [...current.filter((candidate) => candidate.sku !== item.sku), item]);
      setEditingSku(null);
      setMessage(`已保存 ${item.sku}，数据会保留在 NAS 持久化数据库中。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新品资料保存失败。");
    } finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={openNew} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"><Plus className="h-3.5 w-3.5" />添加调研产品</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="调研候选" value={`${candidates.length} 个`} detail="Excel 源数据 + 网页维护数据" icon={<FlaskConical className="h-4 w-4" />} />
      <OpsKpi label="优先候选" value={`${viableCount} 个`} detail="毛利率 ≥ 30%" tone="positive" icon={<Sparkles className="h-4 w-4" />} />
      <OpsKpi label="平均毛利率" value={`${(averageMargin * 100).toFixed(1)}%`} detail="按有完整成本数据的候选计算" tone="positive" />
      <OpsKpi label="最近下单" value={data.summary.latestOrderMonth ?? "—"} detail={`${number.format(data.summary.plannedUnits)} 件计划量`} icon={<PackagePlus className="h-4 w-4" />} />
    </div>
    <OpsCard className="border-blue-200 bg-blue-50/25">
      <OpsCardHeader title="新品成本计算器" description={`按表格口径计算：采购价 ÷ ${RESEARCH_RMB_PER_USD} + 未税价格 + 头程 + 仓储 + 订单费 + 佣金 + 进口税；未税价格留空时按采购美元成本 × ${RESEARCH_UNTAXED_FACTOR} 估算。`} action={<FlaskConical className="h-4 w-4 text-blue-700" />} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <AmountField label="Amazon 售价（USD）" value={calculatorDraft.amazonPrice} onChange={(value) => patchCalculator("amazonPrice", value)} />
        <AmountField label="采购价（RMB）" value={calculatorDraft.purchaseCostRmb} onChange={(value) => patchCalculator("purchaseCostRmb", value)} />
        <AmountField label="未税价格（USD）" value={calculatorDraft.untaxedPriceUsd ?? null} onChange={(value) => patchCalculator("untaxedPriceUsd", value)} />
        <AmountField label="头程（USD）" value={calculatorDraft.firstMile} onChange={(value) => patchCalculator("firstMile", value)} />
        <AmountField label="仓储费（USD）" value={calculatorDraft.storageFee} onChange={(value) => patchCalculator("storageFee", value)} />
        <AmountField label="订单费（USD）" value={calculatorDraft.orderFee} onChange={(value) => patchCalculator("orderFee", value)} />
        <AmountField label="佣金（USD）" value={calculatorDraft.commission} onChange={(value) => patchCalculator("commission", value)} />
        <AmountField label="进口税（USD）" value={calculatorDraft.importDutyRate} onChange={(value) => patchCalculator("importDutyRate", value)} />
      </div>
      <div className="grid gap-px border-t border-blue-100 bg-blue-100 sm:grid-cols-3">
        <PreviewMetric label="总成本（USD）" value={calculatorPreview.totalCostUsd === null ? "待补输入" : money(calculatorPreview.totalCostUsd)} />
        <PreviewMetric label="预计毛利" value={money(calculatorPreview.grossProfit)} tone={calculatorPreview.grossProfit !== null && calculatorPreview.grossProfit >= 0 ? "positive" : "default"} />
        <PreviewMetric label="预计毛利率" value={calculatorPreview.grossMargin === null ? "待补输入" : `${(calculatorPreview.grossMargin * 100).toFixed(1)}%`} tone={calculatorPreview.grossMargin !== null && calculatorPreview.grossMargin >= .3 ? "positive" : "default"} />
      </div>
    </OpsCard>
    {message && editingSku === null ? <p role="status" className="border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{message}</p> : null}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
      <OpsCard>
        <OpsCardHeader title="调研候选产品" description="按毛利率排序；可搜索、新增并直接编辑候选产品的售价与成本参数。" action={<label className="relative block w-56"><span className="sr-only">搜索新品</span><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU 或产品" className="w-full border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-emerald-600" /></label>} />
        <div className="overflow-x-auto"><table className="min-w-[960px] w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-5 py-3">SKU / 产品</th><th className="px-3 py-3">售价</th><th className="px-3 py-3">采购成本</th><th className="px-3 py-3">完整成本</th><th className="px-3 py-3">最终利润</th><th className="px-3 py-3">利润率</th><th className="px-3 py-3">竞品</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((item) => <tr key={item.sku} className="hover:bg-slate-50/80"><td className="px-5 py-3 font-semibold text-slate-900">{item.sku}<span className="mt-0.5 block max-w-64 truncate text-[10px] font-normal text-slate-400" title={item.name}>{item.name}</span></td><td className="px-3 py-3 text-slate-700">{money(item.amazonPrice)}</td><td className="px-3 py-3 text-slate-700">{item.purchaseCostRmb === null ? "—" : `¥${item.purchaseCostRmb.toFixed(2)}`}</td><td className="px-3 py-3 text-slate-700">{money(item.totalCostUsd)}</td><td className={`px-3 py-3 ${item.grossProfit !== null && item.grossProfit < 0 ? "text-rose-700" : "text-slate-700"}`}>{money(item.grossProfit)}</td><td className="px-3 py-3">{item.grossMargin === null ? <OpsBadge>待补成本</OpsBadge> : <OpsBadge tone={item.grossMargin >= .3 ? "emerald" : item.grossMargin >= 0 ? "amber" : "rose"}>{(item.grossMargin * 100).toFixed(1)}%</OpsBadge>}</td><td className="px-3 py-3">{item.competitorUrl ? <a href={item.competitorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900">查看 <ExternalLink className="h-3 w-3" /></a> : <span className="text-slate-400">—</span>}</td><td className="px-5 py-3 text-right"><button type="button" onClick={() => openEdit(item)} className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Pencil className="h-3 w-3" />编辑</button></td></tr>)}</tbody></table></div>
        {!filtered.length ? <p className="p-10 text-center text-xs text-slate-400">没有符合搜索条件的候选产品。</p> : null}
        <div ref={loadMoreRef} className="border-t border-slate-100 px-5 py-3 text-center text-xs text-slate-500">显示 {visible.length} / {filtered.length} 个候选 · {hasMore ? "继续下滑加载" : "已显示全部"}</div>
      </OpsCard>
      <OpsCard>
        <OpsCardHeader title="新品进度" description={data.summary.latestOrderMonth ? `${data.summary.latestOrderMonth} 下单记录` : "最近月份下单记录"} />
        <div className="space-y-2.5 p-4">{latestOrders.length ? latestOrders.map((item) => <div key={`${item.month}-${item.sku}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{item.sku}</p><p className="truncate text-[10px] text-slate-500">{item.name}</p></div><div className="shrink-0 text-right"><p className="text-xs font-semibold text-slate-800">{item.orderQuantity ? `${number.format(item.orderQuantity)} 件` : "待确认"}</p><p className="text-[10px] text-slate-500">{item.costRmb === null ? "成本待补" : `¥${item.costRmb.toFixed(2)}`}</p></div></div>) : <p className="py-6 text-center text-xs text-slate-400">暂无下单记录</p>}</div>
      </OpsCard>
    </div>

    {editingSku !== null ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="research-form-title">
      <div className="max-h-[92vh] w-full overflow-y-auto bg-white shadow-2xl sm:max-w-4xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4"><div><h2 id="research-form-title" className="text-base font-semibold text-slate-950">{editingSku ? `编辑 ${editingSku}` : "添加调研产品"}</h2><p className="mt-1 text-xs text-slate-500">补齐售价和全部成本后，系统自动按汇率 {RESEARCH_RMB_PER_USD} 计算美元毛利与毛利率。</p></div><button type="button" onClick={() => setEditingSku(null)} className="p-1 text-slate-400 hover:text-slate-900" aria-label="关闭"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="SKU *" value={draft.sku} disabled={Boolean(editingSku)} onChange={(value) => patch("sku", value)} placeholder="例如 MD200" />
          <TextField label="产品名称 *" value={draft.name} onChange={(value) => patch("name", value)} placeholder="产品中文或英文名称" wide />
          <AmountField label="Amazon 售价（USD）" value={draft.amazonPrice} onChange={(value) => patch("amazonPrice", value)} />
          <AmountField label="头程费用（USD）" value={draft.firstMile} onChange={(value) => patch("firstMile", value)} />
          <AmountField label="仓储费（USD）" value={draft.storageFee} onChange={(value) => patch("storageFee", value)} />
          <AmountField label="Amazon 佣金（USD）" value={draft.commission} onChange={(value) => patch("commission", value)} />
          <AmountField label="订单费（USD）" value={draft.orderFee} onChange={(value) => patch("orderFee", value)} />
          <AmountField label="关税 / 进口费（USD）" value={draft.importDutyRate} onChange={(value) => patch("importDutyRate", value)} />
          <AmountField label="采购成本（RMB）" value={draft.purchaseCostRmb} onChange={(value) => patch("purchaseCostRmb", value)} />
          <AmountField label="未税价格（USD）" value={draft.untaxedPriceUsd ?? null} onChange={(value) => patch("untaxedPriceUsd", value)} />
          <TextField label="竞品链接" value={draft.competitorUrl} onChange={(value) => patch("competitorUrl", value)} placeholder="https://www.amazon.com/..." wide />
        </div>
        <div className="grid gap-px border-y border-slate-200 bg-slate-200 sm:grid-cols-4"><PreviewMetric label="完整成本（USD）" value={money(preview.totalCostUsd)} /><PreviewMetric label="预计毛利" value={money(preview.grossProfit)} /><PreviewMetric label="预计毛利率" value={preview.grossMargin === null ? "—" : `${(preview.grossMargin * 100).toFixed(1)}%`} tone={preview.grossMargin !== null && preview.grossMargin >= .3 ? "positive" : "default"} /><PreviewMetric label="成本完整度" value={preview.grossMargin === null ? "仍需补充" : "可计算"} tone={preview.grossMargin === null ? "default" : "positive"} /></div>
        {message ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">{message}</p> : null}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4"><button type="button" onClick={() => setEditingSku(null)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700">取消</button><button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{busy ? "保存中…" : "保存产品"}</button></div>
      </div>
    </div> : null}
  </div>;
}

function TextField({ label, value, onChange, placeholder, disabled = false, wide = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; wide?: boolean }) { return <label className={wide ? "sm:col-span-2" : ""}><span className="mb-1.5 block text-[11px] font-medium text-slate-600">{label}</span><input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-500" /></label>; }
function AmountField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) { return <label><span className="mb-1.5 block text-[11px] font-medium text-slate-600">{label}</span><input type="number" min={0} step={0.01} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))} className="w-full border border-slate-200 bg-white px-3 py-2.5 text-right font-mono text-sm outline-none focus:border-emerald-600" /></label>; }
function PreviewMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "positive" }) { return <div className="bg-slate-50 px-5 py-3"><p className="text-[10px] uppercase tracking-[0.1em] text-slate-400">{label}</p><p className={`mt-1 text-sm font-semibold ${tone === "positive" ? "text-emerald-700" : "text-slate-900"}`}>{value}</p></div>; }
