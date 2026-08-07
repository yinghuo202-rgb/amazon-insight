import type { Metadata } from "next";

import { MasterDataEditor } from "@/components/inventory/master-data-editor";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadBaseInventoryDashboardData, loadBaseProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { buildOperationalDataEditorView } from "@/lib/inventory/operational-data-editor";
import { listOperationalDataOverrides } from "@/lib/inventory/operational-data-store";

export const metadata: Metadata = { title: "在线数据编辑", description: "在线维护产品主数据与美加库存，并同步到本地运营数据库。" };
export const dynamic = "force-dynamic";

export default async function MasterDataEditorPage() {
  const [products, variants, us, ca] = await Promise.all([
    loadBaseProductCatalogData(),
    loadVariantCatalogData(),
    loadBaseInventoryDashboardData("US"),
    loadBaseInventoryDashboardData("CA"),
  ]);
  const view = buildOperationalDataEditorView(products, variants, us, ca, listOperationalDataOverrides());
  return (
    <>
      <OpsPageHeader
        eyebrow="Master Data · Online Editing"
        title="在线数据编辑"
        description="在线维护产品主数据与美加库存。保存值进入本地运营数据库，并在库存、补货、采购、清货和产品详情中统一生效。"
      />
      <MasterDataEditor view={view} />
    </>
  );
}
