import { requireCurrentUser, workspaceForUser } from "@/lib/auth";
import { supplyChainSnapshot } from "@/lib/inventory/warehouse-store";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const workspace = await workspaceForUser(user.id);
    const params = new URL(request.url).searchParams;
    const input = z.object({ query: z.string().trim().max(100), view: z.enum(["outbound", "stock", "timeline"]), cursor: z.string().cuid().optional() }).parse({ query: params.get("query") || "", view: params.get("view") || "outbound", cursor: params.get("cursor") ?? undefined });
    return Response.json(await supplyChainSnapshot(workspace.id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return Response.json({ error: "请先登录。" }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "搜索或历史分页参数无效。" }, { status: 422 });
    if (error instanceof Error && error.message === "SUPPLY_CURSOR_CHANGED") return Response.json({ error: "历史分页记录已变化，请重新搜索；已有记录未被删除。" }, { status: 409 });
    return Response.json({ error: "供应链数据读取失败，请重试。" }, { status: 500 });
  }
}
