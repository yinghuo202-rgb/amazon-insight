import { requireCurrentUser, workspaceForUser } from "@/lib/auth";
import { supplyChainSnapshot } from "@/lib/inventory/warehouse-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const workspace = await workspaceForUser(user.id);
    return Response.json(await supplyChainSnapshot(workspace.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "请先登录。" : "供应链数据读取失败。" }, { status: 401 });
  }
}
