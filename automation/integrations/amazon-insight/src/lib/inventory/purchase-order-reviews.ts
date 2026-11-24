import { withOperationsDb } from "@/lib/inventory/operations-db";
import { operationsDbPath } from "@/lib/inventory/paths";

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
  return operationsDbPath();
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
  return withOperationsDb("purchase_order_review_events", schema, (database) => {
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
  });
}

export function recordPurchaseOrderReview(input: RecordPurchaseOrderReviewInput) {
  return withOperationsDb("purchase_order_review_events", schema, (database) => {
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
  });
}
