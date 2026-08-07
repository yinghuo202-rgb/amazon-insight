import type { ProductCatalogItem, VariantCatalogData } from "@/lib/inventory/contracts";

export type ProductSpecificationSource = "listing_description" | "listing_bullet" | "listing_title" | "listing_attribute" | "variant" | "product_master";
export type ProductSpecificationConfidence = "high" | "medium" | "low";

export type ExtractedProductSpecification = {
  key: string;
  label: string;
  value: string;
  source: ProductSpecificationSource;
  sourceLabel: string;
  confidence: ProductSpecificationConfidence;
};

type VariantItem = VariantCatalogData["items"][number];
type Rule = { key: string; label: string; aliases: string[] };

const rules: Rule[] = [
  { key: "dial_size", label: "表盘尺寸", aliases: ["Dial size", "Dial diameter", "表盘尺寸", "表径"] },
  { key: "process_connection", label: "过程接口", aliases: ["Process connection", "Thread connection", "接口规格", "过程连接"] },
  { key: "case_material", label: "表壳/外壳", aliases: ["Case", "Housing", "表壳", "外壳"] },
  { key: "window_material", label: "表窗材质", aliases: ["Window", "Lens", "表窗", "镜片"] },
  { key: "dial_plate", label: "表盘材质", aliases: ["Dial plate", "Dial", "表盘"] },
  { key: "pointer", label: "指针", aliases: ["Pointer", "指针"] },
  { key: "bourdon_tube", label: "波登管", aliases: ["Bourdon tube", "Bourdon", "波登管", "弹簧管"] },
  { key: "movement", label: "机芯", aliases: ["Movement", "Mechanism", "Gear movement", "机芯", "传动机构"] },
  { key: "connection_material", label: "接头材质", aliases: ["Connection", "Connector", "接头", "连接件"] },
  { key: "body_material", label: "主体材质", aliases: ["Body", "Body material", "Main material", "Valve body", "主体材质", "阀体", "本体材质"] },
  { key: "filling", label: "填充液", aliases: ["Filling", "Fill liquid", "Liquid filling", "填充液", "充液"] },
  { key: "ip_rating", label: "防护等级", aliases: ["IP class", "IP rating", "Protection class", "防护等级"] },
  { key: "pressure_range", label: "量程", aliases: ["Pressure range", "Measuring range", "Range", "量程", "测量范围"] },
  { key: "accuracy", label: "精度", aliases: ["Accuracy", "Precision", "精度", "准确度"] },
  { key: "working_temperature", label: "工作温度", aliases: ["Working temperature", "Operating temperature", "工作温度", "使用温度"] },
  { key: "ambient_temperature", label: "环境温度", aliases: ["Ambient temperature", "环境温度"] },
  { key: "inlet", label: "入口接口", aliases: ["Inlet", "入口", "进水口", "进口"] },
  { key: "outlet", label: "出口接口", aliases: ["Outlet", "出口", "出水口"] },
  { key: "pressure_setting", label: "预设压力", aliases: ["Pressure preset", "Preset pressure", "Set pressure", "预设压力", "设定压力"] },
];

const sourceLabels: Record<ProductSpecificationSource, string> = {
  listing_description: "Listing 详情描述",
  listing_bullet: "Listing 五点描述",
  listing_title: "Listing 标题",
  listing_attribute: "Listing 结构化属性",
  variant: "父子变体值",
  product_master: "产品主数据",
};

export function extractProductSpecifications(product: ProductCatalogItem | null, variant?: VariantItem | null): ExtractedProductSpecification[] {
  const result = new Map<string, ExtractedProductSpecification>();
  const add = (key: string, label: string, value: string, source: ProductSpecificationSource, confidence: ProductSpecificationConfidence) => {
    const cleaned = cleanValue(value);
    if (!cleaned || result.has(key)) return;
    result.set(key, { key, label, value: cleaned, source, sourceLabel: sourceLabels[source], confidence });
  };

  const listingDescription = normalizeText(product?.listing?.description ?? "");
  extractLabeledFacts(listingDescription, "listing_description", "high", add);

  for (const bullet of product?.listing?.bullets ?? []) {
    extractLabeledFacts(normalizeText(bullet), "listing_bullet", "medium", add);
  }

  for (const [attribute, value] of Object.entries(product?.listing?.attributes ?? {})) {
    const mapped = attributeRules[attribute];
    if (mapped) add(mapped.key, mapped.label, value, "listing_attribute", "high");
  }

  const title = normalizeText(product?.listing?.title ?? "");
  const masterText = normalizeText([product?.productDescription, product?.chineseName, product?.englishName].filter(Boolean).join("\n"));
  addFallbackFacts(listingDescription, "listing_description", "high", add);
  addFallbackFacts(title, "listing_title", "medium", add);
  addFallbackFacts(masterText, "product_master", "low", add);

  if (variant?.variantValue) {
    const range = findRange(variant.variantValue);
    if (range) add("pressure_range", "量程", range, "variant", "high");
    add("variant_value", variant.variationTheme || "变体规格", variant.variantValue, "variant", "high");
  }

  return [...result.values()].sort((left, right) => specificationRank(left.key) - specificationRank(right.key) || left.label.localeCompare(right.label, "zh-CN"));
}

function extractLabeledFacts(
  text: string,
  source: ProductSpecificationSource,
  confidence: ProductSpecificationConfidence,
  add: (key: string, label: string, value: string, source: ProductSpecificationSource, confidence: ProductSpecificationConfidence) => void,
) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const rule of rules) {
    const aliases = rule.aliases.map(escapeRegExp).join("|");
    const pattern = new RegExp(`^(?:${aliases})\\s*(?::|：|-)\\s*(.+)$`, "i");
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]) {
        add(rule.key, rule.label, match[1], source, confidence);
        break;
      }
    }
  }
}

function addFallbackFacts(
  text: string,
  source: ProductSpecificationSource,
  confidence: ProductSpecificationConfidence,
  add: (key: string, label: string, value: string, source: ProductSpecificationSource, confidence: ProductSpecificationConfidence) => void,
) {
  const patterns: Array<{ key: string; label: string; pattern: RegExp; group?: number }> = [
    { key: "case_material", label: "表壳/外壳", pattern: /\b((?:304|316)\s+stainless\s+steel\s+case)\b/i },
    { key: "body_material", label: "主体材质", pattern: /\b((?:forged\s+)?lead[- ]free\s+brass(?:\s+pressure\s+regulator)?\s+body)\b/i },
    { key: "body_material", label: "主体材质", pattern: /\b((?:stainless\s+steel|brass|aluminum|copper|plastic)\s+body)\b/i },
    { key: "filling", label: "填充液", pattern: /\b(glycerin(?:e)?\s+filled)\b/i },
    { key: "ip_rating", label: "防护等级", pattern: /\b(IP\\s*\\d{2})\b/i },
    { key: "accuracy", label: "精度", pattern: /(?:accuracy|精度)\s*(?::|：)?\s*((?:\+\/-|±)\s*[\d.\-–—]+\s*%)/i },
    { key: "pressure_setting", label: "预设压力", pattern: /(?:preset|set)\s+at\s+(-?\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*-?\d+(?:\.\d+)?\s*(?:psi|bar|kpa|mpa))/i },
    { key: "dial_size", label: "表盘尺寸", pattern: /\b(\d+(?:[ -]\d+\/\d+|\/\d+|\.\d+)?\s*(?:\"|''|”|inch)\s+(?:dial|dial size))\b/i },
    { key: "process_connection", label: "过程接口", pattern: /\b(\d+(?:\/\d+)?\s*(?:\"|''|”)?\s*NPT(?:\s+male|\s+female)?(?:\s+(?:lower|rear|center back|back|bottom)\s+mount|\s+(?:lower|rear|center back|back|bottom))?)\b/i },
  ];
  for (const item of patterns) {
    const match = text.match(item.pattern);
    if (match?.[item.group ?? 1]) add(item.key, item.label, match[item.group ?? 1], source, confidence);
  }
  const range = findRange(text);
  if (range) add("pressure_range", "量程", range, source, confidence);
}

function findRange(text: string) {
  const explicit = text.match(/(?:pressure\s+range|measuring\s+range|range|量程|测量范围)\s*(?::|：|of)?\s*((?:-?\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*)?-?\d+(?:\.\d+)?\s*(?:psi(?:\/kpa)?|kpa|bar|mpa|inhg|mmhg|°c|°f|deg\s*[cf]))/i);
  if (explicit?.[1]) return explicit[1];
  const standalone = text.trim().match(/^(-?\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*-?\d+(?:\.\d+)?\s*(?:psi(?:\/kpa)?|kpa|bar|mpa|inhg|mmhg|°c|°f|deg\s*[cf]))$/i);
  return standalone?.[1] ?? "";
}

function normalizeText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function cleanValue(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[,;，；]+|[,;，；]+$/g, "").trim().slice(0, 220);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function specificationRank(key: string) {
  const order = ["variant_value", "pressure_range", "accuracy", "dial_size", "process_connection", "case_material", "body_material", "movement", "bourdon_tube", "connection_material", "window_material", "dial_plate", "pointer", "filling", "ip_rating", "inlet", "outlet", "pressure_setting", "working_temperature", "ambient_temperature"];
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
}

const attributeRules: Record<string, { key: string; label: string }> = {
  workingPressure: { key: "pressure_range", label: "量程/工作压力" },
  mainMaterial: { key: "body_material", label: "主体材质" },
  inflationHeadType: { key: "process_connection", label: "接口类型" },
  threadSpecification: { key: "process_connection", label: "螺纹规格" },
};
