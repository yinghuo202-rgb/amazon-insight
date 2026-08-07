import fs from "node:fs/promises";
import path from "node:path";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) result[argv[index]?.replace(/^--/, "")] = argv[index + 1];
  return result;
}

const args = parseArgs(process.argv.slice(2));
for (const key of ["sku", "products", "content", "variants", "template", "output"]) {
  if (!args[key]) throw new Error(`Missing --${key}`);
}

const sku = String(args.sku).trim().toUpperCase();
if (!/^[A-Z]{2}\d{3}$/.test(sku)) throw new Error("Invalid SKU");

const [productCatalog, contentWorkflow, variantCatalog] = await Promise.all([
  readJson(args.products),
  readJson(args.content),
  readJson(args.variants),
]);
const product = productCatalog.items.find((item) => item.sku === sku);
const task = contentWorkflow.tasks.find((item) => item.sku === sku);
if (!product || !task) throw new Error(`No product/content task found for ${sku}`);

const family = findFamily(variantCatalog, sku);
const referenceTask = selectFamilyReference(contentWorkflow, variantCatalog, family, task);
const targetVariant = family?.members.find((item) => item.sku === sku) ?? null;
const productFacts = extractProductFacts(product, targetVariant);
const applications = extractApplications(product, task);
const mainSections = buildProductDrivenMainSections(product, task, productFacts, applications);
const aPlusSections = buildProductDrivenAPlusSections(product, task, productFacts, applications, family, targetVariant);

const workbook = Workbook.create();
const productSheet = workbook.worksheets.add("产品信息");
const mainSheet = workbook.worksheets.add("主图美工对接");
const aPlusSheet = workbook.worksheets.add("A+美工对接");

buildProductSheet(productSheet, { sku, product, task, family, referenceTask, template: args.template, productFacts, applications });
buildBriefSheet(mainSheet, {
  title: `${sku} 主图美工对接`,
  type: "主图",
  sections: mainSections,
  product,
  task,
  family,
  referenceTask,
});
buildBriefSheet(aPlusSheet, {
  title: `${sku} A+ 页面美工对接`,
  type: "A+模块",
  sections: aPlusSections,
  product,
  task,
  family,
  referenceTask,
});

const imagePath = product.imageFile ? path.join(path.dirname(args.products), "..", "output", "product-images", product.imageFile) : "";
if (imagePath && await exists(imagePath)) {
  const dataUrl = await fileDataUrl(imagePath, product.imageMimeType || mimeFromPath(imagePath));
  addProductImage(mainSheet, dataUrl);
  addProductImage(aPlusSheet, dataUrl);
}

const keyCheck = await workbook.inspect({
  kind: "table",
  sheetId: "产品信息",
  range: "A1:F18",
  tableMaxRows: 18,
  tableMaxCols: 6,
  maxChars: 6000,
});
const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "creative handoff formula error scan",
  maxChars: 2000,
});

await fs.mkdir(path.dirname(args.output), { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(args.output);

const previewFiles = [];
if (args.previews) {
  await fs.mkdir(args.previews, { recursive: true });
  for (const sheetName of ["产品信息", "主图美工对接", "A+美工对接"]) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 0.8, format: "png" });
    const previewPath = path.join(args.previews, `${sheetName}.png`);
    await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
    previewFiles.push(previewPath);
  }
}

const qa = {
  status: "completed",
  sku,
  output: args.output,
  template: args.template,
  referenceSku: referenceTask.sku,
  family: family ? { market: family.group.market, parentSku: family.group.parentSku, familyName: family.group.familyName, variationTheme: family.group.variationTheme } : null,
  sheets: ["产品信息", "主图美工对接", "A+美工对接"],
  mainSectionCount: mainSections.length,
  aPlusSectionCount: aPlusSections.length,
  strategy: "product_facts_v2",
  productFacts,
  applications,
  keyCheck: keyCheck.ndjson,
  errorCheck: errorCheck.ndjson,
  previews: previewFiles,
};
if (args.qa) await fs.writeFile(args.qa, JSON.stringify(qa, null, 2), "utf8");
console.log(JSON.stringify(qa));

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function findFamily(variants, targetSku) {
  const item = variants.items.find((candidate) => candidate.sku === targetSku && candidate.role === "Child" && candidate.market === "US")
    ?? variants.items.find((candidate) => candidate.sku === targetSku && candidate.role === "Child");
  if (!item) return null;
  const group = variants.groups.find((candidate) => candidate.market === item.market && candidate.parentSku === item.parentSku);
  if (!group) return null;
  const members = variants.items.filter((candidate) => candidate.market === item.market && candidate.parentSku === item.parentSku && candidate.role === "Child");
  return { group, members };
}

function selectFamilyReference(content, variants, family, targetTask) {
  if (!family) return targetTask;
  const taskMap = new Map(content.tasks.map((item) => [item.sku, item]));
  const candidates = family.members.map((member) => taskMap.get(member.sku)).filter(Boolean);
  const score = (item) => (item.mainImageBrief.source === "creative_archive" ? 5 : 0)
    + (item.aPlusBrief.source === "creative_archive" ? 5 : 0)
    + (item.copy.source === "listing_master" ? 2 : 0)
    + (item.sku === targetTask.sku ? 0.25 : 0);
  return candidates.sort((left, right) => score(right) - score(left))[0] ?? targetTask;
}

function buildProductDrivenMainSections(product, task, facts, applications) {
  const factMap = new Map(facts.map((fact) => [fact.label, fact.value]));
  const performance = joinFacts(facts, ["量程", "精度", "预设压力", "填充液", "表盘尺寸"]);
  const structure = joinFacts(facts, ["主体材质", "表壳/外壳", "压力表结构", "机芯", "波登管", "防护等级"]);
  const connections = joinFacts(facts, ["过程接口", "入口接口", "出口接口"]);
  return [
    {
      section: "主图",
      size: "2000 × 2000 px",
      copy: "",
      requirement: "纯白背景，仅展示实际随货产品；主体占画面约 85%，不添加文案、边框、徽章或未随货配件。",
    },
    {
      section: "核心使用任务",
      size: "2000 × 2000 px",
      copy: task.copy.bullets[0] || task.copy.title,
      requirement: `用产品 45° 视角说明一个核心使用结果；场景限定为：${applications || "按产品资料确认"}。不得根据历史订单猜测用途。`,
    },
    {
      section: "测量 / 调节性能",
      size: "2000 × 2000 px",
      copy: performance || "性能参数待工程确认",
      requirement: "表盘或调节部件近景，参数用简短标注线对应真实部位；只呈现产品资料中已出现的量程、精度、预设压力或充液信息。",
    },
    {
      section: "材料与内部结构",
      size: "2000 × 2000 px",
      copy: structure || "材料与结构待工程确认",
      requirement: "材料、机芯、波登管、充液或防护结构特写；没有剖面实拍时使用示意图并明确标注“结构示意”。",
    },
    {
      section: "接口与尺寸",
      size: "2000 × 2000 px",
      copy: [connections, product.shippingSizeCm ? `Product size: ${product.shippingSizeCm}` : ""].filter(Boolean).join("\n"),
      requirement: "用正投影或三视图标注接口、安装方向和整机尺寸；接口公母、螺纹和方向必须由工程复核。",
    },
    {
      section: "真实应用场景",
      size: "2000 × 2000 px",
      copy: applications || task.copy.bullets[0] || "",
      requirement: "选择 2–3 个真实安装场景，产品比例、连接方向和介质保持合理；不展示资料未覆盖的兼容设备。",
    },
    {
      section: "包装与选型",
      size: "2000 × 2000 px",
      copy: [`Package: ${product.packaging || "Confirm before design"}`, targetPackText(product), factMap.get("变体规格") || ""].filter(Boolean).join("\n"),
      requirement: "平铺展示实际包装清单，并说明本 SKU 的变体规格；不得把同系列参考款的配件带入当前产品。",
    },
  ];
}

function buildProductDrivenAPlusSections(product, task, facts, applications, family, targetVariant) {
  const performance = joinFacts(facts, ["量程", "精度", "预设压力", "填充液", "表盘尺寸"]);
  const structure = joinFacts(facts, ["主体材质", "表壳/外壳", "压力表结构", "机芯", "波登管", "接头材质", "防护等级"]);
  const connections = joinFacts(facts, ["过程接口", "入口接口", "出口接口"]);
  const specificationCopy = [
    ...facts.map((fact) => `${fact.label}: ${fact.value}`),
    `Product Size: ${product.shippingSizeCm || "Confirm before design"}`,
    `Product Weight: ${product.productWeightG == null ? "Confirm before design" : `${product.productWeightG} g`}`,
    `Packaging: ${product.packaging || "Confirm before design"}`,
    family ? `Variant: ${targetVariant?.variantValue || family.group.variationTheme || "Confirm before design"}` : "",
  ].filter(Boolean).join("\n");
  return [
    {
      section: "核心承诺 / 品牌横幅",
      size: "1464 × 600 / 600 × 450 px",
      copy: task.copy.title,
      requirement: `产品与一个真实使用环境结合，只表达一个核心结果；场景来源：${applications || "产品资料待确认"}。为移动端保留中央安全区。`,
    },
    {
      section: "使用问题与性能证据",
      size: "1464 × 600 / 600 × 450 px",
      copy: performance || task.copy.bullets[0] || "",
      requirement: "左侧展示客户任务或使用问题，右侧用表盘、调节机构或关键部件近景给出可核验参数；不使用订单销量作为卖点。",
    },
    {
      section: "材料与结构证据",
      size: "1464 × 600 / 600 × 450 px",
      copy: structure || "材料与结构待工程确认",
      requirement: "用 2–4 个局部特写对应材料、机芯、充液或防护结构；每条标注必须能追溯到产品资料。",
    },
    {
      section: "安装、接口与应用",
      size: "1464 × 600 / 600 × 450 px",
      copy: [connections, applications].filter(Boolean).join("\n"),
      requirement: "展示安装方向、接口关系和 2–3 个适用场景；避免“适配所有”等绝对化表述，兼容范围由工程确认。",
    },
    {
      section: "规格、变体与包装",
      size: "1464 × 600 / 600 × 450 px",
      copy: specificationCopy,
      requirement: "使用整洁规格表或同系列选型对比，当前 SKU 高亮；尺寸、接口、包装清单、合规和性能声明在出图前完成工程/合规复核。",
    },
  ];
}

function extractProductFacts(product, variant) {
  const listing = product.listing || {};
  const text = [product.chineseName, product.englishName, listing.title, ...(listing.bullets || []), listing.description, product.productDescription, variant?.variantValue].filter(Boolean).join("\n");
  const facts = new Map();
  const add = (label, value) => {
    const cleaned = String(value || "").replace(/\s+/g, " ").replace(/^[,;:：\s-]+|[,;；\s]+$/g, "").trim();
    if (cleaned && !facts.has(label)) facts.set(label, cleaned.slice(0, 180));
  };
  const labeledRules = [
    ["表盘尺寸", /^(?:Dial size|Dial diameter|表盘尺寸|表径)\s*(?::|：|-)\s*(.+)$/im],
    ["过程接口", /^(?:Process connection|Thread connection|接口规格|过程连接)\s*(?::|：|-)\s*(.+)$/im],
    ["表壳/外壳", /^(?:Case|Housing|表壳|外壳)\s*(?::|：|-)\s*(.+)$/im],
    ["机芯", /^(?:Movement|Mechanism|Gear movement|机芯|传动机构)\s*(?::|：|-)\s*(.+)$/im],
    ["波登管", /^(?:Bourdon tube|Bourdon|波登管|弹簧管)\s*(?::|：|-)\s*(.+)$/im],
    ["填充液", /^(?:Filling|Fill liquid|Liquid filling|填充液|充液)\s*(?::|：|-)\s*(.+)$/im],
    ["防护等级", /^(?:IP class|IP rating|Protection class|防护等级)\s*(?::|：|-)\s*(.+)$/im],
    ["量程", /^(?:Pressure range|Measuring range|Range|量程|测量范围)\s*(?::|：|-)\s*(.+)$/im],
    ["精度", /^(?:Accuracy|Precision|精度|准确度)\s*(?::|：|-)\s*(.+)$/im],
    ["入口接口", /^(?:Inlet|入口|进水口|进口)\s*(?::|：|-)\s*(.+)$/im],
    ["出口接口", /^(?:Outlet|出口|出水口)\s*(?::|：|-)\s*(.+)$/im],
  ];
  for (const [label, pattern] of labeledRules) add(label, text.match(pattern)?.[1]);
  add("主体材质", text.match(/\b((?:forged\s+)?lead[- ]free\s+brass(?:\s+pressure\s+regulator)?\s+body)\b/i)?.[1]
    || text.match(/\b((?:304|316)?\s*(?:stainless\s+steel|brass|aluminum|copper|plastic)\s+body)\b/i)?.[1]);
  add("表壳/外壳", text.match(/\b((?:304|316)\s+stainless\s+steel\s+case)\b/i)?.[1]);
  add("压力表结构", text.match(/\b(stainless\s+steel\s+liquid\s+filled(?:\s+lead[- ]free)?\s+pressure\s+gauge)\b/i)?.[1]);
  add("填充液", text.match(/\b(glycerin(?:e)?\s+filled)\b/i)?.[1] || text.match(/\b(liquid\s+filled)\b/i)?.[1]);
  add("防护等级", text.match(/\b(IP\s*\d{2})\b/i)?.[1]);
  add("精度", text.match(/(?:accuracy|精度)\s*(?::|：)?\s*((?:\+\/-|±)?\s*[\d.\-–—]+\s*%)/i)?.[1]);
  add("预设压力", text.match(/(?:preset|set)\s+at\s+(-?\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*-?\d+(?:\.\d+)?\s*(?:psi|bar|kpa|mpa))/i)?.[1]);
  add("表盘尺寸", text.match(/\b(\d+(?:[ -]\d+\/\d+|\/\d+|\.\d+)?\s*(?:\"|''|”|inch)\s+(?:dial|dial size))\b/i)?.[1]);
  add("过程接口", text.match(/\b(\d+(?:\/\d+)?\s*(?:\"|''|”)?\s*NPT(?:\s+male|\s+female)?(?:\s+(?:lower|rear|center back|back|bottom)\s+mount|\s+(?:lower|rear|center back|back|bottom))?)\b/i)?.[1]);
  add("量程", inferMeasurementRange(text));
  add("变体规格", variant?.variantValue);
  return [...facts].map(([label, value]) => ({ label, value }));
}

function extractApplications(product, task) {
  const text = [product.listing?.title, ...(product.listing?.bullets || []), product.listing?.description, task.productName].filter(Boolean).join(" ");
  const candidates = [
    ["RV / Camper", /\b(?:RV|Camper)\b/i],
    ["Trailer", /\bTrailer\b/i],
    ["Garden / Hose", /\b(?:Garden|Hose)\b/i],
    ["Plumbing System", /\bPlumbing\b/i],
    ["Pool / Spa", /\b(?:Pool|Spa)\b/i],
    ["Air Compressor", /\bAir Compressor\b/i],
    ["Hydraulic System", /\bHydraulic\b/i],
    ["Pneumatic System", /\bPneumatic\b/i],
    ["Water System", /\bWater\b/i],
    ["Fuel / Oil", /\b(?:Fuel|Oil)\b/i],
    ["Refrigeration / HVAC", /\b(?:Refrigeration|HVAC)\b/i],
  ];
  return candidates.filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 5).join(" · ");
}

function inferMeasurementRange(text) {
  const psiValues = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*psi(?![a-z])/gi)]
    .map((match) => ({ value: Number(match[1]), text: `${match[1]}psi` }))
    .filter((item) => Number.isFinite(item.value));
  if (psiValues.length) return psiValues.sort((left, right) => right.value - left.value)[0].text;
  const explicit = text.match(/(?:pressure\s+range|measuring\s+range|range|量程|测量范围)\s*(?::|：|of)?\s*((?:-?\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*)?-?\d+(?:\.\d+)?\s*(?:psi(?:\/kpa)?|kpa|bar|mpa|inhg|mmhg|°c|°f|deg\s*[cf]))/i)?.[1];
  if (explicit) return explicit;
  return "";
}

function joinFacts(facts, labels) {
  const allowed = new Set(labels);
  return facts.filter((fact) => allowed.has(fact.label)).map((fact) => `${fact.label}: ${fact.value}`).join("\n");
}

function targetPackText(product) {
  const match = String(product.productDescription || "").match(/(\d+)\s*(?:只|个|件)?装/);
  return match ? `Pack count: ${match[1]}` : "";
}

function buildProductSheet(sheet, context) {
  sheet.showGridLines = false;
  sheet.getRange("A1:F17").format = { font: { typeface: "微软雅黑", fontSize: 10 }, verticalAlignment: "top", wrapText: true };
  sheet.getRange("A1:A17").format.columnWidthPx = 125;
  sheet.getRange("B1:F17").format.columnWidthPx = 150;
  sheet.getRange("A1:F1").merge();
  sheet.getRange("A1").values = [[`${context.sku} 产品信息与文案底稿`]];
  sheet.getRange("A1:F1").format = { fill: "#92D050", font: { typeface: "微软雅黑", fontSize: 14, bold: true }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "all", style: "thin", color: "#555555" } };
  sheet.getRange("1:1").format.rowHeightPx = 48;
  const carton = context.product.cartonDimensionsCm || {};
  const familyText = context.family ? `${context.family.group.market} · ${context.family.group.parentSku} · ${context.family.group.familyName}` : "单品";
  const rows = [
    ["SKU", context.sku],
    ["中文品名", context.product.productDescription || context.product.chineseName || context.task.productName],
    ["品类 / 变体", `${context.product.category || ""} / ${familyText}`],
    ["标题", context.task.copy.title],
    ["Listing 1", context.task.copy.bullets[0] || ""],
    ["Listing 2", context.task.copy.bullets[1] || ""],
    ["Listing 3", context.task.copy.bullets[2] || ""],
    ["Listing 4", context.task.copy.bullets[3] || ""],
    ["Listing 5", context.task.copy.bullets[4] || ""],
    ["产品描述", context.task.copy.description],
    ["产品尺寸", context.product.shippingSizeCm || "待工程确认"],
    ["产品重量", context.product.productWeightG == null ? "待工程确认" : `${context.product.productWeightG} g`],
    ["装箱信息", `${context.product.cartonQty ?? "待确认"} pcs / ${carton.length ?? "-"} × ${carton.width ?? "-"} × ${carton.height ?? "-"} cm / 毛重 ${context.product.cartonGrossWeightKg ?? "-"} kg`],
    ["包装方式", context.product.packaging || "待工程确认"],
    ["产品特性（画面依据）", context.productFacts.map((fact) => `${fact.label}: ${fact.value}`).join("\n") || "待工程补充材料、机芯、量程、精度与接口信息"],
    ["目标使用场景", context.applications || "待运营与工程确认，不从订单记录推断"],
  ];
  sheet.getRange("A2:A17").values = rows.map((row) => [row[0]]);
  for (let index = 0; index < rows.length; index += 1) {
    const row = index + 2;
    sheet.getRange(`B${row}:F${row}`).merge();
    sheet.getRange(`B${row}`).values = [[rows[index][1]]];
  }
  sheet.getRange("A2:F17").format.borders = { preset: "all", style: "thin", color: "#777777" };
  sheet.getRange("A2:A17").format = { fill: "#F8CBAD", font: { typeface: "微软雅黑", fontSize: 10, bold: true }, verticalAlignment: "center", horizontalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: "#777777" } };
  sheet.getRange("2:17").format.rowHeightPx = 46;
  sheet.getRange("5:10").format.rowHeightPx = 76;
  sheet.getRange("11:11").format.rowHeightPx = 340;
  sheet.getRange("16:17").format.rowHeightPx = 80;
  sheet.getRange("A18:F18").merge();
  sheet.getRange("A18").values = [[`生成规则：画面内容由当前 SKU 的产品事实和使用场景决定；${context.referenceTask.sku} 仅作同系列颜色、字体和构图风格参考。所有规格、接口、尺寸、兼容性和合规表述须在出图前复核。历史文件：${path.basename(context.template)}`]];
  sheet.getRange("A18:F18").format = { fill: "#FFF2CC", font: { typeface: "微软雅黑", fontSize: 9, color: "#7F6000" }, wrapText: true, verticalAlignment: "center", borders: { preset: "all", style: "thin", color: "#C9B458" } };
  sheet.getRange("18:18").format.rowHeightPx = 64;
}

function buildBriefSheet(sheet, context) {
  sheet.showGridLines = false;
  const widths = { A: 89, B: 290, C: 114, D: 316, E: 277 };
  for (const [column, width] of Object.entries(widths)) sheet.getRange(`${column}1:${column}10`).format.columnWidthPx = width;
  const heights = { 1: 77, 2: 48, 3: 37, 4: 269, 5: 288, 6: 269, 7: 269, 8: 269, 9: 269, 10: 269 };
  for (const [row, height] of Object.entries(heights)) sheet.getRange(`${row}:${row}`).format.rowHeightPx = height;
  sheet.getRange("A1:E10").format = { font: { typeface: "微软雅黑", fontSize: 10 }, borders: { preset: "all", style: "thin", color: "#555555" }, verticalAlignment: "center", wrapText: true };
  sheet.getRange("A1:E1").format = { fill: "#92D050", font: { typeface: "微软雅黑", fontSize: 10 }, borders: { preset: "all", style: "thin", color: "#555555" }, verticalAlignment: "center", wrapText: true };
  sheet.getRange("A1").values = [["参考链接"]];
  sheet.getRange("B1").values = [[context.title]];
  sheet.getRange("C1").values = [[context.family ? `父体 ${context.family.group.parentSku}` : "单品"]];
  sheet.getRange("D1").values = [[`风格参考 SKU：${context.referenceTask.sku}（不继承卖点）`]];
  sheet.getRange("E1").values = [["状态：待运营 / 工程 / 合规审核"]];
  sheet.getRange("A2:E2").values = [["", "", "", "", ""]];
  sheet.getRange("A3:E3").values = [["", "参考图片", "尺寸", "文案", "要求"]];
  sheet.getRange("A3:E3").format = { fill: "#F8CBAD", font: { typeface: "微软雅黑", fontSize: 10 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "all", style: "thin", color: "#555555" } };
  for (let index = 0; index < 7; index += 1) {
    const row = index + 4;
    const section = context.sections[index] ?? null;
    sheet.getRange(`A${row}`).values = [[section ? `${context.type}${index + 1}` : `${context.type}${index + 1}（备用）`]];
    sheet.getRange(`C${row}`).values = [[section?.size || ""]];
    sheet.getRange(`D${row}`).values = [[section?.copy || ""]];
    sheet.getRange(`E${row}`).values = [[section?.requirement || ""]];
    sheet.getRange(`A${row}`).format.horizontalAlignment = "center";
    sheet.getRange(`C${row}`).format.horizontalAlignment = "center";
    sheet.getRange(`D${row}:E${row}`).format.verticalAlignment = "center";
  }
}

function addProductImage(sheet, dataUrl) {
  sheet.images.add({ dataUrl, anchor: { from: { row: 3, col: 1, rowOffsetPx: 10, colOffsetPx: 16 }, extent: { widthPx: 245, heightPx: 245 } } });
}

async function fileDataUrl(filePath, mime) {
  const bytes = await fs.readFile(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function mimeFromPath(filePath) {
  return path.extname(filePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
}
