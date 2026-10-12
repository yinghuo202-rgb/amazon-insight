import { describe, expect, it, vi } from "vitest";
import { collectGerpgoPages, gerpgoPerformanceSources, gerpgoSupplementalSources, GerpgoConnectionError, resolveGerpgoStoreScope, type createGerpgoClient } from "@/lib/inventory/gerpgo";
const endpoint = "/purchase/goods/product/page";
const rows = (count: number, start = 0) => Array.from({ length: count }, (_, i) => ({ id: start + i }));
function client(...responses: unknown[]) {
  return { checkedAt: "", expiresAt: "", post: vi.fn().mockImplementation(async () => {
    const result = responses.shift(); if (result instanceof Error) throw result; return result;
  }) } as Awaited<ReturnType<typeof createGerpgoClient>>;
}
const options = { pause: vi.fn().mockResolvedValue(undefined) };
describe("GERPgo full page collector", () => {
  it("selects one exact store identity and excludes the Australian market", () => {
    const own = [1, 2, 3, 17].map((marketId, index) => ({ serverName: "MEASUREMAN", serverId: 1, marketId, market: `amazon-${["us", "ca", "mx", "au"][index]}` }));
    const sellers = [{ marketListVos: [...own.slice(0, 3), { serverName: "Other", serverId: 2, marketId: 4 }] }, { marketListVos: own.slice(3) }];
    expect(resolveGerpgoStoreScope(sellers, " measureman ")).toEqual({ storeName: "MEASUREMAN", serverId: 1, marketIds: [1, 2] });
    expect(gerpgoSupplementalSources([{ condition: { beginDate: "2026-09-01", endDate: "2026-09-01" } }], resolveGerpgoStoreScope(sellers, "MEASUREMAN").marketIds).filter(s => s.name.startsWith("ads-")).map(s => s.condition.marketId)).toEqual([1, 2]);
    expect(() => resolveGerpgoStoreScope(sellers, undefined)).toThrow();
    expect(() => resolveGerpgoStoreScope(sellers, "MEASURE")).toThrow();
    expect(() => resolveGerpgoStoreScope([{ marketListVos: [...own, { ...own[0], serverId: 99, marketId: 90 }] }], "MEASUREMAN")).toThrow();
    expect(() => resolveGerpgoStoreScope([{ marketListVos: [own[0], own[0]] }], "MEASUREMAN")).toThrow();
  });
  it("collects US and CA separately using the documented listing sales contract", () => {
    expect(gerpgoPerformanceSources([{ condition: { beginDate: "2026-10-01", endDate: "2026-10-12" } }], [1, 2])).toEqual([
      { name: "performance-1-2026-10", endpoint: "/operation/sts/listingAnalyzeMultiIndex/page", condition: { beginDate: "2026-10-01", endDate: "2026-10-12", marketList: [1], showCurrencyType: "YUAN", isShowTotal: false, groupByType: "seller_sku" } },
      { name: "performance-2-2026-10", endpoint: "/operation/sts/listingAnalyzeMultiIndex/page", condition: { beginDate: "2026-10-01", endDate: "2026-10-12", marketList: [2], showCurrencyType: "YUAN", isShowTotal: false, groupByType: "seller_sku" } },
    ]);
    expect(() => gerpgoPerformanceSources([{ condition: { beginDate: "2026-10-01", endDate: "2026-10-12" } }], [3])).toThrow("US、CA");
  });
  it("paces requests from completed responses and retries HTTP 509 at most three times", async () => {
    const events: string[] = [];
    const c = { checkedAt: "", expiresAt: "", post: async () => { events.push("response"); throw new GerpgoConnectionError("限流", 509); } } as Awaited<ReturnType<typeof createGerpgoClient>>;
    await expect(collectGerpgoPages(c, endpoint, {}, async () => {}, { pause: async ms => { expect(ms).toBeGreaterThanOrEqual(6000); events.push("pause"); } })).rejects.toMatchObject({ httpStatus: 509 });
    expect(events).toEqual(["response", "pause", "response", "pause", "response", "pause"]);
  });
  it("recovers duplicate ad boundaries with bounded page sizes only when business-key union equals total", async () => {
    const ads = rows(101).map(r => ({ marketId: 1, msku: `SKU-${r.id}`, asin: `ASIN-${r.id}`, cost: 1 }));
    const c = client({ total: 101, rows: ads.slice(0, 100) }, { total: 101, rows: [ads[99]] }, { total: 101, rows: ads.slice(0, 99) }, { total: 101, rows: ads.slice(99) });
    const saved: Record<string, unknown>[] = [];
    const result = await collectGerpgoPages(c, "/operation/ads/adsAsinAnalytical/page", { marketId: 1 }, async p => { saved.push(...p.rows); }, options);
    expect(result).toMatchObject({ pages: 2, total: 101, paginationAudit: { complete: true, pageSizes: [100, 99], duplicateRecords: 101 } });
    expect(saved).toHaveLength(101);
    expect(new Set(saved.map(r => r.msku)).size).toBe(101);
  });
  it("rejects conflicting advertising duplicates and never emits incomplete rows", async () => {
    const ad = { marketId: 1, msku: "SKU-A", asin: "ASIN-A", cost: 1 };
    const saved: unknown[] = [];
    await expect(collectGerpgoPages(client({ total: 2, rows: [ad, { ...ad, cost: 2 }] }), "/operation/ads/adsAsinAnalytical/page", { marketId: 1 }, async p => { saved.push(p); }, options)).rejects.toThrow("重复");
    expect(saved).toEqual([]);
  });
  it("stops after 100/99/97 ad pages if the exact unique key total remains incomplete", async () => {
    const ads = rows(100).map(r => ({ marketId: 1, msku: `SKU-${r.id}`, asin: `ASIN-${r.id}`, cost: 1 }));
    const c = client({ total: 101, rows: ads }, { total: 101, rows: [ads[99]] }, { total: 101, rows: ads.slice(0, 99) }, { total: 101, rows: ads.slice(98) },
      { total: 101, rows: ads.slice(0, 97) }, { total: 101, rows: ads.slice(96) });
    const saved: unknown[] = [];
    await expect(collectGerpgoPages(c, "/operation/ads/adsAsinAnalytical/page", { marketId: 1 }, async p => { saved.push(p); }, options)).rejects.toThrow("仍不完整");
    expect(vi.mocked(c.post).mock.calls.map(call => (call[1] as { pagesize: number }).pagesize)).toEqual([100, 100, 99, 99, 97, 97]);
    expect(saved).toEqual([]);
  });
  it("counts grouped shops by the explicit market total, not seller row count", async () => {
    const c = client({ total: 3, totalUnit: "markets", rows: [{ marketListVos: [{ marketId: 1 }, { marketId: 2 }] }] }, { total: 3, totalUnit: "markets", rows: [{ marketListVos: [{ marketId: 3 }] }] });
    const evidence: unknown[] = [];
    expect(await collectGerpgoPages(c, "/middle/base/market/page", {}, async page => { evidence.push(page); }, options)).toEqual({ pages: 2, total: 3, totalUnit: "markets" });
    expect(evidence).toHaveLength(2);
  });
  it("uses daily market scopes for ads without calling inventory, returns or storage", () => {
    const sources = gerpgoSupplementalSources([{ condition: { beginDate: "2026-09-29", endDate: "2026-09-30" } }], [1, 2, 1]);
    expect(sources.filter(source => source.name.startsWith("ads-")).length).toBe(4);
    expect(sources.find(source => source.name === "ads-2-2026-09-30")?.condition).toEqual({ marketId: 2, startDateData: "2026-09-30", endDateData: "2026-09-30" });
    expect(sources).toHaveLength(4);
    expect(sources.every(source => source.name.startsWith("ads-"))).toBe(true);
    expect(() => gerpgoSupplementalSources([{ condition: {} }], [1])).toThrow();
  });
  it("streams every page without exposing a token", async () => {
    const saved: number[] = [], c = client({ total: 201, rows: rows(100), page: 1 }, { total: 201, rows: rows(100, 100), page: 2 }, { total: 201, rows: rows(1, 200), page: 3 });
    expect(await collectGerpgoPages(c, endpoint, {}, async page => { saved.push(...page.rows.map(row => Number(row.id))); }, options)).toEqual({ pages: 3, total: 201 });
    expect(new Set(saved).size).toBe(201);
    expect(c.post).toHaveBeenLastCalledWith(endpoint, { page: 3, pagesize: 100 });
  });
  it("accepts the observed zero-total null advertising page, retaining empty evidence", async () => {
    const c = client({ total: 0, rows: null, page: 1, pagesize: 100 });
    const save = vi.fn().mockResolvedValue(undefined);
    expect(await collectGerpgoPages(c, "/operation/ads/adsAsinAnalytical/page", { marketId: 3 }, save, options)).toEqual({ pages: 1, total: 0 });
    expect(save).toHaveBeenCalledWith({ total: 0, page: 1, rows: [] });
  });
  it.each([{ total: 1, rows: null }, { total: 0 }, { total: "0", rows: null }, { total: 0, rows: {} }, { total: 0, rows: null, page: 2 }])("still rejects malformed advertising responses", async response => {
    await expect(collectGerpgoPages(client(response), "/operation/ads/adsAsinAnalytical/page", {}, async () => {}, options)).rejects.toThrow();
  });
  it("does not normalize null rows for unrelated endpoints", async () => {
    await expect(collectGerpgoPages(client({ total: 0, rows: null }), endpoint, {}, async () => {}, options)).rejects.toThrow();
  });
  it("uses top-level performance parameters, but nested shop conditions", async () => {
    const c = client({ total: 0, rows: [] }, { total: 0, rows: [] });
    const filters = { beginDate: "2026-09-01", endDate: "2026-09-30", showCurrencyType: "YUAN" };
    await collectGerpgoPages(c, "/operation/sts/listingAnalyzeMultiIndex/page", filters, async () => {}, options);
    expect(c.post).toHaveBeenNthCalledWith(1, "/operation/sts/listingAnalyzeMultiIndex/page", { ...filters, page: 1, pagesize: 100 });
    await collectGerpgoPages(c, "/middle/base/market/page", {}, async () => {}, options);
    expect(c.post).toHaveBeenNthCalledWith(2, "/middle/base/market/page", { page: 1, pagesize: 100, condition: {} });
  });
  it.each([
    [{ total: 200, rows: rows(100) }, { total: 200, rows: rows(100) }],
    [{ total: 200, rows: rows(100) }, { total: 201, rows: rows(100, 100) }],
    [{ total: 200, rows: rows(100) }, { total: 200, rows: [] }],
    [{ total: 200, rows: rows(99) }],
    [{ total: "1", rows: rows(1) }],
    [{ total: 1, rows: rows(1), page: 2 }],
    [{ total: 1, rows: [null] }],
  ])("fails closed for repeated, omitted or malformed pagination", async (...responses) => {
    await expect(collectGerpgoPages(client(...responses), endpoint, {}, async () => {}, options)).rejects.toThrow();
  });
  it("backs off only rate limits and stops after bounded retries", async () => {
    const c = client(new GerpgoConnectionError("限流", 429), { total: 0, rows: [] });
    expect(await collectGerpgoPages(c, endpoint, {}, async () => {}, options)).toEqual({ pages: 1, total: 0 });
    expect(c.post).toHaveBeenCalledTimes(2);
    const forbidden = client(new GerpgoConnectionError("权限", 422));
    await expect(collectGerpgoPages(forbidden, endpoint, {}, async () => {}, options)).rejects.toThrow("权限");
    expect(forbidden.post).toHaveBeenCalledOnce();
  });
});
