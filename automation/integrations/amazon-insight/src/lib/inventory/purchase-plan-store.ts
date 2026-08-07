import { DatabaseSync } from "node:sqlite";

import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type PurchasePlanDraftItem = {
  cycleDate: string;
  sku: string;
  quantity: number;
  suggestedQuantity: number;
  note: string;
  updatedAt: string;
};
export type PurchasePlanCycleStatus = "DRAFT" | "REVIEWED" | "LOCKED" | "ORDERED";
export type PurchasePlanCycle = { cycleDate: string; status: PurchasePlanCycleStatus; version: number; updatedAt: string | null };

const schema = `
CREATE TABLE IF NOT EXISTS purchase_plan_items_v1 (
  cycle_date TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  suggested_quantity INTEGER NOT NULL CHECK(suggested_quantity >= 0),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(cycle_date, sku)
);
CREATE INDEX IF NOT EXISTS idx_purchase_plan_items_v1_cycle
ON purchase_plan_items_v1(cycle_date,updated_at DESC);
CREATE TABLE IF NOT EXISTS purchase_plan_cycles_v1 (
  cycle_date TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'DRAFT', version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_plan_events_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_date TEXT NOT NULL, action TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
  version INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

function openDatabase() {
  const database = new DatabaseSync(shipmentPlanDbPath());
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  database.exec(schema);
  return database;
}

function mapItem(row: Record<string, unknown>): PurchasePlanDraftItem {
  return {
    cycleDate: String(row.cycle_date),
    sku: String(row.sku),
    quantity: Number(row.quantity),
    suggestedQuantity: Number(row.suggested_quantity),
    note: String(row.note ?? ""),
    updatedAt: String(row.updated_at),
  };
}

export function listPurchasePlanDraft(cycleDate: string) {
  const database = openDatabase();
  try {
    return database.prepare("SELECT * FROM purchase_plan_items_v1 WHERE cycle_date=? ORDER BY quantity DESC,sku")
      .all(cycleDate).map((row) => mapItem(row as Record<string, unknown>));
  } finally { database.close(); }
}

export function getPurchasePlanCycle(cycleDate: string): PurchasePlanCycle {
  const database = openDatabase();
  try { return getCycleFromDatabase(database, cycleDate); } finally { database.close(); }
}

export function replacePurchasePlanDraft(cycleDate: string, items: Array<Omit<PurchasePlanDraftItem, "cycleDate" | "updatedAt">>) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const cycle = getCycleFromDatabase(database, cycleDate);
      if (cycle.status !== "DRAFT") throw new Error("采购计划当前不是草稿状态，请先重新打开后再修改。");
      database.prepare("DELETE FROM purchase_plan_items_v1 WHERE cycle_date=?").run(cycleDate);
      const insert = database.prepare("INSERT INTO purchase_plan_items_v1(cycle_date,sku,quantity,suggested_quantity,note,updated_at) VALUES(?,?,?,?,?,?)");
      const now = new Date().toISOString();
      for (const item of items) insert.run(cycleDate, item.sku.trim().toUpperCase(), Math.max(0, Math.round(item.quantity)), Math.max(0, Math.round(item.suggestedQuantity)), item.note.trim(), now);
      const version = cycle.version + 1;
      database.prepare("INSERT INTO purchase_plan_cycles_v1(cycle_date,status,version,updated_at) VALUES(?,?,?,?) ON CONFLICT(cycle_date) DO UPDATE SET status='DRAFT',version=excluded.version,updated_at=excluded.updated_at").run(cycleDate, "DRAFT", version, now);
      addEvent(database, cycleDate, "SAVE", "DRAFT", "DRAFT", version, { itemCount: items.length });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return database.prepare("SELECT * FROM purchase_plan_items_v1 WHERE cycle_date=? ORDER BY quantity DESC,sku")
      .all(cycleDate).map((row) => mapItem(row as Record<string, unknown>));
  } finally { database.close(); }
}

export function transitionPurchasePlanCycle(cycleDate: string, action: "review" | "lock" | "reopen" | "ordered") {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const cycle = getCycleFromDatabase(database, cycleDate);
      const itemCount = Number((database.prepare("SELECT COUNT(*) AS count FROM purchase_plan_items_v1 WHERE cycle_date=?").get(cycleDate) as Record<string, unknown>).count);
      if (!itemCount) throw new Error("当前采购计划没有已保存的 SKU，不能流转状态。");
      const transitions: Record<typeof action, { from: PurchasePlanCycleStatus[]; to: PurchasePlanCycleStatus }> = {
        review: { from: ["DRAFT"], to: "REVIEWED" }, lock: { from: ["REVIEWED"], to: "LOCKED" }, reopen: { from: ["REVIEWED", "LOCKED"], to: "DRAFT" }, ordered: { from: ["LOCKED"], to: "ORDERED" },
      };
      const transition = transitions[action];
      if (!transition.from.includes(cycle.status)) throw new Error(`当前状态 ${cycle.status} 不能执行 ${action}。`);
      const now = new Date().toISOString();
      database.prepare("UPDATE purchase_plan_cycles_v1 SET status=?,updated_at=? WHERE cycle_date=?").run(transition.to, now, cycleDate);
      addEvent(database, cycleDate, action.toUpperCase(), cycle.status, transition.to, cycle.version, { itemCount });
      database.exec("COMMIT");
      return getCycleFromDatabase(database, cycleDate);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } finally { database.close(); }
}

function getCycleFromDatabase(database: DatabaseSync, cycleDate: string): PurchasePlanCycle {
  const row = database.prepare("SELECT status,version,updated_at FROM purchase_plan_cycles_v1 WHERE cycle_date=?").get(cycleDate) as Record<string, unknown> | undefined;
  return { cycleDate, status: String(row?.status ?? "DRAFT") as PurchasePlanCycleStatus, version: Number(row?.version ?? 0), updatedAt: row?.updated_at ? String(row.updated_at) : null };
}
function addEvent(database: DatabaseSync, cycleDate: string, action: string, from: string, to: string, version: number, payload: unknown) { database.prepare("INSERT INTO purchase_plan_events_v1(cycle_date,action,from_status,to_status,version,payload_json,created_at) VALUES(?,?,?,?,?,?,?)").run(cycleDate, action, from, to, version, JSON.stringify(payload), new Date().toISOString()); }
