"use client";
import { useState, type ReactNode } from "react";
export function SkuDetailSections({ initialTab, analysis, supply, records, advertising }: { initialTab: string; analysis: ReactNode; supply: ReactNode; records: ReactNode; advertising?: ReactNode }) {
  const tabs = [{ key: "analysis", label: "经营分析" }, { key: "supply", label: "库存与供货" }, ...(advertising ? [{ key: "advertising", label: "广告表现" }] : []), { key: "records", label: "处理记录" }];
  const [tab, setTab] = useState(tabs.some(t => t.key === initialTab) ? initialTab : "analysis");
  function select(key: string) { setTab(key); const url = new URL(window.location.href); url.searchParams.set("tab", key); window.history.replaceState(window.history.state, "", url.pathname + url.search); }
  return <section className="mt-5"><div role="tablist" aria-label="SKU 分析分区" className="ops-sku-tabs mb-4">{tabs.map((item, index) => <button key={item.key} id={`sku-tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls={`sku-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onClick={() => select(item.key)} onKeyDown={event => {
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (target !== null) { event.preventDefault(); select(tabs[target].key); document.getElementById(`sku-tab-${tabs[target].key}`)?.focus(); }
  }} className={`min-h-12 rounded-xl border text-sm ${tab === item.key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}>{item.label}</button>)}</div>{tabs.map(item => <div key={item.key} id={`sku-panel-${item.key}`} role="tabpanel" aria-labelledby={`sku-tab-${item.key}`} hidden={tab !== item.key}>{item.key === "analysis" ? analysis : item.key === "supply" ? supply : item.key === "advertising" ? advertising : records}</div>)}</section>;
}
