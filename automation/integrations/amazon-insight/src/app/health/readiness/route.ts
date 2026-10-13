import { readRuntimeReadiness } from "@/lib/runtime-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const result = readRuntimeReadiness();
  // Public probes receive no paths, credentials, business data or diagnostics.
  return Response.json({ status: result.ready ? "ready" : "not_ready" }, {
    status: result.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
