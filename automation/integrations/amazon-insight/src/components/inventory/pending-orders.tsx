"use client";

import { Clock3, RotateCcw, TriangleAlert, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { OpsBadge } from "@/components/inventory/ops-ui";
import type { PendingOrder } from "@/lib/inventory/contracts";
import { integer } from "@/lib/inventory/presentation";
import type { OperationsMarket } from "@/lib/inventory/data";
import type { PurchaseOrderReview } from "@/lib/inventory/purchase-order-reviews";

type OrderIdentity = { sku: string; market: OperationsMarket };

export function OrderLine({ order, sku, market }: { order: PendingOrder } & OrderIdentity) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-slate-900">{order.poNumber}</span>
        <OpsBadge tone={order.overdue ? "rose" : "blue"}>{order.overdue ? `逾期 ${order.overdueDays} 天` : "进行中"}</OpsBadge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />下单 {formatOrderDate(order.poDate)}</span>
        <span>订单量 {integer(order.orderedQuantity)}</span>
        <span>未完工 {integer(order.remainingQuantity)}</span>
        <span>工厂 {order.factory || "未填写"}</span>
      </div>
      {order.overdue ? <><p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-rose-700"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />45 天交期应于 {formatOrderDate(order.expectedDeliveryDate)} 前完成</p><PurchaseOrderReviewForm mode="cancel" sku={sku} market={market} poNumber={order.poNumber} poDate={order.poDate} /></> : null}
    </div>
  );
}

export function CanceledPurchaseOrders({ reviews }: { reviews: PurchaseOrderReview[] }) {
  if (!reviews.length) return null;
  return (
    <details className="rounded-2xl border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div><p className="text-sm font-semibold text-slate-900">已取消采购任务</p><p className="mt-1 text-xs text-slate-500">保留人工核查记录，不再计入未完工库存和逾期提醒</p></div>
        <OpsBadge tone="slate">{reviews.length} 条</OpsBadge>
      </summary>
      <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-3">
        {reviews.map((review) => <div key={review.id} className="border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-semibold">{review.poNumber}</span><OpsBadge tone="slate">已取消</OpsBadge></div>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-500"><span>下单 {review.poDate}</span><span>取消数量 {integer(review.remainingQuantity)}</span><span>操作人 {review.reviewer || "未填写"}</span><span>{formatReviewTime(review.createdAt)}</span></div>
          <p className="mt-2 border-l-2 border-slate-300 pl-2 text-[11px] leading-5 text-slate-600">{review.reason}</p>
          <PurchaseOrderReviewForm mode="restore" sku={review.sku} market={review.market} poNumber={review.poNumber} poDate={review.poDate} />
        </div>)}
      </div>
    </details>
  );
}

function PurchaseOrderReviewForm({ mode, sku, market, poNumber, poDate }: { mode: "cancel" | "restore"; poNumber: string; poDate: string } & OrderIdentity) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(mode === "restore" ? "人工复核后恢复采购任务" : "");
  const [reviewer, setReviewer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (reason.trim().length < 2) { setError("请填写人工核查结论或取消原因。"); return; }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/purchase-orders/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, market, sku, poNumber, poDate, reason, reviewer }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "状态更新失败");
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`mt-3 inline-flex items-center gap-1 text-[11px] font-medium hover:underline ${mode === "cancel" ? "text-rose-700" : "text-emerald-700"}`}>{mode === "cancel" ? <XCircle className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{mode === "cancel" ? "人工核查并取消" : "恢复为进行中"}</button>;

  return <div className={`mt-3 space-y-2 border p-2.5 ${mode === "cancel" ? "border-rose-200 bg-rose-50/50" : "border-emerald-200 bg-emerald-50/50"}`}>
    <p className="text-[10px] leading-4 text-slate-600">{mode === "cancel" ? "取消后，该任务不再计入美加店未完工库存和逾期提醒，系统会同步重算生产缺口。" : "恢复后，该任务会重新参与未完工库存、逾期统计和生产缺口计算。"}</p>
    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={300} placeholder="填写核查结论或原因（必填）" className="w-full resize-none border border-slate-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-emerald-600" />
    <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={60} placeholder="操作人（选填）" className="w-full border border-slate-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-emerald-600" />
    {error ? <p className="text-[10px] text-rose-700">{error}</p> : null}
    <div className="flex gap-2"><button type="button" onClick={submit} disabled={submitting} className={`px-2.5 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50 ${mode === "cancel" ? "bg-rose-700" : "bg-emerald-700"}`}>{submitting ? "处理中…" : mode === "cancel" ? "确认取消任务" : "确认恢复任务"}</button><button type="button" onClick={() => { setOpen(false); setError(""); }} className="px-2.5 py-1.5 text-[10px] text-slate-500">返回</button></div>
  </div>;
}

export function formatOrderDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}-${month}-${day}`;
}

function formatReviewTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
