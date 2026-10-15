import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { getReviewInsightState, reviewInsightsConfigured, ReviewInsightsError, syncReviewInsight } from "@/lib/inventory/review-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const targetSchema = z.object({
  asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
  market: z.literal("US"),
}).strict();

function failure(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "请填写有效的美国站子 ASIN。" }, { status: 400, headers: noStore });
  }
  if (error instanceof ReviewInsightsError) {
    return Response.json({ error: error.message, status: "error" }, { status: error.httpStatus, headers: noStore });
  }
  return Response.json({ error: "评论洞察暂时无法读取或保存；已有快照未修改。", status: "error" }, { status: 500, headers: noStore });
}

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401, headers: noStore });
  try {
    const query = new URL(request.url).searchParams;
    const target = targetSchema.parse({ asin: query.get("asin"), market: query.get("market") });
    return Response.json(getReviewInsightState(target.asin), { headers: noStore });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "请使用共用账号登录。" }, { status: 401, headers: noStore });
  let expectedOrigin: string;
  try { expectedOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin; }
  catch { return Response.json({ error: "网站公开地址配置无效。" }, { status: 500, headers: noStore }); }
  if (request.headers.get("origin") !== expectedOrigin || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "请从本站评论调研页面提交。" }, { status: 403, headers: noStore });
  }
  try {
    const body = await request.text();
    if (body.length > 1024) return Response.json({ error: "请求内容过大。" }, { status: 413, headers: noStore });
    const target = targetSchema.parse(JSON.parse(body));
    if (!reviewInsightsConfigured()) {
      return Response.json({ ...getReviewInsightState(target.asin), error: "未配置 Amazon SP-API 评论洞察授权。" }, { status: 503, headers: noStore });
    }
    return Response.json(await syncReviewInsight(target.asin), { headers: noStore });
  } catch (error) { return failure(error); }
}
