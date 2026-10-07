"use client";
import { useState, type ReactNode } from "react";
import { calculateProfitScenario, cartonFreight, matchFbaFee, matchProfitFeeRule, type ProfitFeeRule } from "@/lib/inventory/profit-scenario";
type Product = { sku: string; name: string; category: string; costUsd: number | null; costRmb: number | null; cartonQty: number | null; weightG: number | null; dimensions: string; cartonDimensions: { length: number | null; width: number | null; height: number | null } };
const numeric = (value: string) => value.trim() === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function NewProductProfitCalculator({ products, rules = [] }: { products: Product[]; rules?: ProfitFeeRule[] }) {
  const [market, setMarket] = useState("US");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [carton, setCarton] = useState({ length: "", width: "", height: "", qty: "" });
  const [unit, setUnit] = useState({ length: "", width: "", height: "", weightG: "" });
  const [manual, setManual] = useState({ referral: "", fba: "", rate: "" });
  const [ad, setAd] = useState("15");
  const [returns, setReturns] = useState("1");
  const currency = market === "CA" ? "CAD" : market === "MX" ? "MXN" : "USD";
  const rule = matchProfitFeeRule(rules, market, category);
  const categories = [...new Set([...rules.filter(item => item.market === market).map(item => item.category), ...products.map(item => item.category)])].filter(Boolean).sort();
  const fbaMatched = matchFbaFee(rule, [unit.length, unit.width, unit.height].map(value => numeric(value) ?? 0), numeric(unit.weightG) ?? 0);
  const referral = numeric(manual.referral) ?? rule?.referralPercent ?? null;
  const fba = numeric(manual.fba) ?? fbaMatched;
  const rate = numeric(manual.rate) ?? rule?.freightPerM3 ?? null;
  const freight = rate === null ? null : cartonFreight(numeric(carton.length) ?? 0, numeric(carton.width) ?? 0, numeric(carton.height) ?? 0, numeric(carton.qty) ?? 0, rate);
  const values = [numeric(price), numeric(cost), referral, fba, freight, numeric(ad), numeric(returns)];
  const complete = category !== "" && values.every(value => value !== null);
  const result = complete ? calculateProfitScenario({ price: values[0]!, cost: values[1]!, referralPercent: values[2]!, fba: values[3]!, freight: values[4]!, adPercent: values[5]!, returnPercent: values[6]! }) : null;
  const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  const product = products.find(item => item.sku === sku);
  function chooseSku(value: string) {
    setSku(value);
    const item = products.find(product => product.sku === value);
    setManual({ referral: "", fba: "", rate: "" });
    if (!item) { setCost(""); setCarton({ length: "", width: "", height: "", qty: "" }); setUnit({ length: "", width: "", height: "", weightG: "" }); return; }
    setCategory(item.category || "");
    // Never convert currencies with a guessed exchange rate.
    setCost(market === "US" && item.costUsd !== null ? String(item.costUsd) : "");
    setCarton({ length: item.cartonDimensions.length?.toString() ?? "", width: item.cartonDimensions.width?.toString() ?? "", height: item.cartonDimensions.height?.toString() ?? "", qty: item.cartonQty?.toString() ?? "" });
    const dimensions = item.dimensions.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    setUnit({ length: dimensions[0]?.toString() ?? "", width: dimensions[1]?.toString() ?? "", height: dimensions[2]?.toString() ?? "", weightG: item.weightG?.toString() ?? "" });
  }
  return <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
    <section className="space-y-6 rounded-2xl border border-black/5 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="站点"><select aria-label="站点" value={market} onChange={event => { setMarket(event.target.value); setCategory(""); setPrice(""); setCost(""); setManual({ referral: "", fba: "", rate: "" }); }} className={inputClass}><option value="US">US · USD</option><option value="CA">CA · CAD</option><option value="MX">MX · MXN</option></select></Field>
        <Field label="类目"><select aria-label="类目" value={category} onChange={event => { setCategory(event.target.value); setManual({ referral: "", fba: "", rate: "" }); }} className={inputClass}><option value="">选择类目</option>{categories.map(item => <option key={item}>{item}</option>)}<option value="OTHER">其他 / 新类目</option></select></Field>
      </div>
      <Field label="选择相似产品，带入成本与包装"><select value={sku} onChange={event => chooseSku(event.target.value)} className={inputClass}><option value="">新产品，手动填写</option>{products.map(item => <option key={item.sku} value={item.sku}>{item.sku} · {item.name}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3"><NumberField label={`售价（${currency}）`} value={price} onChange={setPrice} /><NumberField label={`采购成本 / 件（${currency}）`} value={cost} onChange={setCost} /></div>
      {product && <p className="text-xs leading-6 text-slate-500">资料来自 {product.sku} 产品表。{market !== "US" && "采购成本需按所选币种确认，不自动使用旧 USD 成本。"}内部产品类目不一定等于 Amazon 佣金类目，请核对映射。</p>}
      <div className="border-t border-slate-100 pt-5"><h2 className="text-sm font-semibold">箱规与头程</h2><p className="mt-1 text-xs leading-6 text-slate-500">体积头程 = 长 × 宽 × 高 ÷ 1,000,000 × 每立方费率 ÷ 装箱件数。</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{(["length", "width", "height", "qty"] as const).map((key, i) => <NumberField key={key} label={["长 cm", "宽 cm", "高 cm", "件 / 箱"][i]} value={carton[key]} onChange={value => setCarton({ ...carton, [key]: value })} />)}</div>
        <div className="mt-3 grid grid-cols-2 gap-3"><NumberField label={`头程费率（${currency}/m³）`} value={manual.rate} onChange={value => setManual({ ...manual, rate: value })} placeholder={rule ? String(rule.freightPerM3) : "需填写或配置预设"} /><div className="rounded-lg bg-[#f5f5f7] p-3"><p className="text-xs text-slate-500">自动分摊头程 / 件</p><p className="mt-1 font-semibold text-[#1d1d1f]">{money(freight)}</p></div></div>
      </div>
      <details className="rounded-lg border border-slate-200 p-3" open={!rule}><summary className="cursor-pointer text-sm font-medium">包装与平台费用 {rule ? "（已匹配配置）" : "（待确认）"}</summary><div className="mt-4 space-y-4">
        <p className="text-xs leading-6 text-slate-500">{rule ? `已匹配 ${market} / ${category}，费率版本 ${rule.effectiveDate}。修改尺寸后重新匹配配送档位；手填值优先。` : "暂无该站点、类目的有效费率。填写确认值后试算；积加 API 不提供 Amazon 新品佣金和配送规则。"}尺寸和重量须是包装后的单件资料。</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(["length", "width", "height", "weightG"] as const).map((key, i) => <NumberField key={key} label={["单件长 cm", "单件宽 cm", "单件高 cm", "单件毛重 g"][i]} value={unit[key]} placeholder="自动匹配时填写" onChange={value => setUnit({ ...unit, [key]: value })} />)}</div>
        <div className="grid grid-cols-2 gap-3"><NumberField label="佣金率 %" value={manual.referral} onChange={value => setManual({ ...manual, referral: value })} placeholder={rule ? String(rule.referralPercent) : "按类目确认"} /><NumberField label={`配送费 / 件（${currency}）`} value={manual.fba} onChange={value => setManual({ ...manual, fba: value })} placeholder={fbaMatched === null ? "需确认配送费" : String(fbaMatched)} /></div>
      </div></details>
      <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">默认假设：广告 {ad || "—"}%、退货 {returns || "—"}%、税 0%</summary><div className="mt-2 grid grid-cols-2 gap-3"><NumberField label="广告预留 %" value={ad} onChange={setAd} /><NumberField label="退货预留 %" value={returns} onChange={setReturns} /></div></details>
    </section>
    <section className="rounded-2xl border border-black/5 bg-white p-5 xl:sticky xl:top-24"><h2 className="text-base font-semibold">单件利润</h2><p className="mt-1 text-xs text-slate-500">{market} · {currency} · {category || "未选类目"}</p>
      {result ? <><div className="my-5 rounded-xl bg-[#f5f5f7] p-5"><p className={`text-3xl font-semibold ${result.profit < 0 ? "text-rose-700" : "text-[#1d1d1f]"}`}>{money(result.profit)}</p><p className="mt-2 text-sm text-slate-600">利润率 {(result.margin * 100).toFixed(1)}%</p></div><div className="space-y-3">{[["采购成本", result.cost], ["佣金", result.referral], ["配送", result.fba], ["头程", result.freight], ["广告", result.ad], ["退货预留", result.returns]].map(([label, amount]) => <div key={String(label)}><div className="flex justify-between text-xs text-slate-600"><span>{label}</span><span>{money(Number(amount))}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-[#86b9ed]" style={{ width: `${Math.min(100, Number(amount) / result.price * 100)}%` }} /></div></div>)}</div><dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4"><div><dt className="text-xs text-slate-500">盈亏平衡售价</dt><dd className="mt-1 text-sm font-semibold">{result.breakeven === null ? "无法达到" : money(result.breakeven)}</dd></div><div><dt className="text-xs text-slate-500">盈亏平衡广告占比</dt><dd className="mt-1 text-sm font-semibold">{result.maxAdPercent.toFixed(1)}%</dd></div></dl></> : <div role="status" className="my-5 rounded-lg border border-dashed border-slate-300 p-6 text-sm leading-7 text-slate-500">{complete ? "数值无效：金额不得为负，售价须大于 0，费率须在 0–100% 内。" : "补齐类目、售价、成本、箱规、头程费率与平台费用后显示结果。缺失费用不会按 0 计算。"}</div>}
      <p className="mt-5 text-xs leading-6 text-slate-500">费用来源：{rule ? `部署费率配置 ${rule.effectiveDate}；填写值可覆盖配置。` : "用户确认输入，尚无官方费率配置。"}不计税、危险品和电池；未含月度仓储及额外附加费。结果为假设测算，不是已实现利润。</p>
    </section>
  </div>;
}
const inputClass = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-blue-600";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0"><span className="mb-2 block text-xs text-slate-600">{label}</span>{children}</label>; }
function NumberField({ label, value, onChange, placeholder = "必填" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <Field label={label}><input aria-label={label} type="number" min="0" step="any" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></Field>; }
