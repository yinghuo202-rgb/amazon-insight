import type { Metadata } from "next";

import { NewProductProfitCalculator } from "@/components/inventory/new-product-profit-calculator";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadProductCatalogData } from "@/lib/inventory/data";
import { profitFeeRulesSchema } from "@/lib/inventory/profit-scenario";

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
    cartonDimensions: item.cartonDimensionsCm,
  }));
  let rules: ReturnType<typeof profitFeeRulesSchema.parse> = [];
  let configError = "";
  try { rules = profitFeeRulesSchema.parse(JSON.parse(process.env.STORE_OPS_PROFIT_FEE_RULES || "[]")); }
  catch { configError = "利润费率配置无效，自动匹配已停用。请在部署配置中修正 STORE_OPS_PROFIT_FEE_RULES。"; }
  return <>
    <OpsPageHeader title="新品利润试算" description="选择站点和类目，带入相似产品；箱规计算头程，费用就绪后查看利润。默认广告 15%、退货 1%、不计税及危险品、电池费用。" />
    {configError && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{configError}</p>}
    <NewProductProfitCalculator products={products} rules={rules} />
  </>;
}
