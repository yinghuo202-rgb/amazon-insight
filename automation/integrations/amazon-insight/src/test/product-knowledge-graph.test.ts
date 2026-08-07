import { describe, expect, it } from "vitest";

import { loadProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { buildProductKnowledgeGraph } from "@/lib/inventory/product-knowledge-graph";
import { listPurchaseOrders, purchaseOrderDetailsForSku } from "@/lib/inventory/purchase-orders";

describe("product knowledge graph", () => {
  it("links each product family to specifications, attributes, orders, and suppliers", async () => {
    const [variants, products, purchaseOrders] = await Promise.all([
      loadVariantCatalogData(),
      loadProductCatalogData(),
      listPurchaseOrders(),
    ]);
    const families = buildProductKnowledgeGraph({ variants, products, purchaseOrders });

    expect(families).toHaveLength(variants.groups.filter((group) => group.market === "US" || group.market === "CA").length);
    expect(families.some((family) => family.market === "US")).toBe(true);
    expect(families.some((family) => family.market === "CA")).toBe(true);
    expect(families.some((family) => family.summary.orderCount > 0)).toBe(true);

    for (const family of families) {
      const ids = new Set(family.nodes.map((node) => node.id));
      const skuNodes = family.nodes.filter((node) => node.type === "sku");
      expect(skuNodes).toHaveLength(family.summary.childCount);
      expect(family.nodes.some((node) => node.type === "family")).toBe(true);
      expect(family.nodes.some((node) => node.type === "specification")).toBe(true);
      expect(family.nodes.some((node) => node.type === "attribute")).toBe(true);
      expect(family.summary.specificationCoveredChildCount).toBeGreaterThan(0);
      expect(family.summary.relationCount).toBe(family.edges.length);
      expect(family.summary.coveragePercent).toBeGreaterThan(0);
      expect(family.summary.coveragePercent).toBeLessThanOrEqual(100);
      expect(family.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
      expect(skuNodes.every((node) => node.href.includes(`/inventory/sku/${node.label}`))).toBe(true);
      expect(skuNodes.every((node) => family.market === "CA" ? node.href.endsWith("?market=CA") : !node.href.includes("market=CA"))).toBe(true);
    }
  });

  it("uses shared purchase-order nodes when an order contains multiple variants in one family", async () => {
    const [variants, products, purchaseOrders] = await Promise.all([
      loadVariantCatalogData(),
      loadProductCatalogData(),
      listPurchaseOrders(),
    ]);
    const families = buildProductKnowledgeGraph({ variants, products, purchaseOrders });
    const family = families.find((candidate) => candidate.nodes.some((node) => node.type === "order" && candidate.edges.filter((edge) => edge.target === node.id && edge.label.startsWith("订购")).length > 1));

    expect(family).toBeDefined();
    if (!family) return;
    const sharedOrder = family.nodes.find((node) => node.type === "order" && family.edges.filter((edge) => edge.target === node.id && edge.label.startsWith("订购")).length > 1);
    expect(sharedOrder?.href).toContain("/inventory/purchasing/orders/");
    expect(sharedOrder?.metrics.some((metric) => metric.label === "本系列订单行" && metric.value.includes("×"))).toBe(true);
  });

  it("returns complete SKU purchase-order detail in reverse chronological order", async () => {
    const orders = await listPurchaseOrders();
    const sku = orders.flatMap((order) => order.lines).find((line) => line.sku)?.sku;
    expect(sku).toBeTruthy();
    if (!sku) return;

    const details = purchaseOrderDetailsForSku(orders, sku);
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((detail) => detail.line.sku.toUpperCase() === sku.toUpperCase())).toBe(true);
    expect(details.every((detail, index) => index === 0 || details[index - 1].poDate >= detail.poDate)).toBe(true);
  });
});
