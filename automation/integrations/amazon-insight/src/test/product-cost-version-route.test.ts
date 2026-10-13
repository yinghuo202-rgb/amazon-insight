import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), cookies: vi.fn(), catalog: vi.fn(), catalogPath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, SESSION_COOKIE: "measureman_session" }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/inventory/data", () => ({ loadBaseProductCatalogData: mocks.catalog, productCatalogDataPath: mocks.catalogPath }));
import { GET, POST, DELETE } from "@/app/api/inventory/product-costs/route";
import { listProductCostEditStates, listProductCostHistory, readProductCostSnapshot, saveProductCostOverrides } from "@/lib/inventory/product-cost-store";
import { publishedReportPath } from "@/lib/inventory/report-version";
let folder: string, reports: string;
const version = "data-20261013-000000-synthetic";
const product = { sku: "ZZ001", fnsku: "", productDescription: "合成产品", category: "合成", packaging: "", hsCode: "", englishName: "synthetic", chineseName: "合成", declarationElements: "", declarationElementsEnglish: "", cartonQty: null, cartonNetWeightKg: null, cartonGrossWeightKg: null, cartonDimensionsCm: { length: null, width: null, height: null }, cartonVolumeM3: null, productWeightG: null, shippingSizeCm: "", purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, purchaseCostUsd: 30, imageFile: "", imageMimeType: "", imageSha256: "", listing: null };
const catalog = { schemaVersion: 1, generatedAt: "2026-10-13T00:00:00Z", sources: [], items: [product, { ...product, sku: "ZZ002" }] };
const item = (sku = "ZZ001") => ({ sku, purchaseCostRmbTaxIncluded: 113, purchaseCostRmbTaxExcluded: 999, purchaseCostUsd: 10 });
const payload = (extra = {}) => ({ items: [item()], effectiveFrom: "2026-10-13", effectiveTo: null, source: "合成报价", expectedVersions: { ZZ001: "none" }, ...extra });
const request = (method: string, body: unknown, headers: Record<string, string> = {}) => new Request("https://example.invalid/api/inventory/product-costs", { method, headers: { origin: "https://example.invalid", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); folder = mkdtempSync(path.join(tmpdir(), "cost-route-")); reports = path.join(folder, "reports");
  vi.stubEnv("STORE_OPS_STATE_DB", path.join(folder, "state.sqlite3")); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.invalid");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  mkdirSync(path.join(reports, ".versions", version, "reports"), { recursive: true });
  writeFileSync(path.join(reports, "current.json"), JSON.stringify({ version }));
  writeFileSync(path.join(reports, "profitability.json"), '{"actualProfit":"untouched-synthetic-fact"}');
  mocks.user.mockResolvedValue({ id: "shared-synthetic" }); mocks.cookies.mockResolvedValue({ get: () => ({ value: "synthetic-session-not-persisted" }) });
  mocks.catalog.mockResolvedValue(catalog); mocks.catalogPath.mockReturnValue(path.join(reports, "product_catalog.json"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });
it("requires login for current/history reads and all writes", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await GET(new Request("https://example.invalid/api/inventory/product-costs?sku=ZZ001"))).status).toBe(401);
  expect((await POST(request("POST", payload()))).status).toBe(401);
  expect((await DELETE(request("DELETE", {}))).status).toBe(401);
  expect(listProductCostHistory("ZZ001").items).toEqual([]);
});
it.each([{ origin: "https://attacker.invalid" }, { origin: "" }, { "content-type": "text/plain" }] as Array<Record<string, string>>)("rejects non-site JSON writes before storage (%j)", async headers => {
  expect((await POST(request("POST", payload(), headers))).status).toBe(403);
  expect((await DELETE(request("DELETE", { skus: ["ZZ001"], ...payload(), items: undefined }, headers))).status).toBe(403);
  expect(listProductCostHistory("ZZ001").items).toEqual([]);
});
it.each([{ effectiveFrom: "2026-02-30" }, { effectiveTo: "2026-10-12" }, { source: "   " }, { expectedVersions: {} }, { actor: { sessionHash: "client-forged" } }])("rejects invalid date/source/CAS or forged actor without partial history (%j)", async extra => {
  expect((await POST(request("POST", payload(extra)))).status).toBe(400);
  expect(listProductCostHistory("ZZ001").items).toEqual([]);
});
it("returns edit state, trusted audit hashes and fixed tax values without changing historical profit files", async () => {
  const oldProfit = readFileSync(path.join(reports, "profitability.json"));
  const response = await POST(request("POST", payload()));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result.items[0].purchaseCostRmbTaxExcluded).toBe(100);
  expect(result.editStates.find((state: { sku: string }) => state.sku === "ZZ001")).toMatchObject({ editVersion: "cost-1", current: { accountId: "shared-synthetic", sessionHash: expect.stringMatching(/^[a-f0-9]{64}$/), effectiveFrom: "2026-10-13", source: "合成报价" } });
  expect(JSON.stringify(result)).not.toContain("synthetic-session-not-persisted");
  expect(JSON.stringify(listProductCostHistory("ZZ001"))).not.toContain("synthetic-session-not-persisted");
  expect(readFileSync(path.join(reports, "profitability.json"))).toEqual(oldProfit);
  const current = await (await GET(new Request("https://example.invalid/api/inventory/product-costs"))).json();
  expect(current.editStates).toHaveLength(2);
});
it("returns only current overrides after a future save, while its edit token detects a stale whole batch", async () => {
  expect((await POST(request("POST", payload({ effectiveFrom: "2026-12-01" })))).status).toBe(200);
  expect(listProductCostEditStates(["ZZ001"])[0]).toMatchObject({ editVersion: "cost-1", current: null, latest: { status: "scheduled" } });
  const conflict = await POST(request("POST", payload({ items: [item("ZZ002"), item()], expectedVersions: { ZZ001: "none", ZZ002: "none" } })));
  expect(conflict.status).toBe(409); expect(listProductCostHistory("ZZ002").items).toEqual([]);
});
it("records restore source values and the same pinned report version, rather than deleting history", async () => {
  saveProductCostOverrides([item()]); const editVersion = listProductCostEditStates(["ZZ001"])[0].editVersion;
  const next = "data-20261013-000001-synthetic";
  mkdirSync(path.join(reports, ".versions", next, "reports"), { recursive: true });
  mocks.catalog.mockImplementation(async () => { await publishedReportPath(mocks.catalogPath()); writeFileSync(path.join(reports, "current.json"), JSON.stringify({ version: next })); return catalog; });
  const response = await DELETE(request("DELETE", { skus: ["ZZ001"], effectiveFrom: "2026-10-13", source: "恢复合成来源", expectedVersions: { ZZ001: editVersion } }));
  expect(response.status).toBe(200); const result = await response.json();
  expect(result.items).toEqual([]);
  expect(listProductCostHistory("ZZ001").items).toHaveLength(2);
  expect(listProductCostHistory("ZZ001").items[0]).toMatchObject({ action: "restore", purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, sourceReportVersion: version });
});
it("provides continuous SKU-bound history without returning private errors", async () => {
  for (let i = 0; i < 3; i++) saveProductCostOverrides([item()]);
  const first = await (await GET(new Request("https://example.invalid/api/inventory/product-costs?sku=ZZ001&limit=2"))).json();
  expect(first.items).toHaveLength(2); expect(first.nextCursor).toEqual(expect.any(String));
  const second = await (await GET(new Request(`https://example.invalid/api/inventory/product-costs?sku=ZZ001&limit=2&cursor=${first.nextCursor}`))).json();
  expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
  expect((await GET(new Request(`https://example.invalid/api/inventory/product-costs?sku=ZZ002&cursor=${first.nextCursor}`))).status).toBe(400);
  mocks.catalog.mockRejectedValue(new Error("private-synthetic-credential-and-path"));
  const failed = await POST(request("POST", payload()));
  expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("private-synthetic");
});
it("keeps a removed catalog SKU's immutable history queryable while rejecting new edits to it", async () => {
  saveProductCostOverrides([item("ZZ003")]);
  const historical = await GET(new Request("https://example.invalid/api/inventory/product-costs?sku=ZZ003"));
  expect(historical.status).toBe(200);
  expect((await historical.json()).items[0]).toMatchObject({ sku: "ZZ003", purchaseCostRmbTaxIncluded: 113 });
  expect((await POST(request("POST", payload({ items: [item("ZZ003")], expectedVersions: { ZZ003: "cost-1" } })))).status).toBe(400);
  expect(listProductCostHistory("ZZ003").items).toHaveLength(1);
});
it("reads mixed legacy catalog keys without failing GET/page snapshots or a committed valid write response", async () => {
  const db = new DatabaseSync(path.join(folder, "state.sqlite3"));
  db.exec("CREATE TABLE product_cost_overrides_v1(sku TEXT PRIMARY KEY,cost_rmb_tax_included REAL,cost_rmb_tax_excluded REAL,cost_usd REAL,updated_at TEXT NOT NULL)");
  db.prepare("INSERT INTO product_cost_overrides_v1 VALUES(?,?,?,?,?)").run("AA_01", 70, 60, 6, "2020-01-01T00:00:00Z");
  db.prepare("INSERT INTO product_cost_overrides_v1 VALUES(?,?,?,?,?)").run("A", 0, 0, 0, "2020-01-01T00:00:00Z"); db.close();
  const mixed = { ...catalog, items: [product, { ...product, sku: "AA_01" }, { ...product, sku: "A" }] };
  mocks.catalog.mockResolvedValue(mixed);
  const first = await GET(new Request("https://example.invalid/api/inventory/product-costs"));
  expect(first.status).toBe(200);
  expect((await first.json()).items.find((row: { sku: string }) => row.sku === "AA_01")).toMatchObject({ purchaseCostRmbTaxIncluded: 70 });
  const page = readProductCostSnapshot(mixed.items.map(row => row.sku));
  expect(page.editStates.map(row => row.sku)).toEqual(["ZZ001", "AA_01", "A"]);
  expect(listProductCostEditStates(["AA_01", "A"]).map(row => row.current?.status)).toEqual(["legacy_unknown", "legacy_unknown"]);
  const saved = await POST(request("POST", payload()));
  expect(saved.status).toBe(200);
  expect((await saved.json()).items.find((row: { sku: string }) => row.sku === "ZZ001")).toMatchObject({ purchaseCostRmbTaxIncluded: 113 });
  expect(listProductCostHistory("ZZ001").items).toHaveLength(1);
  const legacy = await GET(new Request("https://example.invalid/api/inventory/product-costs?sku=AA_01"));
  expect(legacy.status).toBe(200);
  expect((await legacy.json()).items[0]).toMatchObject({ sku: "AA_01", action: "legacy", effectiveFrom: null, purchaseCostRmbTaxIncluded: 70 });
  expect((await POST(request("POST", payload({ items: [item("AA_01")], expectedVersions: { AA_01: page.editStates[1].editVersion } })))).status).toBe(400);
  expect(listProductCostHistory("AA_01").items).toHaveLength(1);
});
it("does not report a valid write as failed after persisting it when another catalog SKU has an old format", async () => {
  mocks.catalog.mockResolvedValue({ ...catalog, items: [product, { ...product, sku: "AA_01" }] });
  const saved = await POST(request("POST", payload()));
  expect(listProductCostHistory("ZZ001").items).toHaveLength(1);
  expect(saved.status).toBe(200);
  const result = await saved.json();
  expect(result.items[0].purchaseCostRmbTaxIncluded).toBe(113);
  expect(result.editStates.find((row: { sku: string }) => row.sku === "ZZ001").current.purchaseCostRmbTaxIncluded).toBe(113);
});
it.each(["GET", "POST", "DELETE"])("returns normalized catalog source costs from one pinned report context for %s", async method => {
  const next = "data-20261013-000001-synthetic";
  mkdirSync(path.join(reports, ".versions", next, "reports"), { recursive: true });
  mocks.catalog.mockImplementation(async () => {
    await publishedReportPath(mocks.catalogPath());
    writeFileSync(path.join(reports, "current.json"), JSON.stringify({ version: next }));
    return { ...catalog, items: catalog.items.map(row => ({ ...row, purchaseCostRmbTaxExcluded: 999 })) };
  });
  let response: Response;
  if (method === "GET") response = await GET(new Request("https://example.invalid/api/inventory/product-costs"));
  else if (method === "POST") response = await POST(request("POST", payload({ effectiveFrom: "2026-12-01" })));
  else {
    saveProductCostOverrides([item()]);
    response = await DELETE(request("DELETE", { skus: ["ZZ001"], effectiveFrom: "2026-10-13", source: "恢复新合成来源", expectedVersions: { ZZ001: "cost-1" } }));
  }
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.sourceCosts).toEqual({ ZZ001: { purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, purchaseCostUsd: 30 }, ZZ002: { purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, purchaseCostUsd: 30 } });
  expect(result.sourceReportVersion).toBe(version);
  expect(result.items).toEqual([]);
  if (method === "DELETE") expect(listProductCostHistory("ZZ001").items[0]).toMatchObject({ purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, sourceReportVersion: version });
});
