import { DatabaseSync } from "node:sqlite";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";
import { operatingRulesSchema, type OperatingRuleOverride, type OperatingRules } from "@/lib/inventory/operating-rules";

function database() {
  const db = new DatabaseSync(shipmentPlanDbPath());
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS operating_rule_overrides_v1 (market TEXT NOT NULL, sku TEXT NOT NULL, values_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(market,sku))");
  return db;
}
export function listOperatingRuleOverrides(): OperatingRuleOverride[] {
  const db = database();
  try {
    return db.prepare("SELECT market,sku,values_json FROM operating_rule_overrides_v1 ORDER BY market,sku").all().map(row => ({ market: String(row.market), sku: String(row.sku), values: operatingRulesSchema.partial().parse(JSON.parse(String(row.values_json))) }));
  } finally { db.close(); }
}
export function saveOperatingRuleOverride(market: string, sku: string, values: Partial<OperatingRules>) {
  const validated = operatingRulesSchema.partial().parse(values);
  const db = database();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO operating_rule_overrides_v1 VALUES(?,?,?,?) ON CONFLICT(market,sku) DO UPDATE SET values_json=excluded.values_json,updated_at=excluded.updated_at").run(market, sku, JSON.stringify(validated), new Date().toISOString());
    const now = new Date().toISOString();
    db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('operating-rules-save','completed',?,?,?)").run(now, now, JSON.stringify({ market, sku, values: validated, actor: "shared-account" }));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
  return listOperatingRuleOverrides();
}
