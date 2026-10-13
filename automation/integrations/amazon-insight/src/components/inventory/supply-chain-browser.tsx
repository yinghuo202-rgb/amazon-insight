"use client";

import { useEffect, useState } from "react";
import type { SupplyChainView } from "@/lib/inventory/warehouse-store";

type SupplyData = {
  query: string;
  view: SupplyChainView;
  nextCursor: string | null;
  warehouses: Array<{ id: string; code: string; name: string }>;
  documents: Array<{ id: string; documentNo: string; type: string; reference: string | null; approvedAt: string | null; warehouse: { code: string; name: string }; targetWarehouse: { code: string; name: string } | null; lines: Array<{ sku: string; quantity: number; lotCode: string | null; poNumber: string | null; allocations: Array<{ quantity: number; method: string; lotCode: string; poNumber: string | null; receivedAt: string }> }> }>;
  lots: Array<{ warehouseId: string; warehouse: { code: string; name: string }; sku: string; lotCode: string; poNumber: string | null; receivedAt: string; receivedQty: number; remainingQty: number }>;
};

export function SupplyChainBrowser({ data: initialData }: { data: SupplyData }) {
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState(initialData.query);
  const [tab, setTab] = useState<SupplyChainView>(initialData.view);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const loading = query.trim() !== data.query || tab !== data.view;
  const filteredDocs = data.documents, filteredLots = data.lots;
  const outbound = filteredDocs.filter((doc) => doc.type === "OUTBOUND" || doc.type === "TRANSFER");
  useEffect(() => {
    if (query.trim() === data.query && tab === data.view && retry === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ query: query.trim(), view: tab });
      void fetch("/api/inventory/supply-chain?" + params, { cache: "no-store", signal: controller.signal }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "供应链数据读取失败。");
        if (!controller.signal.aborted) { setData(payload); setError(""); setRetry(0); }
      }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "供应链数据读取失败。"); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, tab, data.query, data.view, retry]);
  async function more() {
    if (busy || loading || !data.nextCursor) return;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ query: data.query, view: data.view, cursor: data.nextCursor });
      const response = await fetch("/api/inventory/supply-chain?" + params, { cache: "no-store" }), payload: SupplyData & { error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || "历史记录读取失败。");
      setData(current => current.query === payload.query && current.view === payload.view ? { ...payload, documents: [...current.documents, ...payload.documents.filter(doc => !current.documents.some(existing => existing.id === doc.id))] } : current);
    } catch (e) { setError(e instanceof Error ? e.message : "历史记录读取失败。"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-xl border border-slate-200 bg-white p-1">{([["outbound", "出库来源"], ["stock", "库存构成"], ["timeline", "供应链时间线"]] as const).map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setError(""); }} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === key ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{label}</button>)}</div>
      <input aria-label="搜索 SKU、采购单、批次" maxLength={100} value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} placeholder="搜索 SKU、采购单、批次" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs sm:w-72" />
    </div>
    {loading && !error && <p role="status" className="text-xs text-slate-500">正在搜索全部已审核历史记录…</p>}
    {error && <div role="alert" className="text-xs text-rose-700"><p>{error}</p><button onClick={() => setRetry(value => value + 1)} className="mt-2 min-h-11 rounded-lg border px-3">重新搜索全部记录</button></div>}
    {!loading && !error && tab !== "stock" && <p role="status" className="text-xs text-slate-500">已显示 {filteredDocs.length} 条已审核记录{data.nextCursor ? " · 仍有更早匹配记录，尚未全部加载" : " · 已加载全部匹配历史"}</p>}
    {!loading && !error && <>
    {!data.warehouses.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="text-sm font-semibold text-slate-800">供应链账本尚未初始化</p><p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-slate-500">先在“仓库管理”中创建仓库，并通过审核的入库、出库单建立批次记录。冠唐同步尚未接入，当前没有导入的订单归属。</p></div> : null}
    {tab === "outbound" ? <section className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{outbound.map((doc) => <article key={doc.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-mono text-xs font-semibold">{doc.documentNo}<span className="ml-2 font-sans font-normal text-slate-500">{doc.warehouse.name}{doc.targetWarehouse ? ` → ${doc.targetWarehouse.name}` : ""}</span></p><p className="mt-1 text-[10px] text-slate-400">{doc.reference || (doc.approvedAt ? new Date(doc.approvedAt).toLocaleString("zh-CN") : "")}</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] text-blue-700">{doc.type === "TRANSFER" ? "调拨" : "出库"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{doc.lines.map((line, index) => <div key={`${line.sku}-${index}`} className="rounded-xl bg-slate-50 p-3"><p className="font-mono text-xs font-semibold text-blue-700">{line.sku}<span className="ml-2 font-sans text-slate-700">出库 {line.quantity}</span></p>{line.allocations.length ? <div className="mt-2 space-y-1">{line.allocations.map((allocation, allocationIndex) => <p key={`${allocation.lotCode}-${allocationIndex}`} className="text-[10px] text-slate-500">{allocation.poNumber || `批次 ${allocation.lotCode}`}：{allocation.quantity} 件 · {allocation.method === "FIFO" ? "FIFO 推算" : "批次指定"}</p>)}</div> : <p className="mt-2 text-[10px] text-amber-700">来源待核对</p>}</div>)}</div></article>)}{!outbound.length && data.warehouses.length ? <Empty>没有匹配的已审核出库。</Empty> : null}</section> : null}
    {tab === "stock" ? <section className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{filteredLots.map((lot, index) => <div key={`${lot.warehouseId}-${lot.sku}-${lot.lotCode}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-mono text-xs font-semibold text-blue-700">{lot.sku}<span className="ml-2 font-sans font-normal text-slate-500">{lot.warehouse.name}</span></p><p className="mt-1 text-[10px] text-slate-500">{lot.poNumber || `批次 ${lot.lotCode}`} · 入库 {new Date(lot.receivedAt).toLocaleDateString("zh-CN")} · 累计入库 {lot.receivedQty}</p></div><span className="text-xs font-semibold">现存 {lot.remainingQty}</span></div>)}{!filteredLots.length && data.warehouses.length ? <Empty>没有匹配的现存批次。</Empty> : null}</section> : null}
    {tab === "timeline" ? <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="space-y-3">{filteredDocs.map((doc) => <div key={doc.id} className="grid gap-2 border-l-2 border-blue-200 pl-4 sm:grid-cols-[180px_1fr]"><p className="text-[10px] text-slate-400">{doc.approvedAt ? new Date(doc.approvedAt).toLocaleString("zh-CN") : ""}</p><div><p className="text-xs font-semibold">{doc.documentNo} · {doc.warehouse.name}{doc.targetWarehouse ? ` → ${doc.targetWarehouse.name}` : ""}</p><p className="mt-1 text-[10px] text-slate-500">{doc.lines.map((line) => `${line.sku} × ${line.quantity}`).join("，")}</p></div></div>)}{!filteredDocs.length && data.warehouses.length ? <Empty>没有匹配的供应链事件。</Empty> : null}</div></section> : null}
    {tab !== "stock" && data.nextCursor && <button disabled={busy} onClick={() => void more()} className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs disabled:opacity-50">{busy ? "正在加载更早记录…" : "加载更早的 200 条匹配记录"}</button>}
    </>}
  </div>;
}

function Empty({ children }: { children: string }) { return <p className="py-8 text-center text-xs text-slate-500">{children}</p>; }
