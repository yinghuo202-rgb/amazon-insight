import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkGerpgoConnection, collectGerpgoPages, createGerpgoClient, getGerpgoConfigurationStatus } from "@/lib/inventory/gerpgo";

const env = { GERPGO_APP_ID: "test-app-id", GERPGO_APP_KEY: "test-private-key" };
const token = { code: 200, data: { accessToken: "test-private-token", expiresIn: 86400 } };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const mockFetch = (...responses: Response[]) => vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);

describe("GERPgo read-only connection check", () => {
  it("retries a transport timeout on the same advertising page and emits each row once", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const ad = { marketId: 1, msku: "SKU-TIMEOUT", asin: "ASIN-TIMEOUT", cost: 1 };
    fetcher.mockResolvedValueOnce(json(token));
    fetcher.mockRejectedValueOnce(new DOMException("private-provider-details", "TimeoutError"));
    fetcher.mockResolvedValueOnce(json({ code: 200, data: { rows: [ad], total: 1 } }));
    const client = await createGerpgoClient(env, fetcher), saved: unknown[] = [], pauses: number[] = [];
    const result = await collectGerpgoPages(client, "/operation/ads/adsAsinAnalytical/page", { marketId: 1 }, async page => { saved.push(...page.rows); }, { pause: async ms => { pauses.push(ms); } });
    expect(result).toMatchObject({ pages: 1, total: 1 });
    expect(saved).toEqual([ad]);
    expect(pauses).toEqual([6000, 6000]);
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[2][1]?.body);
  });
  it("stops persistent transport failure after three paced attempts without emitting partial rows", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockRejectedValue(new Error("private-provider-details"));
    const client = await createGerpgoClient(env, fetcher), saved: unknown[] = [], pauses: number[] = [];
    const error = await collectGerpgoPages(client, "/operation/ads/adsAsinAnalytical/page", { marketId: 1 }, async page => { saved.push(...page.rows); }, { pause: async ms => { pauses.push(ms); } }).catch(value => value);
    expect(error).toMatchObject({ httpStatus: 502 });
    expect(String(error)).not.toContain("private-provider-details");
    expect(saved).toEqual([]);
    expect(pauses).toEqual([6000, 6000, 6000]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not retry business failure disguised as 502 or an authorization rejection", async () => {
    for (const response of [json({ code: 400, messages: ["private-provider-details"] }), json({ code: 403 }), new Response("private-provider-details", { status: 502 })]) {
      const fetcher = mockFetch(json(token), response);
      const client = await createGerpgoClient(env, fetcher), saved: unknown[] = [], pauses: number[] = [];
      const error = await collectGerpgoPages(client, "/operation/ads/adsAsinAnalytical/page", { marketId: 1 }, async page => { saved.push(...page.rows); }, { pause: async ms => { pauses.push(ms); } }).catch(value => value);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("private-provider-details");
      expect(saved).toEqual([]);
      expect(pauses).toEqual([6000]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("retries business code 509 through the real client without exposing provider messages", async () => {
    const fetcher = mockFetch(json(token), json({ code: 509, messages: ["private-provider-details"] }), json({ code: 200, data: { rows: [], total: 0 } }));
    const client = await createGerpgoClient(env, fetcher);
    const pauses: number[] = [];
    expect(await collectGerpgoPages(client, "/operation/sts/listingAnalyzeMultiIndex/page", { marketList: [1] }, async () => {}, { pause: async ms => { pauses.push(ms); } })).toEqual({ pages: 1, total: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pauses).toEqual([6000, 6000]);
    const bounded = mockFetch(json(token), ...Array.from({ length: 3 }, () => json({ code: 509, messages: ["private-provider-details"] })));
    const failing = await createGerpgoClient(env, bounded);
    const error = await collectGerpgoPages(failing, "/operation/sts/listingAnalyzeMultiIndex/page", { marketList: [1] }, async () => {}, { pause: async () => {} }).catch(value => value);
    expect(error).toMatchObject({ httpStatus: 509 });
    expect(String(error)).not.toContain("private-provider-details");
    expect(bounded).toHaveBeenCalledTimes(4);
  });
  it("renews an expiring token once, keeping it inside the server client", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = mockFetch(json({ code: 200, data: { accessToken: "old-token", expiresIn: 10 } }), json({ code: 200, data: { accessToken: "new-token", expiresIn: 10 } }), json({ code: 200, data: { rows: [] } }));
      const client = await createGerpgoClient(env, fetcher);
      vi.setSystemTime(Date.now() + 9000);
      await client.post("/purchase/goods/product/page", { page: 1, pagesize: 100 });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({ accessToken: "new-token" });
      expect(JSON.stringify(client)).not.toContain("new-token");
    } finally { vi.useRealTimers(); }
  });
  it("returns only safe configuration status, never credentials", () => {
    expect(getGerpgoConfigurationStatus({}).configured).toBe(false);
    const result = getGerpgoConfigurationStatus(env);
    expect(result.configured).toBe(true);
    expect(result.message).toContain("等待连接检查");
    expect(JSON.stringify(result)).not.toContain(env.GERPGO_APP_KEY);
    expect(JSON.stringify(result)).not.toContain(env.GERPGO_APP_ID);
  });
  it.each([
    {}, { ...env, GERPGO_BASE_URL: "http://open.gerpgo.com/api/open" },
    { ...env, GERPGO_BASE_URL: "https://attacker.invalid/api/open" },
    { ...env, GERPGO_BASE_URL: "https://secret@open.gerpgo.com/api/open" },
    { ...env, GERPGO_SIGNING_ENABLED: "yes" }, { ...env, GERPGO_TIMEOUT_MS: "0" },
  ])("rejects missing or unsafe configuration before sending credentials", async config => {
    const fetcher = mockFetch();
    await expect(checkGerpgoConnection(config, fetcher)).rejects.toMatchObject({ httpStatus: 422 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the documented token and store request and signs the exact serialized body", async () => {
    const fetcher = mockFetch(json(token), json({ code: 200, data: { rows: [{ sellerId: "private-seller-id" }], total: 87 } }));
    const result = await checkGerpgoConnection(env, fetcher);
    const [authUrl, auth] = fetcher.mock.calls[0];
    expect(authUrl).toBe("https://open.gerpgo.com/api/open/api_token");
    expect(JSON.parse(String(auth?.body))).toEqual({ appId: env.GERPGO_APP_ID, appKey: env.GERPGO_APP_KEY });
    expect(auth).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    const [storeUrl, store] = fetcher.mock.calls[1];
    expect(storeUrl).toBe("https://open.gerpgo.com/api/open/middle/base/market/page");
    expect(JSON.parse(String(store?.body))).toEqual({ page: 1, pagesize: 1, condition: {} });
    expect(store?.headers).toMatchObject({ accessToken: token.data.accessToken, sign: createHash("md5").update(String(store?.body) + env.GERPGO_APP_KEY).digest("hex") });
    expect(result).toMatchObject({ status: "authorized", marketAccess: true, hasMarketRecords: true });
    expect(Date.parse(result.expiresAt) - Date.parse(result.checkedAt)).toBeGreaterThanOrEqual(86400000);
    for (const secret of [env.GERPGO_APP_KEY, env.GERPGO_APP_ID, token.data.accessToken, "private-seller-id"]) expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.message).toContain("业务数据尚未同步");
  });
  it("supports explicitly disabling the optional request signature", async () => {
    const fetcher = mockFetch(json(token), json({ code: 200, data: { rows: [] } }));
    const result = await checkGerpgoConnection({ ...env, GERPGO_SIGNING_ENABLED: "false" }, fetcher);
    expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty("sign");
    expect(result).toMatchObject({ marketAccess: true, hasMarketRecords: false });
    expect(result.message).toContain("未返回店铺记录");
  });
  it.each([
    { code: 403, messages: [env.GERPGO_APP_KEY, token.data.accessToken] },
    { code: 200, data: { accessToken: "", expiresIn: 86400 } },
    { code: 200, data: { accessToken: "secret", expiresIn: -1 } },
    { code: 200, data: { accessToken: "secret", expiresIn: "86400" } },
    { code: 200, data: { accessToken: "secret", expiresIn: 1e100 } },
    { code: 200, data: null },
  ])("fails closed for invalid token responses without echoing provider data", async response => {
    const fetcher = mockFetch(json(response));
    const error = await checkGerpgoConnection(env, fetcher).catch(value => value as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(env.GERPGO_APP_KEY);
    expect(String(error)).not.toContain(token.data.accessToken);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([new Response("private secret body", { status: 403 }), new Response("bad JSON"), json({}, 429)])("does not echo HTTP or JSON response bodies", async response => {
    const second = response.clone();
    await expect(checkGerpgoConnection(env, mockFetch(response))).rejects.toThrow();
    const failure = await checkGerpgoConnection(env, mockFetch(second)).catch(error => String(error));
    expect(failure).not.toContain("private secret body");
  });
  it("reports token success separately from failed store access", async () => {
    const result = await checkGerpgoConnection(env, mockFetch(json(token), json({ code: 403, messages: [env.GERPGO_APP_KEY] })));
    expect(result).toMatchObject({ status: "authenticated", marketAccess: false });
    expect(result.message).toContain("店铺读取检查未通过");
    expect(result.message).not.toContain(env.GERPGO_APP_KEY);
  });
  it("does not treat malformed store data as readable", async () => {
    expect(await checkGerpgoConnection(env, mockFetch(json(token), json({ code: 200, data: {} })))).toMatchObject({ marketAccess: false });
  });
  it("redacts network exception messages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(env.GERPGO_APP_KEY));
    await expect(checkGerpgoConnection(env, fetcher)).rejects.toThrow("无法连接积加接口");
  });
});
