import { getCurrentUser } from "@/lib/auth";
import { getDataRefreshStatus, runGerpgoConnectionCheck } from "@/lib/inventory/data-refresh";
import { GerpgoConnectionError, saveGerpgoCredentials } from "@/lib/inventory/gerpgo";
import { z } from "zod";
import { getGerpgoSettingsStatus } from "@/lib/inventory/gerpgo";
import { listRefreshTasks, submitRefreshTask, listSyncSchedules, saveSyncSchedule, syncScheduleSchema, restartSyncSchedule } from "@/lib/inventory/refresh-task-store";
import { operatingRulesSchema } from "@/lib/inventory/operating-rules";
import { gerpgoReviewRequestSchema, readGerpgoPreview, readGerpgoCandidatePage, readGerpgoCollectionSummary } from "@/lib/inventory/gerpgo-preview";
import { saveOperatingRuleOverride } from "@/lib/inventory/operating-rules-store";
import { operatingMarkets } from "@/lib/inventory/operating-performance";
import { getWpsStatus, saveWpsSettings, wpsSettingsSchema, beginWpsAuthorization, finishWpsAuthorization, WpsError } from "@/lib/inventory/wps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if (params.get("wps_callback") === "1") {
    let result = "authorized";
    try { await finishWpsAuthorization(user.id, params.get("code") ?? "", params.get("state") ?? ""); }
    catch { result = "error"; }
    return new Response(null, { status: 303, headers: { Location: "/inventory/data?wps=" + result, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  const collectionId = new URL(request.url).searchParams.get("collection");
  if (collectionId) {
    try { return Response.json({ collection: await readGerpgoCollectionSummary(collectionId) }, { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "采集清单尚未生成或无法读取，请查看任务状态。" }, { status: 422 }); }
  }
  const previewId = new URL(request.url).searchParams.get("preview");
  if (previewId) {
    const params = new URL(request.url).searchParams, offset = Number(params.get("offset") ?? "0");
    if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: "预览位置无效。" }, { status: 400 });
    try {
      const preview = await readGerpgoPreview(previewId);
      if (params.has("version") && params.get("version") !== preview.previewHash) return Response.json({ error: "预览已更新，请重新打开。" }, { status: 409 });
      return Response.json({ preview, ...await readGerpgoCandidatePage(previewId, offset) }, { headers: { "Cache-Control": "no-store" } });
    }
    catch { return Response.json({ error: "预览尚未生成或校验失败，请查看任务状态。" }, { status: 422 }); }
  }
  if (new URL(request.url).searchParams.get("tasks") === "1") return Response.json({ tasks: listRefreshTasks(), schedules: listSyncSchedules(), wps: getWpsStatus(), gerpgoConfigured: getGerpgoSettingsStatus().configured }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ ...await getDataRefreshStatus(), tasks: listRefreshTasks() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  let origin: URL;
  try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url); }
  catch { return Response.json({ error: "网站公开地址配置无效。" }, { status: 500 }); }
  if (request.headers.get("origin") !== origin.origin) return Response.json({ error: "请从本站执行数据更新。" }, { status: 403 });
  const body = await request.text();
  if (body.trim()) {
    if (body.length > 8192) return Response.json({ error: "请求内容过大。" }, { status: 413 });
    let payload;
    try { payload = JSON.parse(body); }
    catch { return Response.json({ error: "请求格式无效。" }, { status: 400 }); }
    if (["save_sync_schedule", "restart_sync_schedule", "save_wps_settings", "authorize_wps", "pull_wps"].includes(payload?.action)) {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ error: "请从本站数据更新页面操作。" }, { status: 403 });
      try {
        if (payload.action === "restart_sync_schedule") {
          const parsed = z.object({ action: z.literal("restart_sync_schedule"), key: z.enum(["gerpgo", "wps_inventory"]), acknowledged: z.literal(true) }).strict().safeParse(payload);
          if (!parsed.success) return Response.json({ error: "重新拉取需要明确确认，且仅支持已配置来源。" }, { status: 422 });
          try { return Response.json({ schedules: restartSyncSchedule(parsed.data.key) }, { headers: { "Cache-Control": "no-store" } }); }
          catch { return Response.json({ error: "请先开启同步；当前任务尚在执行时不能重新拉取。" }, { status: 409 }); }
        }
        if (payload.action === "save_sync_schedule") {
          const parsed = z.object({ action: z.literal("save_sync_schedule"), ...syncScheduleSchema.shape }).strict().safeParse(payload);
          if (!parsed.success) return Response.json({ error: "同步频率必须为 60–10080 分钟，其他设置也需有效。" }, { status: 422 });
          const settings = { key: parsed.data.key, enabled: parsed.data.enabled, intervalMinutes: parsed.data.intervalMinutes, autoPublish: parsed.data.autoPublish };
          return Response.json({ schedules: saveSyncSchedule(settings) }, { headers: { "Cache-Control": "no-store" } });
        }
        if (origin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return Response.json({ error: "WPS 配置和授权需要通过 HTTPS 访问。" }, { status: 403 });
        if (payload.action === "save_wps_settings") {
          const parsed = z.object({ action: z.literal("save_wps_settings"), ...wpsSettingsSchema.shape }).strict().safeParse(payload);
          if (!parsed.success) return Response.json({ error: "请填写有效的 WPS 应用凭证、文件 ID 和分享链接。" }, { status: 422 });
          const settings = { appId: parsed.data.appId, appKey: parsed.data.appKey, fileToken: parsed.data.fileToken, shareUrl: parsed.data.shareUrl };
          return Response.json({ wps: saveWpsSettings(settings) }, { headers: { "Cache-Control": "no-store" } });
        }
        if (Object.keys(payload).length !== 1) return Response.json({ error: "WPS 操作参数无效。" }, { status: 422 });
        if (payload.action === "authorize_wps") return Response.json({ authorizationUrl: beginWpsAuthorization(user.id, origin.origin) }, { headers: { "Cache-Control": "no-store" } });
        if (!getWpsStatus().authorized) return Response.json({ error: "请先完成 WPS 库存文件授权。" }, { status: 422 });
        return Response.json({ task: submitRefreshTask("wps_inventory") }, { status: 202 });
      } catch (error) { return Response.json({ error: error instanceof WpsError ? error.message : "同步配置操作失败，请检查运营数据库。" }, { status: error instanceof WpsError ? error.httpStatus : 500, headers: { "Cache-Control": "no-store" } }); }
    }
    if (payload?.action === "publish_gerpgo") {
      const parsed = z.object({ action: z.literal("publish_gerpgo"), ...gerpgoReviewRequestSchema.shape }).strict().safeParse(payload);
      if (!parsed.success) return Response.json({ error: "请完成对账确认并重新打开预览。" }, { status: 422 });
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ error: "请从本站确认发布。" }, { status: 403 });
      try {
        const review = { sourceTaskId: parsed.data.sourceTaskId, previewHash: parsed.data.previewHash, confirmed: true as const };
        const preview = await readGerpgoPreview(review.sourceTaskId);
        if (preview.blocked || preview.previewHash !== review.previewHash) return Response.json({ error: "预览已变化或校验未通过，不能发布。" }, { status: 409 });
        return Response.json({ task: submitRefreshTask("gerpgo_publish", review) }, { status: 202 });
      } catch { return Response.json({ error: "审核提交失败，请重新打开预览并检查运营数据库。" }, { status: 422 }); }
    }
    if (payload?.action === "pull_gerpgo") {
      const parsed = z.object({ action: z.literal("pull_gerpgo"), includeSupplemental: z.boolean().default(false) }).strict().safeParse(payload);
      if (!parsed.success) return Response.json({ error: "采集范围参数无效。" }, { status: 422 });
      if (!getGerpgoSettingsStatus().configured) return Response.json({ error: "请先配置积加凭证。" }, { status: 422 });
      try { return Response.json({ task: submitRefreshTask("gerpgo", { includeSupplemental: parsed.data.includeSupplemental }) }, { status: 202 }); }
      catch { return Response.json({ error: "任务提交失败，请检查运营数据库。" }, { status: 500 }); }
    }
    if (payload?.action === "save_operating_rules") {
      const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url);
      if (request.headers.get("origin") !== origin.origin || request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ error: "请从本站保存提醒规则。" }, { status: 403 });
      const parsed = z.object({ action: z.literal("save_operating_rules"), market: z.enum(operatingMarkets), sku: z.string().trim().toUpperCase().max(64).regex(/^[A-Z0-9._-]*$/), values: operatingRulesSchema.partial() }).strict().safeParse(payload);
      if (!parsed.success) return Response.json({ error: "提醒规则数值或范围无效。" }, { status: 422 });
      try { return Response.json({ rules: saveOperatingRuleOverride(parsed.data.market, parsed.data.sku, parsed.data.values) }, { headers: { "Cache-Control": "no-store" } }); }
      catch { return Response.json({ error: "提醒规则保存失败，请检查运营数据库。" }, { status: 500 }); }
    }
    if (payload?.action === "save_gerpgo_credentials") {
      // Browser-only credential writes: reject cross-site requests and plain HTTP.
      let origin: URL;
      try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url); }
      catch { return Response.json({ error: "网站公开地址配置无效。" }, { status: 500 }); }
      if (request.headers.get("origin") !== origin.origin || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ error: "请从本站配置页面保存凭证。" }, { status: 403 });
      if (origin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return Response.json({ error: "保存密钥请通过 HTTPS 访问网站。" }, { status: 403 });
      if (Object.keys(payload).length !== 3 || typeof payload.appId !== "string" || typeof payload.appKey !== "string") return Response.json({ error: "请填写 appId 和 appKey。" }, { status: 422 });
      try { return Response.json({ configuration: saveGerpgoCredentials({ appId: payload.appId, appKey: payload.appKey }) }, { headers: { "Cache-Control": "no-store" } }); }
      catch (error) { return Response.json({ error: error instanceof GerpgoConnectionError ? error.message : "保存积加凭证失败。" }, { status: error instanceof GerpgoConnectionError ? error.httpStatus : 500, headers: { "Cache-Control": "no-store" } }); }
    }
    if (!payload || payload.action !== "test_gerpgo" || Object.keys(payload).length !== 1) return Response.json({ error: "不支持此操作。" }, { status: 400 });
    try { return Response.json(await runGerpgoConnectionCheck(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return Response.json({ error: error instanceof GerpgoConnectionError ? error.message : "积加连接检查失败，请检查服务端配置。" }, { status: error instanceof GerpgoConnectionError ? error.httpStatus : 500, headers: { "Cache-Control": "no-store" } }); }
  }
  try {
    const snapshot = await getDataRefreshStatus();
    if (snapshot.summary.missingCount) return Response.json({ error: "必需源文件缺失，请先补齐。" }, { status: 422 });
    return Response.json({ task: submitRefreshTask("rebuild"), snapshot }, { status: 202 });
  } catch {
    return Response.json({ error: "数据任务提交失败，请检查运营数据库。" }, { status: 500 });
  }
}
