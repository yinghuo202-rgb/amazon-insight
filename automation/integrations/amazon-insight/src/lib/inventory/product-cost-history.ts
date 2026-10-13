import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProductCostOverride, ProductCostValues } from "@/lib/inventory/product-cost-store";
import { taxExcludedFromIncluded } from "@/lib/inventory/product-cost-policy";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type ProductCostWriteMetadata = {
  effectiveFrom?: string; effectiveTo?: string | null; source?: string;
  expectedVersions?: Record<string, string>;
  actor?: { accountId: string; sessionHash: string };
  sourceCosts?: Record<string, ProductCostValues>; sourceReportVersion?: string | null;
};
export type ProductCostVersion = ProductCostValues & {
  versionId: string; sku: string; action: "override" | "restore" | "legacy";
  effectiveFrom: string | null; effectiveTo: string | null; source: string; recordedAt: string;
  accountId: string | null; sessionHash: string | null; sourceReportVersion: string | null;
  status: "current" | "scheduled" | "expired" | "superseded" | "legacy_unknown";
};
export type ProductCostEditState = { sku: string; editVersion: string; current: ProductCostVersion | null; latest: ProductCostVersion | null };
export class ProductCostError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Row = Record<string, unknown> & { id: number; sku: string; action: ProductCostVersion["action"]; effective_from: string | null; effective_to: string | null };
const schema = `
CREATE TABLE IF NOT EXISTS product_cost_overrides_v1(sku TEXT PRIMARY KEY,cost_rmb_tax_included REAL,cost_rmb_tax_excluded REAL,cost_usd REAL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_cost_overrides_v1_updated ON product_cost_overrides_v1(updated_at DESC);
CREATE TABLE IF NOT EXISTS product_cost_versions_v1(
 id INTEGER PRIMARY KEY AUTOINCREMENT,sku TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('override','restore','legacy')),
 cost_rmb_tax_included REAL,cost_rmb_tax_excluded REAL,cost_usd REAL,
 effective_from TEXT,effective_to TEXT,source TEXT NOT NULL,recorded_at TEXT NOT NULL,
 account_id TEXT,session_hash TEXT,source_report_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_cost_versions_v1_sku ON product_cost_versions_v1(sku,id DESC);
`;
const today = () => new Date().toISOString().slice(0, 10);
export function validateProductCostDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ProductCostError("成本生效/截止日期不正确。");
  return value;
}
function skuKey(value: string) {
  const sku = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,32}$/.test(sku)) throw new ProductCostError("成本 SKU 格式不正确。");
  return sku;
}
// Reading legacy/catalog keys must not broaden the separate financial-write schema.
const readSkuKey = (value: string) => value.trim().toUpperCase();
function values(value: ProductCostValues): ProductCostValues {
  if (!value || Object.values({ included: value.purchaseCostRmbTaxIncluded, excluded: value.purchaseCostRmbTaxExcluded, usd: value.purchaseCostUsd }).some(cost => cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > 1_000_000))) throw new ProductCostError("成本金额不正确。");
  return { ...value, purchaseCostRmbTaxExcluded: taxExcludedFromIncluded(value.purchaseCostRmbTaxIncluded, value.purchaseCostRmbTaxExcluded) };
}
function inTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try { const result = operation(); database.exec("COMMIT"); return result; }
  catch (error) { database.exec("ROLLBACK"); throw error; }
}
function openDatabase() {
  const file = shipmentPlanDbPath(); mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  try {
    database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    inTransaction(database, () => {
      database.exec(schema);
      // recorded_at is the old record timestamp, never a fabricated business effective date.
      database.exec(`INSERT INTO product_cost_versions_v1(sku,action,cost_rmb_tax_included,cost_rmb_tax_excluded,cost_usd,effective_from,effective_to,source,recorded_at)
        SELECT o.sku,'legacy',o.cost_rmb_tax_included,o.cost_rmb_tax_excluded,o.cost_usd,NULL,NULL,'旧覆盖：历史生效日期未知',o.updated_at
        FROM product_cost_overrides_v1 o WHERE NOT EXISTS(SELECT 1 FROM product_cost_versions_v1 v WHERE v.sku=o.sku)`);
    });
    return database;
  } catch (error) { database.close(); throw error; }
}
function rows(database: DatabaseSync): Row[] { return database.prepare("SELECT * FROM product_cost_versions_v1 ORDER BY id DESC").all() as Row[]; }
function selected(history: Row[], asOf: string, allowLegacy: boolean): Row | undefined {
  const eligible = history.filter(row => row.effective_from !== null && row.effective_from <= asOf).sort((a, b) => b.effective_from!.localeCompare(a.effective_from!) || b.id - a.id);
  // Choose the successor first, then inspect expiry: an expired successor never revives its predecessor.
  return eligible[0] || (allowLegacy ? history.find(row => row.action === "legacy") : undefined);
}
function mapVersion(row: Row, history: Row[], asOf = today()): ProductCostVersion {
  const candidate = selected(history, asOf, true), expired = row.effective_to !== null && row.effective_to < asOf;
  const replacedSameDay = history.some(next => next.effective_from === row.effective_from && next.id > row.id);
  const status: ProductCostVersion["status"] = row.action === "legacy" ? "legacy_unknown" : replacedSameDay ? "superseded" : row.effective_from! > asOf ? "scheduled" : expired ? "expired" : candidate?.id === row.id ? "current" : "superseded";
  const number = (value: unknown) => value === null ? null : Number(value);
  return { versionId: `cost-${row.id}`, sku: row.sku, action: row.action,
    purchaseCostRmbTaxIncluded: number(row.cost_rmb_tax_included), purchaseCostRmbTaxExcluded: number(row.cost_rmb_tax_excluded), purchaseCostUsd: number(row.cost_usd),
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, source: String(row.source), recordedAt: String(row.recorded_at),
    accountId: row.account_id === null ? null : String(row.account_id), sessionHash: row.session_hash === null ? null : String(row.session_hash), sourceReportVersion: row.source_report_version === null ? null : String(row.source_report_version), status };
}
function activeOverrides(history: Row[], asOf: string, allowLegacy: boolean): ProductCostOverride[] {
  return [...new Set(history.map(row => row.sku))].flatMap(sku => {
    const own = history.filter(row => row.sku === sku), row = selected(own, asOf, allowLegacy);
    if (!row || row.action === "restore" || row.effective_to !== null && row.effective_to < asOf) return [];
    const version = mapVersion(row, own, asOf);
    return [{ sku, updatedAt: version.recordedAt, purchaseCostRmbTaxIncluded: version.purchaseCostRmbTaxIncluded, purchaseCostRmbTaxExcluded: version.purchaseCostRmbTaxExcluded, purchaseCostUsd: version.purchaseCostUsd }];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.sku.localeCompare(b.sku));
}
function mirrorCurrent(database: DatabaseSync, history = rows(database)) {
  const current = activeOverrides(history, today(), true);
  // The compatibility table is a current-value projection, never the history source.
  database.exec("DELETE FROM product_cost_overrides_v1");
  const insert = database.prepare("INSERT INTO product_cost_overrides_v1 VALUES(?,?,?,?,?)");
  for (const row of current) insert.run(row.sku, row.purchaseCostRmbTaxIncluded, row.purchaseCostRmbTaxExcluded, row.purchaseCostUsd, row.updatedAt);
  return current;
}
export function listProductCostOverrides(asOf?: string): ProductCostOverride[] {
  if (asOf !== undefined) validateProductCostDate(asOf);
  const database = openDatabase();
  try { return asOf === undefined ? inTransaction(database, () => mirrorCurrent(database)) : activeOverrides(rows(database), asOf, false); }
  finally { database.close(); }
}
function checkedMetadata(metadata: ProductCostWriteMetadata, skus: string[]) {
  const effectiveFrom = validateProductCostDate(metadata.effectiveFrom ?? today()), effectiveTo = metadata.effectiveTo ?? null;
  if (effectiveTo !== null && validateProductCostDate(effectiveTo) < effectiveFrom) throw new ProductCostError("成本截止日期不能早于生效日期。");
  const source = metadata.source === undefined ? "内部操作（来源未核验）" : metadata.source.trim();
  if (!source || source.length > 500) throw new ProductCostError("成本来源需填写且不超过 500 字。");
  if (metadata.actor && (!metadata.actor.accountId.trim() || metadata.actor.accountId.length > 128 || !/^[a-f0-9]{64}$/.test(metadata.actor.sessionHash))) throw new ProductCostError("成本审计标识不正确。");
  if (metadata.sourceReportVersion !== undefined && metadata.sourceReportVersion !== null && (!metadata.sourceReportVersion || metadata.sourceReportVersion.length > 160)) throw new ProductCostError("来源报告版本不正确。");
  if (metadata.expectedVersions && (Object.keys(metadata.expectedVersions).length !== skus.length || skus.some(sku => !Object.hasOwn(metadata.expectedVersions!, sku)))) throw new ProductCostError("成本版本校验参数不完整。");
  return { effectiveFrom, effectiveTo, source };
}
function write(items: Array<{ sku: string } & ProductCostValues>, action: "override" | "restore", metadata: ProductCostWriteMetadata) {
  const input = items.map(item => ({ ...values(item), sku: skuKey(item.sku) })), skus = input.map(item => item.sku);
  if (!skus.length || skus.length > 1000) throw new ProductCostError("成本批次数量不正确。");
  if (new Set(skus).size !== skus.length) throw new ProductCostError("成本批次存在重复 SKU。");
  const meta = checkedMetadata(metadata, skus), database = openDatabase();
  try { return inTransaction(database, () => {
    for (const sku of skus) {
      const latest = database.prepare("SELECT id FROM product_cost_versions_v1 WHERE sku=? ORDER BY id DESC LIMIT 1").get(sku);
      if (metadata.expectedVersions && metadata.expectedVersions[sku] !== (latest ? `cost-${latest.id}` : "none")) throw new ProductCostError("成本版本已变化，整批未保存；请重新加载后核对草稿。", 409);
    }
    const insert = database.prepare("INSERT INTO product_cost_versions_v1(sku,action,cost_rmb_tax_included,cost_rmb_tax_excluded,cost_usd,effective_from,effective_to,source,recorded_at,account_id,session_hash,source_report_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"), recordedAt = new Date().toISOString();
    for (const item of input) insert.run(item.sku, action, item.purchaseCostRmbTaxIncluded, item.purchaseCostRmbTaxExcluded, item.purchaseCostUsd, meta.effectiveFrom, meta.effectiveTo, meta.source, recordedAt, metadata.actor?.accountId ?? null, metadata.actor?.sessionHash ?? null, metadata.sourceReportVersion ?? null);
    return mirrorCurrent(database);
  }); } finally { database.close(); }
}
export function saveProductCostOverrides(items: Array<{ sku: string } & ProductCostValues>, metadata: ProductCostWriteMetadata = {}) { return items.length ? write(items, "override", metadata) : listProductCostOverrides(); }
export function deleteProductCostOverrides(skus: string[], metadata: ProductCostWriteMetadata = {}) {
  if (!skus.length) return listProductCostOverrides();
  const empty = { purchaseCostRmbTaxIncluded: null, purchaseCostRmbTaxExcluded: null, purchaseCostUsd: null };
  return write(skus.map(sku => ({ ...(metadata.sourceCosts?.[skuKey(sku)] ?? empty), sku })), "restore", metadata);
}
export function listProductCostEditStates(skus: string[]): ProductCostEditState[] {
  const keys = [...new Set(skus.map(readSkuKey))], database = openDatabase();
  try {
    return editStates(rows(database), keys);
  } finally { database.close(); }
}
function editStates(history: Row[], keys: string[]): ProductCostEditState[] {
  const date = today();
  return keys.map(sku => {
    const own = history.filter(row => row.sku === sku), candidate = selected(own, date, true);
    const current = candidate && (candidate.effective_to === null || candidate.effective_to >= date) ? mapVersion(candidate, own) : null;
    return { sku, editVersion: own[0] ? `cost-${own[0].id}` : "none", current, latest: own[0] ? mapVersion(own[0], own) : null };
  });
}
export function readProductCostSnapshot(skus: string[]): { items: ProductCostOverride[]; editStates: ProductCostEditState[] } {
  const keys = [...new Set(skus.map(readSkuKey))], database = openDatabase();
  try { return inTransaction(database, () => {
    const history = rows(database);
    return { items: mirrorCurrent(database, history), editStates: editStates(history, keys) };
  }); } finally { database.close(); }
}
export function listProductCostHistory(sku: string, options: { cursor?: string; limit?: number } = {}): { items: ProductCostVersion[]; nextCursor: string | null } {
  const key = readSkuKey(sku), limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProductCostError("成本历史分页数量不正确。");
  const database = openDatabase();
  try {
    const own = database.prepare("SELECT * FROM product_cost_versions_v1 WHERE sku=? ORDER BY id DESC").all(key) as Row[];
    let ceiling = own[0]?.id ?? 0, before = ceiling + 1;
    if (options.cursor !== undefined) {
      try {
        if (options.cursor.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(options.cursor)) throw new Error();
        const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
        if (!Array.isArray(value) || value.length !== 3 || value[0] !== key || !Number.isSafeInteger(value[1]) || value[1] < 1 || !Number.isSafeInteger(value[2]) || value[2] < 1 || value[2] > value[1] + 1) throw new Error();
        [, ceiling, before] = value;
      } catch { throw new ProductCostError("成本历史游标无效，请重新展开历史。"); }
    }
    const page = own.filter(row => row.id <= ceiling && row.id < before).slice(0, limit + 1), result = page.slice(0, limit);
    return { items: result.map(row => mapVersion(row, own)), nextCursor: page.length > limit ? Buffer.from(JSON.stringify([key, ceiling, result.at(-1)!.id])).toString("base64url") : null };
  } finally { database.close(); }
}
