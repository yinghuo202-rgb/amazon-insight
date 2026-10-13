import { z } from "zod";
import definitions from "@/lib/inventory/metric-definitions.json";

const text = z.string().trim().min(1);
const metricIds = ["sales", "source-profit", "source-margin", "average-price", "ad-attribution-ratio", "ad-spend-ratio", "return-rate", "acos", "storage-cost", "fba-cover", "overseas-supply-cover"] as const;
export const metricVersionSchema = z.object({ metricDefinitionVersion: text, calculationRuleVersion: text });
export type MetricVersions = z.infer<typeof metricVersionSchema>;
export const metricContractSchema = metricVersionSchema.extend({
  schemaVersion: z.literal(1), scope: text,
  definitions: z.array(z.object({ id: z.enum(metricIds), name: text, formula: text, unit: text, denominator: text,
    period: text, currencyIsolation: text, source: text, missingRule: text, verificationBoundary: text })).length(metricIds.length),
}).refine(value => new Set(value.definitions.map(item => item.id)).size === metricIds.length, "指标定义缺失或重复");
// Failing validation is a broken code asset, not a legacy business report.
export const currentMetricContract = metricContractSchema.parse(definitions);

export function metricVersions(contract: MetricVersions): MetricVersions {
  return { metricDefinitionVersion: contract.metricDefinitionVersion, calculationRuleVersion: contract.calculationRuleVersion };
}
