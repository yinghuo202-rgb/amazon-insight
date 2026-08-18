import { z } from "zod";

import { calculateResearchCandidate } from "@/lib/inventory/new-product-research";
import { saveResearchCandidate } from "@/lib/inventory/new-product-research-store";

export const runtime = "nodejs";

const nullableAmount = z.number().finite().nonnegative().max(10_000_000).nullable();
const candidateSchema = z.object({
  sku: z.string().trim().min(1).max(40).regex(/^[^\s/\\]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(300),
  amazonPrice: nullableAmount,
  firstMile: nullableAmount,
  storageFee: nullableAmount,
  commission: nullableAmount,
  orderFee: nullableAmount,
  importDutyRate: nullableAmount,
  purchaseCostRmb: nullableAmount,
  untaxedPriceUsd: nullableAmount.optional(),
  competitorUrl: z.union([z.literal(""), z.string().trim().url().max(2000)]),
});

export async function POST(request: Request) {
  try {
    const input = candidateSchema.parse(await request.json());
    const item = saveResearchCandidate(calculateResearchCandidate(input));
    return Response.json({ status: "completed", item });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "新品资料不完整或格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "新品资料保存失败。" }, { status: 500 });
  }
}
