import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { skuBackendContext } from "@/lib/inventory/operating-navigation";
import { SkuContextReturn } from "@/components/inventory/sku-context-return";

import { ProductCostWorkbench } from "@/components/inventory/product-cost-workbench";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadBaseProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { readProductCostSnapshot } from "@/lib/inventory/product-cost-store";
import { buildProductCostView } from "@/lib/inventory/product-costs";

export const metadata: Metadata = { title: "产品成本", description: "按产品系列筛选、换算并维护含税、未税与美元采购成本。" };
export const dynamic = "force-dynamic";

export default async function ProductCostsPage({ searchParams }: { searchParams: Promise<{ market?: string; query?: string; returnTo?: string }> }) {
  const search = skuBackendContext(await searchParams);
  if (search.invalidMarket) notFound();
  const [products, variants] = await Promise.all([loadBaseProductCatalogData(), loadVariantCatalogData()]);
  const snapshot = readProductCostSnapshot(products.items.map((product) => product.sku));
  const view = buildProductCostView(products, variants, snapshot.items, snapshot.editStates);
  return (
    <>
      <SkuContextReturn {...search} />
      <OpsPageHeader
        eyebrow="Product · Series · Cost"
        title="产品成本"
        description="以产品系列筛选，固定按 13% 增值税换算成本；按生效日期维护当前成本与历史版本，不重算已发布历史利润。"
      />
      <ProductCostWorkbench initialQuery={search.query?.slice(0, 100)} view={view} />
    </>
  );
}
