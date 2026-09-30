"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

type Warehouse = { id: string; code: string; name: string; kind: string; locations: Array<{ id: string; code: string; name: string }>; products: Array<{ id: string; productCode: string; sku: string; barcode: string | null; name: string; unit: string }> };
type Document = { id: string; documentNo: string; type: string; status: string; supplier: string | null; reference: string | null; createdAt: string; approvedAt: string | null; warehouse: { code: string; name: string }; targetWarehouse: { code: string; name: string } | null; lines: Array<{ id: string; sku: string; quantity: number; lotCode: string | null; poNumber: string | null; unitCost: number | null }> };
type Lot = { id: string; warehouseId: string; sku: string; lotCode: string; poNumber: string | null; receivedAt: string; unitCost: number | null; receivedQty: number; remainingQty: number; warehouse: { id: string; code: string; name: string }; location: { code: string; name: string } | null };
type Movement = { id: string; sku: string; quantity: number; movementType: string; createdAt: string; warehouse: { code: string; name: string }; document: { documentNo: string; type: string } };
type Snapshot = { warehouses: Warehouse[]; documents: Document[]; lots: Lot[]; movements: Movement[]; balances: Array<{ warehouseId: string; warehouseCode: string; warehouseName: string; sku: string; quantity: number }> };

const types = { RECEIPT: "入库", OUTBOUND: "出库", ADJUSTMENT: "库存调整", TRANSFER: "仓库调拨" } as const;
const statuses = { DRAFT: "待审核", APPROVED: "已审核", VOID: "已作废" } as const;

export function WarehouseWorkbench({ initialData, isAdmin }: { initialData: Snapshot; isAdmin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<"stock" | "documents" | "trace">("stock");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warehouseForm, setWarehouseForm] = useState({ code: "", name: "", kind: "DOMESTIC" });
  const [locationForm, setLocationForm] = useState({ warehouseId: initialData.warehouses[0]?.id ?? "", code: "", name: "" });
  const [productForm, setProductForm] = useState({ warehouseId: initialData.warehouses[0]?.id ?? "", productCode: "", sku: "", barcode: "", name: "", cartonQty: "" });
  const [documentForm, setDocumentForm] = useState({ type: "RECEIPT", warehouseId: initialData.warehouses[0]?.id ?? "", targetWarehouseId: "", locationId: "", sku: "", quantity: "", lotCode: "", poNumber: "", supplier: "", reference: "", unitCost: "", direction: "IN" });
  const [search, setSearch] = useState("");

  const filteredBalances = useMemo(() => data.balances.filter((row) => `${row.sku} ${row.warehouseName} ${row.warehouseCode}`.toLowerCase().includes(search.trim().toLowerCase())), [data.balances, search]);
  const filteredLots = useMemo(() => data.lots.filter((lot) => `${lot.sku} ${lot.poNumber ?? ""} ${lot.lotCode} ${lot.warehouse.name}`.toLowerCase().includes(search.trim().toLowerCase())), [data.lots, search]);

  async function request(path: string, method: string, body?: unknown) {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败。");
      const snapshotResponse = await fetch("/api/inventory/warehouse", { cache: "no-store" });
      if (snapshotResponse.ok) setData(await snapshotResponse.json());
      setMessage("已保存。");
      router.refresh();
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败。");
      return null;
    } finally { setBusy(false); }
  }

  async function createWarehouse() {
    const result = await request("/api/inventory/warehouse", "POST", { action: "warehouse", ...warehouseForm });
    if (result) {
      const warehouseId = result.warehouse?.id ?? "";
      setWarehouseForm({ code: "", name: "", kind: "DOMESTIC" });
      setLocationForm((current) => ({ ...current, warehouseId }));
      setProductForm((current) => ({ ...current, warehouseId }));
      setDocumentForm((current) => ({ ...current, warehouseId }));
    }
  }

  async function createLocation() {
    const result = await request("/api/inventory/warehouse", "POST", { action: "location", ...locationForm });
    if (result) setLocationForm((current) => ({ ...current, code: "", name: "" }));
  }

  async function createProduct() {
    const result = await request("/api/inventory/warehouse", "POST", { action: "product", ...productForm, ...(productForm.cartonQty ? { cartonQty: Number(productForm.cartonQty) } : {}) });
    if (result) setProductForm((current) => ({ ...current, productCode: "", sku: "", barcode: "", name: "", cartonQty: "" }));
  }

  async function createDocument() {
    const qty = Number(documentForm.quantity);
    if (!documentForm.warehouseId || !documentForm.sku || !Number.isInteger(qty) || qty < 1) { setError("请填写仓库、SKU 和正整数数量。"); return; }
    const result = await request("/api/inventory/warehouse", "POST", {
      action: "document", type: documentForm.type, warehouseId: documentForm.warehouseId,
      ...(documentForm.type === "TRANSFER" && documentForm.targetWarehouseId ? { targetWarehouseId: documentForm.targetWarehouseId } : {}),
      supplier: documentForm.supplier, reference: documentForm.reference,
      lines: [{ sku: documentForm.sku, quantity: qty, ...(documentForm.locationId ? { locationId: documentForm.locationId } : {}), ...(documentForm.lotCode ? { lotCode: documentForm.lotCode } : {}), ...(documentForm.poNumber ? { poNumber: documentForm.poNumber } : {}), ...(documentForm.unitCost ? { unitCost: Number(documentForm.unitCost) } : {}), ...(documentForm.type === "ADJUSTMENT" ? { direction: documentForm.direction } : {}) }],
    });
    if (result) setDocumentForm((current) => ({ ...current, sku: "", quantity: "", lotCode: "", poNumber: "", supplier: "", reference: "", unitCost: "" }));
  }

  async function operate(documentId: string, action: "approve" | "void") {
    await request("/api/inventory/warehouse", "PATCH", { action, documentId });
  }

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="仓库" value={String(data.warehouses.length)} hint="按工作区隔离" />
      <Metric label="有库存 SKU" value={String(data.balances.length)} hint="由批次余额汇总" />
      <Metric label="待审核单据" value={String(data.documents.filter((item) => item.status === "DRAFT").length)} hint="审核后才改变库存" />
    </div>

    {isAdmin ? <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-semibold">新增仓库</h2>
        <p className="mt-1 text-xs text-slate-500">建立国内仓、海外仓或在途虚拟仓。</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <input value={warehouseForm.code} onChange={(event) => setWarehouseForm({ ...warehouseForm, code: event.target.value })} placeholder="仓库编码" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
          <input value={warehouseForm.name} onChange={(event) => setWarehouseForm({ ...warehouseForm, name: event.target.value })} placeholder="仓库名称" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
          <select value={warehouseForm.kind} onChange={(event) => setWarehouseForm({ ...warehouseForm, kind: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="DOMESTIC">国内仓</option><option value="TRANSIT">在途</option><option value="OVERSEAS">海外仓</option></select>
        </div>
        <button type="button" disabled={busy || !warehouseForm.code || !warehouseForm.name} onClick={() => void createWarehouse()} className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">创建仓库</button>
        <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">维护库位与货品映射</summary><div className="mt-3 space-y-4">
          <div><p className="mb-2 text-[11px] font-medium text-slate-600">新增库位</p><div className="grid gap-2 sm:grid-cols-3"><select value={locationForm.warehouseId} onChange={(event) => setLocationForm({ ...locationForm, warehouseId: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">选择仓库</option>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select><input value={locationForm.code} onChange={(event) => setLocationForm({ ...locationForm, code: event.target.value })} placeholder="库位编码" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} placeholder="库位名称" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /></div><button disabled={busy || !locationForm.warehouseId || !locationForm.code || !locationForm.name} onClick={() => void createLocation()} className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold disabled:opacity-40">新增库位</button></div>
          <div><p className="mb-2 text-[11px] font-medium text-slate-600">登记仓库货品与 SKU</p><div className="grid gap-2 sm:grid-cols-3"><select value={productForm.warehouseId} onChange={(event) => setProductForm({ ...productForm, warehouseId: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">选择仓库</option>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select><input value={productForm.productCode} onChange={(event) => setProductForm({ ...productForm, productCode: event.target.value })} placeholder="冠唐货品编码" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value.toUpperCase() })} placeholder="网站 SKU" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} placeholder="品名" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={productForm.barcode} onChange={(event) => setProductForm({ ...productForm, barcode: event.target.value })} placeholder="条码（选填）" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={productForm.cartonQty} onChange={(event) => setProductForm({ ...productForm, cartonQty: event.target.value })} placeholder="箱规（件/箱）" inputMode="numeric" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /></div><button disabled={busy || !productForm.warehouseId || !productForm.productCode || !productForm.sku || !productForm.name} onClick={() => void createProduct()} className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold disabled:opacity-40">保存货品映射</button></div>
          <div className="grid gap-2 sm:grid-cols-2">{data.warehouses.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-2.5 text-[10px] text-slate-500">{item.code} · {item.name}<p className="mt-1">{item.locations.length} 个库位 · {item.products.length} 个货品映射</p></div>)}</div>
        </div></details>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-semibold">新建库存单据</h2>
        <p className="mt-1 text-xs text-slate-500">先生成草稿，由管理员审核后记入流水；出库默认按入库日期 FIFO。</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <select value={documentForm.type} onChange={(event) => setDocumentForm({ ...documentForm, type: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="RECEIPT">入库</option><option value="OUTBOUND">出库</option><option value="ADJUSTMENT">库存调整</option><option value="TRANSFER">调拨</option></select>
          <select value={documentForm.warehouseId} onChange={(event) => setDocumentForm({ ...documentForm, warehouseId: event.target.value, locationId: "" })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">选择来源仓库</option>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>
          {data.warehouses.find((item) => item.id === documentForm.warehouseId)?.locations.length ? <select value={documentForm.locationId} onChange={(event) => setDocumentForm({ ...documentForm, locationId: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">不指定库位</option>{data.warehouses.find((item) => item.id === documentForm.warehouseId)?.locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select> : null}
          {documentForm.type === "TRANSFER" ? <select value={documentForm.targetWarehouseId} onChange={(event) => setDocumentForm({ ...documentForm, targetWarehouseId: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">选择目标仓库</option>{data.warehouses.filter((item) => item.id !== documentForm.warehouseId).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select> : null}
          <input value={documentForm.sku} onChange={(event) => setDocumentForm({ ...documentForm, sku: event.target.value.toUpperCase() })} placeholder="SKU" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
          <input value={documentForm.quantity} onChange={(event) => setDocumentForm({ ...documentForm, quantity: event.target.value })} placeholder="数量（件）" inputMode="numeric" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
          {documentForm.type === "ADJUSTMENT" ? <select value={documentForm.direction} onChange={(event) => setDocumentForm({ ...documentForm, direction: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="IN">盘盈</option><option value="OUT">盘亏/报废</option></select> : null}
          {documentForm.type === "RECEIPT" || documentForm.type === "ADJUSTMENT" ? <input value={documentForm.lotCode} onChange={(event) => setDocumentForm({ ...documentForm, lotCode: event.target.value })} placeholder="批次号（可选）" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /> : null}
          {documentForm.type === "RECEIPT" ? <input value={documentForm.poNumber} onChange={(event) => setDocumentForm({ ...documentForm, poNumber: event.target.value })} placeholder="采购订单号" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /> : null}
          {documentForm.type === "RECEIPT" ? <input value={documentForm.supplier} onChange={(event) => setDocumentForm({ ...documentForm, supplier: event.target.value })} placeholder="供应商" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /> : null}
          {documentForm.type === "RECEIPT" ? <input value={documentForm.unitCost} onChange={(event) => setDocumentForm({ ...documentForm, unitCost: event.target.value })} placeholder="单位成本（选填）" inputMode="decimal" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /> : null}
          <input value={documentForm.reference} onChange={(event) => setDocumentForm({ ...documentForm, reference: event.target.value })} placeholder="关联发货批次/备注编号" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
        </div>
        <button type="button" disabled={busy || !data.warehouses.length} onClick={() => void createDocument()} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">保存草稿</button>
      </div>
    </section> : null}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-xl border border-slate-200 bg-white p-1">{([ ["stock", "库存批次"], ["documents", "库存单据"], ["trace", "库存流水"] ] as const).map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === key ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{label}</button>)}</div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 SKU、采购单或仓库" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs sm:w-64" />
    </div>

    {tab === "stock" ? <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-semibold">仓库库存</h2><div className="mt-3 divide-y divide-slate-100">{filteredBalances.length ? filteredBalances.map((row) => <div key={`${row.warehouseId}-${row.sku}`} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="font-mono text-xs font-semibold text-blue-700">{row.sku}</p><p className="mt-1 truncate text-[11px] text-slate-500">{row.warehouseCode} · {row.warehouseName}</p></div><strong className="text-sm tabular-nums">{row.quantity}</strong></div>) : <Empty>暂无库存批次。</Empty>}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-semibold">采购订单与批次构成</h2><div className="mt-3 divide-y divide-slate-100">{filteredLots.length ? filteredLots.map((lot) => <div key={lot.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><p className="font-mono text-xs font-semibold text-blue-700">{lot.sku}<span className="ml-2 font-sans font-normal text-slate-500">{lot.warehouse.name}{lot.location ? ` · ${lot.location.code}` : ""}</span></p><p className="mt-1 truncate text-[11px] text-slate-500">批次 {lot.lotCode} · 采购单 {lot.poNumber || "未关联"} · 入库 {new Date(lot.receivedAt).toLocaleDateString("zh-CN")}</p></div><span className="text-xs font-semibold">余额 {lot.remainingQty} / 入库 {lot.receivedQty}</span></div>) : <Empty>暂无可用批次。</Empty>}</div></section>
    </div> : null}

    {tab === "documents" ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-4"><h2 className="text-sm font-semibold">最近库存单据</h2></div><div className="divide-y divide-slate-100">{data.documents.length ? data.documents.map((doc) => <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold">{doc.documentNo}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">{types[doc.type as keyof typeof types] ?? doc.type}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${doc.status === "APPROVED" ? "bg-emerald-50 text-emerald-700" : doc.status === "VOID" ? "bg-slate-100 text-slate-400" : "bg-amber-50 text-amber-700"}`}>{statuses[doc.status as keyof typeof statuses] ?? doc.status}</span></div><p className="mt-1 text-[11px] text-slate-500">{doc.warehouse.name}{doc.targetWarehouse ? ` → ${doc.targetWarehouse.name}` : ""} · {doc.lines.map((line) => `${line.sku} × ${line.quantity}`).join("，")} · {new Date(doc.createdAt).toLocaleString("zh-CN")}</p><p className="mt-1 text-[10px] text-slate-400">{doc.lines.map((line) => [line.poNumber && `采购单 ${line.poNumber}`, line.lotCode && `批次 ${line.lotCode}`].filter(Boolean).join(" / ")).filter(Boolean).join(" · ")}</p></div>{isAdmin && doc.status === "DRAFT" ? <div className="flex gap-2"><button disabled={busy} onClick={() => void operate(doc.id, "approve")} className="rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">审核记账</button><button disabled={busy} onClick={() => void operate(doc.id, "void")} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600 disabled:opacity-40">作废</button></div> : null}</div>) : <Empty>暂无单据。</Empty>}</div></section> : null}

    {tab === "trace" ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-4"><h2 className="text-sm font-semibold">库存流水</h2><p className="mt-1 text-[11px] text-slate-500">每次已审核的库存变化保留单据、批次和操作类型。</p></div><div className="divide-y divide-slate-100">{data.movements.filter((item) => `${item.sku} ${item.document.documentNo} ${item.warehouse.name}`.toLowerCase().includes(search.trim().toLowerCase())).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><p className="font-mono text-xs font-semibold">{item.sku} <span className="ml-2 font-sans font-normal text-slate-500">{item.warehouse.name}</span></p><p className="mt-1 text-[10px] text-slate-500">{item.document.documentNo} · {item.movementType} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p></div><strong className={`text-sm tabular-nums ${item.quantity < 0 ? "text-rose-600" : "text-emerald-700"}`}>{item.quantity > 0 ? "+" : ""}{item.quantity}</strong></div>)}{!data.movements.length ? <Empty>暂无已审核流水。</Empty> : null}</div></section> : null}

    {message ? <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
  </div>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[10px] text-slate-400">{hint}</p></div>; }
function Empty({ children }: { children: ReactNode }) { return <p className="py-8 text-center text-xs text-slate-500">{children}</p>; }
