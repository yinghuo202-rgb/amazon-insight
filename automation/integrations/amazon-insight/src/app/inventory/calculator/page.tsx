import { createHash } from "node:crypto";
import { withReportVersion } from "@/lib/inventory/report-version";
import type { Metadata } from "next";

import { NewProductProfitCalculator } from "@/components/inventory/new-product-profit-calculator";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadNewProductResearchData, loadProductCatalogData } from "@/lib/inventory/data";
import { profitFeeRulesSchema } from "@/lib/inventory/profit-scenario";

export const metadata: Metadata = { title: "新品利润试算", description: "按市场、类目和产品成本估算新品单件利润。" };
export const dynamic = "force-dynamic";

export default async function NewProductProfitCalculatorPage() {
  const [catalog, research] = await withReportVersion(() => Promise.allSettled([loadProductCatalogData(), loadNewProductResearchData()]));
  const catalogItems = catalog.status === "fulfilled" ? catalog.value.items : [];
  const sourceWarnings = [catalog.status === "rejected" ? "产品目录不可读取，可手工填写。" : "", research.status === "rejected" ? "新品资料不可读取，可手工填写。" : ""].filter(Boolean);
  const products = catalogItems.map((item) => ({
    sku: item.sku,
    selectionId: "catalog:" + item.sku,
    source: "产品目录",
    name: item.chineseName || item.englishName || item.productDescription || item.sku,
    category: item.category || "",
    costUsd: item.purchaseCostUsd,
    costRmb: item.purchaseCostRmbTaxExcluded,
    cartonQty: item.cartonQty,
    weightG: item.productWeightG,
    dimensions: item.shippingSizeCm,
    cartonDimensions: item.cartonDimensionsCm,
  }));
  if (research.status === "fulfilled") {
    for (const candidate of research.value.candidates) {
      const catalogItem = catalogItems.find(item => item.sku === candidate.sku);
      products.push({
        sku: candidate.sku, selectionId: "research:" + createHash("sha256").update(JSON.stringify([candidate.sku, candidate.name])).digest("hex").slice(0, 24),
        source: "新品调研", name: candidate.name || candidate.sku, category: catalogItem?.category || "",
        costUsd: null, costRmb: candidate.purchaseCostRmb, cartonQty: catalogItem?.cartonQty ?? null,
        weightG: catalogItem?.productWeightG ?? null, dimensions: catalogItem?.shippingSizeCm ?? "",
        cartonDimensions: catalogItem?.cartonDimensionsCm ?? { length: null, width: null, height: null },
      });
    }
  }
  let rules: ReturnType<typeof profitFeeRulesSchema.parse> = [];
  let configError = "";
  try { rules = profitFeeRulesSchema.parse(JSON.parse(process.env.STORE_OPS_PROFIT_FEE_RULES || "[]")); }
  catch { configError = "利润费率配置无效，自动匹配已停用。请在部署配置中修正 STORE_OPS_PROFIT_FEE_RULES。"; }
  return <>
    <OpsPageHeader eyebrow="PROFIT SCENARIOS" title="新品利润试算" description="填写产品与箱规，在同一费用假设下对比售价方案。" />
    {sourceWarnings.map(warning => <p key={warning} role="status" className="mb-3 text-sm text-amber-800">{warning}</p>)}
    {configError && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{configError}</p>}
    <NewProductProfitCalculator products={products} rules={rules} />
  </>;
}
