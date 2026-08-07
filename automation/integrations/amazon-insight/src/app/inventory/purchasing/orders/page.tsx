import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { PurchaseOrderBrowser } from "@/components/inventory/purchase-order-browser";
import { listPurchaseOrderSummaries } from "@/lib/inventory/purchase-orders";

export const metadata: Metadata = { title: "催货订单", description: "查看全部采购订单及待完成数量。" };
export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  return <><OpsPageHeader eyebrow="Purchase Order Follow-up" title="催货订单" description="按采购订单查看全部 SKU、订购数量、已出货/到货数量、待完成数量和付款台账信息。" /><PurchaseOrderBrowser orders={await listPurchaseOrderSummaries()} /></>;
}
