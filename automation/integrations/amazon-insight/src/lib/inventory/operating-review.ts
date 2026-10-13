import { createHash } from "node:crypto";
import { z } from "zod";
import { operatingFacts, type OperatingModel } from "@/lib/inventory/dashboard-view-model";
import { operatingRulesSchema, resolveOperatingRules } from "@/lib/inventory/operating-rules";

export const reviewRequestSchema = z.object({
  kind: z.literal("review"), sku: z.string().trim().toUpperCase().min(1).max(64),
  market: z.enum(["US", "CA", "MX"]), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  issue: z.string().min(1).max(100), version: z.string().min(1).max(200),
});
export const evidenceSchema = z.object({
  version: z.string(), publishedVersion: z.string().nullable(), period: z.string(), currency: z.string(), capturedAt: z.string(),
  sales: z.number().nullable(), profit: z.number().nullable(), profitVerified: z.boolean(),
  adShare: z.number().nullable(), returnRate: z.number().nullable(), fbaDays: z.number().nullable(), supplyDays: z.number().nullable(),
  issues: z.array(z.string()), dataIssues: z.array(z.string()),
  rules: operatingRulesSchema.optional(), rulesAvailable: z.boolean().optional(), inventoryDate: z.string().nullable().optional(), awdDate: z.string().nullable().optional(),
});
export const reviewContextSchema = z.object({ listingId: z.string(), issue: z.string(), baseline: evidenceSchema, latest: evidenceSchema });
export const taskHistorySchema = z.array(z.object({ at: z.string(), actor: z.enum(["shared-account", "system"]), userId: z.string(), action: z.string(), status: z.string(), note: z.string().nullable(),
  previousStatus: z.string().optional(), evidence: evidenceSchema.optional(), triggered: z.boolean().optional() }));
export function buildReviewEvidence(model: OperatingModel, input: z.infer<typeof reviewRequestSchema>, now = new Date(), allowResolved = false) {
  if (model.dataVersion !== input.version) throw new Error("REVIEW_VERSION_CHANGED");
  const row = model.rows.find(item => item.sku === input.sku && item.market === input.market);
  if (!row) throw new Error("REVIEW_NOT_FOUND");
  const rules = resolveOperatingRules(input.market, row.sku, model.ruleOverrides);
  const facts = operatingFacts(row, input.period, rules, now, model.rulesAvailable);
  const triggered = [...facts.issues, ...facts.dataIssues].includes(input.issue);
  if (!triggered && !allowResolved) throw new Error("REVIEW_NOT_TRIGGERED");
  const evidence = evidenceSchema.parse({
    version: model.dataVersion, publishedVersion: model.publishedVersion, period: input.period, currency: row.currency, capturedAt: now.toISOString(),
    sales: facts.current?.productSales ?? null, profit: facts.current?.actualProfit ?? null, profitVerified: facts.current?.quality?.profitVerified === true,
    adShare: facts.advertisingSpendShare, returnRate: facts.returnRate, fbaDays: facts.fbaCover,
    supplyDays: facts.supplyFresh ? row.stock?.cover ?? null : null, issues: facts.issues, dataIssues: facts.dataIssues,
    rules, rulesAvailable: model.rulesAvailable, inventoryDate: row.inventoryDate, awdDate: row.awdDate,
  });
  return { triggered, issueKey: createHash("sha256").update(JSON.stringify([row.listingId, input.issue])).digest("hex"), context: { listingId: row.listingId, issue: input.issue, baseline: evidence, latest: evidence } };
}
export function preserveReviewBaseline(existing: string | null, next: z.infer<typeof reviewContextSchema>) {
  return existing ? { ...next, baseline: reviewContextSchema.parse(JSON.parse(existing)).baseline } : next;
}
export function appendTaskHistory(existing: string, event: z.infer<typeof taskHistorySchema>[number]) {
  return JSON.stringify([...taskHistorySchema.parse(JSON.parse(existing)), taskHistorySchema.element.parse(event)]);
}

// Logical/publication IDs and capture times describe provenance, not a new
// business problem. A restore always gets a new publication ID. Only this
// listing's period/facts/rules and actual inventory business dates are material.
function materialEvidence(evidence: z.infer<typeof evidenceSchema>) {
  return JSON.stringify([evidence.period, evidence.currency, evidence.sales, evidence.profit, evidence.profitVerified,
    evidence.adShare, evidence.returnRate, evidence.fbaDays, evidence.supplyDays, evidence.rules ?? null, evidence.rulesAvailable ?? null, evidence.inventoryDate ?? null, evidence.awdDate ?? null]);
}

export function reviewEvidenceUpdate(existing: { contextJson: string | null; historyJson: string; status: string; note: string | null }, review: ReturnType<typeof buildReviewEvidence>, actor: { actor: "shared-account" | "system"; userId: string; now: Date }) {
  const previous = existing.contextJson ? reviewContextSchema.parse(JSON.parse(existing.contextJson)) : null;
  const history = taskHistorySchema.parse(JSON.parse(existing.historyJson));
  const evidence = review.context.latest;
  if (previous?.latest.version === evidence.version && previous.latest.period === evidence.period) return null;
  // A rolled-back/revisited version is already evidence, not a new trigger.
  if (history.some(event => event.evidence?.version === evidence.version && event.evidence.period === evidence.period)) {
    return { status: existing.status, contextJson: JSON.stringify(preserveReviewBaseline(existing.contextJson, review.context)), historyJson: existing.historyJson };
  }
  const alreadyReviewed = previous && [previous.baseline, previous.latest, ...history.flatMap(event => event.evidence ? [event.evidence] : [])]
    .some(known => materialEvidence(known) === materialEvidence(evidence));
  if (alreadyReviewed) {
    // Keep the new actual source pointer in latest, but do not manufacture a
    // duplicate business snapshot or reopen a conclusion on republish/restore.
    return { status: existing.status, contextJson: JSON.stringify(preserveReviewBaseline(existing.contextJson, review.context)), historyJson: existing.historyJson };
  }
  let historyJson = JSON.stringify(history);
  if (previous && !history.some(event => event.evidence?.version === previous.latest.version && event.evidence.period === previous.latest.period)) {
    historyJson = appendTaskHistory(historyJson, { at: actor.now.toISOString(), actor: "system", userId: "system", action: "preserve-legacy-evidence", status: existing.status, note: null,
      evidence: previous.latest, triggered: [...previous.latest.issues, ...previous.latest.dataIssues].includes(previous.issue) });
  }
  const status = previous && review.triggered && ["DONE", "DISMISSED"].includes(existing.status) ? "REVIEW" : existing.status;
  historyJson = appendTaskHistory(historyJson, { at: actor.now.toISOString(), actor: actor.actor, userId: actor.userId,
    action: previous ? "refresh-evidence" : "create-review", previousStatus: existing.status, status, note: existing.note,
    evidence, triggered: review.triggered });
  return { status, contextJson: JSON.stringify(preserveReviewBaseline(existing.contextJson, review.context)), historyJson };
}
