"use client";

import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { Focus, Network, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { KnowledgeGraphFamily, KnowledgeGraphNode, KnowledgeNodeTone } from "@/lib/inventory/product-knowledge-graph";

const typeLabels: Record<KnowledgeGraphNode["type"], string> = { category: "品类", market: "市场", family: "父体", sku: "子 SKU", specification: "产品主数据", attribute: "工程参数", listing: "Listing", order: "采购订单", supplier: "供应商" };
const toneBadge: Record<KnowledgeNodeTone, "slate" | "emerald" | "blue" | "amber" | "rose"> = { slate: "slate", emerald: "emerald", blue: "blue", amber: "amber", rose: "rose", violet: "blue" };

export function VariantKnowledgeGraph({ family }: { family: KnowledgeGraphFamily }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Core | null>(null);
  const [selectedId, setSelectedId] = useState(() => family.nodes.find((node) => node.type === "family")?.id ?? family.nodes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const selected = family.nodes.find((node) => node.id === selectedId) ?? family.nodes[0] ?? null;
  const related = useMemo(() => selected ? relatedNodes(family, selected.id) : [], [family, selected]);

  const focusNode = useCallback((id: string) => {
    const graph = graphRef.current;
    const node = graph?.getElementById(id);
    if (!graph || !node?.length) return;
    graph.elements().unselect();
    node.select();
    graph.animate({ center: { eles: node }, zoom: Math.max(graph.zoom(), 1.15) }, { duration: 280 });
    setSelectedId(id);
  }, []);

  const runLayout = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.layout({ name: "cose", animate: false, fit: true, padding: 34, nodeRepulsion: () => 9500, idealEdgeLength: () => 105, edgeElasticity: () => 90, gravity: 0.22, numIter: 900, randomize: true }).run();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const elements: ElementDefinition[] = [
      ...family.nodes.map((node) => ({ data: { ...node } })),
      ...family.edges.map((edge) => ({ data: { ...edge } })),
    ];
    const graph = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.45,
      maxZoom: 2.4,
      wheelSensitivity: 0.22,
      boxSelectionEnabled: false,
      style: graphStyles,
      layout: { name: "cose", animate: false, fit: true, padding: 34, nodeRepulsion: () => 9500, idealEdgeLength: () => 105, edgeElasticity: () => 90, gravity: 0.22, numIter: 900, randomize: true },
    });
    graphRef.current = graph;
    const familyNode = graph.getElementById(family.nodes.find((node) => node.type === "family")?.id ?? "");
    if (familyNode.length) familyNode.select();
    graph.on("tap", "node", (event) => setSelectedId(event.target.id()));
    graph.on("mouseover", "node", (event) => {
      graph.elements().addClass("faded");
      event.target.closedNeighborhood().removeClass("faded");
    });
    graph.on("mouseout", "node", () => graph.elements().removeClass("faded"));
    const observer = new ResizeObserver(() => { graph.resize(); graph.fit(undefined, 34); });
    observer.observe(containerRef.current);
    setSelectedId(family.nodes.find((node) => node.type === "family")?.id ?? family.nodes[0]?.id ?? "");
    return () => { observer.disconnect(); graph.destroy(); graphRef.current = null; };
  }, [family]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.elements().removeClass("matched muted");
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;
    const matches = graph.nodes().filter((node) => `${node.data("label")} ${node.data("subtitle")} ${node.data("type")}`.toLowerCase().includes(normalized));
    graph.elements().addClass("muted");
    matches.removeClass("muted").addClass("matched");
    matches.connectedEdges().removeClass("muted");
    if (matches.length) graph.fit(matches, 80);
  }, [query]);

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="子 SKU / 工程参数" value={`${family.summary.childCount} / ${family.summary.attributeCount}`} detail={`${family.summary.engineeringCoveredChildCount} 个 SKU 已提取材料、机芯、量程或精度等参数`} />
      <OpsKpi label="历史采购订单" value={`${family.summary.orderCount} 单`} detail={`${family.summary.orderedQuantity.toLocaleString("zh-CN")} 件；图中展示最近 ${family.summary.displayedOrderCount} 单`} tone="positive" />
      <OpsKpi label="订单覆盖 SKU" value={`${family.summary.orderCoveredChildCount} 个`} detail={`${family.summary.relationCount} 条产品、规格与订单关系`} />
      <OpsKpi label="主数据 + 参数 + 订单覆盖" value={`${family.summary.coveragePercent}%`} detail="按每个子 SKU 的产品主数据、工程参数和订单三类数据计算" tone={family.summary.coveragePercent >= 90 ? "positive" : "warning"} />
    </div>

    <OpsCard>
      <OpsCardHeader title="产品与变体知识图谱" description={`${family.summary.childCount} 个子 SKU 已形成 ${family.summary.relationCount} 条关系，工程参数覆盖 ${family.summary.engineeringCoveredChildCount} 个、订单覆盖 ${family.summary.orderCoveredChildCount} 个。`} action={<Network className="h-4 w-4 text-emerald-700" />} />
      <div className="flex flex-col gap-2 border-y border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、节点或模块" className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 sm:w-64" /></label>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="定位知识图谱节点" value={selected?.id ?? ""} onChange={(event) => focusNode(event.target.value)} className="max-w-52 border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-emerald-600">{family.nodes.map((node) => <option key={node.id} value={node.id}>{typeLabels[node.type]} · {node.label}</option>)}</select><button type="button" onClick={runLayout} className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-600 hover:text-emerald-700"><Focus className="h-3.5 w-3.5" />重新排列</button><button type="button" onClick={() => graphRef.current?.fit(undefined, 34)} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-600 hover:text-emerald-700">适应画布</button></div>
      </div>
      <div ref={containerRef} className="h-[620px] w-full bg-[radial-gradient(circle_at_center,_#f8fafc_0,_#ffffff_68%)]" role="img" aria-label={`${family.parentSku} 变体经营知识图谱，共 ${family.nodes.length} 个节点和 ${family.edges.length} 条关系`} />
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-500">{legendItems.map((item) => <span key={item.label} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 ${item.color}`} />{item.label}</span>)}</div>
    </OpsCard>

    {selected ? <OpsCard>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.75fr)]">
        <div><div className="flex flex-wrap items-center gap-2"><OpsBadge tone={toneBadge[selected.tone]}>{typeLabels[selected.type]}</OpsBadge><span className="font-mono text-sm font-semibold text-slate-900">{selected.label}</span></div><p className="mt-2 text-sm text-slate-600">{selected.subtitle}</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{selected.metrics.map((metric) => <div key={`${metric.label}-${metric.value}`} className="border-l-2 border-slate-200 pl-3"><p className="text-[10px] text-slate-400">{metric.label}</p><p className="mt-1 break-words text-xs font-medium text-slate-800">{metric.value}</p></div>)}</div>{selected.href ? <Link href={selected.href} className="mt-5 inline-flex items-center border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">打开关联页面</Link> : null}</div>
        <div><p className="text-xs font-semibold text-slate-900">直接关系</p><div className="mt-2 flex flex-wrap gap-2">{related.length ? related.map((item) => <button key={item.node.id} type="button" onClick={() => focusNode(item.node.id)} className="border border-slate-200 bg-slate-50 px-2.5 py-2 text-left hover:border-emerald-500 hover:bg-emerald-50"><span className="block text-[10px] text-slate-400">{item.relation}</span><span className="mt-0.5 block font-mono text-xs font-semibold text-slate-800">{item.node.label}</span></button>) : <p className="text-xs text-slate-400">当前节点没有直接关系。</p>}</div></div>
      </div>
    </OpsCard> : null}
  </div>;
}

function relatedNodes(family: KnowledgeGraphFamily, id: string) {
  return family.edges.flatMap((edge) => {
    const otherId = edge.source === id ? edge.target : edge.target === id ? edge.source : "";
    const node = family.nodes.find((candidate) => candidate.id === otherId);
    return node ? [{ node, relation: edge.label }] : [];
  });
}

const graphStyles: cytoscape.StylesheetJson = [
  { selector: "node", style: { label: "data(label)", "text-valign": "center", "text-halign": "center", "font-size": 10, "font-family": "ui-sans-serif, system-ui, sans-serif", color: "#0f172a", "text-wrap": "wrap", "text-max-width": "88px", "background-color": "#dbeafe", "border-width": 1.5, "border-color": "#93c5fd", width: 44, height: 44, "overlay-opacity": 0, "transition-property": "opacity, border-width, border-color", "transition-duration": 150 } },
  { selector: 'node[type = "family"]', style: { shape: "round-rectangle", width: 92, height: 54, "background-color": "#d1fae5", "border-color": "#059669", "border-width": 3, "font-size": 12, "font-weight": 700 } },
  { selector: 'node[type = "sku"]', style: { shape: "round-rectangle", width: 84, height: 38, "font-size": 9 } },
  { selector: 'node[type = "category"]', style: { shape: "diamond", width: 58, height: 58, "background-color": "#e2e8f0", "border-color": "#64748b" } },
  { selector: 'node[type = "market"]', style: { shape: "ellipse", width: 54, height: 54, "background-color": "#dbeafe", "border-color": "#2563eb" } },
  { selector: 'node[type = "specification"], node[type = "attribute"], node[type = "listing"], node[type = "order"], node[type = "supplier"]', style: { shape: "round-rectangle", width: 82, height: 42, "font-size": 9 } },
  { selector: 'node[tone = "rose"]', style: { "background-color": "#ffe4e6", "border-color": "#e11d48" } },
  { selector: 'node[tone = "amber"]', style: { "background-color": "#fef3c7", "border-color": "#d97706" } },
  { selector: 'node[tone = "emerald"]', style: { "background-color": "#d1fae5", "border-color": "#059669" } },
  { selector: 'node[tone = "violet"]', style: { "background-color": "#ede9fe", "border-color": "#7c3aed" } },
  { selector: "edge", style: { width: 1.2, "line-color": "#cbd5e1", "target-arrow-color": "#94a3b8", "target-arrow-shape": "triangle", "arrow-scale": 0.7, "curve-style": "bezier", opacity: 0.8, "overlay-opacity": 0 } },
  { selector: "node:selected", style: { "border-width": 4, "border-color": "#0f172a" } },
  { selector: "edge:selected", style: { label: "data(label)", "font-size": 8, color: "#334155", "text-background-color": "#ffffff", "text-background-opacity": 0.9, "text-background-padding": "2px", width: 2.2, "line-color": "#0f766e", "target-arrow-color": "#0f766e" } },
  { selector: ".faded", style: { opacity: 0.12 } },
  { selector: ".muted", style: { opacity: 0.08 } },
  { selector: ".matched", style: { opacity: 1, "border-width": 4, "border-color": "#0f172a" } },
];

const legendItems = [
  { label: "父体", color: "bg-emerald-500" }, { label: "子 SKU", color: "bg-blue-400" }, { label: "产品主数据", color: "bg-emerald-300" }, { label: "材料/机芯/量程/精度等", color: "bg-violet-400" }, { label: "采购订单", color: "bg-amber-400" }, { label: "供应商", color: "bg-slate-400" },
];
