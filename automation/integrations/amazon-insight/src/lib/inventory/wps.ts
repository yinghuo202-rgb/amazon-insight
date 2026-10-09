// Official KDocs OAuth/download adapter. Never read or persist browser cookies.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { openRefreshDatabase } from "@/lib/inventory/refresh-task-store";
import { runtimePath } from "@/lib/inventory/paths";

const context = "measureman:wps-credentials:v1", host = "https://developer.kdocs.cn";
export const wpsSettingsSchema = z.object({ appId: z.string().trim().min(1).max(512), appKey: z.string().trim().min(1).max(4096), fileToken: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,200}$/), shareUrl: z.url().refine(value => validShareUrl(value)) }).strict();
type Settings = z.infer<typeof wpsSettingsSchema> & { accessToken?: string; refreshToken?: string; expiresAt?: string; revision?: string };
export class WpsError extends Error { constructor(message: string, public readonly httpStatus = 422) { super(message); } }
export function validShareUrl(value: string) {
  try { const u = new URL(value); return u.protocol === "https:" && ["www.kdocs.cn", "kdocs.cn"].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash && /^\/l\/[a-zA-Z0-9]+\/?$/.test(u.pathname); } catch { return false; }
}
function key() {
  if ((process.env.SECRET_KEY?.trim().length ?? 0) < 32) throw new WpsError("WPS 授权需要保留至少 32 字符的 SECRET_KEY。");
  return createHash("sha256").update(context + process.env.SECRET_KEY!.trim()).digest();
}
function readSettings(): Settings {
  const db = openRefreshDatabase();
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wps_credentials_v1'").get();
    const row = exists ? db.prepare("SELECT * FROM wps_credentials_v1 WHERE id=1").get() : null;
    if (row) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(String(row.iv), "base64"));
        decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(String(row.auth_tag), "base64"));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(String(row.ciphertext), "base64")), decipher.final()]).toString("utf8"));
      } catch { throw new WpsError("WPS 凭证无法解密，请检查原 SECRET_KEY 或重新授权。"); }
    }
    const parsed = wpsSettingsSchema.safeParse({ appId: process.env.STORE_OPS_WPS_APP_ID, appKey: process.env.STORE_OPS_WPS_APP_KEY,
      fileToken: process.env.STORE_OPS_WPS_INVENTORY_FILE_TOKEN, shareUrl: process.env.STORE_OPS_WPS_INVENTORY_URL });
    if (!parsed.success) throw new WpsError("待 WPS 应用授权：请填写 APPID、APPKEY、库存文件 ID 和分享链接。");
    return { ...parsed.data, revision: "env" };
  } finally { db.close(); }
}
function persist(value: Settings, expectedRevision?: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv); cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  const db = openRefreshDatabase();
  try {
    db.exec("BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS wps_credentials_v1(id INTEGER PRIMARY KEY CHECK(id=1),ciphertext TEXT NOT NULL,iv TEXT NOT NULL,auth_tag TEXT NOT NULL,revision TEXT NOT NULL)");
    const old = db.prepare("SELECT revision FROM wps_credentials_v1 WHERE id=1").get();
    if (expectedRevision && (old ? String(old.revision) : "env") !== expectedRevision) throw new WpsError("WPS 配置已变化，请重新授权或重试同步。");
    db.prepare("INSERT INTO wps_credentials_v1 VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,revision=excluded.revision").run(ciphertext.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), value.revision!);
    // Changing app/file settings invalidates the authority of an in-flight automatic publish.
    if (!expectedRevision) {
      db.prepare("UPDATE data_sync_schedules_v1 SET enabled=0,last_task_id=NULL WHERE key='wps_inventory'").run();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('wps-configuration-save','completed',?,?,?)").run(now, now, JSON.stringify({ fileToken: value.fileToken, actor: "shared-account" }));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
export function getWpsStatus() {
  try { const c = readSettings(); return { configured: true, authorized: Boolean(c.refreshToken), fileToken: c.fileToken, shareUrl: c.shareUrl, expiresAt: c.expiresAt ?? null,
    message: c.refreshToken ? "已保存 WPS 授权；是否成功更新以同步任务和发布版本为准。" : "应用已配置，请点击授权库存表。" }; }
  catch (error) { return { configured: false, authorized: false, fileToken: "", shareUrl: validShareUrl(process.env.STORE_OPS_WPS_INVENTORY_URL ?? "") ? process.env.STORE_OPS_WPS_INVENTORY_URL! : "", expiresAt: null, message: error instanceof WpsError ? error.message : "WPS 配置读取失败，请检查运营数据库。" }; }
}
export function saveWpsSettings(input: unknown) {
  const parsed = wpsSettingsSchema.parse(input);
  if (/[\u0000-\u001f\u007f]/.test(parsed.appId + parsed.appKey)) throw new WpsError("WPS 应用凭证格式无效。");
  persist({ ...parsed, revision: randomBytes(16).toString("hex") });
  return getWpsStatus();
}
function callbackUrl(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new WpsError("WPS 授权需要 HTTPS 网站地址。");
  return url.origin + "/api/inventory/data-refresh?wps_callback=1";
}
export function beginWpsAuthorization(userId: string, origin: string) {
  const c = readSettings(), state = randomBytes(32).toString("hex"), db = openRefreshDatabase();
  try {
    db.exec("CREATE TABLE IF NOT EXISTS wps_oauth_states_v1(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,revision TEXT NOT NULL,expires_at TEXT NOT NULL)");
    db.prepare("DELETE FROM wps_oauth_states_v1 WHERE expires_at<?").run(new Date().toISOString());
    db.prepare("INSERT INTO wps_oauth_states_v1 VALUES(?,?,?,?)").run(createHash("sha256").update(state).digest("hex"), userId, c.revision!, new Date(Date.now() + 300000).toISOString());
  } finally { db.close(); }
  const u = new URL(host + "/h5/auth"); u.search = new URLSearchParams({ app_id: c.appId, scope: "download_personal_files", redirect_uri: callbackUrl(origin), state }).toString();
  // force_login is intentionally omitted: the user may authorize with the existing WPS session.
  return u.href;
}
async function api(url: URL, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  try {
    const r = await fetcher(url, { ...init, headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(30000), cache: "no-store" });
    if (!r.ok) throw new WpsError(`WPS 接口返回 HTTP ${r.status}，请检查授权或稍后重试。`);
    const d = await r.json();
    if (d.code !== 0 || !d.data) throw new WpsError("WPS 授权过期、权限不足或接口返回异常，请重新授权并检查文件权限。");
    return d.data;
  } catch (error) { if (error instanceof WpsError) throw error; throw new WpsError("无法连接 WPS 官方接口；旧数据保留。", 502); }
}
function tokens(data: Record<string, unknown>, c: Settings): Settings {
  if (data.app_id !== c.appId || typeof data.access_token !== "string" || !data.access_token || typeof data.refresh_token !== "string" || !data.refresh_token || !Number.isInteger(data.expires_in) || Number(data.expires_in) <= 0) throw new WpsError("WPS 令牌结构或所属应用异常，授权未保存。");
  return { ...c, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() };
}
export async function finishWpsAuthorization(userId: string, code: string, state: string, fetcher: typeof fetch = fetch) {
  if (!/^[a-f0-9]{64}$/.test(state) || !code || code.length > 2048) throw new WpsError("WPS 授权回调无效，请重新授权。");
  const c = readSettings(), db = openRefreshDatabase();
  try {
    const row = db.prepare("DELETE FROM wps_oauth_states_v1 WHERE hash=? AND user_id=? AND revision=? AND expires_at>=? RETURNING hash").get(createHash("sha256").update(state).digest("hex"), userId, c.revision!, new Date().toISOString());
    if (!row) throw new WpsError("WPS 授权已过期、已使用或账号不匹配，请重新授权。");
  } finally { db.close(); }
  const u = new URL(host + "/api/v1/oauth2/access_token"); u.search = new URLSearchParams({ code, app_id: c.appId, app_key: c.appKey }).toString();
  persist({ ...tokens(await api(u, {}, fetcher), c), revision: randomBytes(16).toString("hex") }, c.revision);
}
async function authorizedSettings(fetcher: typeof fetch) {
  let c = readSettings();
  if (!c.refreshToken) throw new WpsError("WPS 尚未授权，请在数据更新页授权库存表。");
  if (!c.accessToken || !c.expiresAt || Date.parse(c.expiresAt) < Date.now() + 60000) {
    const u = new URL(host + "/api/v1/oauth2/refresh_token"); u.searchParams.set("app_id", c.appId);
    const next = tokens(await api(u, { method: "POST", body: JSON.stringify({ app_key: c.appKey, refresh_token: c.refreshToken }) }, fetcher), c);
    persist(next, c.revision); c = next;
  }
  return c;
}
// Downloads use only provider-issued HTTPS hosts; no token is sent to the object store.
export function validateWpsDownloadUrl(value: string) {
  const u = new URL(value), suffixes = [".kdocs.cn", ".wps.cn", ".ksyun.com", ".kingsoft.com"];
  if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443" || !suffixes.some(s => u.hostname.endsWith(s))) throw new WpsError("WPS 下载地址不在官方 HTTPS 存储范围，已停止下载。");
  return u;
}
export async function downloadWpsInventory(taskId: string, fetcher: typeof fetch = fetch) {
  if (!z.uuid().safeParse(taskId).success) throw new WpsError("WPS 同步任务编号无效。");
  const c = await authorizedSettings(fetcher), u = new URL(host + "/api/v1/openapi/personal/files/" + c.fileToken + "/download");
  u.searchParams.set("access_token", c.accessToken!);
  const d = await api(u, {}, fetcher), max = 300 * 1024 * 1024;
  if (!Number.isSafeInteger(d.fsize) || d.fsize <= 0 || d.fsize > max || !/^[a-f0-9]{40}$/i.test(d.checksums?.sha1) || typeof d.url !== "string") throw new WpsError("WPS 文件大小或校验信息不完整，旧数据保留。");
  const download = validateWpsDownloadUrl(d.url);
  const addresses = await lookup(download.hostname, { all: true });
  if (!addresses.length || addresses.some(a => /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::|fc|fd|fe80|::ffff:)/i.test(a.address))) throw new WpsError("WPS 下载地址解析异常，已停止下载。");
  let buffer: Buffer;
  try {
    const r = await fetcher(download, { redirect: "error", signal: AbortSignal.timeout(120000), cache: "no-store" });
    if (!r.ok || !r.body) throw new WpsError("WPS 文件下载失败，旧数据保留。");
    const chunks: Buffer[] = []; let size = 0;
    const reader = r.body.getReader();
    try {
      while (true) { const { value: chunk, done } = await reader.read(); if (done) break; size += chunk.length; if (size > d.fsize || size > max) { await reader.cancel(); throw new WpsError("WPS 下载内容超过声明大小。"); } chunks.push(Buffer.from(chunk)); }
    } finally { reader.releaseLock(); }
    buffer = Buffer.concat(chunks);
  } catch (error) { if (error instanceof WpsError) throw error; throw new WpsError("WPS 下载中断，请稍后重试；旧数据保留。"); }
  if (buffer.length !== d.fsize || createHash("sha1").update(buffer).digest("hex") !== d.checksums.sha1.toLowerCase() || buffer.subarray(0, 4).toString("hex") !== "504b0304") throw new WpsError("WPS 文件校验失败或不是 Excel 文件，禁止导入。");
  const folder = runtimePath("incoming", "wps", taskId); await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, "库存规划.xlsx"); await writeFile(file, buffer, { mode: 0o600, flag: "wx" });
  return { file, fileToken: c.fileToken, shareUrl: c.shareUrl };
}
