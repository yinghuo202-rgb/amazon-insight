import { z } from "zod";

import { getAdvertisingPlan, saveAdvertisingPlan, transitionAdvertisingPlan } from "@/lib/inventory/advertising-plan-store";
import { inventoryDashboardSchema } from "@/lib/inventory/contracts";

export const runtime = "nodejs";
const actionSchema = inventoryDashboardSchema.shape.advertising.shape.campaigns.element.shape.action;
const itemSchema = z.object({ campaign: z.string().trim().min(1).max(300), sku: z.string().trim().max(30).default(""), recommendedAction: actionSchema, currentBudget: z.number().nonnegative(), proposedBudget: z.number().nonnegative(), bidChangePercent: z.number().min(-100).max(300), note: z.string().max(300).default("") });
const requestSchema = z.object({ market: z.enum(["US", "CA"]), period: z.string().regex(/^\d{4}-\d{2}$/), action: z.enum(["save", "confirm", "reopen"]), items: z.array(itemSchema).optional() });

export async function GET(request: Request) {
  const url = new URL(request.url); const market = url.searchParams.get("market"); const period = url.searchParams.get("period");
  const parsed = z.object({ market: z.enum(["US", "CA"]), period: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse({ market, period });
  if (!parsed.success) return Response.json({ error: "广告计划站点或月份格式不正确。" }, { status: 400 });
  return Response.json(getAdvertisingPlan(parsed.data.market, parsed.data.period));
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    return Response.json(payload.action === "save" ? saveAdvertisingPlan(payload.market, payload.period, payload.items ?? []) : transitionAdvertisingPlan(payload.market, payload.period, payload.action));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "广告调整参数不完整或格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "广告计划操作失败。" }, { status: 500 });
  }
}
