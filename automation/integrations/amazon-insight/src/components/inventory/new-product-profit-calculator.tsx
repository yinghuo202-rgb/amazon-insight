"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

type Product = { sku: string; name: string; category: string; costUsd: number | null; costRmb: number | null; cartonQty: number | null; weightG: number | null; dimensions: string };

export function NewProductProfitCalculator({ products }: { products: Product[] }) {
  const categories = [...new Set(products.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const [market, setMarket] = useState("US");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [selectedSku, setSelectedSku] = useState("");
  const product = products.find((item) => item.sku === selectedSku);
  const currency = market === "CA" ? "CAD" : market === "MX" ? "MXN" : "USD";
  const [price, setPrice] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [exchange, setExchange] = useState("1");
  const [referralRate, setReferralRate] = useState("");
  const [fulfillmentFee, setFulfillmentFee] = useState("");
  const [firstMile, setFirstMile] = useState("");
  const [adRate, setAdRate] = useState("15");
  const [returnRate, setReturnRate] = useState("1");
  const [expanded, setExpanded] = useState(false);

  function chooseSku(value: string) {
    setSelectedSku(value);
    const matched = products.find((item) => item.sku === value);
    if (matched) {
      setCategory(matched.category || category);
      setPurchaseCost(matched.costUsd === null ? "" : market === "US" ? String(matched.costUsd) : Number(exchange) > 0 ? String(matched.costUsd * Number(exchange)) : "");
    }
  }

  const result = useMemo(() => {
    const values = [price, purchaseCost, referralRate, fulfillmentFee, firstMile].map(Number);
    if (values.some((value, index) => ![price, purchaseCost, referralRate, fulfillmentFee, firstMile][index] || !Number.isFinite(value)) || Number(price) <= 0 || Number(purchaseCost) < 0) return null;
    const [sellingPrice, cost, referralPercent, fbaFee, freight] = values;
    const ad = sellingPrice * (Number(adRate) || 0) / 100;
    const returns = sellingPrice * (Number(returnRate) || 0) / 100;
    const referral = sellingPrice * referralPercent / 100;
    const profit = sellingPrice - referral - fbaFee - freight - cost - ad - returns;
    const contributionRate = 1 - referralPercent / 100 - (Number(adRate) || 0) / 100 - (Number(returnRate) || 0) / 100;
    const breakeven = contributionRate > 0 ? (cost + fbaFee + freight) / contributionRate : Number.POSITIVE_INFINITY;
    return { sellingPrice, cost, referral, fbaFee, freight, ad, returns, profit, margin: profit / sellingPrice * 100, breakeven };
  }, [price, purchaseCost, referralRate, fulfillmentFee, firstMile, adRate, returnRate]);

  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);

  return <div className="grid gap-4 xl:grid-cols-[1fr_.8fr]">
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div><h2 className="text-sm font-semibold">产品与市场</h2><p className="mt-1 text-xs leading-5 text-slate-500">先选市场、类目，再选择已有 SKU 自动带入成本与包装资料；费率表待配置前，佣金和配送费由你确认输入。</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="市场"><select value={market} onChange={(event) => { const nextMarket = event.target.value; setMarket(nextMarket); setExchange(nextMarket === "US" ? "1" : ""); setPurchaseCost(""); }} className={inputClass}><option value="US">US · USD</option><option value="CA">CA · CAD</option><option value="MX">MX · MXN</option></select></Field>
        <Field label="Amazon 类目"><select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}><option value="">选择类目</option>{categories.map((item) => <option key={item}>{item}</option>)}<option value="OTHER">其他/新类目</option></select></Field>
        <Field label="已有 SKU / 相似产品"><select value={selectedSku} onChange={(event) => chooseSku(event.target.value)} className={inputClass}><option value="">新产品，手动输入</option>{products.map((item) => <option key={item.sku} value={item.sku}>{item.sku} · {item.name}</option>)}</select></Field>
        <Field label={`预估售价（${currency}）`}><input value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="0" step="0.01" className={inputClass} placeholder="必填" /></Field>
        <Field label={`单件采购成本（${currency}）`} hint={product?.costUsd !== null && product?.costUsd !== undefined ? `来自产品成本表：$${product.costUsd.toFixed(2)} USD` : "冠唐成本接入后可自动匹配；当前需确认输入。"}><input value={purchaseCost} onChange={(event) => setPurchaseCost(event.target.value)} type="number" min="0" step="0.01" className={inputClass} placeholder="必填" /></Field>
        {market !== "US" ? <Field label="USD → 市场币种汇率" hint="请填当前汇率；未接汇率源时不会自动猜。"><input value={exchange} onChange={(event) => { const rate = event.target.value; setExchange(rate); if (product?.costUsd !== null && product?.costUsd !== undefined) setPurchaseCost(Number(rate) > 0 ? String(product.costUsd * Number(rate)) : ""); }} type="number" min="0.0001" step="0.0001" className={inputClass} /></Field> : null}
      </div>
      {product ? <div className="rounded-xl bg-blue-50/70 p-3 text-[11px] leading-5 text-blue-900"><p className="font-semibold">已带入 {product.sku} 的产品资料</p><p className="mt-1">成本来源：产品成本表；箱规：{product.cartonQty ? `${product.cartonQty} 件/箱` : "缺失"}；单品重量：{product.weightG ? `${product.weightG} g` : "缺失"}；尺寸：{product.dimensions || "缺失"}</p></div> : null}
      <div className="border-t border-slate-100 pt-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-xs font-semibold">平台与头程费用</h3><p className="mt-1 text-[10px] text-slate-500">按市场和类目确定有效费率；未配置官方费率前请使用确认值。</p></div><button onClick={() => setExpanded((value) => !value)} className="text-[11px] font-medium text-blue-700">{expanded ? "收起默认项" : "广告/退货默认值"}</button></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label="佣金率 %"><input value={referralRate} onChange={(event) => setReferralRate(event.target.value)} type="number" min="0" max="100" step="0.1" className={inputClass} placeholder="按类目确认" /></Field><Field label={`FBA 配送费（${currency}）`}><input value={fulfillmentFee} onChange={(event) => setFulfillmentFee(event.target.value)} type="number" min="0" step="0.01" className={inputClass} placeholder="按尺寸/重量确认" /></Field><Field label={`头程分摊（${currency}/件）`}><input value={firstMile} onChange={(event) => setFirstMile(event.target.value)} type="number" min="0" step="0.01" className={inputClass} placeholder="按预设路线确认" /></Field></div>
        {expanded ? <div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label="广告费率 %"><input value={adRate} onChange={(event) => setAdRate(event.target.value)} type="number" min="0" max="100" step="0.1" className={inputClass} /></Field><Field label="退货预留 %"><input value={returnRate} onChange={(event) => setReturnRate(event.target.value)} type="number" min="0" max="100" step="0.1" className={inputClass} /></Field><div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">税率 0% · 不计算危险品和电池费</div></div> : null}
      </div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-semibold">单件利润试算</h2><p className="mt-1 text-xs text-slate-500">{category || "请先选类目"} · {market} · {currency}</p>{result ? <><div className={`mt-5 rounded-2xl p-5 ${result.profit >= 0 ? "bg-emerald-50" : "bg-rose-50"}`}><p className="text-xs text-slate-600">预估净利润</p><p className={`mt-2 text-3xl font-semibold tracking-tight ${result.profit >= 0 ? "text-emerald-800" : "text-rose-800"}`}>{money(result.profit)}</p><p className="mt-2 text-xs text-slate-600">利润率 {result.margin.toFixed(1)}%</p></div><div className="mt-4 divide-y divide-slate-100">{[["售价", result.sellingPrice], ["采购成本", -result.cost], ["Amazon 佣金", -result.referral], ["FBA 配送", -result.fbaFee], ["头程", -result.freight], [`广告（${adRate}%）`, -result.ad], [`退货预留（${returnRate}%）`, -result.returns]].map(([label, amount]) => <div key={String(label)} className="flex justify-between gap-3 py-2.5 text-xs"><span className="text-slate-500">{label}</span><span className="font-medium tabular-nums">{money(Number(amount))}</span></div>)}</div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">盈亏平衡售价</p><p className="mt-1 text-sm font-semibold">{Number.isFinite(result.breakeven) ? money(result.breakeven) : "需补费率"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">适用假设</p><p className="mt-1 text-[11px] font-medium">广告 15% · 退货 1% · 税 0%</p></div></div></> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs leading-5 text-slate-500">填入售价、成本、类目佣金率、FBA 配送费和头程分摊后显示结果。缺失费用不会按 0 计算。</div>}<p className="mt-4 text-[10px] leading-5 text-slate-400">仅用于新品假设测算。Amazon 类目佣金和 FBA 费率需按所选市场、类目、生效日期及产品尺寸重量核对。</p></section>
  </div>;
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="block min-w-0"><span className="mb-1.5 block text-[11px] font-medium text-slate-600">{label}</span>{children}{hint ? <span className="mt-1 block text-[10px] leading-4 text-slate-400">{hint}</span> : null}</label>; }
