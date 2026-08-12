import { DatabaseSync } from "node:sqlite";

import { calculateInventoryDecision, roundUpToPack } from "@/lib/inventory/calculator";
import type { InventoryDashboardData, ProductCatalogData, PurchasePlanData } from "@/lib/inventory/contracts";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type ProductMasterValues = {
  chineseName: string;
  englishName: string;
  category: string;
  packaging: string;
  cartonQty: number | null;
  productWeightG: number | null;
  shippingSizeCm: string;
  cartonGrossWeightKg: number | null;
  cartonLengthCm: number | null;
  cartonWidthCm: number | null;
  cartonHeightCm: number | null;
};

export type ProductMasterOverride = ProductMasterValues & { sku: string; updatedAt: string };
export type InventoryValues = {
  fbaSellable: number;
  awdAvailable: number;
  awdOutboundToFba: number;
  awdInbound: number;
  localInventory: number;
};
export type InventoryOverride = Omit<InventoryValues, "localInventory"> & { market: "US" | "CA"; sku: string; updatedAt: string };
export type DomesticInventoryOverride = { sku: string; localInventory: number; updatedAt: string };
export type OperationalDataOverrides = {
  products: ProductMasterOverride[];
  inventories: InventoryOverride[];
  domesticInventories: DomesticInventoryOverride[];
};

const schema = `
CREATE TABLE IF NOT EXISTS product_master_overrides_v1 (
  sku TEXT PRIMARY KEY,
  chinese_name TEXT NOT NULL,
  english_name TEXT NOT NULL,
  category TEXT NOT NULL,
  packaging TEXT NOT NULL,
  carton_qty INTEGER,
  product_weight_g REAL,
  shipping_size_cm TEXT NOT NULL,
  carton_gross_weight_kg REAL,
  carton_length_cm REAL,
  carton_width_cm REAL,
  carton_height_cm REAL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_overrides_v1 (
  market TEXT NOT NULL CHECK(market IN ('US','CA')),
  sku TEXT NOT NULL,
  fba_sellable INTEGER NOT NULL CHECK(fba_sellable >= 0),
  awd_available INTEGER NOT NULL CHECK(awd_available >= 0),
  awd_outbound_to_fba INTEGER NOT NULL CHECK(awd_outbound_to_fba >= 0),
  awd_inbound INTEGER NOT NULL CHECK(awd_inbound >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(market,sku)
);
CREATE TABLE IF NOT EXISTS domestic_inventory_overrides_v1 (
  sku TEXT PRIMARY KEY,
  local_inventory INTEGER NOT NULL CHECK(local_inventory >= 0),
  updated_at TEXT NOT NULL
);
`;

function openDatabase() {
  const database = new DatabaseSync(shipmentPlanDbPath());
  database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  database.exec(schema);
  return database;
}

export function listOperationalDataOverrides(): OperationalDataOverrides {
  const database = openDatabase();
  try {
    return {
      products: database.prepare("SELECT * FROM product_master_overrides_v1 ORDER BY updated_at DESC,sku").all().map((row) => mapProduct(row as Record<string, unknown>)),
      inventories: database.prepare("SELECT * FROM inventory_overrides_v1 ORDER BY updated_at DESC,market,sku").all().map((row) => mapInventory(row as Record<string, unknown>)),
      domesticInventories: database.prepare("SELECT * FROM domestic_inventory_overrides_v1 ORDER BY updated_at DESC,sku").all().map((row) => mapDomestic(row as Record<string, unknown>)),
    };
  } finally {
    database.close();
  }
}

export function saveProductMasterOverrides(items: Array<{ sku: string } & ProductMasterValues>) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const statement = database.prepare(`
        INSERT INTO product_master_overrides_v1(
          sku,chinese_name,english_name,category,packaging,carton_qty,product_weight_g,shipping_size_cm,
          carton_gross_weight_kg,carton_length_cm,carton_width_cm,carton_height_cm,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sku) DO UPDATE SET
          chinese_name=excluded.chinese_name,english_name=excluded.english_name,category=excluded.category,
          packaging=excluded.packaging,carton_qty=excluded.carton_qty,product_weight_g=excluded.product_weight_g,
          shipping_size_cm=excluded.shipping_size_cm,carton_gross_weight_kg=excluded.carton_gross_weight_kg,
          carton_length_cm=excluded.carton_length_cm,carton_width_cm=excluded.carton_width_cm,
          carton_height_cm=excluded.carton_height_cm,updated_at=excluded.updated_at
      `);
      const now = new Date().toISOString();
      for (const item of items) statement.run(item.sku.trim().toUpperCase(), item.chineseName.trim(), item.englishName.trim(), item.category.trim(), item.packaging.trim(), item.cartonQty, item.productWeightG, item.shippingSizeCm.trim(), item.cartonGrossWeightKg, item.cartonLengthCm, item.cartonWidthCm, item.cartonHeightCm, now);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } finally { database.close(); }
  return listOperationalDataOverrides();
}

export function saveInventoryOverrides(items: Array<{ market: "US" | "CA"; sku: string } & InventoryValues>) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const inventory = database.prepare(`
        INSERT INTO inventory_overrides_v1(market,sku,fba_sellable,awd_available,awd_outbound_to_fba,awd_inbound,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(market,sku) DO UPDATE SET fba_sellable=excluded.fba_sellable,awd_available=excluded.awd_available,
          awd_outbound_to_fba=excluded.awd_outbound_to_fba,awd_inbound=excluded.awd_inbound,updated_at=excluded.updated_at
      `);
      const domestic = database.prepare(`
        INSERT INTO domestic_inventory_overrides_v1(sku,local_inventory,updated_at) VALUES(?,?,?)
        ON CONFLICT(sku) DO UPDATE SET local_inventory=excluded.local_inventory,updated_at=excluded.updated_at
      `);
      const now = new Date().toISOString();
      for (const item of items) {
        const sku = item.sku.trim().toUpperCase();
        inventory.run(item.market, sku, item.fbaSellable, item.awdAvailable, item.awdOutboundToFba, item.awdInbound, now);
        domestic.run(sku, item.localInventory, now);
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } finally { database.close(); }
  return listOperationalDataOverrides();
}

export function deleteOperationalDataOverrides(entity: "product" | "inventory", keys: Array<{ sku: string; market?: "US" | "CA" }>) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (entity === "product") {
        const statement = database.prepare("DELETE FROM product_master_overrides_v1 WHERE sku=?");
        for (const key of keys) statement.run(key.sku.trim().toUpperCase());
      } else {
        const inventory = database.prepare("DELETE FROM inventory_overrides_v1 WHERE market=? AND sku=?");
        const domestic = database.prepare("DELETE FROM domestic_inventory_overrides_v1 WHERE sku=?");
        for (const key of keys) {
          inventory.run(key.market ?? "US", key.sku.trim().toUpperCase());
          domestic.run(key.sku.trim().toUpperCase());
        }
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } finally { database.close(); }
  return listOperationalDataOverrides();
}

export function applyProductMasterOverrides(data: ProductCatalogData, overrides: ProductMasterOverride[]): ProductCatalogData {
  const bySku = new Map(overrides.map((item) => [item.sku, item] as const));
  return {
    ...data,
    items: data.items.map((item) => {
      const value = bySku.get(item.sku);
      return value ? {
        ...item,
        chineseName: value.chineseName,
        englishName: value.englishName,
        category: value.category,
        packaging: value.packaging,
        cartonQty: value.cartonQty,
        productWeightG: value.productWeightG,
        shippingSizeCm: value.shippingSizeCm,
        cartonGrossWeightKg: value.cartonGrossWeightKg,
        cartonDimensionsCm: { length: value.cartonLengthCm, width: value.cartonWidthCm, height: value.cartonHeightCm },
      } : item;
    }),
  };
}

export function applyInventoryOverrides(
  data: InventoryDashboardData,
  overrides: OperationalDataOverrides,
): InventoryDashboardData {
  const market = data.market === "CA" ? "CA" : "US";
  const inventoryBySku = new Map(overrides.inventories.filter((item) => item.market === market).map((item) => [item.sku, item] as const));
  const domesticBySku = new Map(overrides.domesticInventories.map((item) => [item.sku, item.localInventory] as const));
  const productBySku = new Map(overrides.products.map((item) => [item.sku, item] as const));
  const rows = data.rows.map((row) => {
    const inventory = inventoryBySku.get(row.sku);
    const localInventory = domesticBySku.get(row.sku) ?? row.localInventory;
    const product = productBySku.get(row.sku);
    const base = {
      ...row,
      productName: product?.chineseName || row.productName,
      cartonQty: product ? product.cartonQty : row.cartonQty,
      fbaSellable: inventory?.fbaSellable ?? row.fbaSellable,
      awdAvailable: inventory?.awdAvailable ?? row.awdAvailable,
      awdOutboundToFba: inventory?.awdOutboundToFba ?? row.awdOutboundToFba,
      awdInbound: inventory?.awdInbound ?? row.awdInbound,
      localInventory,
      domesticSupplyTotal: localInventory + row.pendingOrderQty,
    };
    const decision = calculateInventoryDecision(base, data.parameters);
    return {
      ...base,
      ...decision,
      readyToShipQty: Math.min(localInventory, decision.suggestedShipmentQty),
      suggestedProductionQty: Math.max(0, decision.suggestedShipmentQty - base.domesticSupplyTotal),
    };
  });
  return { ...data, rows, summary: recalculateInventorySummary(data, rows) };
}

export function applyPurchasePlanOverrides(data: PurchasePlanData, us: InventoryDashboardData, ca: InventoryDashboardData, productOverrides: ProductMasterOverride[]): PurchasePlanData {
  const usBySku = new Map(us.rows.map((item) => [item.sku, item] as const));
  const caBySku = new Map(ca.rows.map((item) => [item.sku, item] as const));
  const productBySku = new Map(productOverrides.map((item) => [item.sku, item] as const));
  const rows = data.rows.map((row) => {
    const usRow = usBySku.get(row.sku);
    const caRow = caBySku.get(row.sku);
    const product = productBySku.get(row.sku);
    const cartonQty = product?.cartonQty ?? row.cartonQty;
    const usNetworkInventory = usRow?.eligibleInventoryPosition ?? row.usNetworkInventory;
    const caNetworkInventory = caRow?.eligibleInventoryPosition ?? row.caNetworkInventory;
    const localInventory = usRow?.localInventory ?? caRow?.localInventory ?? row.localInventory;
    const inventoryPosition = usNetworkInventory + caNetworkInventory + localInventory + row.pendingOrderQty;
    const projectedDemand = Math.ceil(row.combinedDailySales * data.parameters.demandHorizonDays);
    const suggestedPurchaseQty = roundUpToPack(Math.max(0, projectedDemand - inventoryPosition), cartonQty);
    const coverageDays = row.combinedDailySales > 0 ? inventoryPosition / row.combinedDailySales : null;
    return {
      ...row,
      productName: product?.chineseName || row.productName,
      cartonQty: cartonQty ?? row.cartonQty,
      usNetworkInventory,
      caNetworkInventory,
      localInventory,
      inventoryPosition,
      projectedDemand,
      coverageDays,
      suggestedPurchaseQty,
      riskLevel: coverageDays === null ? "data" as const : coverageDays < 75 ? "critical" as const : coverageDays < 120 ? "watch" as const : "healthy" as const,
    };
  });
  return {
    ...data,
    rows,
    summary: {
      ...data.summary,
      nextCycleSkuCount: rows.filter((row) => row.suggestedPurchaseQty > 0).length,
      nextCycleQuantity: rows.reduce((sum, row) => sum + row.suggestedPurchaseQty, 0),
      criticalSkuCount: rows.filter((row) => row.riskLevel === "critical").length,
    },
  };
}

function recalculateInventorySummary(data: InventoryDashboardData, rows: InventoryDashboardData["rows"]) {
  return {
    ...data.summary,
    skuCount: rows.length,
    fbaSellable: sum(rows, "fbaSellable"),
    awdAvailable: sum(rows, "awdAvailable"),
    awdOutboundToFba: sum(rows, "awdOutboundToFba"),
    awdInboundNotCounted: sum(rows, "awdInbound"),
    localInventory: sum(rows, "localInventory"),
    pendingOrderQty: sum(rows, "pendingOrderQty"),
    readyToShipQty: sum(rows, "readyToShipQty"),
    suggestedProductionQty: sum(rows, "suggestedProductionQty"),
    criticalSkuCount: rows.filter((row) => row.riskLevel === "critical").length,
    reviewSkuCount: rows.filter((row) => row.riskLevel === "watch" || row.riskLevel === "data").length,
    suggestedShipmentQty: sum(rows, "suggestedShipmentQty"),
  };
}

function sum(rows: InventoryDashboardData["rows"], key: keyof InventoryDashboardData["rows"][number]) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function mapProduct(row: Record<string, unknown>): ProductMasterOverride {
  return {
    sku: String(row.sku), chineseName: String(row.chinese_name), englishName: String(row.english_name),
    category: String(row.category), packaging: String(row.packaging), cartonQty: nullable(row.carton_qty),
    productWeightG: nullable(row.product_weight_g), shippingSizeCm: String(row.shipping_size_cm),
    cartonGrossWeightKg: nullable(row.carton_gross_weight_kg), cartonLengthCm: nullable(row.carton_length_cm),
    cartonWidthCm: nullable(row.carton_width_cm), cartonHeightCm: nullable(row.carton_height_cm), updatedAt: String(row.updated_at),
  };
}
function mapInventory(row: Record<string, unknown>): InventoryOverride {
  return {
    market: String(row.market) === "CA" ? "CA" : "US", sku: String(row.sku), fbaSellable: Number(row.fba_sellable),
    awdAvailable: Number(row.awd_available), awdOutboundToFba: Number(row.awd_outbound_to_fba),
    awdInbound: Number(row.awd_inbound), updatedAt: String(row.updated_at),
  };
}
function mapDomestic(row: Record<string, unknown>): DomesticInventoryOverride {
  return { sku: String(row.sku), localInventory: Number(row.local_inventory), updatedAt: String(row.updated_at) };
}
function nullable(value: unknown) { return value === null || value === undefined ? null : Number(value); }
