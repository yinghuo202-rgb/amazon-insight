import { z } from "zod";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";

export const operatingMarkets = ["US", "CA", "MX"] as const;

const advertisingAmounts = {
  cost: z.number().nonnegative().nullable(), sales: z.number().nonnegative().nullable(),
  clicks: z.number().nonnegative().nullable(), impressions: z.number().nonnegative().nullable(), orders: z.number().nonnegative().nullable(),
};
const advertisingPeriod = {
  market: z.enum(operatingMarkets), currency: z.enum(["USD", "CAD", "MXN"]),
  reportMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), startDate: z.string(), businessAsOf: z.string(), recordCount: z.number().int().nonnegative(),
};
export const advertisingDataSchema = z.object({
  schemaVersion: z.literal(1), capturedAt: z.string(),
  identities: z.array(z.object({ sku: z.string(), aliases: z.array(z.string()) })),
  scopes: z.array(z.object({ ...advertisingPeriod, ...advertisingAmounts, dayCount: z.number().int().positive(), unmatchedRecords: z.number().int().nonnegative() })),
  rows: z.array(z.object({ ...advertisingPeriod, ...advertisingAmounts, sku: z.string(), productName: z.string(), asins: z.array(z.string()), mskus: z.array(z.string()) })),
});
export type AdvertisingData = z.infer<typeof advertisingDataSchema>;

export function selectAdvertisingPeriod<T extends { reportMonth: string; cost: number | null; sales: number | null }>(rows: T[], period: string): T | null {
  const available = [...rows].filter(row => row.cost !== null || row.sales !== null).sort((a, b) => b.reportMonth.localeCompare(a.reportMonth));
  const complete = available.filter(row => row.cost !== null && row.sales !== null);
  return complete.find(row => row.reportMonth === period) ?? complete[0]
    ?? available.find(row => row.reportMonth === period) ?? available[0] ?? null;
}

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
  advertising: advertisingDataSchema.optional(),
  publication: z.object({ version: z.string(), actor: z.enum(["shared-account", "scheduled-worker"]), baseline: z.string(), previewHash: z.string(), reviewedAt: z.string() }),
});
export type OperatingPerformance = z.infer<typeof operatingPerformanceSchema>;
export type OperatingPerformanceRow = z.infer<typeof operatingPerformanceRowSchema>;
