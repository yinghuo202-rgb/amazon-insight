"use client";

import { Archive, CalendarClock, Download, FileSpreadsheet, LoaderCircle, LockKeyhole, Plus, RotateCcw, Search, SlidersHorizontal, SunMedium, Trash2, WandSparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { InventoryStockVisual } from "@/components/inventory/inventory-stock-visual";
import { calculatePlanningRows, type InventoryPlanningViewModel } from "@/lib/inventory/client-view-models";
import type { InventoryParameters } from "@/lib/inventory/contracts";
import { days, integer, inventoryActionLabels, marketHref, toneByInventoryAction } from "@/lib/inventory/presentation";
import type { SeasonalShipmentAction } from "@/lib/inventory/seasonal-plan-integration";
import type { ShipmentBatch, ShipmentPlanItem } from "@/lib/inventory/shipment-plan";

type ExportType = "shipment" | "declaration";
type SkuSortDirection = "asc" | "desc";
type PlanResponse = {
  batches: ShipmentBatch[];
  activeBatch: ShipmentBatch | null;
  activeBatchItems: ShipmentPlanItem[];
  items: ShipmentPlanItem[];
  allMarketItems: ShipmentPlanItem[];
  nextBatchNumber: string;
  error?: string;
};
type ExportMeta = { defaultBatchNumber?: string; readiness?: { shipmentSkus?: string[]; declarationSkus?: string[] } };

export function ReplenishmentWorkbench({ data, seasonalActions: allSeasonalActions }: { data: InventoryPlanningViewModel; seasonalActions: SeasonalShipmentAction[] }) {
  const [leadTimeDays, setLeadTimeDays] = useState(data.parameters.leadTimeDays);
  const [targetCoverDays, setTargetCoverDays] = useState(data.parameters.targetCoverDays);
  const [safetyStockDays, setSafetyStockDays] = useState(data.parameters.safetyStockDays);
  const [demandPercent, setDemandPercent] = useState(100);
  const [query, setQuery] = useState("");
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [batchItems, setBatchItems] = useState<ShipmentPlanItem[]>([]);
  const [marketPlanItems, setMarketPlanItems] = useState<ShipmentPlanItem[]>([]);
  const [allMarketItems, setAllMarketItems] = useState<ShipmentPlanItem[]>([]);
  const [nextBatchNumber, setNextBatchNumber] = useState("CM320");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState<ExportType | "both" | null>(null);
  const [exportMessage, setExportMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [shipmentReadySkus, setShipmentReadySkus] = useState<Set<string>>(new Set());
  const [declarationReadySkus, setDeclarationReadySkus] = useState<Set<string>>(new Set());
  const [skuSortDirection, setSkuSortDirection] = useState<SkuSortDirection>("asc");

  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) ?? null;
  const editable = selectedBatch?.status === "DRAFT";

  useEffect(() => {
    Promise.all([
      fetch(`/api/inventory/exports?market=${data.market}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch(`/api/inventory/shipment-plan?market=${data.market}`, { cache: "no-store" }).then((response) => response.json()),
    ]).then(([meta, plan]: [ExportMeta | null, PlanResponse]) => {
      setShipmentReadySkus(new Set(meta?.readiness?.shipmentSkus ?? []));
      setDeclarationReadySkus(new Set(meta?.readiness?.declarationSkus ?? []));
      applyPlan(plan);
    }).catch((error) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "读取发货计划失败" }))
      .finally(() => setLoading(false));
  }, [data.market]);

  const parameters: InventoryParameters = useMemo(() => ({ ...data.parameters, leadTimeDays, targetCoverDays, safetyStockDays }), [data.parameters, leadTimeDays, targetCoverDays, safetyStockDays]);
  const rows = useMemo(() => calculatePlanningRows(data, parameters, demandPercent), [data, demandPercent, parameters]);
  const rowBySku = useMemo(() => new Map(rows.map((row) => [row.sku, row] as const)), [rows]);
  const seasonalActions = useMemo(() => allSeasonalActions.filter((action) => action.market === data.market), [allSeasonalActions, data.market]);
  const seasonalActionBySku = useMemo(() => new Map(seasonalActions.map((action) => [action.sku, action] as const)), [seasonalActions]);
  const readyQuantityBySku = new Map(rows.map((row) => {
    const carton = Math.max(1, row.cartonQty ?? 1);
    const seasonal = seasonalActionBySku.get(row.sku);
    const seasonalTransfer = seasonal?.transferQty ?? 0;
    const seasonalClearance = seasonal?.clearanceQty ?? 0;
    const target = Math.max(row.suggestedShipmentQty, seasonalTransfer) + seasonalClearance;
    const quantity = Math.floor(Math.min(target, row.localInventory) / carton) * carton;
    return [row.sku, quantity] as const;
  }));
  const replenishmentRows = rows.filter((row) => (readyQuantityBySku.get(row.sku) ?? 0) > 0)
    .sort((left, right) => (readyQuantityBySku.get(right.sku) ?? 0) - (readyQuantityBySku.get(left.sku) ?? 0));
  const plannedSkus = new Set(marketPlanItems.map((item) => item.sku));
  const normalized = query.trim().toLowerCase();
  const availableRows = replenishmentRows.filter((row) => !plannedSkus.has(row.sku) && (!normalized || row.sku.toLowerCase().includes(normalized) || row.productName.toLowerCase().includes(normalized)));
  const seasonalAvailableRows = replenishmentRows.filter((row) => !plannedSkus.has(row.sku) && (seasonalActionBySku.get(row.sku)?.shipmentQty ?? 0) > 0);
  const activeBatchRows = batchItems.flatMap((item) => {
    const row = rowBySku.get(item.sku);
    return row && (readyQuantityBySku.get(row.sku) ?? 0) > 0 ? [{ item, row }] : [];
  }).sort((left, right) => left.item.sku.localeCompare(right.item.sku, "en", { numeric: true }) * (skuSortDirection === "asc" ? 1 : -1));
  const staleItems = batchItems.filter((item) => !activeBatchRows.some((entry) => entry.item.sku === item.sku));
  const planEntries = activeBatchRows.map(({ item }) => ({ sku: item.sku, quantity: item.quantity }));
  const candidateUnits = replenishmentRows.reduce((sum, row) => sum + (readyQuantityBySku.get(row.sku) ?? 0), 0);
  const plannedUnits = planEntries.reduce((sum, item) => sum + item.quantity, 0);
  const marketPlannedUnits = marketPlanItems.reduce((sum, item) => sum + item.quantity, 0);
  const otherMarketUnits = allMarketItems.filter((item) => item.market !== data.market).reduce((sum, item) => sum + item.quantity, 0);
  const otherMarketBySku = new Map<string, number>();
  for (const item of allMarketItems.filter((candidate) => candidate.market !== data.market)) otherMarketBySku.set(item.sku, (otherMarketBySku.get(item.sku) ?? 0) + item.quantity);
  const crossMarketConflicts = activeBatchRows.filter((entry) => entry.item.quantity + (otherMarketBySku.get(entry.item.sku) ?? 0) > entry.row.localInventory);
  const productionGap = activeBatchRows.reduce((sum, entry) => sum + Math.max(0, entry.item.quantity - entry.row.localInventory), 0);
  const missingShipmentData = planEntries.filter((entry) => !shipmentReadySkus.has(entry.sku));
  const missingDeclarationData = planEntries.filter((entry) => !declarationReadySkus.has(entry.sku));
  const seasonalShipmentRows = seasonalActions.filter((action) => action.shipmentQty > 0);
  const seasonalClearanceRows = seasonalActions.filter((action) => action.clearanceQty > 0 || action.overseasClearanceQty > 0);
  const seasonalShipmentUnits = seasonalShipmentRows.reduce((sum, action) => sum + action.shipmentQty, 0);
  const activeBatchQuantityBySku = new Map(batchItems.map((item) => [item.sku, item.quantity] as const));

  function applyPlan(plan: PlanResponse) {
    if (plan.error) throw new Error(plan.error);
    setBatches(plan.batches);
    setSelectedBatchId(plan.activeBatch?.id ?? "");
    setBatchItems(plan.activeBatchItems);
    setMarketPlanItems(plan.items);
    setAllMarketItems(plan.allMarketItems);
    setNextBatchNumber(plan.nextBatchNumber || "CM320");
  }

  async function refresh(batchId?: string) {
    const suffix = batchId ? `&batchId=${encodeURIComponent(batchId)}` : "";
    const response = await fetch(`/api/inventory/shipment-plan?market=${data.market}${suffix}`, { cache: "no-store" });
    const plan = await response.json() as PlanResponse;
    if (!response.ok || plan.error) throw new Error(plan.error || "读取发货计划失败");
    applyPlan(plan);
  }

  function itemFromRow(row: (typeof rows)[number], quantity = readyQuantityBySku.get(row.sku) ?? 0) {
    const seasonal = seasonalActionBySku.get(row.sku);
    const seasonalNote = seasonal ? seasonalPlanNote(seasonal) : "";
    return {
      sku: row.sku,
      quantity: Math.max(1, Math.round(quantity)),
      suggestedQuantity: Math.round(readyQuantityBySku.get(row.sku) ?? 0),
      note: batchItems.find((item) => item.sku === row.sku)?.note ?? seasonalNote,
      reason: seasonal?.reason ? `${row.reason}；${seasonal.reason}` : row.reason,
      snapshotDate: data.snapshots.fbaDate,
    };
  }

  async function mutatePlan(body: Record<string, unknown>, busyKey = "ALL") {
    setBusy(busyKey);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/shipment-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: data.market, ...body }),
      });
      const payload = await response.json() as PlanResponse;
      if (!response.ok || payload.error) throw new Error(payload.error || "发货计划更新失败");
      applyPlan(payload);
      setMessage({ tone: "success", text: "发货计划已保存。" });
      return payload;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "发货计划更新失败" });
      return null;
    } finally {
      setBusy("");
    }
  }

  function updateItemLocal(sku: string, patch: Partial<ShipmentPlanItem>) {
    setBatchItems((current) => current.map((item) => item.sku === sku ? { ...item, ...patch } : item));
  }

  function saveItem(sku: string) {
    const item = batchItems.find((candidate) => candidate.sku === sku);
    const row = rowBySku.get(sku);
    if (selectedBatch && item && row) void mutatePlan({ action: "upsert", batchId: selectedBatch.id, item: { ...itemFromRow(row, item.quantity), note: item.note } }, sku);
  }

  function patchSelectedBatch(patch: Partial<ShipmentBatch>) {
    if (!selectedBatch) return;
    setBatches((current) => current.map((batch) => batch.id === selectedBatch.id ? { ...batch, ...patch } : batch));
  }

  function saveBatch() {
    const batch = batches.find((candidate) => candidate.id === selectedBatchId);
    if (!batch || batch.status !== "DRAFT") return;
    void mutatePlan({ action: "updateBatch", batchId: batch.id, batch: {
      batchNumber: batch.batchNumber,
      shipmentDate: batch.shipmentDate,
      invoiceNumber: batch.invoiceNumber,
      freightReference: batch.freightReference,
      shipmentId: batch.shipmentId,
      trackingId: batch.trackingId,
      consignee: batch.consignee,
      note: batch.note,
    } }, batch.id);
  }

  function addCurrentPage() {
    if (!selectedBatch || !editable) return;
    const additions = availableRows.map((row) => itemFromRow(row));
    const existing = activeBatchRows.map(({ item, row }) => ({ ...itemFromRow(row, item.quantity), note: item.note }));
    void mutatePlan({ action: "replace", batchId: selectedBatch.id, items: [...existing, ...additions] });
  }

  function addSeasonalPlan() {
    if (!selectedBatch || !editable) return;
    const additions = seasonalAvailableRows.map((row) => itemFromRow(row));
    const existing = activeBatchRows.map(({ item, row }) => ({ ...itemFromRow(row, item.quantity), note: item.note }));
    void mutatePlan({ action: "replace", batchId: selectedBatch.id, items: [...existing, ...additions] });
  }

  function autoSplitAll() {
    const items = availableRows.map((row) => itemFromRow(row));
    if (!items.length) return;
    void mutatePlan({ action: "autoSplit", items, firstBatchNumber: nextBatchNumber, shipmentDate: localIsoDate() });
  }

  async function exportDocuments(documentTypes: ExportType[]) {
    if (!selectedBatch || !planEntries.length) return setExportMessage({ tone: "error", text: "当前批次为空，请先加入 SKU。" });
    if (documentTypes.includes("shipment") && missingShipmentData.length) return setExportMessage({ tone: "error", text: `${missingShipmentData.map((item) => item.sku).join("、")} 缺少历史发货参数。` });
    if (documentTypes.includes("declaration") && missingDeclarationData.length) return setExportMessage({ tone: "error", text: `${missingDeclarationData.map((item) => item.sku).join("、")} 缺少报运资料或可用采购批次。` });
    if (!selectedBatch.shipmentDate) return setExportMessage({ tone: "error", text: "请先填写提货日期。" });
    setExporting(documentTypes.length === 2 ? "both" : documentTypes[0]);
    setExportMessage(null);
    try {
      const response = await fetch("/api/inventory/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: data.market,
          documentTypes,
          batchNumber: selectedBatch.batchNumber,
          shipmentDate: selectedBatch.shipmentDate,
          invoiceNumber: selectedBatch.invoiceNumber || undefined,
          freightReference: selectedBatch.freightReference || undefined,
          shipmentId: selectedBatch.shipmentId || undefined,
          trackingId: selectedBatch.trackingId || undefined,
          consignee: selectedBatch.consignee || undefined,
          skuSort: skuSortDirection,
          entries: planEntries,
        }),
      });
      const payload = await response.json() as { error?: string; exportId?: string; files?: Array<{ filename: string }> };
      if (!response.ok || payload.error || !payload.exportId || !payload.files) throw new Error(payload.error || "单据生成失败");
      payload.files.forEach((file, index) => window.setTimeout(() => {
        const anchor = document.createElement("a");
        anchor.href = `/api/inventory/exports/${payload.exportId}/${encodeURIComponent(file.filename)}`;
        anchor.download = file.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }, index * 350));
      await mutatePlan({ action: "setStatus", batchId: selectedBatch.id, status: "EXPORTED" }, selectedBatch.id);
      setExportMessage({ tone: "success", text: `已生成 ${payload.files.length} 份单据，批次已锁定并保留历史记录。` });
    } catch (error) {
      setExportMessage({ tone: "error", text: error instanceof Error ? error.message : "单据生成失败" });
    } finally {
      setExporting(null);
    }
  }

  return <div className="space-y-4">
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
      <OpsKpi label="国内可发候选" value={`${replenishmentRows.length} SKU`} detail={`可发 ${integer(candidateUnits)} 件`} tone="warning" />
      <OpsKpi label="季节计划发货" value={`${seasonalShipmentRows.length} SKU`} detail={`${integer(seasonalShipmentUnits)} 件 · 含清货与补货`} tone="warning" />
      <OpsKpi label="当前批次" value={selectedBatch ? selectedBatch.batchNumber : "未建立"} detail={`${activeBatchRows.length} SKU · ${integer(plannedUnits)} 件`} tone="positive" />
      <OpsKpi label="全部进行中批次" value={`${batches.filter((batch) => batch.status === "DRAFT").length} 批`} detail={`${integer(marketPlannedUnits)} 件已规划`} />
      <OpsKpi label="共享国内现货" value={integer(data.summary.localInventory)} detail="美国、加拿大共用" />
      <OpsKpi label="跨站库存冲突" value={`${crossMarketConflicts.length} SKU`} detail={`另一站已计划 ${integer(otherMarketUnits)} 件`} tone={crossMarketConflicts.length ? "danger" : "default"} />
      <OpsKpi label="当前批次现货缺口" value={integer(productionGap)} detail="超出当前国内现货" tone={productionGap > 0 ? "danger" : "default"} />
    </div>

    <InventoryStockVisual
      title={`${data.market} 发货库存视图`}
      description="把站点 FBA、AWD、共享国内现货和未完工订单放在同一视图中，对比补货建议与当前选中批次，直观看出库存将从哪里发往哪里。"
      mode="market"
      actionLabel="当前批次发货"
      referenceLabel="建议发货"
      rows={rows.map((row) => ({ sku: row.sku, fba: row.fbaSellable, awd: row.awdAvailable + row.awdOutboundToFba, domestic: row.localInventory, pending: row.pendingOrderQty, action: activeBatchQuantityBySku.get(row.sku) ?? 0, reference: readyQuantityBySku.get(row.sku) ?? 0 }))}
    />

    <OpsCard>
      <OpsCardHeader title="补货计算参数" description={`按 ${leadTimeDays} 天船期、${demandPercent}% 销量情景计算出 ${replenishmentRows.length} 个国内可发 SKU，合计 ${integer(candidateUnits)} 件。`} action={<SlidersHorizontal className="h-4 w-4 text-slate-400" />} />
      <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"><Range label="海运船期" value={leadTimeDays} min={45} max={120} suffix="天" onChange={setLeadTimeDays} /><Range label="销量情景" value={demandPercent} min={70} max={150} suffix="%" onChange={setDemandPercent} /><Range label="到货后覆盖" value={targetCoverDays} min={15} max={90} suffix="天" onChange={setTargetCoverDays} /><Range label="安全库存" value={safetyStockDays} min={0} max={60} suffix="天" onChange={setSafetyStockDays} /></div>
    </OpsCard>

    <details className="group border border-amber-200 bg-amber-50/40" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none"><span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><SunMedium className="h-4 w-4 text-amber-700" />季节清货与补货交付约束</span><span className="text-xs text-slate-500">{seasonalShipmentRows.length} 个需发货 · {seasonalClearanceRows.length} 个需季末售罄</span></summary>
      <div className="overflow-x-auto border-t border-amber-200"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-amber-50 text-[10px] uppercase tracking-[0.08em] text-amber-900/70"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">季节动作</th><th className="px-3 py-3 text-right">国内调拨</th><th className="px-3 py-3 text-right">国内清货发出</th><th className="px-3 py-3 text-right">海外待售罄</th><th className="px-3 py-3">最晚发出</th><th className="px-3 py-3">售罄/覆盖截止</th><th className="px-4 py-3">执行说明</th></tr></thead><tbody className="divide-y divide-amber-100">{seasonalActions.filter((action) => action.shipmentQty > 0 || action.overseasClearanceQty > 0).map((action) => <tr key={`${action.market}-${action.sku}`}><td className="px-4 py-3"><Link href={marketHref(`/inventory/sku/${encodeURIComponent(action.sku)}`, data.market)} className="font-mono font-semibold text-emerald-700 hover:underline">{action.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{action.productName}</p></td><td className="px-3 py-3"><SeasonalActionBadge action={action} /></td><td className="px-3 py-3 text-right font-mono">{integer(action.transferQty)}</td><td className="px-3 py-3 text-right font-mono font-semibold text-amber-800">{integer(action.clearanceQty)}</td><td className="px-3 py-3 text-right font-mono font-semibold text-rose-700">{integer(action.overseasClearanceQty)}</td><td className="px-3 py-3 font-mono"><span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-amber-700" />{action.shipByDate}</span></td><td className="px-3 py-3 font-mono">{action.sellByDate}</td><td className="px-4 py-3 max-w-md text-slate-600">{action.reason}</td></tr>)}</tbody></table></div>
    </details>

    {message ? <p className={`border px-3 py-2 text-xs ${message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{message.text}</p> : null}

    <OpsCard>
      <div className="border-b border-slate-100 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="text-sm font-semibold text-slate-900">发货批次</h2><p className="mt-1 text-xs text-slate-500">单批 SKU 数量不设上限；导出时按历史模板容量自动生成分册</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void mutatePlan({ action: "createBatch", batch: { batchNumber: nextBatchNumber, shipmentDate: localIsoDate() } })} disabled={Boolean(busy)} className={secondaryButton}><Plus className="h-3.5 w-3.5" />新建空批次</button>
            <button type="button" onClick={autoSplitAll} disabled={Boolean(busy) || !availableRows.length} className={primaryButton}><WandSparkles className="h-3.5 w-3.5" />全部加入新批次</button>
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {batches.map((batch) => <button key={batch.id} type="button" onClick={() => void refresh(batch.id)} className={`min-w-40 border px-3 py-2 text-left ${selectedBatchId === batch.id ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-semibold">{batch.batchNumber}</span><OpsBadge tone={batch.status === "DRAFT" ? "emerald" : batch.status === "EXPORTED" ? "blue" : "slate"}>{batch.status === "DRAFT" ? "草稿" : batch.status === "EXPORTED" ? "已导出" : "已归档"}</OpsBadge></div>
            <p className="mt-1 text-[10px] text-slate-500">{batch.itemCount} SKU · {integer(batch.totalQuantity)} 件</p>
          </button>)}
          {!batches.length && !loading ? <p className="py-2 text-xs text-slate-500">尚无批次，请新建或自动分批。</p> : null}
        </div>
      </div>

      {selectedBatch ? <>
        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="批次号"><input value={selectedBatch.batchNumber} disabled={!editable} onChange={(event) => patchSelectedBatch({ batchNumber: event.target.value.toUpperCase() })} onBlur={saveBatch} className={inputClass} /></Field>
          <Field label="提货日期"><input type="date" value={selectedBatch.shipmentDate} disabled={!editable} onChange={(event) => patchSelectedBatch({ shipmentDate: event.target.value })} onBlur={saveBatch} className={inputClass} /></Field>
          <Field label="发票号"><input value={selectedBatch.invoiceNumber} disabled={!editable} onChange={(event) => patchSelectedBatch({ invoiceNumber: event.target.value })} onBlur={saveBatch} className={inputClass} placeholder="可稍后补填" /></Field>
          <Field label="货代资料"><input value={selectedBatch.freightReference} disabled={!editable} onChange={(event) => patchSelectedBatch({ freightReference: event.target.value })} onBlur={saveBatch} className={inputClass} placeholder="可稍后补填" /></Field>
          <Field label="货件编号"><input value={selectedBatch.shipmentId} disabled={!editable} onChange={(event) => patchSelectedBatch({ shipmentId: event.target.value })} onBlur={saveBatch} className={inputClass} /></Field>
          <Field label="追踪编号"><input value={selectedBatch.trackingId} disabled={!editable} onChange={(event) => patchSelectedBatch({ trackingId: event.target.value })} onBlur={saveBatch} className={inputClass} /></Field>
          <Field label="Consignee" wide><input value={selectedBatch.consignee} disabled={!editable} onChange={(event) => patchSelectedBatch({ consignee: event.target.value })} onBlur={saveBatch} className={inputClass} placeholder="收货仓名称与地址" /></Field>
          <div className="flex items-end gap-2">
            {selectedBatch.status === "DRAFT" ? <button type="button" onClick={() => void mutatePlan({ action: "deleteBatch", batchId: selectedBatch.id })} disabled={Boolean(busy)} className={dangerButton}><Trash2 className="h-3.5 w-3.5" />删除批次</button> : <button type="button" onClick={() => void mutatePlan({ action: "setStatus", batchId: selectedBatch.id, status: "DRAFT" })} disabled={Boolean(busy)} className={secondaryButton}><RotateCcw className="h-3.5 w-3.5" />恢复草稿</button>}
            {selectedBatch.status !== "ARCHIVED" ? <button type="button" onClick={() => void mutatePlan({ action: "setStatus", batchId: selectedBatch.id, status: "ARCHIVED" })} disabled={Boolean(busy)} className={secondaryButton}><Archive className="h-3.5 w-3.5" />{selectedBatch.status === "EXPORTED" ? "取消发货并释放库存" : "归档并释放占用"}</button> : null}
          </div>
        </div>

        {staleItems.length ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">{staleItems.map((item) => item.sku).join("、")} 当前已无补货建议，不会进入导出。{editable ? <button type="button" onClick={() => void mutatePlan({ action: "replace", batchId: selectedBatch.id, items: activeBatchRows.map(({ item, row }) => ({ ...itemFromRow(row, item.quantity), note: item.note })) })} className="ml-2 font-semibold underline">清理</button> : null}</div> : null}

        {loading ? <div className="grid h-32 place-items-center text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /></div> : activeBatchRows.length ? <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.09em] text-slate-500"><tr><th className="px-4 py-3"><button type="button" onClick={() => setSkuSortDirection((current) => current === "asc" ? "desc" : "asc")} className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-emerald-700" aria-label={`SKU 当前${skuSortDirection === "asc" ? "升序" : "降序"}，点击切换`}>SKU / 产品 <span aria-hidden>{skuSortDirection === "asc" ? "↑" : "↓"}</span></button></th><th className="px-3 py-3 text-right">月销</th><th className="px-3 py-3 text-right">海外覆盖</th><th className="px-3 py-3 text-right">国内现货</th><th className="px-3 py-3 text-right">建议</th><th className="px-3 py-3">季节最晚发出</th><th className="px-3 py-3 text-right">计划数量</th><th className="px-3 py-3 text-right">缺口</th><th className="px-3 py-3">备注</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{activeBatchRows.map(({ item, row }) => {
              const seasonal = seasonalActionBySku.get(item.sku);
              return <tr key={item.sku}>
                <td className="px-4 py-3"><Link href={marketHref(`/inventory/sku/${encodeURIComponent(item.sku)}`, data.market)} className="font-mono font-semibold text-emerald-700 hover:underline">{item.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{row.productName}</p><div className="mt-1 flex flex-wrap gap-1"><OpsBadge tone={badgeTone(toneByInventoryAction[row.action])}>{inventoryActionLabels[row.action]}</OpsBadge>{seasonal ? <SeasonalActionBadge action={seasonal} /> : null}<OpsBadge tone={shipmentReadySkus.has(item.sku) ? "emerald" : "rose"}>{shipmentReadySkus.has(item.sku) ? "发货参数齐全" : "缺发货参数"}</OpsBadge><OpsBadge tone={declarationReadySkus.has(item.sku) ? "blue" : "amber"}>{declarationReadySkus.has(item.sku) ? "可报运" : "报运资料待补"}</OpsBadge></div></td>
                <td className="px-3 py-3 text-right">{integer(row.dailySales * 30)}</td><td className="px-3 py-3 text-right">{days(row.daysCoverNetwork)}</td><td className="px-3 py-3 text-right"><InventoryQuantity source="domestic" label="国内现货" value={row.localInventory} /></td><td className="px-3 py-3 text-right text-emerald-700">{integer(readyQuantityBySku.get(row.sku) ?? 0)}</td><td className="px-3 py-3 font-mono text-amber-800">{seasonal?.shipByDate ?? "—"}</td>
                <td className="px-3 py-3 text-right"><input type="number" min={1} step={Math.max(1, row.cartonQty ?? 1)} value={item.quantity} disabled={!editable} onChange={(event) => updateItemLocal(item.sku, { quantity: Math.max(1, Number(event.target.value) || 1) })} onBlur={() => saveItem(item.sku)} className="w-24 border border-emerald-200 px-2 py-1.5 text-right font-mono font-semibold outline-none disabled:bg-slate-100" /></td><td className={`px-3 py-3 text-right font-semibold ${item.quantity > row.localInventory ? "text-rose-700" : "text-slate-400"}`}>{integer(Math.max(0, item.quantity - row.localInventory))}</td><td className="px-3 py-3"><input value={item.note} disabled={!editable} onChange={(event) => updateItemLocal(item.sku, { note: event.target.value })} onBlur={() => saveItem(item.sku)} className="w-56 border border-slate-200 px-2 py-1.5 outline-none disabled:bg-slate-100" placeholder="仓库、优先级等" /></td><td className="px-4 py-3 text-right">{editable ? <button type="button" onClick={() => void mutatePlan({ action: "remove", batchId: selectedBatch.id, sku: item.sku }, item.sku)} className="text-rose-700 hover:underline">删除</button> : <LockKeyhole className="ml-auto h-3.5 w-3.5 text-slate-400" />}</td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <div className="p-8 text-center text-sm text-slate-500">当前批次为空。</div>}
      </> : null}
    </OpsCard>

    {selectedBatch ? <OpsCard>
      <OpsCardHeader title="当前批次导出" description={`${selectedBatch.batchNumber} 已规划 ${planEntries.length} 个 SKU、${integer(plannedUnits)} 件；${missingShipmentData.length + missingDeclarationData.length ? `仍有 ${missingShipmentData.length} 个缺发货参数、${missingDeclarationData.length} 个缺报运资料` : "发货与报运资料均已齐全"}。`} action={<FileSpreadsheet className="h-4 w-4 text-emerald-700" />} />
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div><p className="text-sm font-semibold">{selectedBatch.batchNumber} · {planEntries.length} SKU · {integer(plannedUnits)} 件</p><p className="mt-1 text-xs text-slate-500">预检：{missingShipmentData.length} 个缺发货参数，{missingDeclarationData.length} 个缺报运资料。导出成功后批次自动锁定。</p>{exportMessage ? <p className={`mt-3 border px-3 py-2 text-xs ${exportMessage.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{exportMessage.text}</p> : null}</div><div className="grid gap-2 sm:grid-cols-3"><ExportButton busy={exporting === "shipment"} disabled={Boolean(exporting) || !planEntries.length || Boolean(missingShipmentData.length)} onClick={() => exportDocuments(["shipment"])}>发货清单</ExportButton><ExportButton busy={exporting === "declaration"} disabled={Boolean(exporting) || !planEntries.length || Boolean(missingDeclarationData.length)} onClick={() => exportDocuments(["declaration"])}>报运单</ExportButton><ExportButton busy={exporting === "both"} disabled={Boolean(exporting) || !planEntries.length || Boolean(missingShipmentData.length) || Boolean(missingDeclarationData.length)} onClick={() => exportDocuments(["shipment", "declaration"])} primary>整套单据</ExportButton></div></div>
    </OpsCard> : null}

    <OpsCard>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">国内现货发货候选</h2><p className="mt-1 text-xs text-slate-500">包含常规补货、旺季调拨与季节清货；仅显示可满足至少一整箱且尚未进入批次的 SKU：{availableRows.length} 个</p></div><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={addSeasonalPlan} disabled={Boolean(busy) || !editable || !seasonalAvailableRows.length} className={secondaryButton}><SunMedium className="h-3.5 w-3.5" />季节 SKU 加入当前批次</button><button type="button" onClick={addCurrentPage} disabled={Boolean(busy) || !editable || !availableRows.length} className={secondaryButton}><Plus className="h-3.5 w-3.5" />全部填入当前批次</button><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索国内现货 SKU" className="w-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 sm:w-64" /></label></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.09em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">季节动作</th><th className="px-3 py-3 text-right">FBA</th><th className="px-3 py-3 text-right">AWD</th><th className="px-3 py-3 text-right">国内现货</th><th className="px-3 py-3 text-right">未完工订单</th><th className="px-3 py-3 text-right">月销</th><th className="px-3 py-3 text-right">覆盖</th><th className="px-3 py-3 text-right">可发数量</th><th className="px-3 py-3">最晚发出</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{availableRows.map((row) => { const seasonal = seasonalActionBySku.get(row.sku); return <tr key={row.sku} className="hover:bg-slate-50"><td className="px-4 py-3"><Link href={marketHref(`/inventory/sku/${encodeURIComponent(row.sku)}`, data.market)} className="font-mono font-semibold text-emerald-700 hover:underline">{row.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{row.productName}</p></td><td className="px-3 py-3">{seasonal ? <SeasonalActionBadge action={seasonal} /> : <span className="text-slate-400">常规补货</span>}</td><td className="px-3 py-3 text-right"><InventoryQuantity source="fba" label="FBA" value={row.fbaSellable} /></td><td className="px-3 py-3 text-right"><InventoryQuantity source="awd" label="AWD" value={row.awdAvailable + row.awdOutboundToFba} /></td><td className="px-3 py-3 text-right"><InventoryQuantity source="domestic" label="国内现货" value={row.localInventory} /></td><td className="px-3 py-3 text-right"><InventoryQuantity source="pending" label="未完工订单" value={row.pendingOrderQty} /></td><td className="px-3 py-3 text-right">{integer(row.dailySales * 30)}</td><td className="px-3 py-3 text-right">{days(row.daysCoverNetwork)}</td><td className="px-3 py-3 text-right font-semibold text-emerald-700">{integer(readyQuantityBySku.get(row.sku) ?? 0)}</td><td className="px-3 py-3 font-mono text-amber-800">{seasonal?.shipByDate ?? "—"}</td><td className="px-4 py-3 text-right"><button type="button" disabled={Boolean(busy) || !editable} onClick={() => selectedBatch && void mutatePlan({ action: "upsert", batchId: selectedBatch.id, item: itemFromRow(row) }, row.sku)} className="text-emerald-700 hover:underline disabled:opacity-30">加入当前批次</button></td></tr>; })}</tbody></table></div>
    </OpsCard>
  </div>;
}

function localIsoDate() { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 10); }
const inputClass = "w-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-500";
const secondaryButton = "inline-flex items-center justify-center gap-1.5 border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-emerald-600 hover:text-emerald-700 disabled:opacity-40";
const primaryButton = "inline-flex items-center justify-center gap-1.5 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40";
const dangerButton = "inline-flex items-center justify-center gap-1.5 border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:border-rose-500 disabled:opacity-40";
const inventoryQuantityStyles = {
  fba: "border-emerald-200 bg-emerald-50 text-emerald-800",
  awd: "border-sky-200 bg-sky-50 text-sky-800",
  domestic: "border-blue-200 bg-blue-50 text-blue-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
} as const;
function badgeTone(tone: "blue" | "emerald" | "amber" | "rose" | "slate") { return tone; }
function SeasonalActionBadge({ action }: { action: SeasonalShipmentAction }) {
  if (action.kind === "combined") return <OpsBadge tone="rose">清货 + 补货调拨</OpsBadge>;
  if (action.kind === "clearance") return <OpsBadge tone="rose">季节清货</OpsBadge>;
  if (action.kind === "replenishment") return <OpsBadge tone="blue">旺季补货</OpsBadge>;
  return <OpsBadge tone="amber">旺季关注</OpsBadge>;
}
function seasonalPlanNote(action: SeasonalShipmentAction) { return `${action.kind === "clearance" || action.kind === "combined" ? "季节清货" : "旺季补货"}：最晚 ${action.shipByDate} 发出，${action.sellByDate} 前完成销售/覆盖。`; }
function InventoryQuantity({ source, label, value }: { source: keyof typeof inventoryQuantityStyles; label: string; value: number }) { return <span aria-label={`${label} ${integer(value)}`} className={`inline-flex min-w-14 justify-end rounded border px-2 py-1 font-mono font-semibold tabular-nums ${inventoryQuantityStyles[source]}`}>{integer(value)}</span>; }
function Range({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) { return <label><span className="flex justify-between text-xs font-medium text-slate-600"><span>{label}</span><span className="font-mono text-emerald-700">{value}{suffix}</span></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-3 w-full accent-emerald-700" /></label>; }
function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={wide ? "sm:col-span-2" : ""}><span className="mb-1.5 block text-[11px] font-medium text-slate-500">{label}</span>{children}</label>; }
function ExportButton({ children, busy, disabled, primary = false, onClick }: { children: React.ReactNode; busy: boolean; disabled: boolean; primary?: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${primary ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" : "border-slate-300 bg-white text-slate-700 hover:border-emerald-600 hover:text-emerald-700"}`}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{children}</button>; }
