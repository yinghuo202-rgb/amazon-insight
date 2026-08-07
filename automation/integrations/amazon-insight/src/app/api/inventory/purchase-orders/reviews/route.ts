import { z } from "zod";

import { loadRawInventoryDashboardData, normalizeOperationsMarket } from "@/lib/inventory/data";
import { listLatestPurchaseOrderReviews, purchaseOrderReviewKey, recordPurchaseOrderReview } from "@/lib/inventory/purchase-order-reviews";

export const runtime = "nodejs";

const requestSchema = z.object({
  action: z.enum(["cancel", "restore"]),
  market: z.enum(["US", "CA"]),
  sku: z.string().trim().regex(/^[A-Z]{2}\d{3}$/),
  poNumber: z.string().trim().min(1).max(80),
  poDate: z.iso.date(),
  reason: z.string().trim().min(2).max(300),
  reviewer: z.string().trim().max(60).default(""),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const market = normalizeOperationsMarket(payload.market);
    const data = await loadRawInventoryDashboardData(market);
    const row = data.rows.find((item) => item.sku === payload.sku);
    const order = row?.pendingOrders.find((item) => item.poNumber === payload.poNumber && item.poDate === payload.poDate);
    const key = purchaseOrderReviewKey(payload);
    const latest = listLatestPurchaseOrderReviews().find((review) => purchaseOrderReviewKey(review) === key);

    if (payload.action === "cancel") {
      if (!order) return Response.json({ error: "未找到对应的进行中采购任务，请刷新页面后重试。" }, { status: 404 });
      if (!order.overdue) return Response.json({ error: "只有超过交期的采购任务可以人工取消。" }, { status: 409 });
      if (latest?.action === "cancel") return Response.json({ error: "该采购任务已经取消。" }, { status: 409 });
    } else if (latest?.action !== "cancel") {
      return Response.json({ error: "该采购任务当前不是取消状态。" }, { status: 409 });
    }

    const source = order ?? latest;
    const review = recordPurchaseOrderReview({
      action: payload.action,
      market,
      sku: payload.sku,
      poNumber: payload.poNumber,
      poDate: payload.poDate,
      factory: source?.factory ?? "",
      remainingQuantity: source?.remainingQuantity ?? 0,
      reason: payload.reason,
      reviewer: payload.reviewer,
    });
    return Response.json({ status: "completed", review });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? "提交内容不完整。" }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "采购任务状态更新失败。" }, { status: 500 });
  }
}
