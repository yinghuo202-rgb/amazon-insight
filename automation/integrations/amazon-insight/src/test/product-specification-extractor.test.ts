import { describe, expect, it } from "vitest";

import { loadProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { extractProductSpecifications } from "@/lib/inventory/product-specification-extractor";

describe("product specification extraction", () => {
  it("extracts engineering parameters from a pressure-gauge listing", async () => {
    const [products, variants] = await Promise.all([loadProductCatalogData(), loadVariantCatalogData()]);
    const product = products.items.find((item) => item.sku === "MA003") ?? null;
    const variant = variants.items.find((item) => item.sku === "MA003" && item.role === "Child") ?? null;
    const facts = extractProductSpecifications(product, variant);
    const byKey = new Map(facts.map((fact) => [fact.key, fact]));

    expect(byKey.get("pressure_range")?.value.toLowerCase()).toContain("0-100psi");
    expect(byKey.get("accuracy")?.value).toContain("3-2-3%");
    expect(byKey.get("movement")?.value.toLowerCase()).toBe("brass");
    expect(byKey.get("bourdon_tube")?.value.toLowerCase()).toBe("copper alloy");
    expect(byKey.get("case_material")?.value.toLowerCase()).toContain("304 stainless steel");
    expect(byKey.get("process_connection")?.value.toLowerCase()).toContain("1/8\"npt");
    expect(byKey.get("dial_size")?.value).toContain("1-1/2");
    expect(byKey.get("filling")?.value.toLowerCase()).toContain("glycerin");
    expect(byKey.get("ip_rating")?.value.toUpperCase()).toBe("IP67");
    expect(facts.every((fact) => fact.sourceLabel && fact.confidence)).toBe(true);
  });

  it("extracts body material, preset pressure, inlet, and outlet from a regulator listing", async () => {
    const products = await loadProductCatalogData();
    const product = products.items.find((item) => item.sku === "MA166") ?? null;
    const facts = extractProductSpecifications(product);
    const byKey = new Map(facts.map((fact) => [fact.key, fact.value.toLowerCase()]));

    expect(byKey.get("body_material")).toContain("lead free brass");
    expect(byKey.get("pressure_setting")).toContain("40-50psi");
    expect(byKey.get("inlet")).toContain("3/4");
    expect(byKey.get("outlet")).toContain("3/4");
  });
});
