import { ArrowLeft, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi, OpsPageHeader } from "@/components/inventory/ops-ui";
import { getPurchaseOrder } from "@/lib/inventory/purchase-orders";
import { integer } from "@/lib/inventory/presentation";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage(props: PageProps<"/inventory/purchasing/orders/[poNumber]">) {
  const { poNumber } = await props.params;
  const order = await getPurchaseOrder(poNumber);
  if (!order) notFound();
  return <>
    <OpsPageHeader eyebrow="Purchase Order Detail" title={order.poNumber} description="该采购订单的全部产品行、完成进度、付款信息和数据来源。" />
    <div className="mb-4"><Link href="/inventory/purchasing/orders" className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:underline"><ArrowLeft className="h-3.5 w-3.5" />返回催货订单</Link></div>
    <div className="space-y-4">
      <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><OpsKpi label="订单日期" value={order.poDate || "—"} detail={order.factories.join(" / ") || "供应商待补"} /><OpsKpi label="SKU 明细" value={`${order.lineCount} 项`} detail="该订单全部产品" /><OpsKpi label="订购数量" value={integer(order.orderedQuantity)} detail="件" /><OpsKpi label="已出/到货" value={integer(order.shippedQuantity)} detail="件" tone="positive" /><OpsKpi label="待完成" value={integer(order.remainingQuantity)} detail="件" tone={order.remainingQuantity ? "warning" : "positive"} /></div>
      <OpsCard><OpsCardHeader title="付款台账" description={order.paymentDates.length ? `当前匹配 ${order.paymentDates.length} 条付款日期记录，付款方为 ${order.paymentPayers.join(" / ") || "未匹配"}。` : "当前采购订单尚未匹配到付款日期记录。"} action={<ReceiptText className="h-4 w-4 text-emerald-700" />} /><div className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-4"><Info label="付款方" value={order.paymentPayers.join(" / ") || "未匹配"} /><Info label="付款方式" value={order.paymentMethods.join(" / ") || "未匹配"} /><Info label="付款日期" value={order.paymentDates.join(" / ") || "未匹配"} /><Info label="台账备注" value={order.paymentNotes.join(" / ") || "—"} /></div></OpsCard>
      <OpsCard><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">订单全部明细</h2><p className="mt-1 text-xs text-slate-500">每一行均保留原采购数量、已完成数量、待完成数量和来源文件</p></div><OpsBadge tone={order.status === "OPEN" ? "amber" : "emerald"}>{order.status === "OPEN" ? "待催货" : "已完成"}</OpsBadge></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 品名</th><th className="px-3 py-3">供应商</th><th className="px-3 py-3 text-right">单价</th><th className="px-3 py-3 text-right">订购</th><th className="px-3 py-3 text-right">已完成</th><th className="px-3 py-3 text-right">待完成</th><th className="px-3 py-3">到货状态</th><th className="px-4 py-3">来源</th></tr></thead><tbody className="divide-y divide-slate-100">{order.lines.map((line) => <tr key={`${line.sku}-${line.factory}`}><td className="px-4 py-3"><Link href={`/inventory/sku/${encodeURIComponent(line.sku)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{line.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{line.productName || "—"}</p></td><td className="px-3 py-3">{line.factory || "—"}</td><td className="px-3 py-3 text-right">¥{line.unitPrice.toFixed(2)}</td><td className="px-3 py-3 text-right font-semibold">{integer(line.orderedQuantity)}</td><td className="px-3 py-3 text-right">{integer(line.previouslyShippedQuantity)}</td><td className="px-3 py-3 text-right font-semibold text-amber-700">{integer(line.remainingQuantity)}</td><td className="px-3 py-3">{line.received ? <OpsBadge tone="emerald">已到货 {line.receivedAt}</OpsBadge> : <OpsBadge tone="amber">生产/催货中</OpsBadge>}</td><td className="px-4 py-3"><p className="max-w-72 truncate text-[10px] text-slate-500" title={line.sourcePath}>{line.sourcePath}</p></td></tr>)}</tbody></table></div></OpsCard>
    </div>
  </>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p><p className="mt-1 text-sm text-slate-800">{value}</p></div>; }
