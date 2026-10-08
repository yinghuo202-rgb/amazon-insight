// Server-side only: imported by the data page and its existing route handler.
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";
import { operatingMarkets } from "@/lib/inventory/operating-performance";

type Environment = Record<string, string | undefined>;
export type GerpgoSettingsStatus = {
  configured: boolean;
  canSave: boolean;
  source: "database" | "env" | "missing";
  updatedAt: string | null;
  message: string;
};
export type GerpgoConnectionResult = {
  status: "authorized" | "authenticated";
  checkedAt: string;
  expiresAt: string;
  marketAccess: boolean;
  hasMarketRecords: boolean;
  message: string;
};

export class GerpgoConnectionError extends Error {
  constructor(message: string, public readonly httpStatus = 502) { super(message); }
}

function configuration(env: Environment) {
  const appId = env.GERPGO_APP_ID?.trim() ?? "";
  const appKey = env.GERPGO_APP_KEY?.trim() ?? "";
  const baseUrl = (env.GERPGO_BASE_URL?.trim() || "https://open.gerpgo.com/api/open").replace(/\/$/, "");
  const signing = env.GERPGO_SIGNING_ENABLED?.trim() || "true";
  const timeoutMs = Number(env.GERPGO_TIMEOUT_MS?.trim() || "10000");
  let error = "";
  if (!appId || !appKey) error = "尚未配置积加凭证，请在此页面填写 appId 和 appKey，或配置 NAS 环境变量。";
  // Never send credentials to a configurable third-party origin or a redirect.
  else if (baseUrl !== "https://open.gerpgo.com/api/open") error = "GERPGO_BASE_URL 必须使用积加官方 HTTPS 开放接口地址。";
  else if (!["true", "false"].includes(signing)) error = "GERPGO_SIGNING_ENABLED 只能为 true 或 false。";
  else if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) error = "GERPGO_TIMEOUT_MS 必须是 1000–30000 的整数。";
  return { appId, appKey, baseUrl, signing: signing === "true", timeoutMs, error };
}

export function getGerpgoConfigurationStatus(env: Environment = process.env) {
  const config = configuration(env);
  return { configured: !config.error, message: config.error || "服务端凭证已配置，等待连接检查。业务数据尚未同步。" };
}

const credentialContext = "measureman:gerpgo-credentials:v1";
function encryptionKey(env: Environment) {
  const secret = env.SECRET_KEY?.trim() ?? "";
  if (secret.length < 32) throw new GerpgoConnectionError("网页保存凭证需要 NAS 配置至少 32 字符的 SECRET_KEY；请沿用已有密钥，不要随意更换。", 422);
  return createHash("sha256").update(credentialContext + secret).digest();
}

function savedCredentials(database: DatabaseSync) {
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gerpgo_credentials'").get()) return null;
  return database.prepare("SELECT ciphertext,iv,auth_tag,updated_at FROM gerpgo_credentials WHERE id=1").get();
}

function decryptCredentials(row: Record<string, unknown>, env: Environment) {
  const key = encryptionKey(env);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(row.iv), "base64"));
    decipher.setAAD(Buffer.from(credentialContext));
    decipher.setAuthTag(Buffer.from(String(row.auth_tag), "base64"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(String(row.ciphertext), "base64")), decipher.final()]).toString("utf8"));
    if (typeof value.appId !== "string" || !value.appId.trim() || typeof value.appKey !== "string" || !value.appKey.trim()) throw new Error("Invalid credentials");
    return { ...env, GERPGO_APP_ID: value.appId, GERPGO_APP_KEY: value.appKey };
  } catch { throw new GerpgoConnectionError("已保存的积加凭证无法解密，请检查 SECRET_KEY 是否改变；恢复原密钥或重新填写两项凭证。", 422); }
}

// A saved pair overrides the environment pair, never mixing values from two sources.
export function resolveGerpgoEnvironment(env: Environment = process.env): Environment {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(shipmentPlanDbPath(), { readOnly: true });
    const row = savedCredentials(database);
    return row ? decryptCredentials(row, env) : env;
  } catch (error) {
    throw error instanceof GerpgoConnectionError ? error : new GerpgoConnectionError("无法读取积加配置，请检查 NAS 运营数据库和数据卷权限。", 500);
  } finally { database?.close(); }
}

export function getGerpgoSettingsStatus(env: Environment = process.env): GerpgoSettingsStatus {
  let database: DatabaseSync | undefined;
  const canSave = (env.SECRET_KEY?.trim().length ?? 0) >= 32;
  try {
    database = new DatabaseSync(shipmentPlanDbPath(), { readOnly: true });
    const row = savedCredentials(database);
    const effective = row ? decryptCredentials(row, env) : env;
    const status = getGerpgoConfigurationStatus(effective);
    return { ...status, canSave, source: row ? "database" : effective.GERPGO_APP_ID?.trim() && effective.GERPGO_APP_KEY?.trim() ? "env" : "missing", updatedAt: row ? String(row.updated_at) : null };
  } catch (error) {
    return { configured: false, canSave, source: "missing", updatedAt: null, message: error instanceof GerpgoConnectionError ? error.message : "无法读取积加配置，请检查 NAS 运营数据库和数据卷权限。" };
  } finally { database?.close(); }
}

export function saveGerpgoCredentials(input: { appId: string; appKey: string }, env: Environment = process.env): GerpgoSettingsStatus {
  const appId = input.appId.trim(), appKey = input.appKey.trim();
  if (!appId || !appKey || appId.length > 512 || appKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(appId + appKey)) throw new GerpgoConnectionError("请填写有效的 appId 和 appKey。", 422);
  const key = encryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(credentialContext));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ appId, appKey }), "utf8"), cipher.final()]);
  let database: DatabaseSync | undefined;
  const now = new Date().toISOString();
  try {
    database = new DatabaseSync(shipmentPlanDbPath());
    database.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS gerpgo_credentials(id INTEGER PRIMARY KEY CHECK(id=1),ciphertext TEXT NOT NULL,iv TEXT NOT NULL,auth_tag TEXT NOT NULL,updated_at TEXT NOT NULL)");
    database.prepare("INSERT INTO gerpgo_credentials(id,ciphertext,iv,auth_tag,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,updated_at=excluded.updated_at").run(ciphertext.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), now);
    database.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('gerpgo-credentials-save','completed',?,?,?)").run(now, now, JSON.stringify({ credentialsUpdated: true }));
    database.exec("COMMIT");
  } catch {
    try { database?.exec("ROLLBACK"); } catch { /* Never emit raw SQLite errors. */ }
    throw new GerpgoConnectionError("保存积加凭证失败，请检查 NAS 运营数据库写入权限。", 500);
  } finally { database?.close(); }
  return getGerpgoSettingsStatus(env);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Resolve a configured store by the provider's exact server identity, not SKU/brand guesses. */
export function resolveGerpgoStoreScope(sellers: Record<string, unknown>[], storeName: string | undefined) {
  const name = storeName?.trim();
  if (!name || name.length > 100) throw new GerpgoConnectionError("请配置 GERPGO_STORE_NAME 指定唯一店铺；不允许默认汇总全部店铺。", 422);
  const shops = sellers.flatMap(seller => Array.isArray(seller.marketListVos) ? seller.marketListVos : []).filter(shop => typeof shop?.serverName === "string" && shop.serverName.trim().toLowerCase() === name.toLowerCase());
  const serverIds = new Set(shops.map(shop => shop.serverId));
  if (!shops.length || serverIds.size !== 1 || !Number.isSafeInteger([...serverIds][0]) || [...serverIds][0] <= 0) throw new GerpgoConnectionError("指定店铺未找到或店铺名称对应多个身份，请核对积加店铺配置。", 422);
  const marketIds = shops.map(shop => shop.marketId);
  if (marketIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(marketIds).size !== marketIds.length) throw new GerpgoConnectionError("指定店铺的站点标识缺失或重复，不能确认范围。", 422);
  const included = shops.filter(shop => operatingMarkets.some(market => shop.market === `amazon-${market.toLowerCase()}`)).map(shop => shop.marketId);
  if (!included.length) throw new GerpgoConnectionError("指定店铺没有本站纳入的 US、CA、MX 站点。", 422);
  return { storeName: shops[0].serverName.trim() as string, serverId: shops[0].serverId as number, marketIds: included.sort((a, b) => a - b) as number[] };
}

/** Shared server client. Tokens never leave this closure. */
export async function createGerpgoClient(env: Environment = process.env, fetcher: typeof fetch = fetch) {
  const config = configuration(env);
  if (config.error) throw new GerpgoConnectionError(config.error, 422);
  async function post(endpoint: string, payload: unknown, accessToken?: string) {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) {
      headers.accessToken = accessToken;
      if (config.signing) headers.sign = createHash("md5").update(body + config.appKey).digest("hex");
    }
    const signal = AbortSignal.timeout(config.timeoutMs);
    let response: Response;
    try {
      response = await fetcher(`${config.baseUrl}${endpoint}`, { method: "POST", headers, body, cache: "no-store", redirect: "error", signal });
    } catch {
      throw new GerpgoConnectionError(signal.aborted ? "积加接口请求超时，请检查 NAS 网络后重试。" : "无法连接积加接口，请检查 NAS 出站网络和 HTTPS 访问。", 502);
    }
    const stage = accessToken ? "店铺读取" : "凭证申请";
    if (response.status === 429) throw new GerpgoConnectionError("积加接口限流，请稍后重试。", 429);
    if (!response.ok) throw new GerpgoConnectionError(`积加${stage}失败（HTTP ${response.status}）；请核对凭证、出口 IP 白名单和开放平台权限。`);
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new GerpgoConnectionError("积加返回了无效响应，请检查接口服务状态。"); }
    const result = object(value);
    if (!result || result.code !== 200) throw new GerpgoConnectionError(`积加${stage}未通过；请核对 appId/appKey、NAS 公网出口 IP 白名单和开放平台权限。`);
    const data = object(result.data);
    if (!data) throw new GerpgoConnectionError("积加响应缺少有效数据，请检查接口服务状态。");
    const extra = object(result.extObj);
    // This endpoint reports market totals although rows are seller/region groups.
    return endpoint === "/middle/base/market/page" && extra && extra.marketCount === data.total && Number.isSafeInteger(extra.accountCount)
      ? { ...data, totalUnit: "markets" } : data;
  }

  async function authorize() {
    const token = await post("/api_token", { appId: config.appId, appKey: config.appKey });
    if (typeof token.accessToken !== "string" || !token.accessToken.trim() || typeof token.expiresIn !== "number" || !Number.isFinite(token.expiresIn) || token.expiresIn <= 0 || token.expiresIn > 31 * 86400) {
      throw new GerpgoConnectionError("积加响应缺少有效令牌或有效期，不能确认授权。");
    }
    return { value: token.accessToken, expires: Date.now() + token.expiresIn * 1000, refreshAt: Date.now() + token.expiresIn * 800 };
  }
  const checkedAt = new Date().toISOString();
  let token = await authorize();
  let refreshing: Promise<void> | null = null;
  return {
    checkedAt,
    expiresAt: new Date(token.expires).toISOString(),
    post: async (endpoint: string, payload: unknown) => {
      if (!gerpgoPageEndpoints.has(endpoint)) throw new GerpgoConnectionError("不支持的积加业务接口。", 422);
      if (Date.now() >= token.refreshAt) {
        refreshing ??= authorize().then(next => { token = next; }).finally(() => { refreshing = null; });
        await refreshing;
      }
      return post(endpoint, payload, token.value);
    },
  };
}

export const gerpgoPageEndpoints = new Set([
  "/middle/base/market/page", "/purchase/goods/product/page",
  "/operation/sts/productAnalyzeMultiIndex/page", "/purchase/store/fbaInventory/page/V2",
  "/operation/ads/adsAsinAnalytical/page", "/operation/sale/returnOrder/page", "/finance/asset/storageFee/page",
]);

/** Dates remain explicit evidence; advertising is a daily, market-specific API. */
export function gerpgoSupplementalSources(scopes: Array<{ condition: Record<string, unknown> }>, marketIds: number[]) {
  const sources: Array<{ name: string; endpoint: string; condition: Record<string, unknown> }> = [];
  for (const scope of scopes) {
    const begin = String(scope.condition.beginDate), end = String(scope.condition.endDate), month = begin.slice(0, 7);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(begin) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(begin)) || !Number.isFinite(Date.parse(end)) || begin > end || Date.parse(end) - Date.parse(begin) > 31 * 86400000 || marketIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new GerpgoConnectionError("积加补充采集范围无效。", 422);
    sources.push({ name: "returns-" + month, endpoint: "/operation/sale/returnOrder/page", condition: { returnStartDate: begin, returnEndDate: end } });
    sources.push({ name: "storage-" + month, endpoint: "/finance/asset/storageFee/page", condition: { year: month.slice(0, 4), month: String(Number(month.slice(5))) } });
    for (let date = new Date(begin + "T00:00:00Z"); date.toISOString().slice(0, 10) <= end; date = new Date(date.getTime() + 86400000)) {
      const day = date.toISOString().slice(0, 10);
      for (const marketId of [...new Set(marketIds)]) sources.push({ name: `ads-${marketId}-${day}`, endpoint: "/operation/ads/adsAsinAnalytical/page", condition: { marketId, startDateData: day, endDateData: day } });
    }
  }
  return sources;
}

/** Full collection fails closed on drift, duplicate pages, missing rows or invalid totals. */
export async function collectGerpgoPages(
  client: Awaited<ReturnType<typeof createGerpgoClient>>, endpoint: string,
  condition: Record<string, unknown>, onPage: (page: { rows: Record<string, unknown>[]; page: number; total: number; totalUnit?: "markets" }) => Promise<void>,
  options: { pause?: (ms: number) => Promise<void>; intervalMs?: number; maxPages?: number } = {},
) {
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const maxPages = options.maxPages ?? 10000, pagesize = 100;
  let expected: number | undefined, collected = 0;
  let expectedUnit: "rows" | "markets" | undefined;
  const hashes = new Set<string>(), recordHashes = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    // Conservative sequential rate, below the documented shop/product/FBA limits.
    await pause(options.intervalMs ?? 1200);
    let data: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const payload = endpoint === "/middle/base/market/page" ? { page, pagesize, condition } : { ...condition, page, pagesize };
        data = await client.post(endpoint, payload); break;
      }
      catch (error) {
        if (!(error instanceof GerpgoConnectionError) || error.httpStatus !== 429 || attempt === 2) throw error;
        await pause(2000 * 2 ** attempt);
      }
    }
    const total = data?.total, raw = data?.rows;
    if (!Number.isSafeInteger(total) || (total as number) < 0 || !Array.isArray(raw) || raw.length > pagesize || raw.some(row => !object(row))) throw new GerpgoConnectionError("积加分页格式变化，已停止采集；旧业务数据未修改。");
    if (expected !== undefined && total !== expected) throw new GerpgoConnectionError("积加分页总数发生变化，请重新拉取完整批次。");
    expected = total as number;
    const unit = endpoint === "/middle/base/market/page" && data!.totalUnit === "markets" ? "markets" : "rows";
    if (expectedUnit && expectedUnit !== unit) throw new GerpgoConnectionError("积加分页计数口径发生变化，已停止采集。");
    expectedUnit = unit;
    if (unit === "markets" && raw.some(row => !Array.isArray(row.marketListVos) || !row.marketListVos.length || row.marketListVos.some((market: unknown) => !object(market)))) throw new GerpgoConnectionError("积加店铺分组缺少有效站点，不能确认完整性。");
    const count = unit === "markets" ? raw.reduce((sum, row) => sum + row.marketListVos.length, 0) : raw.length;
    if (data!.page !== undefined && Number(data!.page) !== page) throw new GerpgoConnectionError("积加返回页码不匹配，已停止采集。");
    const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    if (raw.length && hashes.has(hash)) throw new GerpgoConnectionError("积加重复返回相同分页，不能确认完整性。");
    hashes.add(hash);
    for (const row of raw) {
      const fingerprint = createHash("sha256").update(JSON.stringify(row)).digest("hex");
      if (recordHashes.has(fingerprint)) throw new GerpgoConnectionError("积加存在重复记录，需核查来源主键后重新拉取。");
      recordHashes.add(fingerprint);
    }
    if (collected + count > expected || (raw.length === 0 && collected !== expected) || (unit === "rows" && collected + count < expected && raw.length !== pagesize)) throw new GerpgoConnectionError("积加分页缺失或记录数不一致，不能发布。");
    await onPage({ rows: raw as Record<string, unknown>[], page, total: expected, ...(unit === "markets" ? { totalUnit: "markets" as const } : {}) });
    collected += count;
    if (collected === expected) return { pages: page, total: collected, ...(unit === "markets" ? { totalUnit: "markets" as const } : {}) };
  }
  throw new GerpgoConnectionError("积加分页超过采集上限，批次未完成。");
}

/** Read-only handshake. No token, key, seller record or raw provider error escapes. */
export async function checkGerpgoConnection(env: Environment = process.env, fetcher: typeof fetch = fetch): Promise<GerpgoConnectionResult> {
  const client = await createGerpgoClient(env, fetcher);
  const checkedAt = client.checkedAt;
  const expiresAt = client.expiresAt;
  try {
    const markets = await client.post("/middle/base/market/page", { page: 1, pagesize: 1, condition: {} });
    if (!Array.isArray(markets.rows)) throw new GerpgoConnectionError("店铺接口响应格式无效，不能确认读取权限。");
    const hasMarketRecords = markets.rows.length > 0;
    return { status: "authorized", checkedAt, expiresAt, marketAccess: true, hasMarketRecords, message: hasMarketRecords ? "凭证有效，店铺接口可读取。销售、广告、库存等权限尚未逐项验证，业务数据尚未同步。" : "凭证有效，店铺接口可读取，但未返回店铺记录。请确认授权范围；业务数据尚未同步。" };
  } catch (error) {
    return { status: "authenticated", checkedAt, expiresAt, marketAccess: false, hasMarketRecords: false, message: `凭证有效，但店铺读取检查未通过。${error instanceof GerpgoConnectionError ? error.message : "请检查店铺权限。"}业务数据尚未同步。` };
  }
}
