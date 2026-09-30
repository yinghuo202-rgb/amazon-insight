import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { SupplyChainBrowser } from "@/components/inventory/supply-chain-browser";
import { getCurrentUser, workspaceForUser } from "@/lib/auth";
import { supplyChainSnapshot } from "@/lib/inventory/warehouse-store";

export const metadata: Metadata = { title: "供应链追溯", description: "查看 SKU 出库来源和当前仓库订单批次构成。" };
export const dynamic = "force-dynamic";

export default async function SupplyChainPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspace = await workspaceForUser(user.id);
  const data = await supplyChainSnapshot(workspace.id);
  return <>
    <OpsPageHeader eyebrow="Supply Chain · Read Only" title="供应链追溯" description="查看出库 SKU 的采购订单/入库批次来源，以及当前仓库库存构成。来源未能直接关联时会明确显示待核对或 FIFO 推算。" />
    <SupplyChainBrowser data={data} />
  </>;
}
