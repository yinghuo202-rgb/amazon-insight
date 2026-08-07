import type { Metadata } from "next";

import { ProductCostWorkbench } from "@/components/inventory/product-cost-workbench";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadBaseProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { listProductCostOverrides } from "@/lib/inventory/product-cost-store";
import { buildProductCostView } from "@/lib/inventory/product-costs";

export const metadata: Metadata = { title: "产品成本", description: "按产品系列筛选、换算并维护含税、未税与美元采购成本。" };
export const dynamic = "force-dynamic";

export default async function ProductCostsPage() {
  const [products, variants] = await Promise.all([loadBaseProductCatalogData(), loadVariantCatalogData()]);
  const view = buildProductCostView(products, variants, listProductCostOverrides());
  return (
    <>
      <OpsPageHeader
        eyebrow="Product · Series · Cost"
        title="产品成本"
        description="以产品系列为筛选口径，固定按 13% 增值税换算含税与未税人民币成本，再换算不含税美元采购成本；修改后同步到本地运营数据库。"
      />
      <ProductCostWorkbench view={view} />
    </>
  );
}
