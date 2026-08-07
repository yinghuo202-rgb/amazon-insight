"use client";

import { Boxes, PackageSearch, RotateCcw, Save, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { EditableInventoryRow, EditableProductRow } from "@/lib/inventory/operational-data-editor";
import type { InventoryOverride, InventoryValues, ProductMasterOverride, ProductMasterValues } from "@/lib/inventory/operational-data-store";
import type { ProductCostSeries } from "@/lib/inventory/product-costs";

type EditorView = {
  products: EditableProductRow[];
  inventories: EditableInventoryRow[];
  series: ProductCostSeries[];
  summary: { productOverrideCount: number; inventoryOverrideCount: number; domesticOverrideCount: number };
};
type EditorMode = "inventory" | "product";

export function MasterDataEditor({ view }: { view: EditorView }) {
  const pageSize = 25;
  const [mode, setMode] = useState<EditorMode>("inventory");
  const [market, setMarket] = useState<"US" | "CA">("US");
  const [seriesFilter, setSeriesFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, InventoryValues>>(() => Object.fromEntries(view.inventories.map((row) => [inventoryKey(row), inventoryValues(row)])));
  const [inventorySaved, setInventorySaved] = useState<Record<string, InventoryValues>>(() => Object.fromEntries(view.inventories.map((row) => [inventoryKey(row), inventoryValues(row)])));
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductMasterValues>>(() => Object.fromEntries(view.products.map((row) => [row.sku, productValues(row)])));
  const [productSaved, setProductSaved] = useState<Record<string, ProductMasterValues>>(() => Object.fromEntries(view.products.map((row) => [row.sku, productValues(row)])));
  const [inventoryMeta, setInventoryMeta] = useState<Record<string, string>>(() => Object.fromEntries(view.inventories.flatMap((row) => row.updatedAt ? [[inventoryKey(row), row.updatedAt]] : [])));
  const [productMeta, setProductMeta] = useState<Record<string, string>>(() => Object.fromEntries(view.products.flatMap((row) => row.updatedAt ? [[row.sku, row.updatedAt]] : [])));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const normalized = query.trim().toUpperCase();
  const filteredInventory = useMemo(() => view.inventories.filter((row) =>
    row.market === market
    && (seriesFilter === "ALL" || row.seriesId === seriesFilter)
    && (!normalized || `${row.sku} ${row.productName} ${row.seriesName}`.toUpperCase().includes(normalized)),
  ), [market, normalized, seriesFilter, view.inventories]);
  const filteredProducts = useMemo(() => view.products.filter((row) =>
    (seriesFilter === "ALL" || row.seriesId === seriesFilter)
    && (!normalized || `${row.sku} ${row.chineseName} ${row.englishName} ${row.category} ${row.seriesName}`.toUpperCase().includes(normalized)),
  ), [normalized, seriesFilter, view.products]);
  const currentRows = mode === "inventory" ? filteredInventory : filteredProducts;
  const pageCount = Math.max(1, Math.ceil(currentRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleInventory = filteredInventory.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleProducts = filteredProducts.slice((safePage - 1) * pageSize, safePage * pageSize);
  const dirtyInventory = view.inventories.filter((row) => !same(inventoryDrafts[inventoryKey(row)], inventorySaved[inventoryKey(row)]));
  const dirtyProducts = view.products.filter((row) => !same(productDrafts[row.sku], productSaved[row.sku]));
  const dirtyCount = mode === "inventory" ? dirtyInventory.length : dirtyProducts.length;
  const onlineCount = mode === "inventory" ? Object.keys(inventoryMeta).length : Object.keys(productMeta).length;

  function patchInventory(row: EditableInventoryRow, field: keyof InventoryValues, value: number) {
    const key = inventoryKey(row);
    setInventoryDrafts((current) => ({ ...current, [key]: { ...current[key], [field]: Math.max(0, Math.round(value)) } }));
    setMessage("");
  }
  function patchProduct(sku: string, patch: Partial<ProductMasterValues>) {
    setProductDrafts((current) => ({ ...current, [sku]: { ...current[sku], ...patch } }));
    setMessage("");
  }

  async function saveChanges() {
    const entity = mode;
    const dirty = entity === "inventory" ? dirtyInventory : dirtyProducts;
    if (!dirty.length) return;
    setBusy("save"); setMessage("");
    try {
      const items = entity === "inventory"
        ? dirtyInventory.map((row) => ({ market: row.market, sku: row.sku, ...inventoryDrafts[inventoryKey(row)] }))
        : dirtyProducts.map((row) => ({ sku: row.sku, ...productDrafts[row.sku] }));
      const response = await fetch("/api/inventory/master-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, items }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "在线数据保存失败。");
      if (entity === "inventory") {
        setInventorySaved((current) => ({ ...current, ...Object.fromEntries(dirtyInventory.map((row) => [inventoryKey(row), inventoryDrafts[inventoryKey(row)]])) }));
        setInventoryMeta(inventoryMetaFromPayload(payload.inventories as InventoryOverride[], payload.domesticInventories as Array<{ sku: string; updatedAt: string }>));
      } else {
        setProductSaved((current) => ({ ...current, ...Object.fromEntries(dirtyProducts.map((row) => [row.sku, productDrafts[row.sku]])) }));
        setProductMeta(Object.fromEntries((payload.products as ProductMasterOverride[]).map((item) => [item.sku, item.updatedAt])));
      }
      setMessage(`已保存 ${dirty.length} 条${entity === "inventory" ? "库存" : "产品"}数据，后台计算与其他页面将读取新值。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "在线数据保存失败。");
    } finally { setBusy(""); }
  }

  async function restoreFiltered() {
    const rows = mode === "inventory"
      ? filteredInventory.filter((row) => inventoryMeta[inventoryKey(row)])
      : filteredProducts.filter((row) => productMeta[row.sku]);
    if (!rows.length) { setMessage("当前筛选范围没有需要恢复的在线修改。"); return; }
    setBusy("restore"); setMessage("");
    try {
      const keys = rows.map((row) => ({ sku: row.sku, ...(mode === "inventory" ? { market: (row as EditableInventoryRow).market } : {}) }));
      const response = await fetch("/api/inventory/master-data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: mode, keys }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "恢复源数据失败。");
      if (mode === "inventory") {
        const values = Object.fromEntries((rows as EditableInventoryRow[]).map((row) => [inventoryKey(row), row.source]));
        setInventoryDrafts((current) => ({ ...current, ...values })); setInventorySaved((current) => ({ ...current, ...values }));
        setInventoryMeta(inventoryMetaFromPayload(payload.inventories, payload.domesticInventories));
      } else {
        const values = Object.fromEntries((rows as EditableProductRow[]).map((row) => [row.sku, row.source]));
        setProductDrafts((current) => ({ ...current, ...values })); setProductSaved((current) => ({ ...current, ...values }));
        setProductMeta(Object.fromEntries((payload.products as ProductMasterOverride[]).map((item) => [item.sku, item.updatedAt])));
      }
      setMessage(`已将 ${rows.length} 条数据恢复为后台源文件值。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复源数据失败。");
    } finally { setBusy(""); }
  }

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="当前数据集" value={mode === "inventory" ? `${market} 库存` : "产品主数据"} detail={`${currentRows.length} 个符合筛选的 SKU`} />
      <OpsKpi label="在线版本" value={`${onlineCount} 条`} detail="保存在本地运营数据库中的人工值" tone={onlineCount ? "positive" : "default"} />
      <OpsKpi label="未保存修改" value={`${dirtyCount} 条`} detail="保存后同步到所有业务页面" tone={dirtyCount ? "warning" : "positive"} />
      <OpsKpi label="数据保护" value="源文件只读" detail="可随时恢复；销量、订单和派生指标不可直接修改" />
    </div>

    <OpsCard>
      <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex w-fit rounded-lg bg-slate-100 p-1">
          <ModeButton active={mode === "inventory"} onClick={() => { setMode("inventory"); setPage(1); }}><Boxes className="h-4 w-4" />库存数据</ModeButton>
          <ModeButton active={mode === "product"} onClick={() => { setMode("product"); setPage(1); }}><PackageSearch className="h-4 w-4" />产品主数据</ModeButton>
        </div>
        <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-[120px_minmax(250px,1fr)_minmax(220px,1fr)]">
          {mode === "inventory" ? <select aria-label="在线编辑市场" value={market} onChange={(event) => { setMarket(event.target.value as "US" | "CA"); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="US">美国库存</option><option value="CA">加拿大库存</option></select> : <Link href="/inventory/costs" className="inline-flex items-center justify-center border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">产品成本另页维护</Link>}
          <select aria-label="在线编辑系列筛选" value={seriesFilter} onChange={(event) => { setSeriesFilter(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ALL">全部系列</option>{view.series.map((series) => <option key={series.id} value={series.id}>{series.kind === "variant" ? "系列" : "待归"} · {series.name} · {series.skuCount}</option>)}</select>
          <label className="relative"><span className="sr-only">搜索在线数据</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="搜索在线数据" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、产品或系列" className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" /></label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button type="button" onClick={() => void saveChanges()} disabled={!dirtyCount || Boolean(busy)} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{busy === "save" ? "保存中…" : `保存修改${dirtyCount ? `（${dirtyCount}）` : ""}`}</button>
        <button type="button" onClick={() => void restoreFiltered()} disabled={!onlineCount || Boolean(busy)} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />恢复当前筛选源数据</button>
        <p className="ml-auto text-[11px] text-slate-500">{mode === "inventory" ? "国内库存为美加共享池；在任一市场修改都会同步到另一市场。" : "产品名称、品类、包装和箱规将同步到产品详情及供应链计算。"}</p>
      </div>
      {message ? <p role="status" className={`border-t px-4 py-2.5 text-xs ${message.startsWith("已") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800"}`}>{message}</p> : null}
    </OpsCard>

    <OpsCard>
      <OpsCardHeader title={mode === "inventory" ? `${market} 库存在线编辑` : "产品主数据在线编辑"} description={`当前筛选 ${currentRows.length} 个 SKU，${onlineCount} 个采用在线值，${dirtyCount ? `${dirtyCount} 个修改尚未保存` : "所有修改均已同步"}。`} action={<OpsBadge tone={dirtyCount ? "amber" : "emerald"}>{dirtyCount ? `${dirtyCount} 项待保存` : "数据已同步"}</OpsBadge>} />
      {mode === "inventory" ? <InventoryTable rows={visibleInventory} drafts={inventoryDrafts} saved={inventorySaved} meta={inventoryMeta} onChange={patchInventory} /> : <ProductTable rows={visibleProducts} drafts={productDrafts} saved={productSaved} meta={productMeta} onChange={patchProduct} />}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>显示 {mode === "inventory" ? visibleInventory.length : visibleProducts.length} / {currentRows.length} 项 · 第 {safePage}/{pageCount} 页</span><div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="border border-slate-200 px-3 py-1.5 disabled:opacity-40">上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="border border-slate-200 px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
    </OpsCard>

    <details className="border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">可编辑与只读数据边界</summary><div className="grid gap-3 border-t border-slate-100 p-4 text-xs leading-5 text-slate-600 md:grid-cols-3"><p><strong className="text-slate-900">库存源字段：</strong>FBA 可售、AWD 可用、AWD 调拨/入库和共享国内库存可在线维护。</p><p><strong className="text-slate-900">产品主数据：</strong>名称、品类、包装、装箱量、单品重量和外箱尺寸可在线维护。</p><p><strong className="text-slate-900">只读派生数据：</strong>销量、订单、覆盖天数、风险、发货和采购建议由系统根据源字段重新计算。</p></div></details>
  </div>;
}

function InventoryTable({ rows, drafts, saved, meta, onChange }: { rows: EditableInventoryRow[]; drafts: Record<string, InventoryValues>; saved: Record<string, InventoryValues>; meta: Record<string, string>; onChange: (row: EditableInventoryRow, field: keyof InventoryValues, value: number) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">系列</th><th className="px-3 py-3">状态</th><th className="px-3 py-3 text-right">FBA 可售</th><th className="px-3 py-3 text-right">AWD 可用</th><th className="px-3 py-3 text-right">AWD→FBA</th><th className="px-3 py-3 text-right">AWD 入库</th><th className="px-3 py-3 text-right">共享国内库存</th><th className="px-4 py-3">最后修改</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => {
    const key = inventoryKey(row); const values = drafts[key]; const dirty = !same(values, saved[key]);
    return <tr key={key} className={dirty ? "bg-amber-50/40" : "hover:bg-slate-50"}><td className="px-4 py-3"><Link href={`/inventory/sku/${row.sku}?market=${row.market}`} className="font-mono font-semibold text-emerald-700">{row.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{row.productName}</p></td><td className="px-3 py-3"><p className="max-w-56 truncate">{row.seriesName}</p></td><td className="px-3 py-3"><StateBadge dirty={dirty} online={Boolean(meta[key])} /></td>{(["fbaSellable", "awdAvailable", "awdOutboundToFba", "awdInbound", "localInventory"] as const).map((field) => <IntegerInput key={field} label={`${row.market} ${row.sku} ${inventoryLabel[field]}`} value={values[field]} onChange={(value) => onChange(row, field, value)} />)}<td className="px-4 py-3 text-[11px] text-slate-500">{meta[key] ? dateTime(meta[key]) : "源文件"}</td></tr>;
  })}</tbody></table></div>;
}

function ProductTable({ rows, drafts, saved, meta, onChange }: { rows: EditableProductRow[]; drafts: Record<string, ProductMasterValues>; saved: Record<string, ProductMasterValues>; meta: Record<string, string>; onChange: (sku: string, patch: Partial<ProductMasterValues>) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[1900px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 系列</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">中文名称</th><th className="px-3 py-3">英文名称</th><th className="px-3 py-3">品类</th><th className="px-3 py-3">包装</th><th className="px-3 py-3 text-right">装箱量</th><th className="px-3 py-3 text-right">单品克重</th><th className="px-3 py-3">单品尺寸</th><th className="px-3 py-3 text-right">箱重 kg</th><th className="px-3 py-3">外箱 cm</th><th className="px-4 py-3">最后修改</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => {
    const values = drafts[row.sku]; const dirty = !same(values, saved[row.sku]);
    return <tr key={row.sku} className={dirty ? "bg-amber-50/40" : "hover:bg-slate-50"}><td className="px-4 py-3"><Link href={`/inventory/sku/${row.sku}`} className="font-mono font-semibold text-emerald-700">{row.sku}</Link><p className="mt-1 max-w-56 truncate text-slate-500">{row.seriesName}</p></td><td className="px-3 py-3"><StateBadge dirty={dirty} online={Boolean(meta[row.sku])} /></td><TextInput label={`${row.sku} 中文名称`} value={values.chineseName} onChange={(value) => onChange(row.sku, { chineseName: value })} /><TextInput label={`${row.sku} 英文名称`} value={values.englishName} onChange={(value) => onChange(row.sku, { englishName: value })} /><TextInput label={`${row.sku} 品类`} value={values.category} onChange={(value) => onChange(row.sku, { category: value })} /><TextInput label={`${row.sku} 包装`} value={values.packaging} onChange={(value) => onChange(row.sku, { packaging: value })} /><NullableInput label={`${row.sku} 装箱量`} value={values.cartonQty} integer onChange={(value) => onChange(row.sku, { cartonQty: value })} /><NullableInput label={`${row.sku} 单品克重`} value={values.productWeightG} onChange={(value) => onChange(row.sku, { productWeightG: value })} /><TextInput label={`${row.sku} 单品尺寸`} value={values.shippingSizeCm} onChange={(value) => onChange(row.sku, { shippingSizeCm: value })} /><NullableInput label={`${row.sku} 外箱毛重`} value={values.cartonGrossWeightKg} onChange={(value) => onChange(row.sku, { cartonGrossWeightKg: value })} /><td className="px-3 py-3"><div className="flex gap-1">{(["cartonLengthCm", "cartonWidthCm", "cartonHeightCm"] as const).map((field, index) => <input key={field} aria-label={`${row.sku} 外箱${["长", "宽", "高"][index]}`} type="number" min={0} step={0.1} value={values[field] ?? ""} onChange={(event) => onChange(row.sku, { [field]: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) })} className="w-16 border border-slate-200 px-2 py-1.5 text-right font-mono" />)}</div></td><td className="px-4 py-3 text-[11px] text-slate-500">{meta[row.sku] ? dateTime(meta[row.sku]) : "源文件"}</td></tr>;
  })}</tbody></table></div>;
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{children}</button>; }
function StateBadge({ dirty, online }: { dirty: boolean; online: boolean }) { return <OpsBadge tone={dirty ? "amber" : online ? "blue" : "slate"}>{dirty ? "待保存" : online ? "在线值" : "源数据"}</OpsBadge>; }
function IntegerInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <td className="px-3 py-3 text-right"><input aria-label={label} type="number" min={0} step={1} value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} className="w-24 border border-slate-200 px-2 py-1.5 text-right font-mono focus:border-emerald-600" /></td>; }
function NullableInput({ label, value, integer = false, onChange }: { label: string; value: number | null; integer?: boolean; onChange: (value: number | null) => void }) { return <td className="px-3 py-3 text-right"><input aria-label={label} type="number" min={integer ? 1 : 0} step={integer ? 1 : 0.1} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Math.max(integer ? 1 : 0, integer ? Math.round(Number(event.target.value) || 0) : Number(event.target.value) || 0))} className="w-24 border border-slate-200 px-2 py-1.5 text-right font-mono" /></td>; }
function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <td className="px-3 py-3"><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-48 border border-slate-200 px-2 py-1.5" /></td>; }
function inventoryKey(row: { market: string; sku: string }) { return `${row.market}:${row.sku}`; }
function inventoryValues(row: InventoryValues) { return { fbaSellable: row.fbaSellable, awdAvailable: row.awdAvailable, awdOutboundToFba: row.awdOutboundToFba, awdInbound: row.awdInbound, localInventory: row.localInventory }; }
function productValues(row: ProductMasterValues) { return { chineseName: row.chineseName, englishName: row.englishName, category: row.category, packaging: row.packaging, cartonQty: row.cartonQty, productWeightG: row.productWeightG, shippingSizeCm: row.shippingSizeCm, cartonGrossWeightKg: row.cartonGrossWeightKg, cartonLengthCm: row.cartonLengthCm, cartonWidthCm: row.cartonWidthCm, cartonHeightCm: row.cartonHeightCm }; }
function same(left: object | undefined, right: object | undefined) { return JSON.stringify(left) === JSON.stringify(right); }
function inventoryMetaFromPayload(inventories: InventoryOverride[], domestic: Array<{ sku: string; updatedAt: string }>) {
  const domesticBySku = new Map(domestic.map((item) => [item.sku, item.updatedAt]));
  return Object.fromEntries(inventories.map((item) => [`${item.market}:${item.sku}`, item.updatedAt > (domesticBySku.get(item.sku) ?? "") ? item.updatedAt : domesticBySku.get(item.sku) ?? item.updatedAt]));
}
function dateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
const inventoryLabel: Record<keyof InventoryValues, string> = { fbaSellable: "FBA可售", awdAvailable: "AWD可用", awdOutboundToFba: "AWD转FBA", awdInbound: "AWD入库", localInventory: "共享国内库存" };
