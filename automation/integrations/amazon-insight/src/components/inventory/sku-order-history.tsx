import { ReceiptText } from "lucide-react";
import Link from "next/link";

import { OpsBadge, OpsCard, OpsCardHeader } from "@/components/inventory/ops-ui";
import type { SkuPurchaseOrderDetail } from "@/lib/inventory/purchase-orders";
import { integer } from "@/lib/inventory/presentation";

export function SkuOrderHistory({ orders, sku }: { orders: SkuPurchaseOrderDetail[]; sku: string }) {
  const orderCount = new Set(orders.map((order) => order.poNumber)).size;
  const orderedQuantity = orders.reduce((total, order) => total + order.line.orderedQuantity, 0);
  const shippedQuantity = orders.reduce((total, order) => total + order.line.previouslyShippedQuantity, 0);
  const remainingQuantity = orders.reduce((total, order) => total + order.line.remainingQuantity, 0);
  const purchaseAmount = orders.reduce((total, order) => total + order.line.orderedQuantity * order.line.unitPrice, 0);
  const averageUnitPrice = orderedQuantity ? purchaseAmount / orderedQuantity : null;

  return (
    <OpsCard id="purchase-order-history">
      <OpsCardHeader
        title="SKU 历史采购订单明细"
        description={orders.length ? `${sku} 历史累计订购 ${integer(orderedQuantity)} 件，已完成 ${integer(shippedQuantity)} 件，仍有 ${integer(remainingQuantity)} 件待完成。` : `${sku} 当前尚未匹配到历史采购订单。`}
        action={<div className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-emerald-700" /><OpsBadge tone={remainingQuantity > 0 ? "amber" : "emerald"}>{orderCount} 单 · 待完成 {integer(remainingQuantity)} 件</OpsBadge></div>}
      />
      {orders.length ? <>
        <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-5">
          <OrderMetric label="历史订单" value={`${orderCount} 单`} detail={`${orders.length} 条 SKU 订单行`} />
          <OrderMetric label="累计订购" value={`${integer(orderedQuantity)} 件`} detail={orders.at(-1)?.poDate ? `最早 ${orders.at(-1)?.poDate}` : "日期未记录"} />
          <OrderMetric label="已出/到货" value={`${integer(shippedQuantity)} 件`} detail={orderedQuantity ? `完成率 ${Math.round(shippedQuantity / orderedQuantity * 100)}%` : "完成率 —"} />
          <OrderMetric label="待完成" value={`${integer(remainingQuantity)} 件`} detail={`${orders.filter((order) => order.line.remainingQuantity > 0).length} 条订单行仍未完成`} warning={remainingQuantity > 0} />
          <OrderMetric label="采购金额 / 均价" value={`¥${purchaseAmount.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`} detail={averageUnitPrice === null ? "均价 —" : `加权均价 ¥${averageUnitPrice.toFixed(2)}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.07em] text-slate-500"><tr><th className="px-4 py-3">订单号 / 日期</th><th className="px-3 py-3">供应商 / 品名</th><th className="px-3 py-3 text-right">采购单价</th><th className="px-3 py-3 text-right">订购</th><th className="px-3 py-3 text-right">已完成</th><th className="px-3 py-3 text-right">待完成</th><th className="px-3 py-3">到货状态</th><th className="px-3 py-3">付款信息</th><th className="px-4 py-3">来源</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order, index) => <tr key={`${order.poNumber}-${order.line.factory}-${order.line.sourcePath}-${index}`} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3"><Link href={`/inventory/purchasing/orders/${encodeURIComponent(order.poNumber)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{order.poNumber}</Link><p className="mt-1 text-[10px] text-slate-500">{order.poDate || "日期未记录"}</p></td>
                <td className="px-3 py-3"><p className="font-medium text-slate-800">{order.line.factory || "供应商未记录"}</p><p className="mt-1 max-w-64 text-[10px] leading-4 text-slate-500">{order.line.productName || sku}</p></td>
                <td className="px-3 py-3 text-right font-medium">¥{order.line.unitPrice.toFixed(2)}</td>
                <td className="px-3 py-3 text-right font-semibold">{integer(order.line.orderedQuantity)}</td>
                <td className="px-3 py-3 text-right">{integer(order.line.previouslyShippedQuantity)}</td>
                <td className={`px-3 py-3 text-right font-semibold ${order.line.remainingQuantity > 0 ? "text-amber-700" : "text-slate-700"}`}>{integer(order.line.remainingQuantity)}</td>
                <td className="px-3 py-3">{order.line.received ? <OpsBadge tone="emerald">已到货 {normalizeReceivedAt(order.line.receivedAt)}</OpsBadge> : order.line.remainingQuantity > 0 ? <OpsBadge tone="amber">生产/催货中</OpsBadge> : <OpsBadge>已完成</OpsBadge>}</td>
                <td className="px-3 py-3"><p>{order.paymentPayers.join(" / ") || "未匹配"}</p><p className="mt-1 text-[10px] text-slate-500">{[order.paymentMethods.join(" / "), order.paymentDates.join(" / ")].filter(Boolean).join(" · ") || "—"}</p>{order.paymentNotes.length ? <p className="mt-1 max-w-48 text-[10px] leading-4 text-slate-400">{order.paymentNotes.join(" / ")}</p> : null}</td>
                <td className="px-4 py-3"><p className="max-w-56 truncate text-[10px] text-slate-500" title={order.line.sourcePath}>{order.line.sourcePath || "—"}</p></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </> : <div className="p-8 text-sm text-slate-500">采购订单主档中尚未匹配到 {sku} 的历史订单行。</div>}
    </OpsCard>
  );
}

function OrderMetric({ label, value, detail, warning = false }: { label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="bg-white px-4 py-3"><p className="text-[10px] font-medium text-slate-400">{label}</p><p className={`mt-1 text-base font-semibold ${warning ? "text-amber-700" : "text-slate-900"}`}>{value}</p><p className="mt-1 text-[10px] text-slate-500">{detail}</p></div>;
}

function normalizeReceivedAt(value: string) {
  return value && value !== "/" ? value : "";
}
