import { z } from "zod";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";

export const operatingMarkets = ["US", "CA", "MX"] as const;

// Keep the existing Excel contract for legacy detail consumers. Operating facts
// accept nullable API fees without manufacturing a complete profit statement.
// AU remains readable only for old report compatibility; it is not a live market.
export const operatingPerformanceRowSchema = profitabilityRowSchema.omit({ settlementPayout: true, landedCost: true, netUnits: true, grossMargin: true, conservativeMargin: true }).extend({
  market: z.enum(["US", "CA", "MX", "AU"]), currency: z.enum(["USD", "CAD", "MXN", "AUD"]),
  returns: z.number().int().nonnegative().nullable(),
  actualProfit: z.number().nullable(), grossProfit: z.number().nullable(),
  advertisingCost: z.number().nullable(), storageCost: z.number().nullable(),
  productName: z.string().optional(),
  sourceTaskId: z.uuid().optional(),
});
export const operatingPerformanceSchema = z.object({
  schemaVersion: z.literal(1), sourceTaskId: z.uuid(), generatedAt: z.string(),
  storeScope: z.object({ storeName: z.string().min(1), serverId: z.number().int().positive(), marketIds: z.array(z.number().int().positive()).min(1) }).optional(),
  scopes: z.array(z.object({ market: z.enum(["US", "CA", "MX", "AU"]), reportMonth: z.string().regex(/^\d{4}-\d{2}$/) })),
  rows: z.array(operatingPerformanceRowSchema),
  publication: z.object({ version: z.string(), actor: z.literal("shared-account"), baseline: z.string(), previewHash: z.string(), reviewedAt: z.string() }),
});
export type OperatingPerformance = z.infer<typeof operatingPerformanceSchema>;
export type OperatingPerformanceRow = z.infer<typeof operatingPerformanceRowSchema>;
