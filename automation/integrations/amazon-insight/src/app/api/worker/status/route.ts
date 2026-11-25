import { requireWorkerOrUserAuth } from "@/lib/worker/auth";
import { getWorkerOverview } from "@/lib/worker/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireWorkerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  const overview = await getWorkerOverview();
  return Response.json(overview);
}
