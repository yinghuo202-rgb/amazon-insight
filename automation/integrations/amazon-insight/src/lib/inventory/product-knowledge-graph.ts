import type { ProductCatalogData, VariantCatalogData } from "@/lib/inventory/contracts";
import type { PurchaseOrderLine, PurchaseOrderSummary } from "@/lib/inventory/purchase-orders";
import { extractProductSpecifications } from "@/lib/inventory/product-specification-extractor";

export type KnowledgeNodeType = "category" | "market" | "family" | "sku" | "specification" | "attribute" | "listing" | "order" | "supplier";
export type KnowledgeNodeTone = "slate" | "emerald" | "blue" | "amber" | "rose" | "violet";

export type KnowledgeGraphNode = {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  subtitle: string;
  href: string;
  tone: KnowledgeNodeTone;
  metrics: Array<{ label: string; value: string }>;
};

export type KnowledgeGraphEdge = { id: string; source: string; target: string; label: string };

export type KnowledgeGraphFamily = {
  key: string;
  market: "US" | "CA";
  parentSku: string;
  familyName: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  summary: {
    childCount: number;
    specificationCoveredChildCount: number;
    engineeringCoveredChildCount: number;
    orderCoveredChildCount: number;
    attributeCount: number;
    orderCount: number;
    displayedOrderCount: number;
    orderedQuantity: number;
    relationCount: number;
    coveragePercent: number;
  };
};

type OrderLineRelation = { order: PurchaseOrderSummary; line: PurchaseOrderLine };

export function buildProductKnowledgeGraph(input: {
  variants: VariantCatalogData;
  products: ProductCatalogData;
  purchaseOrders: PurchaseOrderSummary[];
  market?: "US" | "CA";
  parentSku?: string;
}) {
  const productBySku = new Map(input.products.items.map((product) => [normalizeSku(product.sku), product] as const));
  const ordersBySku = indexOrdersBySku(input.purchaseOrders);

  return input.variants.groups
    .filter((group) => (!input.market || group.market === input.market) && (!input.parentSku || group.parentSku === input.parentSku))
    .flatMap((group) => {
    const market = group.market === "CA" ? "CA" as const : group.market === "US" ? "US" as const : null;
    if (!market) return [];

    const key = `${market}:${group.parentSku}`;
    const prefix = key;
    const children = input.variants.items.filter((item) => item.market === market && item.parentSku === group.parentSku && item.role === "Child");
    const childSkus = new Set(children.map((item) => normalizeSku(item.sku)));
    const familyOrderRelations = children.flatMap((item) => ordersBySku.get(normalizeSku(item.sku)) ?? []);
    const familyOrderNumbers = new Set(familyOrderRelations.map(({ order }) => order.poNumber));
    const displayedOrderNumbers = new Set([...new Map(familyOrderRelations.map(({ order }) => [order.poNumber, order] as const)).values()]
      .sort((left, right) => right.poDate.localeCompare(left.poDate) || right.poNumber.localeCompare(left.poNumber))
      .slice(0, 15)
      .map((order) => order.poNumber));
    const orderedQuantity = familyOrderRelations.reduce((total, { line }) => total + line.orderedQuantity, 0);
    const nodes: KnowledgeGraphNode[] = [];
    const edges: KnowledgeGraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const addNode = (node: KnowledgeGraphNode) => {
      if (nodeIds.has(node.id)) return;
      nodes.push(node);
      nodeIds.add(node.id);
    };
    const addEdge = (source: string, target: string, label: string) => {
      const id = `${source}->${target}:${label}`;
      if (edgeIds.has(id)) return;
      edges.push({ id, source, target, label });
      edgeIds.add(id);
    };

    const categoryId = `${prefix}:category`;
    const marketId = `${prefix}:market`;
    const familyId = `${prefix}:family`;
    addNode({
      id: categoryId,
      type: "category",
      label: group.categoryL2 || group.categoryL1 || "未分类",
      subtitle: group.categoryL1,
      href: `/inventory/categories?market=${market}`,
      tone: "slate",
      metrics: [{ label: "产品系列", value: group.familyName }, { label: "变体主题", value: group.variationTheme || "未设置" }],
    });
    addNode({
      id: marketId,
      type: "market",
      label: market === "US" ? "美国站" : "加拿大站",
      subtitle: "Amazon 变体市场",
      href: `/inventory?market=${market}`,
      tone: "blue",
      metrics: [{ label: "市场", value: market }, { label: "父体", value: group.parentSku }],
    });
    addNode({
      id: familyId,
      type: "family",
      label: group.parentSku,
      subtitle: group.familyName,
      href: `/inventory/categories?market=${market}&parent=${encodeURIComponent(group.parentSku)}`,
      tone: "emerald",
      metrics: [
        { label: "Family ID", value: group.familyId },
        { label: "变体主题", value: group.variationTheme || "未设置" },
        { label: "子 SKU", value: String(children.length) },
        { label: "数据质量", value: group.note || "正常" },
      ],
    });
    addEdge(categoryId, familyId, "包含系列");
    addEdge(marketId, familyId, "发布市场");

    const specificationCovered = new Set<string>();
    const engineeringCovered = new Set<string>();
    const orderCovered = new Set<string>();
    for (const item of children) {
      const sku = normalizeSku(item.sku);
      const skuId = `${prefix}:sku:${sku}`;
      const product = productBySku.get(sku);
      const orderRelations = ordersBySku.get(sku) ?? [];
      const skuHref = `/inventory/sku/${encodeURIComponent(sku)}${market === "CA" ? "?market=CA" : ""}`;
      addNode({
        id: skuId,
        type: "sku",
        label: sku,
        subtitle: item.productName,
        href: skuHref,
        tone: product ? "blue" : "amber",
        metrics: [
          { label: "变体值", value: item.variantValue || "默认款" },
          { label: "变体主题", value: item.variationTheme || "未设置" },
          { label: "Amazon 类型", value: item.amazonItemType || "未设置" },
          { label: "FNSKU", value: product?.fnsku || "未匹配" },
          { label: "历史采购单", value: String(new Set(orderRelations.map(({ order }) => order.poNumber)).size) },
        ],
      });
      addEdge(familyId, skuId, "父子变体");

      const engineeringFacts = extractProductSpecifications(product ?? null, item);
      if (engineeringFacts.length) engineeringCovered.add(sku);
      for (const fact of engineeringFacts) {
        const attributeId = `${prefix}:attribute:${slug(fact.key)}:${slug(fact.value)}`;
        addNode({
          id: attributeId,
          type: "attribute",
          label: fact.value,
          subtitle: fact.label,
          href: `${skuHref}#engineering-specifications`,
          tone: "violet",
          metrics: [
            { label: "参数字段", value: fact.label },
            { label: "参数值", value: fact.value },
            { label: "提取来源", value: fact.sourceLabel },
            { label: "置信度", value: confidenceLabel(fact.confidence) },
          ],
        });
        addEdge(skuId, attributeId, fact.label);
      }

      if (product) {
        specificationCovered.add(sku);
        const specificationId = `${prefix}:specification:${sku}`;
        addNode({
          id: specificationId,
          type: "specification",
          label: `${sku} 产品规格`,
          subtitle: product.chineseName || product.englishName || item.productName,
          href: `${skuHref}#product-specifications`,
          tone: "emerald",
          metrics: specificationMetrics(product),
        });
        addEdge(skuId, specificationId, "产品主数据");

        if (product.listing) {
          const listingId = `${prefix}:listing:${sku}`;
          addNode({
            id: listingId,
            type: "listing",
            label: `${product.listing.brand || "MEASUREMAN"} Listing`,
            subtitle: product.listing.title || "标题待补充",
            href: `${skuHref}#listing-information`,
            tone: "blue",
            metrics: [
              { label: "品牌", value: product.listing.brand || "未设置" },
              { label: "标题", value: product.listing.title || "未设置" },
              { label: "五点描述", value: `${product.listing.bullets.length} 条` },
              { label: "属性字段", value: `${Object.keys(product.listing.attributes).length} 项` },
              { label: "来源表", value: product.listing.sourceSheet || "未记录" },
            ],
          });
          addEdge(skuId, listingId, "Listing 内容");
        }
      }

      if (orderRelations.length) orderCovered.add(sku);
      for (const { order, line } of orderRelations.filter(({ order }) => displayedOrderNumbers.has(order.poNumber))) {
        const orderId = `${prefix}:order:${slug(order.poNumber)}`;
        const familyLines = order.lines.filter((candidate) => childSkus.has(normalizeSku(candidate.sku)));
        addNode({
          id: orderId,
          type: "order",
          label: order.poNumber,
          subtitle: `${order.poDate || "日期未记录"} · ${order.status === "OPEN" ? "待完成" : "已完成"}`,
          href: `/inventory/purchasing/orders/${encodeURIComponent(order.poNumber)}`,
          tone: order.status === "OPEN" ? "amber" : "emerald",
          metrics: [
            { label: "订单日期", value: order.poDate || "未记录" },
            { label: "订单状态", value: order.status === "OPEN" ? "待催货" : "已完成" },
            { label: "全单 SKU", value: `${order.lineCount} 项` },
            { label: "全单订购", value: `${order.orderedQuantity} 件` },
            { label: "全单待完成", value: `${order.remainingQuantity} 件` },
            { label: "本系列订单行", value: familyLines.map((candidate) => `${candidate.sku} × ${candidate.orderedQuantity}`).join("；") || "—" },
            { label: "付款方", value: order.paymentPayers.join(" / ") || "未匹配" },
            { label: "付款方式", value: order.paymentMethods.join(" / ") || "未匹配" },
          ],
        });
        addEdge(skuId, orderId, `订购 ${line.orderedQuantity} 件 · 待 ${line.remainingQuantity}`);

        if (line.factory) {
          const supplierId = `${prefix}:supplier:${slug(line.factory)}`;
          addNode({
            id: supplierId,
            type: "supplier",
            label: line.factory,
            subtitle: "采购供应商",
            href: "",
            tone: "slate",
            metrics: [{ label: "供应商", value: line.factory }, { label: "产品系列", value: group.familyName }, { label: "查看方式", value: "点击相邻订单节点查看采购内容" }],
          });
          addEdge(orderId, supplierId, "供应商");
        }
      }
    }

    const attributeCount = nodes.filter((node) => node.type === "attribute").length;
    const coverageDenominator = children.length * 3;
    const coveragePercent = coverageDenominator
      ? Math.round((specificationCovered.size + engineeringCovered.size + orderCovered.size) / coverageDenominator * 100)
      : 0;
    return [{
      key,
      market,
      parentSku: group.parentSku,
      familyName: group.familyName,
      nodes,
      edges,
      summary: {
        childCount: children.length,
        specificationCoveredChildCount: specificationCovered.size,
        engineeringCoveredChildCount: engineeringCovered.size,
        orderCoveredChildCount: orderCovered.size,
        attributeCount,
        orderCount: familyOrderNumbers.size,
        displayedOrderCount: displayedOrderNumbers.size,
        orderedQuantity,
        relationCount: edges.length,
        coveragePercent,
      },
    } satisfies KnowledgeGraphFamily];
  });
}

function indexOrdersBySku(orders: PurchaseOrderSummary[]) {
  const result = new Map<string, OrderLineRelation[]>();
  for (const order of orders) {
    for (const line of order.lines) {
      const sku = normalizeSku(line.sku);
      if (!sku) continue;
      result.set(sku, [...(result.get(sku) ?? []), { order, line }]);
    }
  }
  return result;
}

function specificationMetrics(product: ProductCatalogData["items"][number]) {
  const dimensions = product.cartonDimensionsCm;
  return [
    { label: "FNSKU", value: product.fnsku || "未记录" },
    { label: "中文品名", value: product.chineseName || "未记录" },
    { label: "英文品名", value: product.englishName || "未记录" },
    { label: "产品分类", value: product.category || "未记录" },
    { label: "包装方式", value: product.packaging || "未记录" },
    { label: "HS 编码", value: product.hsCode || "未记录" },
    { label: "装箱量", value: product.cartonQty ? `${product.cartonQty} 件/箱` : "未记录" },
    { label: "外箱尺寸", value: [dimensions.length, dimensions.width, dimensions.height].every((value) => value !== null) ? `${dimensions.length} × ${dimensions.width} × ${dimensions.height} cm` : "未记录" },
    { label: "箱净重 / 毛重", value: `${numberUnit(product.cartonNetWeightKg, "kg")} / ${numberUnit(product.cartonGrossWeightKg, "kg")}` },
    { label: "单箱体积", value: numberUnit(product.cartonVolumeM3, "m³") },
    { label: "单品重量", value: numberUnit(product.productWeightG, "g") },
    { label: "产品尺寸", value: product.shippingSizeCm || "未记录" },
    { label: "含税采购成本", value: product.purchaseCostRmbTaxIncluded === null ? "未记录" : `¥${product.purchaseCostRmbTaxIncluded.toFixed(2)}` },
    { label: "美元采购成本", value: product.purchaseCostUsd === null ? "未记录" : `$${product.purchaseCostUsd.toFixed(2)}` },
    { label: "报关要素", value: product.declarationElements || "未记录" },
  ];
}

function numberUnit(value: number | null, unit: string) {
  return value === null ? "未记录" : `${value} ${unit}`;
}

function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

function slug(value: string) {
  return encodeURIComponent(value.trim().toLowerCase()).replaceAll("%", "_");
}

function confidenceLabel(confidence: "high" | "medium" | "low") {
  return confidence === "high" ? "高 · 结构化描述" : confidence === "medium" ? "中 · Listing 文案" : "低 · 名称推断";
}
