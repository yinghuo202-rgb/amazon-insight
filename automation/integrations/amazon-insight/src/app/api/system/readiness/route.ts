import { getCurrentUser } from "@/lib/auth";
import { readRuntimeReadiness } from "@/lib/runtime-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!await getCurrentUser()) return Response.json({ error: "请使用共用账号登录。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "登录状态暂时无法验证。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const result = readRuntimeReadiness();
  return Response.json(result, { status: result.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
