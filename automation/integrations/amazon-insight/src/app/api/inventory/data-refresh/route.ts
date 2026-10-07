import { getCurrentUser } from "@/lib/auth";
import { getDataRefreshStatus, runFullDataRefresh, runGerpgoConnectionCheck } from "@/lib/inventory/data-refresh";
import { GerpgoConnectionError, saveGerpgoCredentials } from "@/lib/inventory/gerpgo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  return Response.json(await getDataRefreshStatus());
}

export async function POST(request: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401 });
  const body = await request.text();
  if (body.trim()) {
    if (body.length > 8192) return Response.json({ error: "请求内容过大。" }, { status: 413 });
    let payload;
    try { payload = JSON.parse(body); }
    catch { return Response.json({ error: "请求格式无效。" }, { status: 400 }); }
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
    return Response.json(await runFullDataRefresh());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据重建失败。" }, { status: 500 });
  }
}
