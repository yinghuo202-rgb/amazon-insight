import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { automationRoot } from "@/lib/inventory/document-exports";

export type ShipmentPlanMarket = "US" | "CA";
export type ShipmentBatchStatus = "DRAFT" | "EXPORTED" | "ARCHIVED";

export type ShipmentPlanItem = {
  batchId: string;
  market: ShipmentPlanMarket;
  sku: string;
  quantity: number;
  suggestedQuantity: number;
  note: string;
  reason: string;
  snapshotDate: string;
  createdAt: string;
  updatedAt: string;
};

export type ShipmentPlanInput = Pick<ShipmentPlanItem, "market" | "sku" | "quantity" | "suggestedQuantity" | "note" | "reason" | "snapshotDate">;

export type ShipmentBatch = {
  id: string;
  market: ShipmentPlanMarket;
  batchNumber: string;
  shipmentDate: string;
  invoiceNumber: string;
  freightReference: string;
  shipmentId: string;
  trackingId: string;
  consignee: string;
  note: string;
  status: ShipmentBatchStatus;
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
  exportedAt: string;
};

export type ShipmentBatchPatch = Partial<Pick<ShipmentBatch, "batchNumber" | "shipmentDate" | "invoiceNumber" | "freightReference" | "shipmentId" | "trackingId" | "consignee" | "note">>;

const schema = `
CREATE TABLE IF NOT EXISTS shipment_batches_v2 (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK(market IN ('US','CA')),
  batch_number TEXT NOT NULL,
  shipment_date TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  freight_reference TEXT NOT NULL DEFAULT '',
  shipment_id TEXT NOT NULL DEFAULT '',
  tracking_id TEXT NOT NULL DEFAULT '',
  consignee TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','EXPORTED','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  exported_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS shipment_batch_items_v2 (
  batch_id TEXT NOT NULL REFERENCES shipment_batches_v2(id) ON DELETE CASCADE,
  market TEXT NOT NULL CHECK(market IN ('US','CA')),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  suggested_quantity INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  snapshot_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(batch_id, sku)
);
CREATE TABLE IF NOT EXISTS shipment_batch_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipment_batches_v2_market_status
ON shipment_batches_v2(market,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_batch_items_v2_market_sku
ON shipment_batch_items_v2(market,sku);
`;

export function shipmentPlanDbPath() {
  return process.env.STORE_OPS_STATE_DB?.trim()
    ? path.resolve(process.env.STORE_OPS_STATE_DB)
    : path.join(automationRoot(), "runtime", "db", "operations.sqlite3");
}

function openDatabase() {
  const databasePath = shipmentPlanDbPath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  database.exec(schema);
  return database;
}

function marketOf(value: unknown): ShipmentPlanMarket {
  return String(value).toUpperCase() === "CA" ? "CA" : "US";
}

function mapItem(row: Record<string, unknown>): ShipmentPlanItem {
  return {
    batchId: String(row.batch_id ?? ""),
    market: marketOf(row.market),
    sku: String(row.sku),
    quantity: Number(row.quantity),
    suggestedQuantity: Number(row.suggested_quantity ?? 0),
    note: String(row.note ?? ""),
    reason: String(row.reason ?? ""),
    snapshotDate: String(row.snapshot_date ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapBatch(row: Record<string, unknown>): ShipmentBatch {
  return {
    id: String(row.id),
    market: marketOf(row.market),
    batchNumber: String(row.batch_number),
    shipmentDate: String(row.shipment_date ?? ""),
    invoiceNumber: String(row.invoice_number ?? ""),
    freightReference: String(row.freight_reference ?? ""),
    shipmentId: String(row.shipment_id ?? ""),
    trackingId: String(row.tracking_id ?? ""),
    consignee: String(row.consignee ?? ""),
    note: String(row.note ?? ""),
    status: String(row.status) as ShipmentBatchStatus,
    itemCount: Number(row.item_count ?? 0),
    totalQuantity: Number(row.total_quantity ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    exportedAt: String(row.exported_at ?? ""),
  };
}

function normalizeInput(input: ShipmentPlanInput): ShipmentPlanInput {
  return {
    market: input.market === "CA" ? "CA" : "US",
    sku: input.sku.trim().toUpperCase(),
    quantity: Math.max(1, Math.round(input.quantity)),
    suggestedQuantity: Math.max(0, Math.round(input.suggestedQuantity)),
    note: input.note.trim(),
    reason: input.reason.trim(),
    snapshotDate: input.snapshotDate.trim(),
  };
}

function batchQuery(where = "") {
  return `SELECT b.*,
    COUNT(i.sku) AS item_count,
    COALESCE(SUM(i.quantity),0) AS total_quantity
    FROM shipment_batches_v2 b
    LEFT JOIN shipment_batch_items_v2 i ON i.batch_id=b.id
    ${where}
    GROUP BY b.id`;
}

function getBatchFromDatabase(database: DatabaseSync, batchId: string) {
  const row = database.prepare(`${batchQuery("WHERE b.id=?")}`).get(batchId) as Record<string, unknown> | undefined;
  return row ? mapBatch(row) : null;
}

function assertEditable(database: DatabaseSync, batchId: string) {
  const batch = getBatchFromDatabase(database, batchId);
  if (!batch) throw new Error("发货批次不存在。");
  if (batch.status !== "DRAFT") throw new Error("已导出或已归档批次不可编辑，请先恢复为草稿。");
  return batch;
}

function event(database: DatabaseSync, batchId: string, market: ShipmentPlanMarket, action: string, payload: unknown, sku = "") {
  database.prepare("INSERT INTO shipment_batch_events_v2(batch_id,market,sku,action,payload,created_at) VALUES(?,?,?,?,?,?)")
    .run(batchId, market, sku, action, JSON.stringify(payload), new Date().toISOString());
}

export function listShipmentBatches(market: ShipmentPlanMarket, includeArchived = true) {
  const database = openDatabase();
  try {
    const where = includeArchived ? "WHERE b.market=?" : "WHERE b.market=? AND b.status<>'ARCHIVED'";
    return database.prepare(`${batchQuery(where)} ORDER BY CASE b.status WHEN 'DRAFT' THEN 0 WHEN 'EXPORTED' THEN 1 ELSE 2 END,b.updated_at DESC`)
      .all(market).map((row) => mapBatch(row as Record<string, unknown>));
  } finally {
    database.close();
  }
}

export function getShipmentBatch(batchId: string) {
  const database = openDatabase();
  try { return getBatchFromDatabase(database, batchId); } finally { database.close(); }
}

export function createShipmentBatch(market: ShipmentPlanMarket, patch: ShipmentBatchPatch = {}) {
  const database = openDatabase();
  try {
    const now = new Date().toISOString();
    const id = randomUUID();
    const batchNumber = (patch.batchNumber || nextBatchNumberFromDatabase(database, market)).trim().toUpperCase();
    database.prepare(`INSERT INTO shipment_batches_v2(
      id,market,batch_number,shipment_date,invoice_number,freight_reference,shipment_id,tracking_id,consignee,note,status,created_at,updated_at,exported_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, market, batchNumber, patch.shipmentDate?.trim() ?? "", patch.invoiceNumber?.trim() ?? "",
      patch.freightReference?.trim() ?? "", patch.shipmentId?.trim() ?? "", patch.trackingId?.trim() ?? "",
      patch.consignee?.trim() ?? "", patch.note?.trim() ?? "", "DRAFT", now, now, "",
    );
    event(database, id, market, "CREATE_BATCH", { batchNumber });
    return getBatchFromDatabase(database, id)!;
  } finally {
    database.close();
  }
}

export function updateShipmentBatch(batchId: string, patch: ShipmentBatchPatch) {
  const database = openDatabase();
  try {
    const batch = assertEditable(database, batchId);
    const next = { ...batch, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value?.trim() ?? ""])) };
    const now = new Date().toISOString();
    database.prepare(`UPDATE shipment_batches_v2 SET batch_number=?,shipment_date=?,invoice_number=?,freight_reference=?,shipment_id=?,tracking_id=?,consignee=?,note=?,updated_at=? WHERE id=?`)
      .run(next.batchNumber.toUpperCase(), next.shipmentDate, next.invoiceNumber, next.freightReference, next.shipmentId, next.trackingId, next.consignee, next.note, now, batchId);
    event(database, batchId, batch.market, "UPDATE_BATCH", patch);
    return getBatchFromDatabase(database, batchId)!;
  } finally {
    database.close();
  }
}

export function setShipmentBatchStatus(batchId: string, status: ShipmentBatchStatus) {
  const database = openDatabase();
  try {
    const batch = getBatchFromDatabase(database, batchId);
    if (!batch) throw new Error("发货批次不存在。");
    const now = new Date().toISOString();
    database.prepare("UPDATE shipment_batches_v2 SET status=?,updated_at=?,exported_at=? WHERE id=?")
      .run(status, now, status === "EXPORTED" ? now : batch.exportedAt, batchId);
    event(database, batchId, batch.market, "STATUS", { previous: batch.status, next: status });
    return getBatchFromDatabase(database, batchId)!;
  } finally {
    database.close();
  }
}

export function deleteShipmentBatch(batchId: string) {
  const database = openDatabase();
  try {
    const batch = assertEditable(database, batchId);
    database.prepare("DELETE FROM shipment_batches_v2 WHERE id=?").run(batchId);
    event(database, batchId, batch.market, "DELETE_BATCH", { batchNumber: batch.batchNumber, itemCount: batch.itemCount });
    return true;
  } finally {
    database.close();
  }
}

export function listShipmentBatchItems(batchId: string) {
  const database = openDatabase();
  try {
    return database.prepare("SELECT * FROM shipment_batch_items_v2 WHERE batch_id=? ORDER BY updated_at DESC,sku")
      .all(batchId).map((row) => mapItem(row as Record<string, unknown>));
  } finally {
    database.close();
  }
}

export function listShipmentPlanItems(market?: ShipmentPlanMarket) {
  const database = openDatabase();
  try {
    const where = market ? "WHERE i.market=? AND b.status<>'ARCHIVED'" : "WHERE b.status<>'ARCHIVED'";
    const rows = database.prepare(`SELECT i.* FROM shipment_batch_items_v2 i JOIN shipment_batches_v2 b ON b.id=i.batch_id ${where} ORDER BY i.market,i.updated_at DESC,i.sku`)
      .all(...(market ? [market] : []));
    return rows.map((row) => mapItem(row as Record<string, unknown>));
  } finally {
    database.close();
  }
}

export function upsertShipmentBatchItem(batchId: string, rawInput: ShipmentPlanInput) {
  const input = normalizeInput(rawInput);
  const database = openDatabase();
  try {
    const batch = assertEditable(database, batchId);
    if (batch.market !== input.market) throw new Error("SKU 站点与发货批次不一致。");
    const conflict = database.prepare(`SELECT i.batch_id,b.batch_number FROM shipment_batch_items_v2 i JOIN shipment_batches_v2 b ON b.id=i.batch_id WHERE i.market=? AND i.sku=? AND i.batch_id<>? AND b.status='DRAFT'`)
      .get(input.market, input.sku, batchId) as { batch_id: string; batch_number: string } | undefined;
    if (conflict) throw new Error(`${input.sku} 已在草稿批次 ${conflict.batch_number} 中。`);
    const existing = database.prepare("SELECT * FROM shipment_batch_items_v2 WHERE batch_id=? AND sku=?").get(batchId, input.sku) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO shipment_batch_items_v2(batch_id,market,sku,quantity,suggested_quantity,note,reason,snapshot_date,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(batch_id,sku) DO UPDATE SET quantity=excluded.quantity,suggested_quantity=excluded.suggested_quantity,note=excluded.note,reason=excluded.reason,snapshot_date=excluded.snapshot_date,updated_at=excluded.updated_at`)
      .run(batchId, input.market, input.sku, input.quantity, input.suggestedQuantity, input.note, input.reason, input.snapshotDate, existing?.created_at ?? now, now);
    database.prepare("UPDATE shipment_batches_v2 SET updated_at=? WHERE id=?").run(now, batchId);
    event(database, batchId, input.market, "UPSERT_ITEM", { quantity: input.quantity, previousQuantity: existing?.quantity ?? null }, input.sku);
    return mapItem(database.prepare("SELECT * FROM shipment_batch_items_v2 WHERE batch_id=? AND sku=?").get(batchId, input.sku) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

export function removeShipmentBatchItem(batchId: string, sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  const database = openDatabase();
  try {
    const batch = assertEditable(database, batchId);
    const result = database.prepare("DELETE FROM shipment_batch_items_v2 WHERE batch_id=? AND sku=?").run(batchId, normalizedSku);
    if (!result.changes) return false;
    database.prepare("UPDATE shipment_batches_v2 SET updated_at=? WHERE id=?").run(new Date().toISOString(), batchId);
    event(database, batchId, batch.market, "REMOVE_ITEM", {}, normalizedSku);
    return true;
  } finally {
    database.close();
  }
}

export function replaceShipmentBatchItems(batchId: string, rawItems: ShipmentPlanInput[]) {
  const items = rawItems.map(normalizeInput);
  const database = openDatabase();
  try {
    const batch = assertEditable(database, batchId);
    if (items.some((item) => item.market !== batch.market)) throw new Error("SKU 站点与发货批次不一致。");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM shipment_batch_items_v2 WHERE batch_id=?").run(batchId);
      const insert = database.prepare(`INSERT INTO shipment_batch_items_v2(batch_id,market,sku,quantity,suggested_quantity,note,reason,snapshot_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
      const now = new Date().toISOString();
      for (const item of items) insert.run(batchId, batch.market, item.sku, item.quantity, item.suggestedQuantity, item.note, item.reason, item.snapshotDate, now, now);
      database.prepare("UPDATE shipment_batches_v2 SET updated_at=? WHERE id=?").run(now, batchId);
      event(database, batchId, batch.market, "REPLACE_ITEMS", { count: items.length });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return database.prepare("SELECT * FROM shipment_batch_items_v2 WHERE batch_id=? ORDER BY sku").all(batchId)
      .map((row) => mapItem(row as Record<string, unknown>));
  } finally {
    database.close();
  }
}

export function autoSplitShipmentBatches(market: ShipmentPlanMarket, rawItems: ShipmentPlanInput[], firstBatchNumber?: string, shipmentDate = "") {
  const items = rawItems.map(normalizeInput);
  if (!items.length) return [];
  const existingDraftSkus = new Set(listShipmentPlanItems(market).filter((item) => getShipmentBatch(item.batchId)?.status === "DRAFT").map((item) => item.sku));
  const uniqueItems = items.filter((item, index) => !existingDraftSkus.has(item.sku) && items.findIndex((candidate) => candidate.sku === item.sku) === index);
  if (!uniqueItems.length) return [];
  const batch = createShipmentBatch(market, {
    batchNumber: normalizeBatchNumber(firstBatchNumber || nextShipmentBatchNumber(market)),
    shipmentDate,
  });
  replaceShipmentBatchItems(batch.id, uniqueItems);
  return [getShipmentBatch(batch.id)!];
}

export function nextShipmentBatchNumber(market: ShipmentPlanMarket) {
  const database = openDatabase();
  try { return nextBatchNumberFromDatabase(database, market); } finally { database.close(); }
}

function nextBatchNumberFromDatabase(database: DatabaseSync, market: ShipmentPlanMarket) {
  const rows = database.prepare("SELECT batch_number FROM shipment_batches_v2 WHERE market=?").all(market) as Array<{ batch_number: string }>;
  const max = rows.reduce((value, row) => Math.max(value, Number(row.batch_number.match(/^CM(\d{3,4})$/)?.[1] ?? 0)), 319);
  return `CM${max + 1}`;
}

function normalizeBatchNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^CM\d{3,4}$/.test(normalized) ? normalized : "CM320";
}

// Backwards-compatible helpers used by the inventory list and older callers.
function editableBatchForMarket(market: ShipmentPlanMarket) {
  return listShipmentBatches(market, false).find((batch) => batch.status === "DRAFT") ?? createShipmentBatch(market);
}

export function upsertShipmentPlanItem(input: ShipmentPlanInput) {
  return upsertShipmentBatchItem(editableBatchForMarket(input.market).id, input);
}

export function removeShipmentPlanItem(market: ShipmentPlanMarket, sku: string) {
  const item = listShipmentPlanItems(market).find((candidate) => candidate.sku === sku && getShipmentBatch(candidate.batchId)?.status === "DRAFT");
  return item ? removeShipmentBatchItem(item.batchId, sku) : false;
}

export function replaceShipmentPlan(market: ShipmentPlanMarket, items: ShipmentPlanInput[]) {
  return replaceShipmentBatchItems(editableBatchForMarket(market).id, items);
}

export function clearShipmentPlan(market: ShipmentPlanMarket) {
  const drafts = listShipmentBatches(market, false).filter((batch) => batch.status === "DRAFT");
  let count = 0;
  for (const batch of drafts) {
    count += batch.itemCount;
    replaceShipmentBatchItems(batch.id, []);
  }
  return count;
}
