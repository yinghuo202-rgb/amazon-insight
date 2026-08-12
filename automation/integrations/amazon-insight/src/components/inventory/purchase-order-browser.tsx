"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsKpi } from "@/components/inventory/ops-ui";
import type { PurchaseOrderListItem } from "@/lib/inventory/purchase-orders";
import { integer } from "@/lib/inventory/presentation";

const pageSize = 50;

export function PurchaseOrderBrowser({ orders }: { orders: PurchaseOrderListItem[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"OPEN" | "COMPLETED" | "ALL">("OPEN");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return orders.filter((order) => (status === "ALL" || order.status === status)
      && (!normalized || `${order.poNumber} ${order.factories.join(" ")} ${order.searchText}`.toUpperCase().includes(normalized)));
  }, [orders, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const openOrders = orders.filter((order) => order.status === "OPEN");
  return <div className="space-y-4">
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><OpsKpi label="全部采购订单" value={`${orders.length} 单`} detail={`${integer(orders.reduce((sum, order) => sum + order.orderedQuantity, 0))} 件`} /><OpsKpi label="待催货订单" value={`${openOrders.length} 单`} detail={`${integer(openOrders.reduce((sum, order) => sum + order.remainingQuantity, 0))} 件未完成`} tone="warning" /><OpsKpi label="已完成订单" value={`${orders.length - openOrders.length} 单`} detail="保留历史明细" tone="positive" /><OpsKpi label="已匹配付款台账" value={`${orders.filter((order) => order.paymentPayers.length || order.paymentMethods.length).length} 单`} detail="付款方 / 含税方式" /></div>
    <OpsCard>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-1 bg-slate-100 p-1">{(["OPEN", "COMPLETED", "ALL"] as const).map((value) => <button key={value} type="button" onClick={() => { setStatus(value); setPage(1); }} className={`px-3 py-1.5 text-xs font-semibold ${status === value ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500"}`}>{value === "OPEN" ? "待催货" : value === "COMPLETED" ? "已完成" : "全部订单"}</button>)}</div><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索订单号、SKU、供应商" className="w-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 sm:w-80" /></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">订单号</th><th className="px-3 py-3">日期 / 供应商</th><th className="px-3 py-3 text-right">SKU</th><th className="px-3 py-3 text-right">订购</th><th className="px-3 py-3 text-right">已出/到货</th><th className="px-3 py-3 text-right">待完成</th><th className="px-3 py-3">付款</th><th className="px-4 py-3">状态</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((order) => <tr key={order.poNumber} className="hover:bg-slate-50"><td className="px-4 py-3"><Link href={`/inventory/purchasing/orders/${encodeURIComponent(order.poNumber)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{order.poNumber}</Link><p className="mt-1 text-[10px] text-slate-400">查看全部明细 →</p></td><td className="px-3 py-3"><p>{order.poDate || "—"}</p><p className="mt-1 max-w-56 truncate text-[10px] text-slate-500" title={order.factories.join(" / ")}>{order.factories.join(" / ") || "—"}</p></td><td className="px-3 py-3 text-right">{order.lineCount}</td><td className="px-3 py-3 text-right font-semibold">{integer(order.orderedQuantity)}</td><td className="px-3 py-3 text-right">{integer(order.shippedQuantity)}</td><td className="px-3 py-3 text-right font-semibold text-amber-700">{integer(order.remainingQuantity)}</td><td className="px-3 py-3"><p>{order.paymentPayers.join(" / ") || "—"}</p><p className="mt-1 text-[10px] text-slate-500">{order.paymentMethods.join(" / ")}</p></td><td className="px-4 py-3"><OpsBadge tone={order.status === "OPEN" ? "amber" : "emerald"}>{order.status === "OPEN" ? "待催货" : "已完成"}</OpsBadge></td></tr>)}</tbody></table></div>
      {!visible.length ? <div className="p-10 text-center text-sm text-slate-500">没有符合条件的订单。</div> : null}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>共 {filtered.length} 单 · 第 {safePage}/{pageCount} 页</span><div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="border border-slate-200 px-3 py-1.5 disabled:opacity-30">上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="border border-slate-200 px-3 py-1.5 disabled:opacity-30">下一页</button></div></div>
    </OpsCard>
  </div>;
}
