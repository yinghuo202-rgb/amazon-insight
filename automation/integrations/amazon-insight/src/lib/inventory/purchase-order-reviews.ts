import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimePath } from "@/lib/inventory/paths";

export type PurchaseOrderReviewAction = "cancel" | "restore";

export type PurchaseOrderReview = {
  id: number;
  sku: string;
  poNumber: string;
  poDate: string;
  market: "US" | "CA";
  factory: string;
  remainingQuantity: number;
  action: PurchaseOrderReviewAction;
  reason: string;
  reviewer: string;
  createdAt: string;
};

export type RecordPurchaseOrderReviewInput = Omit<PurchaseOrderReview, "id" | "createdAt">;

const schema = `
CREATE TABLE IF NOT EXISTS purchase_order_review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  po_number TEXT NOT NULL,
  po_date TEXT NOT NULL,
  market TEXT NOT NULL,
  factory TEXT NOT NULL DEFAULT '',
  remaining_quantity INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL CHECK(action IN ('cancel', 'restore')),
  reason TEXT NOT NULL,
  reviewer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_review_key
ON purchase_order_review_events(sku,po_number,po_date,id DESC);
`;

export function purchaseOrderReviewDbPath() {
  return process.env.STORE_OPS_STATE_DB?.trim()
    ? path.resolve(process.env.STORE_OPS_STATE_DB)
    : runtimePath("db", "operations.sqlite3");
}

function openDatabase() {
  const databasePath = purchaseOrderReviewDbPath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  database.exec(schema);
  return database;
}

function mapReview(row: Record<string, unknown>): PurchaseOrderReview {
  return {
    id: Number(row.id),
    sku: String(row.sku),
    poNumber: String(row.po_number),
    poDate: String(row.po_date),
    market: String(row.market).toUpperCase() === "CA" ? "CA" : "US",
    factory: String(row.factory ?? ""),
    remainingQuantity: Number(row.remaining_quantity ?? 0),
    action: row.action === "restore" ? "restore" : "cancel",
    reason: String(row.reason),
    reviewer: String(row.reviewer ?? ""),
    createdAt: String(row.created_at),
  };
}

export function purchaseOrderReviewKey(value: Pick<PurchaseOrderReview, "sku" | "poNumber" | "poDate">) {
  return `${value.sku.toUpperCase()}\u0000${value.poNumber.trim()}\u0000${value.poDate}`;
}

export function listLatestPurchaseOrderReviews(options: { sku?: string; action?: PurchaseOrderReviewAction } = {}) {
  const database = openDatabase();
  try {
    const rows = database.prepare(`
      SELECT id,sku,po_number,po_date,market,factory,remaining_quantity,action,reason,reviewer,created_at
      FROM purchase_order_review_events
      ORDER BY id DESC
    `).all();
    const latest = new Map<string, PurchaseOrderReview>();
    for (const row of rows) {
      const review = mapReview(row);
      const key = purchaseOrderReviewKey(review);
      if (!latest.has(key)) latest.set(key, review);
    }
    return [...latest.values()].filter((review) =>
      (!options.sku || review.sku === options.sku.toUpperCase()) &&
      (!options.action || review.action === options.action)
    );
  } finally {
    database.close();
  }
}

export function recordPurchaseOrderReview(input: RecordPurchaseOrderReviewInput) {
  const database = openDatabase();
  try {
    const createdAt = new Date().toISOString();
    const result = database.prepare(`
      INSERT INTO purchase_order_review_events(
        sku,po_number,po_date,market,factory,remaining_quantity,action,reason,reviewer,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      input.sku.toUpperCase(),
      input.poNumber.trim(),
      input.poDate,
      input.market,
      input.factory.trim(),
      Math.max(0, Math.round(input.remainingQuantity)),
      input.action,
      input.reason.trim(),
      input.reviewer.trim(),
      createdAt,
    );
    return { ...input, id: Number(result.lastInsertRowid), createdAt } satisfies PurchaseOrderReview;
  } finally {
    database.close();
  }
}
