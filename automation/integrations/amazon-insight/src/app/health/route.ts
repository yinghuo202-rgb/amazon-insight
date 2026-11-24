import { prisma } from "@/lib/db/prisma";
import { checkOperationsDbHealth } from "@/lib/inventory/operations-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const operationsDbOk = checkOperationsDbHealth();
    if (!operationsDbOk) {
      return Response.json({ status: "error", db: "operations_unavailable" }, { status: 503 });
    }
    return Response.json({ status: "ok", db: "ok" });
  } catch {
    return Response.json({ status: "error", db: "unavailable" }, { status: 503 });
  }
}
