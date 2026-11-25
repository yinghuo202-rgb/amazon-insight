import { syncGerpGoIfConfigured } from "@/lib/gerpgo/service";
import { requireWorkerOrUserAuth } from "@/lib/worker/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireWorkerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const result = await syncGerpGoIfConfigured();
    return Response.json({ ok: true, actor: auth.actor, ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "后台同步积加 ERP 失败。" },
      { status: 500 },
    );
  }
}
