import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as costs from "@/lib/inventory/product-cost-store";
let folder: string, file: string;
const item = (sku = "ZZ001", value: number | null = 113) => ({ sku, purchaseCostRmbTaxIncluded: value, purchaseCostRmbTaxExcluded: 999, purchaseCostUsd: value === null ? null : value / 10 });
const metadata = (effectiveFrom = "2026-10-13", extra = {}) => ({ effectiveFrom, source: "合成报价", ...extra });
beforeEach(() => { folder = mkdtempSync(path.join(tmpdir(), "cost-versions-")); file = path.join(folder, "state.sqlite3"); vi.stubEnv("STORE_OPS_STATE_DB", file); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z")); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });

it("does not apply future versions early and does not revive predecessors after expiry", () => {
  costs.saveProductCostOverrides([item()], metadata("2026-10-01"));
  costs.saveProductCostOverrides([item("ZZ001", 226)], metadata("2026-10-20", { effectiveTo: "2026-10-21" }));
  expect(costs.listProductCostOverrides()[0].purchaseCostRmbTaxIncluded).toBe(113);
  expect(costs.listProductCostOverrides("2026-10-20")[0].purchaseCostRmbTaxIncluded).toBe(226);
  expect(costs.listProductCostOverrides("2026-10-21")[0].purchaseCostRmbTaxIncluded).toBe(226);
  expect(costs.listProductCostOverrides("2026-10-22")).toEqual([]);
});
it("keeps same-day revisions, true zero, null and the fixed thirteen-percent calculation", () => {
  costs.saveProductCostOverrides([item()], metadata());
  costs.saveProductCostOverrides([item("ZZ001", 0)], metadata());
  costs.saveProductCostOverrides([item("ZZ001", null)], metadata());
  const history = costs.listProductCostHistory("ZZ001");
  expect(history.items.map(row => row.purchaseCostRmbTaxIncluded)).toEqual([null, 0, 113]);
  expect(history.items[2].purchaseCostRmbTaxExcluded).toBe(100);
  expect(history.items[1].purchaseCostRmbTaxExcluded).toBe(0);
  expect(history.items[0].purchaseCostRmbTaxExcluded).toBe(999);
  expect(new Set(history.items.map(row => row.versionId)).size).toBe(3);
});
it("migrates a legacy override without inventing an effective date", () => {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE product_cost_overrides_v1(sku TEXT PRIMARY KEY,cost_rmb_tax_included REAL,cost_rmb_tax_excluded REAL,cost_usd REAL,updated_at TEXT NOT NULL)");
  db.prepare("INSERT INTO product_cost_overrides_v1 VALUES('ZZ001',113,100,10,'2020-01-01T00:00:00Z')").run(); db.close();
  expect(costs.listProductCostOverrides()[0].purchaseCostRmbTaxIncluded).toBe(113);
  expect(costs.listProductCostOverrides("2020-01-01")).toEqual([]);
  expect(costs.listProductCostHistory("ZZ001").items[0]).toMatchObject({ action: "legacy", effectiveFrom: null, recordedAt: "2020-01-01T00:00:00Z", status: "legacy_unknown", accountId: null, sessionHash: null });
  expect(costs.listProductCostHistory("ZZ001").items).toHaveLength(1);
});
it("appends restore provenance while following published source costs and preserving past overrides", () => {
  costs.saveProductCostOverrides([item()], metadata("2026-10-01"));
  costs.deleteProductCostOverrides(["ZZ001"], metadata("2026-10-14", { sourceCosts: { ZZ001: item("ZZ001", 339) }, sourceReportVersion: "data-20261013-000000-synthetic", actor: { accountId: "shared", sessionHash: "a".repeat(64) } }));
  expect(costs.listProductCostOverrides()[0].purchaseCostRmbTaxIncluded).toBe(113);
  expect(costs.listProductCostOverrides("2026-10-14")).toEqual([]);
  expect(costs.listProductCostHistory("ZZ001").items[0]).toMatchObject({ action: "restore", purchaseCostRmbTaxIncluded: 339, sourceReportVersion: "data-20261013-000000-synthetic", accountId: "shared", sessionHash: "a".repeat(64) });
  expect(costs.listProductCostHistory("ZZ001").items).toHaveLength(2);
});
it("checks every SKU edit token in one batch transaction, including unseen future plans", () => {
  costs.saveProductCostOverrides([item()], metadata("2026-12-01", { expectedVersions: { ZZ001: "none" } }));
  expect(() => costs.saveProductCostOverrides([item("ZZ002"), item("ZZ001", 226)], metadata("2026-10-13", { expectedVersions: { ZZ002: "none", ZZ001: "none" } }))).toThrow(/变化|冲突/);
  expect(costs.listProductCostHistory("ZZ002").items).toEqual([]);
  expect(costs.listProductCostHistory("ZZ001").items).toHaveLength(1);
  expect(costs.listProductCostEditStates(["ZZ001"])[0].editVersion).not.toBe("none");
});
it("pages every revision once under a stable history cursor, even if a new version arrives", () => {
  for (let i = 1; i <= 5; i++) costs.saveProductCostOverrides([item("ZZ001", i)], metadata());
  const first = costs.listProductCostHistory("ZZ001", { limit: 2 });
  costs.saveProductCostOverrides([item("ZZ001", 6)], metadata());
  const second = costs.listProductCostHistory("ZZ001", { limit: 2, cursor: first.nextCursor! });
  const third = costs.listProductCostHistory("ZZ001", { limit: 2, cursor: second.nextCursor! });
  expect([...first.items, ...second.items, ...third.items].map(row => row.purchaseCostRmbTaxIncluded)).toEqual([5, 4, 3, 2, 1]);
  expect(third.nextCursor).toBeNull();
  expect(() => costs.listProductCostHistory("ZZ002", { cursor: first.nextCursor! })).toThrow(/游标/);
});
it("rejects impossible dates and duplicate batch SKUs without writing partial history", () => {
  expect(() => costs.saveProductCostOverrides([item()], metadata("2026-02-30"))).toThrow(/日期/);
  expect(() => costs.saveProductCostOverrides([item()], metadata("2026-10-13", { effectiveTo: "2026-10-12" }))).toThrow(/日期/);
  expect(() => costs.saveProductCostOverrides([item(), item()], metadata())).toThrow(/重复/);
  expect(costs.listProductCostHistory("ZZ001").items).toHaveLength(0);
});
it("keeps empty legacy calls as no-ops and preserves fully null costs", () => {
  const empty = { sku: "ZZ001", purchaseCostRmbTaxIncluded: null, purchaseCostRmbTaxExcluded: null, purchaseCostUsd: null };
  costs.saveProductCostOverrides([empty]);
  expect(costs.saveProductCostOverrides([])[0]).toMatchObject(empty);
  expect(costs.deleteProductCostOverrides([])[0]).toMatchObject(empty);
  expect(costs.listProductCostHistory("ZZ001").items).toHaveLength(1);
});
it("holds an atomic snapshot against a real competing SQLite process between its current/token reads", () => {
  costs.saveProductCostOverrides([item()]);
  const original = DatabaseSync.prototype.prepare; let probed = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    const statement = original.call(this, sql);
    if (sql === "SELECT * FROM product_cost_versions_v1 ORDER BY id DESC" && !probed) {
      probed = true; const all = statement.all.bind(statement);
      statement.all = (...parameters) => {
        const result = all(...parameters);
        const writer = spawnSync(process.execPath, ["-e", `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=20');try{db.exec("BEGIN IMMEDIATE; INSERT INTO product_cost_versions_v1(sku,action,cost_rmb_tax_included,effective_from,source,recorded_at) VALUES('ZZ001','override',999,'2026-10-13','synthetic','2026-10-13'); COMMIT");process.stdout.write('changed')}catch(e){process.stdout.write(e.message.includes('locked')?'locked':'unexpected')}finally{db.close()}`, file], { encoding: "utf8" });
        expect(writer.status).toBe(0); expect(writer.stdout).toBe("locked");
        return result;
      };
    }
    return statement;
  });
  const snapshot = costs.readProductCostSnapshot(["ZZ001"]);
  expect(probed).toBe(true);
  expect(snapshot.items[0].purchaseCostRmbTaxIncluded).toBe(113);
  expect(snapshot.editStates[0]).toMatchObject({ editVersion: "cost-1", current: { versionId: "cost-1", purchaseCostRmbTaxIncluded: 113 } });
});
it("labels permanently replaced same-day future revisions superseded without changing date selection", () => {
  costs.saveProductCostOverrides([item()], metadata("2026-11-01", { effectiveTo: "2026-11-02" }));
  costs.saveProductCostOverrides([item("ZZ001", 226)], metadata("2026-11-01", { effectiveTo: "2026-11-01" }));
  costs.saveProductCostOverrides([item("ZZ001", 339)], metadata("2026-12-01"));
  expect(costs.listProductCostHistory("ZZ001").items.map(row => row.status)).toEqual(["scheduled", "scheduled", "superseded"]);
  expect(costs.listProductCostOverrides("2026-11-01")[0].purchaseCostRmbTaxIncluded).toBe(226);
  expect(costs.listProductCostOverrides("2026-11-02")).toEqual([]);
  expect(costs.listProductCostOverrides()[0]).toBeUndefined();
});
