import { DatabaseSync } from "node:sqlite";

import type { ProductCatalogData } from "@/lib/inventory/contracts";
import { taxExcludedFromIncluded } from "@/lib/inventory/product-cost-policy";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type ProductCostValues = {
  purchaseCostRmbTaxIncluded: number | null;
  purchaseCostRmbTaxExcluded: number | null;
  purchaseCostUsd: number | null;
};

export type ProductCostOverride = ProductCostValues & {
  sku: string;
  updatedAt: string;
};

const schema = `
CREATE TABLE IF NOT EXISTS product_cost_overrides_v1 (
  sku TEXT PRIMARY KEY,
  cost_rmb_tax_included REAL,
  cost_rmb_tax_excluded REAL,
  cost_usd REAL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_cost_overrides_v1_updated
ON product_cost_overrides_v1(updated_at DESC);
`;

function openDatabase() {
  const database = new DatabaseSync(shipmentPlanDbPath());
  database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  database.exec(schema);
  return database;
}

function mapOverride(row: Record<string, unknown>): ProductCostOverride {
  return {
    sku: String(row.sku),
    purchaseCostRmbTaxIncluded: nullableNumber(row.cost_rmb_tax_included),
    purchaseCostRmbTaxExcluded: nullableNumber(row.cost_rmb_tax_excluded),
    purchaseCostUsd: nullableNumber(row.cost_usd),
    updatedAt: String(row.updated_at),
  };
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

export function listProductCostOverrides() {
  const database = openDatabase();
  try {
    return database.prepare("SELECT * FROM product_cost_overrides_v1 ORDER BY updated_at DESC, sku")
      .all()
      .map((row) => mapOverride(row as Record<string, unknown>));
  } finally {
    database.close();
  }
}

export function saveProductCostOverrides(items: Array<{ sku: string } & ProductCostValues>) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const statement = database.prepare(`
        INSERT INTO product_cost_overrides_v1(
          sku,cost_rmb_tax_included,cost_rmb_tax_excluded,cost_usd,updated_at
        ) VALUES(?,?,?,?,?)
        ON CONFLICT(sku) DO UPDATE SET
          cost_rmb_tax_included=excluded.cost_rmb_tax_included,
          cost_rmb_tax_excluded=excluded.cost_rmb_tax_excluded,
          cost_usd=excluded.cost_usd,
          updated_at=excluded.updated_at
      `);
      const updatedAt = new Date().toISOString();
      for (const item of items) {
        statement.run(
          item.sku.trim().toUpperCase(),
          item.purchaseCostRmbTaxIncluded,
          taxExcludedFromIncluded(item.purchaseCostRmbTaxIncluded, item.purchaseCostRmbTaxExcluded),
          item.purchaseCostUsd,
          updatedAt,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return listProductCostOverridesFromDatabase(database);
  } finally {
    database.close();
  }
}

export function deleteProductCostOverrides(skus: string[]) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const statement = database.prepare("DELETE FROM product_cost_overrides_v1 WHERE sku=?");
      for (const sku of skus) statement.run(sku.trim().toUpperCase());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return listProductCostOverridesFromDatabase(database);
  } finally {
    database.close();
  }
}

export function applyProductCostOverrides(data: ProductCatalogData, overrides: ProductCostOverride[]): ProductCatalogData {
  if (!overrides.length) return data;
  const bySku = new Map(overrides.map((item) => [item.sku, item] as const));
  return {
    ...data,
    items: data.items.map((item) => {
      const override = bySku.get(item.sku);
      if (!override) return item;
      return {
        ...item,
        purchaseCostRmbTaxIncluded: override.purchaseCostRmbTaxIncluded,
        purchaseCostRmbTaxExcluded: taxExcludedFromIncluded(
          override.purchaseCostRmbTaxIncluded,
          override.purchaseCostRmbTaxExcluded,
        ),
        purchaseCostUsd: override.purchaseCostUsd,
      };
    }),
  };
}

function listProductCostOverridesFromDatabase(database: DatabaseSync) {
  return database.prepare("SELECT * FROM product_cost_overrides_v1 ORDER BY updated_at DESC, sku")
    .all()
    .map((row) => mapOverride(row as Record<string, unknown>));
}
