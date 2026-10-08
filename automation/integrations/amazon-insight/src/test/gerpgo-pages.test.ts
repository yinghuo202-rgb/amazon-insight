import { describe, expect, it, vi } from "vitest";
import { collectGerpgoPages, gerpgoSupplementalSources, GerpgoConnectionError, resolveGerpgoStoreScope, type createGerpgoClient } from "@/lib/inventory/gerpgo";
const endpoint = "/purchase/goods/product/page";
const rows = (count: number, start = 0) => Array.from({ length: count }, (_, i) => ({ id: start + i }));
function client(...responses: unknown[]) {
  return { checkedAt: "", expiresAt: "", post: vi.fn().mockImplementation(async () => {
    const result = responses.shift(); if (result instanceof Error) throw result; return result;
  }) } as Awaited<ReturnType<typeof createGerpgoClient>>;
}
const options = { pause: vi.fn().mockResolvedValue(undefined) };
describe("GERPgo full page collector", () => {
  it("selects one exact store identity across all its authorized markets", () => {
    const own = [1, 2, 3, 17].map(marketId => ({ serverName: "MEASUREMAN", serverId: 1, marketId }));
    const sellers = [{ marketListVos: [...own.slice(0, 3), { serverName: "Other", serverId: 2, marketId: 4 }] }, { marketListVos: own.slice(3) }];
    expect(resolveGerpgoStoreScope(sellers, " measureman ")).toEqual({ storeName: "MEASUREMAN", serverId: 1, marketIds: [1, 2, 3, 17] });
    expect(() => resolveGerpgoStoreScope(sellers, undefined)).toThrow();
    expect(() => resolveGerpgoStoreScope(sellers, "MEASURE")).toThrow();
    expect(() => resolveGerpgoStoreScope([{ marketListVos: [...own, { ...own[0], serverId: 99, marketId: 90 }] }], "MEASUREMAN")).toThrow();
    expect(() => resolveGerpgoStoreScope([{ marketListVos: [own[0], own[0]] }], "MEASUREMAN")).toThrow();
  });
  it("counts grouped shops by the explicit market total, not seller row count", async () => {
    const c = client({ total: 3, totalUnit: "markets", rows: [{ marketListVos: [{ marketId: 1 }, { marketId: 2 }] }] }, { total: 3, totalUnit: "markets", rows: [{ marketListVos: [{ marketId: 3 }] }] });
    const evidence: unknown[] = [];
    expect(await collectGerpgoPages(c, "/middle/base/market/page", {}, async page => { evidence.push(page); }, options)).toEqual({ pages: 2, total: 3, totalUnit: "markets" });
    expect(evidence).toHaveLength(2);
  });
  it("uses daily market scopes for ads and separate return/storage periods", () => {
    const sources = gerpgoSupplementalSources([{ condition: { beginDate: "2026-09-29", endDate: "2026-09-30" } }], [1, 2, 1]);
    expect(sources.filter(source => source.name.startsWith("ads-")).length).toBe(4);
    expect(sources.find(source => source.name === "ads-2-2026-09-30")?.condition).toEqual({ marketId: 2, startDateData: "2026-09-30", endDateData: "2026-09-30" });
    expect(sources.find(source => source.name.startsWith("storage-"))?.condition).toEqual({ year: "2026", month: "9" });
    expect(sources.find(source => source.name.startsWith("returns-"))?.condition).toEqual({ returnStartDate: "2026-09-29", returnEndDate: "2026-09-30" });
    expect(() => gerpgoSupplementalSources([{ condition: {} }], [1])).toThrow();
  });
  it("streams every page without exposing a token", async () => {
    const saved: number[] = [], c = client({ total: 201, rows: rows(100), page: 1 }, { total: 201, rows: rows(100, 100), page: 2 }, { total: 201, rows: rows(1, 200), page: 3 });
    expect(await collectGerpgoPages(c, endpoint, {}, async page => { saved.push(...page.rows.map(row => Number(row.id))); }, options)).toEqual({ pages: 3, total: 201 });
    expect(new Set(saved).size).toBe(201);
    expect(c.post).toHaveBeenLastCalledWith(endpoint, { page: 3, pagesize: 100 });
  });
  it("uses top-level performance parameters, but nested shop conditions", async () => {
    const c = client({ total: 0, rows: [] }, { total: 0, rows: [] });
    const filters = { beginDate: "2026-09-01", endDate: "2026-09-30", showCurrencyType: "YUAN" };
    await collectGerpgoPages(c, "/operation/sts/productAnalyzeMultiIndex/page", filters, async () => {}, options);
    expect(c.post).toHaveBeenNthCalledWith(1, "/operation/sts/productAnalyzeMultiIndex/page", { ...filters, page: 1, pagesize: 100 });
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
