"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { OpsBadge, OpsCard } from "@/components/inventory/ops-ui";
import { VariantKnowledgeGraph } from "@/components/inventory/variant-knowledge-graph";
import type { KnowledgeGraphFamily } from "@/lib/inventory/product-knowledge-graph";
import { buildVariantGroupMetrics, integer } from "@/lib/inventory/presentation";

type VariantGroupMetric = ReturnType<typeof buildVariantGroupMetrics>[number];

export function CategoryBrowser({ market, groups, graphFamilies, initialParent }: { market: "US" | "CA"; groups: VariantGroupMetric[]; graphFamilies: KnowledgeGraphFamily[]; initialParent?: string }) {
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const categories = ["全部", ...Array.from(new Set(groups.map((group) => group.categoryL2)))];
  const normalized = query.trim().toLowerCase();
  const visibleGroups = groups.filter((group) => (category === "全部" || group.categoryL2 === category) && (!normalized || group.parentSku.toLowerCase().includes(normalized) || group.familyName.toLowerCase().includes(normalized)));
  const selected = groups.find((group) => group.parentSku === initialParent) ?? visibleGroups[0] ?? null;
  const selectedGraph = selected ? graphFamilies.find((family) => family.market === market && family.parentSku === selected.parentSku) ?? null : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
      <OpsCard className="self-start xl:sticky xl:top-6">
        <div className="border-b border-slate-100 p-4">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索父体或系列" className="w-full border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-emerald-600" /></label>
          <div className="mt-3 flex flex-wrap gap-1.5">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded px-2.5 py-1.5 text-[11px] ${category === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}</div>
        </div>
        <div className="max-h-[calc(100vh-240px)] overflow-y-auto divide-y divide-slate-100">
          {visibleGroups.map((group) => <Link key={group.parentSku} href={`/inventory/categories?market=${market}&parent=${encodeURIComponent(group.parentSku)}`} className={`block w-full px-4 py-3.5 text-left transition ${selected?.parentSku === group.parentSku ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-semibold">{group.parentSku}</span>{group.critical > 0 ? <OpsBadge tone="rose">{group.critical} 风险</OpsBadge> : <OpsBadge tone="emerald">正常</OpsBadge>}</div><p className="mt-1.5 text-sm font-medium text-slate-800">{group.familyName}</p><p className="mt-1 text-[11px] text-slate-500">{group.childCount} 个子体 · 库存 {integer(group.networkInventory)}</p></Link>)}
        </div>
      </OpsCard>

      {selected ? <div className="space-y-4">
        <OpsCard>
          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(90px,.5fr))] lg:items-end">
            <div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-emerald-700">{selected.parentSku}</span><OpsBadge tone="blue">{selected.variationTheme || "无变体主题"}</OpsBadge></div><h2 className="mt-2 text-xl font-semibold text-slate-950">{selected.familyName}</h2><p className="mt-1 text-xs text-slate-500">{selected.categoryL1} / {selected.categoryL2} · {selected.familyId}</p></div>
            <Metric label="子 SKU" value={integer(selected.childCount)} />
            <Metric label="网络库存" value={integer(selected.networkInventory)} />
            <Metric label="日销合计" value={selected.dailySales.toFixed(1)} />
            <Metric label="建议发货" value={integer(selected.shipment)} strong />
          </div>
          <div className={`border-t px-5 py-3 text-xs ${selected.note.includes("复核") || selected.note.includes("疑似") ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-100 bg-slate-50 text-slate-600"}`}>{selected.note}</div>
        </OpsCard>

        {selectedGraph ? <VariantKnowledgeGraph family={selectedGraph} /> : <OpsCard className="p-8 text-sm text-slate-500">这个系列暂时没有可展示的关联数据。</OpsCard>}
      </div> : <OpsCard className="p-8 text-sm text-slate-500">没有符合条件的变体组。</OpsCard>}
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><p className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-400">{label}</p><p className={`mt-1 text-lg font-semibold ${strong ? "text-emerald-700" : "text-slate-900"}`}>{value}</p></div>;
}
