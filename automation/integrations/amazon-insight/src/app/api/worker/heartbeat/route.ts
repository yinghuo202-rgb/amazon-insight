import { z } from "zod";

import { requireWorkerOrUserAuth } from "@/lib/worker/auth";
import { workerHeartbeatSchema } from "@/lib/worker/contracts";
import { recordWorkerHeartbeat } from "@/lib/worker/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireWorkerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const payload = workerHeartbeatSchema.parse(await request.json().catch(() => ({})));
    const state = await recordWorkerHeartbeat(payload);
    return Response.json({ ok: true, actor: auth.actor, state });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Worker 心跳参数无效。", details: error.flatten() }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "记录 Worker 心跳失败。" },
      { status: 500 },
    );
  }
}
