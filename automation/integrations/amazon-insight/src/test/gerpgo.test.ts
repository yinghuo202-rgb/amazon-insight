import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkGerpgoConnection, getGerpgoConfigurationStatus } from "@/lib/inventory/gerpgo";

const env = { GERPGO_APP_ID: "test-app-id", GERPGO_APP_KEY: "test-private-key" };
const token = { code: 200, data: { accessToken: "test-private-token", expiresIn: 86400 } };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const mockFetch = (...responses: Response[]) => vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);

describe("GERPgo read-only connection check", () => {
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
