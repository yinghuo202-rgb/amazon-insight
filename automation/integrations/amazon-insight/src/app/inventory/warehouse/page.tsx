import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { WarehouseWorkbench } from "@/components/inventory/warehouse-workbench";
import { getCurrentUser, workspaceForUser } from "@/lib/auth";
import { warehouseSnapshot } from "@/lib/inventory/warehouse-store";

export const metadata: Metadata = { title: "仓库管理", description: "维护国内仓、入出库单据、批次库存和库存流水。" };
export const dynamic = "force-dynamic";

export default async function WarehousePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspace = await workspaceForUser(user.id);
  const data = await warehouseSnapshot(workspace.id);
  return <>
    <OpsPageHeader eyebrow="Warehouse · Admin" title="仓库管理" description="以审核单据记录入库、出库、调拨和调整，库存余额由批次流水计算。冠唐数据接入前，可先建立网站侧的仓库台账。" />
    <WarehouseWorkbench initialData={JSON.parse(JSON.stringify(data))} isAdmin />
  </>;
}
