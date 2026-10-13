import { expect, it } from "vitest";
import { inventoryRowSchema, type InventoryDashboardData } from "@/lib/inventory/contracts";
import { buildOperatingModel, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { calculateInventoryRows, resolveInventoryDemandBasis } from "@/lib/inventory/presentation";
import { buildInventoryPlanningViewModel, calculatePlanningRows } from "@/lib/inventory/client-view-models";

const now = new Date("2026-10-13T00:00:00Z");
function report(overrides: Partial<InventoryDashboardData["rows"][number]> = {}) {
  const stock = inventoryRowSchema.parse({
    sku: "MA018", productName: "Fixture", factory: "", cartonQty: 10,
    fbaSellable: 20, fbaReservedTransfer: 0, fbaReservedProcessing: 0,
    awdOnHand: 8, awdAvailable: 8, awdPendingShipment: 0, awdOutboundToFba: 0, awdInbound: 0, awdFbaReconciliation: 0,
    inTransitInventory: 22, dailySales: 34.281,
    salesByMonth: [{ month: "2026-05", units: 1507 }, { month: "2026-06", units: 1504 }, { month: "2026-07", units: 587 }],
    dataQuality: [], eligibleInventoryPosition: 50, daysCoverFba: 1, daysCoverNetwork: 2,
    suggestedShipmentQty: 999, suggestedAwdTransferQty: 0, action: "SEA_SHIP", riskLevel: "watch", reason: "old",
    inventorySnapshotDate: "2026-10-12", awdSnapshotDate: "2026-10-12",
    domesticSupplyTotal: 10000, localInventory: 9000, pendingOrderQty: 1000, domesticSupplyBreakdownVerified: false,
    ...overrides,
  });
  return {
    market: "US", currency: "USD", generatedAt: "2026-10-12", rows: [stock],
    parameters: { leadTimeDays: 75, reviewCycleDays: 7, targetCoverDays: 90, safetyStockDays: 21, excessCoverDays: 240, fbaTransferTriggerDays: 30, purchaseOrderOverdueDays: 45 },
    snapshots: { fbaDate: "2026-10-12", awdDate: "2026-10-12", staleAfterDays: 14, awdSourceAvailable: true, inTransitConfirmed: true, awdAvailableConfirmed: true },
    sales: { sourceKind: "planning_workbook", method: "原报告加权日销", windowMonths: ["2026-06"], historyMonths: [] },
    domesticPool: { id: "CN-SHARED" }, summary: { localInventory: 9000 },
  } as unknown as InventoryDashboardData;
}

it("uses dated WPS reference sales for the same ninety-day demand in planning and operating coverage", () => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12", planningMonthlySales: 9000 });
  const computed = calculateInventoryRows(data, data.parameters, 100, now)[0];
  const operating = buildOperatingModel([data], undefined, undefined, [], now).rows[0];
  const planning = calculatePlanningRows(buildInventoryPlanningViewModel(data, now), data.parameters, 100, now)[0];
  expect(computed.demandBasis).toMatchObject({ source: "wps_reference", date: "2026-10-12", monthlySales: 300, dailySales: 10, usable: true, staleAfterDays: 14 });
  expect(computed.supplyBasis).toMatchObject({ confirmed: true, fbaFresh: true, awdFresh: true, usable: true });
  expect(computed.suggestedShipmentQty).toBe(850); // 10 * 90 - (20 + 8 + 22); no domestic stock/orders deduction.
  expect(computed.readyToShipQty).toBe(0);
  expect(operating.stock?.dailySales).toBe(10);
  expect(operating.stock?.cover).toBe(5);
  expect(operatingFacts(operating, "2026-09", undefined, now).fbaCover).toBe(2);
  expect(planning.suggestedShipmentQty).toBe(computed.suggestedShipmentQty);
  expect(data.rows[0].dailySales).toBe(34.281);
  expect(data.rows[0].planningMonthlySales).toBe(9000);
});

it("keeps a zero reference as an explicit plan rather than falling back to old sales or infinite coverage", () => {
  const data = report({ referenceMonthlySales: 0 });
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  expect(row.demandBasis).toMatchObject({ source: "wps_reference", monthlySales: 0, usable: true });
  expect(row.dailySales).toBe(0);
  expect(row.daysCoverNetwork).toBeNull();
  expect(row.suggestedShipmentQty).toBe(0);
  expect(row.action).toBe("REVIEW_DATA");
  expect(buildOperatingModel([data], undefined, undefined, [], now).rows[0].stock?.cover).toBeNull();
});

it.each([null, "2026-09-28", "2026-10-14"])("pauses dated-reference decisions for an unknown, expired or future date (%s)", date => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: date });
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  expect(row.dailySales).toBe(10);
  expect(row.demandBasis.usable).toBe(false);
  expect(row.daysCoverNetwork).toBeNull();
  expect(row.suggestedShipmentQty).toBe(0);
  expect(row.suggestedAwdTransferQty).toBe(0);
  expect(row.action).toBe("REVIEW_DATA");
  const facts = operatingFacts(buildOperatingModel([data], undefined, undefined, [], now).rows[0], "2026-09", undefined, now);
  expect(facts.fbaCover).toBeNull();
  expect(facts.supplyFresh).toBe(false);
  expect(facts.issues).not.toContain("当前供货风险");
  expect(facts.dataIssues).toContain("需求基线过期或口径待核验，补货建议暂停");
});

it("retains the true historical window and its saved rate but stops using stale May-July demand", () => {
  const data = report();
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  expect(row.demandBasis).toMatchObject({ source: "historical", date: "2026-07-31", windowMonths: ["2026-05", "2026-06", "2026-07"], dailySales: 34.281, usable: false, staleAfterDays: 62 });
  expect(row.dailySales).toBe(34.281);
  expect(row.salesByMonth).toEqual(data.rows[0].salesByMonth);
  expect(row.eligibleInventoryPosition).toBe(50);
  expect(row.suggestedShipmentQty).toBe(0);
  expect(row.suggestedProductionQty).toBe(0);
  expect(row.daysCoverNetwork).toBeNull();
});

it("never promotes an undated planning column into historical evidence", () => {
  const data = report({ planningMonthlySales: 300, salesByMonth: [] });
  const basis = resolveInventoryDemandBasis(data.rows[0], data, now);
  expect(basis).toMatchObject({ source: "historical", monthlySales: null, date: null, usable: false });
  expect(buildOperatingModel([data], undefined, undefined, [], now).rows[0].unitHistory).toEqual([]);
  const unconfirmed = report({ referenceMonthlySales: 300 });
  unconfirmed.snapshots.businessDateUnknown = true;
  expect(resolveInventoryDemandBasis(unconfirmed.rows[0], unconfirmed, now)).toMatchObject({ date: null, usable: false });
});

it("uses the existing freshness boundaries and preserves a fresh historical rate without hidden multipliers", () => {
  const wps = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-09-29" });
  expect(resolveInventoryDemandBasis(wps.rows[0], wps, now).usable).toBe(true); // Existing stock-maintenance window: 14 days.
  const history = report();
  expect(resolveInventoryDemandBasis(history.rows[0], history, new Date("2026-10-01")).usable).toBe(true); // Existing sales low-confidence threshold: 62 days.
  expect(resolveInventoryDemandBasis(history.rows[0], history, new Date("2026-10-02")).usable).toBe(false);
  const fresh = report({ dailySales: 10, salesByMonth: [{ month: "2026-09", units: 300 }] });
  expect(calculateInventoryRows(fresh, fresh.parameters, 100, now)[0]).toMatchObject({ dailySales: 10, suggestedShipmentQty: 850 });
  const plan = buildInventoryPlanningViewModel(wps, now);
  expect(calculatePlanningRows(plan, plan.parameters, 150, now)[0].suggestedShipmentQty).toBe(1300); // Explicit UI scenario only.
  expect(calculatePlanningRows(plan, plan.parameters, 100, new Date("2026-10-14"))[0].suggestedShipmentQty).toBe(0);
});

it.each(["inTransitConfirmed", "awdAvailableConfirmed", "awdSourceAvailable"] as const)("keeps unverified %s quantities but pauses network coverage and all deterministic shipment quantities", field => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12" });
  data.snapshots[field] = false;
  const before = JSON.stringify(data);
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  const operating = buildOperatingModel([data], undefined, undefined, [], now).rows[0];
  const facts = operatingFacts(operating, "2026-09", undefined, now);
  const planned = calculatePlanningRows(buildInventoryPlanningViewModel(data, now), data.parameters, 100, now)[0];
  expect(row).toMatchObject({ fbaSellable: 20, awdAvailable: 8, inTransitInventory: 22, eligibleInventoryPosition: 50,
    daysCoverFba: 2, daysCoverNetwork: null, suggestedShipmentQty: 0, suggestedAwdTransferQty: 0,
    readyToShipQty: 0, suggestedProductionQty: 0, action: "REVIEW_DATA" });
  expect(operating.stock?.cover).toBe(row.daysCoverNetwork);
  expect(operating.stock?.supplyConfirmed).toBe(false);
  expect(planned.daysCoverNetwork).toBeNull();
  expect(planned.suggestedShipmentQty).toBe(0);
  expect(facts.fbaCover).toBe(2);
  expect(facts.issues).toContain("当前供货风险");
  expect(facts.issues).not.toContain("供应覆盖不足");
  expect(facts.supplyFresh).toBe(false);
  expect(JSON.stringify(data)).toBe(before);
});

it("checks each SKU's FBA business date rather than the newer report date or demand maintenance date", () => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12", inventorySnapshotDate: "2026-07-14" });
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  expect(row.demandBasis.usable).toBe(true);
  expect(row.supplyBasis).toMatchObject({ fbaDate: "2026-07-14", fbaFresh: false, usable: false });
  expect(row.daysCoverFba).toBeNull();
  expect(row.daysCoverNetwork).toBeNull();
  expect(row.suggestedShipmentQty).toBe(0);
  const facts = operatingFacts(buildOperatingModel([data], undefined, undefined, [], now).rows[0], "2026-09", undefined, now);
  expect(facts.stockFresh).toBe(false);
  expect(facts.fbaCover).toBeNull();
  expect(facts.issues).not.toContain("当前供货风险");
});

it.each(["2026-06-26", "2026-10-14"])("preserves fresh FBA risk while rejecting an expired or future AWD date (%s)", awdSnapshotDate => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12", awdSnapshotDate });
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  expect(row.supplyBasis).toMatchObject({ fbaFresh: true, awdFresh: false, confirmed: true, usable: false });
  expect(row.daysCoverFba).toBe(2);
  expect(row.daysCoverNetwork).toBeNull();
  expect(row.suggestedShipmentQty).toBe(0);
  expect(row.suggestedAwdTransferQty).toBe(0);
  const facts = operatingFacts(buildOperatingModel([data], undefined, undefined, [], now).rows[0], "2026-09", undefined, now);
  expect(facts.issues).toContain("当前供货风险");
  expect(facts.dataIssues).toContain("AWD 日期待核验或过期");
});

it("uses the same network position including fresh confirmed AWD-to-FBA transfer without domestic inventory/orders", () => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12", awdOutboundToFba: 20 });
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  const operating = buildOperatingModel([data], undefined, undefined, [], now).rows[0];
  expect(row.eligibleInventoryPosition).toBe(70); // 20 FBA + 8 AWD + 20 AWD->FBA + 22 transit.
  expect(row.daysCoverNetwork).toBe(7);
  expect(operating.stock?.cover).toBe(row.daysCoverNetwork);
  expect(row.suggestedShipmentQty).toBe(830); // 10 daily * 90 days - 70 overseas; no 10,000 domestic deduction.
  const onlyTransfer = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12", awdAvailable: 0, awdOutboundToFba: 20, awdSnapshotDate: "2026-06-26" });
  const blocked = calculateInventoryRows(onlyTransfer, onlyTransfer.parameters, 100, now)[0];
  expect(blocked.supplyBasis.requiresAwd).toBe(true);
  expect(blocked.daysCoverNetwork).toBeNull();
  expect(blocked.suggestedShipmentQty).toBe(0);
});

it("does not require an AWD or transit source when the corresponding physical quantity is explicitly zero", () => {
  const data = report({ referenceMonthlySales: 300, referenceMonthlySalesDate: "2026-10-12", awdAvailable: 0, awdOutboundToFba: 0, inTransitInventory: 0 });
  data.snapshots.awdSourceAvailable = false;
  data.snapshots.awdAvailableConfirmed = false;
  data.snapshots.inTransitConfirmed = false;
  const row = calculateInventoryRows(data, data.parameters, 100, now)[0];
  expect(row.supplyBasis).toMatchObject({ confirmed: true, requiresAwd: false, usable: true });
  expect(row.daysCoverNetwork).toBe(2);
  expect(row.suggestedShipmentQty).toBe(880);
});
