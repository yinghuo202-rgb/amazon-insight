import { DatabaseSync } from "node:sqlite";

import type { AdvertisingAction } from "@/lib/inventory/contracts";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type AdvertisingPlanStatus = "DRAFT" | "CONFIRMED";
export type AdvertisingPlanItem = {
  market: "US" | "CA";
  period: string;
  campaign: string;
  sku: string;
  recommendedAction: AdvertisingAction;
  currentBudget: number;
  proposedBudget: number;
  bidChangePercent: number;
  note: string;
  updatedAt: string;
};

const schema = `
CREATE TABLE IF NOT EXISTS advertising_plan_cycles_v1 (
  market TEXT NOT NULL, period TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, PRIMARY KEY(market,period)
);
CREATE TABLE IF NOT EXISTS advertising_plan_items_v1 (
  market TEXT NOT NULL, period TEXT NOT NULL, campaign TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', recommended_action TEXT NOT NULL,
  current_budget REAL NOT NULL, proposed_budget REAL NOT NULL, bid_change_percent REAL NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  PRIMARY KEY(market,period,campaign)
);
CREATE TABLE IF NOT EXISTS advertising_plan_events_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT, market TEXT NOT NULL, period TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

function openDatabase() { const database = new DatabaseSync(shipmentPlanDbPath()); database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;"); database.exec(schema); return database; }

export function getAdvertisingPlan(market: "US" | "CA", period: string) {
  const database = openDatabase();
  try {
    const cycle = database.prepare("SELECT status,version,updated_at FROM advertising_plan_cycles_v1 WHERE market=? AND period=?").get(market, period) as Record<string, unknown> | undefined;
    const items = database.prepare("SELECT * FROM advertising_plan_items_v1 WHERE market=? AND period=? ORDER BY campaign").all(market, period).map(mapItem);
    return { market, period, status: String(cycle?.status ?? "DRAFT") as AdvertisingPlanStatus, version: Number(cycle?.version ?? 0), updatedAt: cycle?.updated_at ? String(cycle.updated_at) : null, items };
  } finally { database.close(); }
}

export function saveAdvertisingPlan(market: "US" | "CA", period: string, items: Array<Omit<AdvertisingPlanItem, "market" | "period" | "updatedAt">>) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = database.prepare("SELECT status,version FROM advertising_plan_cycles_v1 WHERE market=? AND period=?").get(market, period) as Record<string, unknown> | undefined;
      if (existing?.status === "CONFIRMED") throw new Error("本期广告调整已确认，请先重新打开草稿后再修改。");
      const now = new Date().toISOString(); const version = Number(existing?.version ?? 0) + 1;
      database.prepare("INSERT INTO advertising_plan_cycles_v1(market,period,status,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(market,period) DO UPDATE SET status='DRAFT',version=excluded.version,updated_at=excluded.updated_at").run(market, period, "DRAFT", version, now);
      database.prepare("DELETE FROM advertising_plan_items_v1 WHERE market=? AND period=?").run(market, period);
      const insert = database.prepare("INSERT INTO advertising_plan_items_v1(market,period,campaign,sku,recommended_action,current_budget,proposed_budget,bid_change_percent,note,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
      for (const item of items) insert.run(market, period, item.campaign.trim(), item.sku.trim().toUpperCase(), item.recommendedAction, item.currentBudget, item.proposedBudget, item.bidChangePercent, item.note.trim(), now);
      event(database, market, period, "SAVE", { version, itemCount: items.length }); database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return getAdvertisingPlanFromDatabase(database, market, period);
  } finally { database.close(); }
}

export function transitionAdvertisingPlan(market: "US" | "CA", period: string, action: "confirm" | "reopen") {
  const database = openDatabase();
  try {
    const current = getAdvertisingPlanFromDatabase(database, market, period);
    if (!current.items.length) throw new Error("当前没有可确认的广告调整草稿。");
    const status: AdvertisingPlanStatus = action === "confirm" ? "CONFIRMED" : "DRAFT";
    database.prepare("UPDATE advertising_plan_cycles_v1 SET status=?,updated_at=? WHERE market=? AND period=?").run(status, new Date().toISOString(), market, period);
    event(database, market, period, action.toUpperCase(), { from: current.status, to: status, version: current.version });
    return getAdvertisingPlanFromDatabase(database, market, period);
  } finally { database.close(); }
}

function getAdvertisingPlanFromDatabase(database: DatabaseSync, market: "US" | "CA", period: string) {
  const cycle = database.prepare("SELECT status,version,updated_at FROM advertising_plan_cycles_v1 WHERE market=? AND period=?").get(market, period) as Record<string, unknown> | undefined;
  const items = database.prepare("SELECT * FROM advertising_plan_items_v1 WHERE market=? AND period=? ORDER BY campaign").all(market, period).map(mapItem);
  return { market, period, status: String(cycle?.status ?? "DRAFT") as AdvertisingPlanStatus, version: Number(cycle?.version ?? 0), updatedAt: cycle?.updated_at ? String(cycle.updated_at) : null, items };
}

function mapItem(row: unknown): AdvertisingPlanItem { const item = row as Record<string, unknown>; return { market: String(item.market) as "US" | "CA", period: String(item.period), campaign: String(item.campaign), sku: String(item.sku), recommendedAction: String(item.recommended_action) as AdvertisingAction, currentBudget: Number(item.current_budget), proposedBudget: Number(item.proposed_budget), bidChangePercent: Number(item.bid_change_percent), note: String(item.note ?? ""), updatedAt: String(item.updated_at) }; }
function event(database: DatabaseSync, market: string, period: string, action: string, payload: unknown) { database.prepare("INSERT INTO advertising_plan_events_v1(market,period,action,payload_json,created_at) VALUES(?,?,?,?,?)").run(market, period, action, JSON.stringify(payload), new Date().toISOString()); }
