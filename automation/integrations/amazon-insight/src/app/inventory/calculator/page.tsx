import type { Metadata } from "next";

import { NewProductProfitCalculator } from "@/components/inventory/new-product-profit-calculator";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadProductCatalogData } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "新品利润试算", description: "按市场、类目和产品成本估算新品单件利润。" };
export const dynamic = "force-dynamic";

export default async function NewProductProfitCalculatorPage() {
  const catalog = await loadProductCatalogData();
  const products = catalog.items.map((item) => ({
    sku: item.sku,
    name: item.chineseName || item.englishName || item.productDescription || item.sku,
    category: item.category || "",
    costUsd: item.purchaseCostUsd,
    costRmb: item.purchaseCostRmbTaxExcluded,
    cartonQty: item.cartonQty,
    weightG: item.productWeightG,
    dimensions: item.shippingSizeCm,
  }));
  return <>
    <OpsPageHeader eyebrow="Product · Profit Scenario" title="新品利润试算" description="选择市场和类目后，可选已有产品自动带入成本与包装信息。市场和类目佣金、FBA 配送费以及头程需使用当期费率确认。" />
    <NewProductProfitCalculator products={products} />
  </>;
}
