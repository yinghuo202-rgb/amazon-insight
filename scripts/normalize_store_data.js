const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.join(ROOT, "input");
const DATA_DIR = path.join(ROOT, "data");
const PRODUCT_DETAIL_FILE = path.join(INPUT_DIR, "产品明细表-一店.xlsx");
const COST_FILE = path.join(INPUT_DIR, "产品总成本计算表8.21.xlsx");

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeSku(value) {
  return cleanText(value).toUpperCase();
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s/g, "");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;

  const text = cleanText(value).replace(/,/g, "").replace(/%$/, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toBoolFlag(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const text = cleanText(value).toLowerCase();
  if (["1", "true", "yes", "y", "是", "有"].includes(text)) return true;
  if (["0", "false", "no", "n", "否", "无"].includes(text)) return false;
  return Boolean(text);
}

function readWorkbook(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing input workbook: ${file}`);
  }
  return XLSX.readFile(file, { cellDates: false, raw: true });
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing sheet "${sheetName}"`);
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false
  });
}

function headerMap(headerRow) {
  const map = new Map();
  headerRow.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function getByHeader(row, map, header) {
  const index = map.get(normalizeHeader(header));
  return index === undefined ? null : row[index];
}

const PRODUCT_RULES = [
  { terms: ["压力表"], productType: "pressure_gauge", subScenario: "pressure_measurement" },
  { terms: ["减压阀"], productType: "pressure_regulator", subScenario: "water_pressure_control" },
  { terms: ["阀门", "球阀", "阀"], productType: "valve", subScenario: "flow_control" },
  { terms: ["园艺接头", "水管接头", "接头"], productType: "connector", subScenario: "connection_fitting" },
  { terms: ["园艺水管", "花园水管", "水管"], productType: "hose", subScenario: "water_hose" },
  { terms: ["园艺", "花园"], productType: "garden_accessory", subScenario: "garden_watering" },
  { terms: ["房车", "RV"], productType: "rv_accessory", subScenario: "rv_maintenance" },
  { terms: ["拖车"], productType: "trailer_accessory", subScenario: "trailer_utility" },
  { terms: ["罩子", "保护罩", "罩"], productType: "cover", subScenario: "protection" },
  { terms: ["过滤器", "滤芯", "滤网"], productType: "filter", subScenario: "water_filtration" },
  { terms: ["防冻"], productType: "freeze_protection", subScenario: "winterization" },
  { terms: ["支架"], productType: "bracket", subScenario: "mounting_support" },
  { terms: ["挂钩"], productType: "hook", subScenario: "garage_storage" },
  { terms: ["收纳"], productType: "storage_accessory", subScenario: "organization" }
];

function inferProductProfile(titleCn, categoryCn) {
  const text = `${titleCn} ${categoryCn}`;
  for (const rule of PRODUCT_RULES) {
    const matched = rule.terms.filter(term => text.includes(term));
    if (matched.length) {
      return {
        productType: rule.productType,
        subScenario: rule.subScenario,
        keywords: buildKeywords(titleCn, categoryCn, rule.productType, rule.subScenario, matched)
      };
    }
  }

  const fallbackType = cleanText(categoryCn)
    ? cleanText(categoryCn).replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, "_").replace(/^_+|_+$/g, "")
    : "general_product";

  return {
    productType: fallbackType || "general_product",
    subScenario: "general_store_product",
    keywords: buildKeywords(titleCn, categoryCn, fallbackType || "general_product", "general_store_product", [])
  };
}

function buildKeywords(titleCn, categoryCn, productType, subScenario, matchedTerms) {
  const alphaTokens = `${titleCn} ${categoryCn}`
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
  const chineseTokens = [];
  for (const term of PRODUCT_RULES.flatMap(rule => rule.terms)) {
    if (`${titleCn} ${categoryCn}`.includes(term)) chineseTokens.push(term);
  }
  if (categoryCn) chineseTokens.push(categoryCn);
  return Array.from(new Set([
    ...matchedTerms,
    ...chineseTokens,
    ...alphaTokens,
    productType,
    subScenario
  ].filter(Boolean))).sort();
}

function inferPriceBand(price) {
  if (price === null || price === undefined) return "unknown";
  if (price < 20) return "under_20";
  if (price <= 80) return "20_80";
  return "over_80";
}

function inferProfitBand(profit, margin) {
  if (profit === null && margin === null) return "unknown";
  if (profit !== null && profit < 0) return "negative";
  if (margin !== null) {
    if (margin < 0) return "negative";
    if (margin < 0.15) return "low";
    if (margin <= 0.35) return "medium";
    return "high";
  }
  if (profit < 2) return "low";
  if (profit <= 8) return "medium";
  return "high";
}

function inferSizeRisk(grossWeightKg, cartonVolumeCbm) {
  if (grossWeightKg === null && cartonVolumeCbm === null) return "unknown";
  if ((grossWeightKg !== null && grossWeightKg > 5) || (cartonVolumeCbm !== null && cartonVolumeCbm >= 0.08)) {
    return "high";
  }
  if ((grossWeightKg !== null && grossWeightKg >= 1) || (cartonVolumeCbm !== null && cartonVolumeCbm >= 0.03)) {
    return "medium";
  }
  return "low";
}

function normalizeProductDetails(rows, report) {
  const records = [];
  for (const row of rows.slice(1)) {
    const hasAnyValue = row.some(value => value !== null && value !== undefined && value !== "");
    if (!hasAnyValue) continue;

    const sku = normalizeSku(row[5]);
    if (!sku) {
      report.missing_sku_rows += 1;
      continue;
    }

    const titleCn = cleanText(row[2]);
    const categoryCn = cleanText(row[3]);
    const profile = inferProductProfile(titleCn, categoryCn);

    records.push({
      sku,
      asin: "",
      parent_asin: "",
      title_cn: titleCn,
      amazon_title: "",
      brand: "",
      category_cn: categoryCn,
      product_type: profile.productType,
      sub_scenario: profile.subScenario,
      packaging: cleanText(row[4]),
      carton_qty: toNumber(row[6]),
      net_weight_kg: toNumber(row[7]),
      gross_weight_kg: toNumber(row[8]),
      carton_length_cm: toNumber(row[9]),
      carton_width_cm: toNumber(row[10]),
      carton_height_cm: toNumber(row[11]),
      carton_volume_cbm: toNumber(row[12]),
      product_weight_g: toNumber(row[13]),
      product_size_text: cleanText(row[14]),
      purchase_cost_rmb_tax_included: toNumber(row[15]),
      purchase_cost_rmb_ex_tax: toNumber(row[16]),
      exchange_rate: toNumber(row[18]),
      cost_usd_ex_tax: toNumber(row[19]),
      keywords: profile.keywords,
      status: "active",
      source: "product_detail_sheet"
    });
  }
  return records;
}

function normalizeUsCost(rows, report) {
  const headers = headerMap(rows[0] || []);
  const records = [];
  for (const row of rows.slice(1)) {
    const sku = normalizeSku(getByHeader(row, headers, "SKU"));
    if (!sku) {
      if (row.some(value => value !== null && value !== undefined && value !== "")) report.missing_sku_rows += 1;
      continue;
    }
    records.push({
      sku,
      marketplace: "US",
      current_price: toNumber(getByHeader(row, headers, "现价")),
      product_cost_usd: toNumber(getByHeader(row, headers, "美金价")),
      cost_usd_ex_tax: toNumber(getByHeader(row, headers, "未税价格")),
      import_tax_rate: toNumber(getByHeader(row, headers, "进口税率")),
      import_tax: toNumber(getByHeader(row, headers, "进口税")),
      product_length_cm: toNumber(getByHeader(row, headers, "尺寸cm：长")),
      product_width_cm: toNumber(getByHeader(row, headers, "尺寸cm：宽")),
      product_height_cm: toNumber(getByHeader(row, headers, "尺寸cm：高")),
      gross_weight_kg: toNumber(getByHeader(row, headers, "毛重(kg)")),
      product_volume_cbm: toNumber(getByHeader(row, headers, "产品体积（m³）")),
      carton_qty: toNumber(getByHeader(row, headers, "装箱数")),
      carton_volume_cbm: toNumber(getByHeader(row, headers, "外箱体积（m³）")),
      inbound_fba_shipping_cost: toNumber(getByHeader(row, headers, "海运入FBA仓成本")),
      fba_storage_fee: toNumber(getByHeader(row, headers, "FBA仓储费")),
      fulfillment_fee: toNumber(getByHeader(row, headers, "订单处理费")),
      referral_fee_rate: toNumber(getByHeader(row, headers, "佣金比例")),
      referral_fee: toNumber(getByHeader(row, headers, "佣金")),
      estimated_profit: toNumber(getByHeader(row, headers, "利润")),
      estimated_profit_margin: toNumber(getByHeader(row, headers, "利润率")),
      cost_note: cleanText(getByHeader(row, headers, "备注")),
      competitor_asin: cleanText(getByHeader(row, headers, "竞品ASIN"))
    });
  }
  return records;
}

function normalizeCaCost(rows, report) {
  const headers = headerMap(rows[0] || []);
  const records = [];
  for (const row of rows.slice(1)) {
    const sku = normalizeSku(getByHeader(row, headers, "SKU"));
    if (!sku) {
      if (row.some(value => value !== null && value !== undefined && value !== "")) report.missing_sku_rows += 1;
      continue;
    }
    records.push({
      sku,
      marketplace: "CA",
      current_price: toNumber(getByHeader(row, headers, "现价")),
      us_price_reference: toNumber(getByHeader(row, headers, "美国售价")),
      fob_cost_usd: toNumber(getByHeader(row, headers, "FOB价")),
      carton_qty: toNumber(getByHeader(row, headers, "装箱数")),
      carton_volume_cbm: toNumber(getByHeader(row, headers, "外箱体积（m³）")),
      inbound_fba_shipping_cost: toNumber(getByHeader(row, headers, "海运入FBA仓成本")),
      landed_cost: toNumber(getByHeader(row, headers, "FOB+头程")),
      fulfillment_fee: toNumber(getByHeader(row, headers, "订单处理费")),
      referral_fee_rate: toNumber(getByHeader(row, headers, "佣金比例")),
      referral_fee: toNumber(getByHeader(row, headers, "佣金")),
      estimated_profit: toNumber(getByHeader(row, headers, "利润")),
      estimated_profit_margin: toNumber(getByHeader(row, headers, "利润率")),
      cost_note: cleanText(getByHeader(row, headers, "备注")),
      competitor_asin: cleanText(getByHeader(row, headers, "竞品ASIN")),
      slow_moving_flag: toBoolFlag(getByHeader(row, headers, "是否是滞销品"))
    });
  }
  return records;
}

function normalizeSalesSnapshot(rows, report) {
  const headers = headerMap(rows[0] || []);
  const records = [];
  for (const row of rows.slice(1)) {
    const sku = normalizeSku(getByHeader(row, headers, "MSKU"));
    if (!sku) {
      if (row.some(value => value !== null && value !== undefined && value !== "")) report.missing_sku_rows += 1;
      continue;
    }
    records.push({
      sku,
      current_price: toNumber(getByHeader(row, headers, "售价")),
      prime_discount_price: toNumber(getByHeader(row, headers, "Prime折扣价")),
      promo_profit: toNumber(getByHeader(row, headers, "利润")),
      promo_margin: toNumber(getByHeader(row, headers, "毛利率")),
      inventory_units: toNumber(getByHeader(row, headers, "库存")),
      monthly_sales_units: toNumber(getByHeader(row, headers, "月销")),
      prime_flag: toBoolFlag(getByHeader(row, headers, "prime"))
    });
  }
  return records;
}

function toSkuMap(records) {
  const map = new Map();
  for (const record of records) {
    if (record.sku && !map.has(record.sku)) map.set(record.sku, record);
  }
  return map;
}

function mergeProfiles(products, usCosts, salesSnapshots) {
  const usBySku = toSkuMap(usCosts);
  const salesBySku = toSkuMap(salesSnapshots);

  return products.map(product => {
    const us = usBySku.get(product.sku) || {};
    const sales = salesBySku.get(product.sku) || {};
    const currentPrice = us.current_price ?? sales.current_price ?? null;
    const grossWeight = us.gross_weight_kg ?? product.gross_weight_kg ?? null;
    const cartonVolume = us.carton_volume_cbm ?? product.carton_volume_cbm ?? null;

    return {
      sku: product.sku,
      asin: product.asin,
      parent_asin: product.parent_asin,
      title_cn: product.title_cn,
      amazon_title: product.amazon_title,
      brand: product.brand,
      category_cn: product.category_cn,
      product_type: product.product_type,
      sub_scenario: product.sub_scenario,
      current_price_usd: currentPrice,
      cost_usd: us.product_cost_usd ?? product.cost_usd_ex_tax ?? null,
      estimated_profit_usd: us.estimated_profit ?? null,
      estimated_profit_margin: us.estimated_profit_margin ?? null,
      monthly_sales_units: sales.monthly_sales_units ?? null,
      inventory_units: sales.inventory_units ?? null,
      product_weight_g: product.product_weight_g,
      gross_weight_kg: grossWeight,
      carton_volume_cbm: cartonVolume,
      packaging: product.packaging,
      competitor_asin: us.competitor_asin ?? "",
      keywords: product.keywords,
      price_band: inferPriceBand(currentPrice),
      profit_band: inferProfitBand(us.estimated_profit ?? null, us.estimated_profit_margin ?? null),
      size_risk: inferSizeRisk(grossWeight, cartonVolume),
      store_existing_product: true
    };
  });
}

function missingCount(records, field) {
  return records.filter(record => record[field] === null || record[field] === undefined || record[field] === "").length;
}

function uniqueSkus(records) {
  return new Set(records.map(record => record.sku).filter(Boolean));
}

function sortedDifference(leftSet, rightSet) {
  return Array.from(leftSet).filter(sku => !rightSet.has(sku)).sort();
}

function writeJson(fileName, payload) {
  fs.writeFileSync(path.join(DATA_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const report = {
    generated_at: new Date().toISOString(),
    product_detail_source: path.relative(ROOT, PRODUCT_DETAIL_FILE),
    cost_source: path.relative(ROOT, COST_FILE),
    total_rows_product_detail_sheet: 0,
    total_normalized_store_products: 0,
    total_us_cost_rows: 0,
    total_ca_cost_rows: 0,
    total_sales_snapshot_rows: 0,
    matched_store_us_cost_count: 0,
    matched_store_sales_count: 0,
    unmatched_skus_from_us_cost: [],
    unmatched_skus_from_sales_snapshot: [],
    product_skus_missing_us_cost: [],
    product_skus_missing_sales_snapshot: [],
    missing_sku_rows: 0,
    missing_price_count: 0,
    missing_profit_count: 0,
    missing_title_count: 0
  };

  const productWorkbook = readWorkbook(PRODUCT_DETAIL_FILE);
  const costWorkbook = readWorkbook(COST_FILE);

  const productRows = sheetRows(productWorkbook, "一店");
  const usRows = sheetRows(costWorkbook, "美国");
  const caRows = sheetRows(costWorkbook, "加拿大");
  const salesRows = sheetRows(costWorkbook, "Sheet1");

  report.total_rows_product_detail_sheet = Math.max(productRows.length - 1, 0);

  const storeProducts = normalizeProductDetails(productRows, report);
  const usCostProfile = normalizeUsCost(usRows, report);
  const caCostProfile = normalizeCaCost(caRows, report);
  const salesSnapshot = normalizeSalesSnapshot(salesRows, report);
  const mergedProfile = mergeProfiles(storeProducts, usCostProfile, salesSnapshot);

  const productSkus = uniqueSkus(storeProducts);
  const usSkus = uniqueSkus(usCostProfile);
  const salesSkus = uniqueSkus(salesSnapshot);

  report.total_normalized_store_products = storeProducts.length;
  report.total_us_cost_rows = usCostProfile.length;
  report.total_ca_cost_rows = caCostProfile.length;
  report.total_sales_snapshot_rows = salesSnapshot.length;
  report.matched_store_us_cost_count = storeProducts.filter(record => usSkus.has(record.sku)).length;
  report.matched_store_sales_count = storeProducts.filter(record => salesSkus.has(record.sku)).length;
  report.unmatched_skus_from_us_cost = sortedDifference(usSkus, productSkus);
  report.unmatched_skus_from_sales_snapshot = sortedDifference(salesSkus, productSkus);
  report.product_skus_missing_us_cost = sortedDifference(productSkus, usSkus);
  report.product_skus_missing_sales_snapshot = sortedDifference(productSkus, salesSkus);
  report.missing_price_count = missingCount(mergedProfile, "current_price_usd");
  report.missing_profit_count = missingCount(mergedProfile, "estimated_profit_usd");
  report.missing_title_count = missingCount(storeProducts, "title_cn");

  writeJson("store_products.json", storeProducts);
  writeJson("store_cost_profile_us.json", usCostProfile);
  writeJson("store_cost_profile_ca.json", caCostProfile);
  writeJson("store_sales_snapshot.json", salesSnapshot);
  writeJson("store_product_profile_merged.json", mergedProfile);
  writeJson("store_data_report.json", report);

  console.log(JSON.stringify(report, null, 2));
}

main();
