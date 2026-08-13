import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ResearchCandidate } from "@/lib/inventory/new-product-research";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

const schema = `
CREATE TABLE IF NOT EXISTS new_product_research_candidates_v1 (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amazon_price REAL,
  first_mile REAL,
  storage_fee REAL,
  commission REAL,
  order_fee REAL,
  import_duty REAL,
  purchase_cost_rmb REAL,
  gross_profit REAL,
  gross_margin REAL,
  competitor_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_new_product_research_candidates_v1_updated
ON new_product_research_candidates_v1(updated_at DESC);
`;

function openDatabase() {
  const databasePath = shipmentPlanDbPath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  database.exec(schema);
  return database;
}

export function listResearchCandidateOverrides() {
  const database = openDatabase();
  try {
    return database.prepare("SELECT * FROM new_product_research_candidates_v1 ORDER BY updated_at DESC, sku").all().map((row) => mapCandidate(row as Record<string, unknown>));
  } finally {
    database.close();
  }
}

export function saveResearchCandidate(candidate: ResearchCandidate) {
  const database = openDatabase();
  try {
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO new_product_research_candidates_v1(
        sku,name,amazon_price,first_mile,storage_fee,commission,order_fee,import_duty,
        purchase_cost_rmb,gross_profit,gross_margin,competitor_url,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(sku) DO UPDATE SET
        name=excluded.name,amazon_price=excluded.amazon_price,first_mile=excluded.first_mile,
        storage_fee=excluded.storage_fee,commission=excluded.commission,order_fee=excluded.order_fee,
        import_duty=excluded.import_duty,purchase_cost_rmb=excluded.purchase_cost_rmb,
        gross_profit=excluded.gross_profit,gross_margin=excluded.gross_margin,
        competitor_url=excluded.competitor_url,updated_at=excluded.updated_at
    `).run(
      candidate.sku, candidate.name, candidate.amazonPrice, candidate.firstMile, candidate.storageFee,
      candidate.commission, candidate.orderFee, candidate.importDutyRate, candidate.purchaseCostRmb,
      candidate.grossProfit, candidate.grossMargin, candidate.competitorUrl, now, now,
    );
    return candidate;
  } finally {
    database.close();
  }
}

function mapCandidate(row: Record<string, unknown>): ResearchCandidate {
  return {
    sku: String(row.sku),
    name: String(row.name),
    amazonPrice: nullableNumber(row.amazon_price),
    firstMile: nullableNumber(row.first_mile),
    storageFee: nullableNumber(row.storage_fee),
    commission: nullableNumber(row.commission),
    orderFee: nullableNumber(row.order_fee),
    importDutyRate: nullableNumber(row.import_duty),
    purchaseCostRmb: nullableNumber(row.purchase_cost_rmb),
    grossProfit: nullableNumber(row.gross_profit),
    grossMargin: nullableNumber(row.gross_margin),
    competitorUrl: String(row.competitor_url ?? ""),
  };
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}
