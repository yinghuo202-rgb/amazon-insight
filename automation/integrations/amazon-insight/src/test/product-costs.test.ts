import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadBaseProductCatalogData, loadProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { deleteProductCostOverrides, listProductCostOverrides, saveProductCostOverrides } from "@/lib/inventory/product-cost-store";
import { PRODUCT_COST_VAT_RATE } from "@/lib/inventory/product-cost-policy";
import { buildProductCostView, calculateCostsFromTaxIncluded } from "@/lib/inventory/product-costs";

describe("product cost management", () => {
  const original = process.env.STORE_OPS_STATE_DB;
  let folder = "";

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), "product-costs-"));
    process.env.STORE_OPS_STATE_DB = path.join(folder, "operations.sqlite3");
  });

  afterEach(() => {
    if (original === undefined) delete process.env.STORE_OPS_STATE_DB;
    else process.env.STORE_OPS_STATE_DB = original;
    rmSync(folder, { recursive: true, force: true });
  });

  it("persists overrides and applies them to downstream product catalog reads", async () => {
    saveProductCostOverrides([{
      sku: "MA007",
      purchaseCostRmbTaxIncluded: 20,
      purchaseCostRmbTaxExcluded: 17.6991,
      purchaseCostUsd: 2.6042,
    }]);

    expect(listProductCostOverrides()).toHaveLength(1);
    expect((await loadProductCatalogData()).items.find((item) => item.sku === "MA007")).toMatchObject({
      purchaseCostRmbTaxIncluded: 20,
      purchaseCostRmbTaxExcluded: 17.6991,
      purchaseCostUsd: 2.6042,
    });

    deleteProductCostOverrides(["MA007"]);
    expect(listProductCostOverrides()).toHaveLength(0);
  });

  it("builds real variant series and category fallback groups for all products", async () => {
    const [products, variants] = await Promise.all([loadBaseProductCatalogData(), loadVariantCatalogData()]);
    const view = buildProductCostView(products, variants, []);
    const variantRow = view.rows.find((row) => row.sku === "MA003");
    const fallbackRow = view.rows.find((row) => row.seriesKind === "category");

    expect(view.rows).toHaveLength(products.items.length);
    expect(variantRow).toMatchObject({ seriesKind: "variant" });
    expect(variantRow?.seriesName).toContain("1.5英寸");
    expect(fallbackRow?.seriesId).toMatch(/^CATEGORY:/);
    expect(view.series.some((series) => series.kind === "variant")).toBe(true);
    expect(view.series.some((series) => series.kind === "category")).toBe(true);
  });

  it("recalculates untaxed and dollar costs from the tax-included amount", () => {
    expect(PRODUCT_COST_VAT_RATE).toBe(13);
    expect(calculateCostsFromTaxIncluded(113, 7.5)).toEqual({
      purchaseCostRmbTaxIncluded: 113,
      purchaseCostRmbTaxExcluded: 100,
      purchaseCostUsd: 13.3333,
    });
  });

  it("enforces the fixed 13 percent tax rate when saving overrides", () => {
    saveProductCostOverrides([{
      sku: "MA007",
      purchaseCostRmbTaxIncluded: 113,
      purchaseCostRmbTaxExcluded: 113,
      purchaseCostUsd: 13.3333,
    }]);

    expect(listProductCostOverrides()[0].purchaseCostRmbTaxExcluded).toBe(100);
  });
});
