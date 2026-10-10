"use client";
import { useState, type ReactNode } from "react";
import { calculateProfitScenario, cartonFreight, matchFbaFee, matchProfitFeeRule, type ProfitFeeRule } from "@/lib/inventory/profit-scenario";
type Product = { selectionId?: string; source?: string; sku: string; name: string; category: string; costUsd: number | null; costRmb: number | null; cartonQty: number | null; weightG: number | null; dimensions: string; cartonDimensions: { length: number | null; width: number | null; height: number | null } };
const numeric = (value: string) => value.trim() === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function NewProductProfitCalculator({ products, rules = [] }: { products: Product[]; rules?: ProfitFeeRule[] }) {
  const [market, setMarket] = useState("US");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [scenarioPrices, setScenarioPrices] = useState({ conservative: "", higher: "" });
  const [selectedScenario, setSelectedScenario] = useState(1);
  const [confirmation, setConfirmation] = useState("");
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
  const feeKey = JSON.stringify({ market, category, carton, unit, manual, rule });
  const needsConfirmation = !rule?.validUntil || Object.values(manual).some(value => value.trim() !== "") || fbaMatched === null;
  const feesConfirmed = !needsConfirmation || confirmation === feeKey;
  const scenario = (scenarioPrice: number | null) => complete && feesConfirmed && scenarioPrice !== null ? calculateProfitScenario({ price: scenarioPrice, cost: values[1]!, referralPercent: values[2]!, fba: values[3]!, freight: values[4]!, adPercent: values[5]!, returnPercent: values[6]!, referralRule: manual.referral.trim() === "" && rule ? rule : undefined }) : null;
  const scenarios = [
    { name: "方案 A", label: "保守售价", price: numeric(scenarioPrices.conservative) ?? (values[0] === null ? null : values[0] * .95) },
    { name: "方案 B", label: "基准售价", price: values[0] },
    { name: "方案 C", label: "提价售价", price: numeric(scenarioPrices.higher) ?? (values[0] === null ? null : values[0] * 1.05) },
  ].map(item => ({ ...item, result: scenario(item.price) }));
  const result = scenarios[selectedScenario].result;
  const feeColors = ["#315d50", "#a6b7aa", "#739e8b", "#b1c8ba", "#d6c5ac", "#e7dfd2", "#eaf0ec"];
  const feeParts = result ? [result.cost, result.referral, result.fba, result.freight, result.ad, result.returns, Math.max(0, result.profit)] : [];
  const feeTotal = feeParts.reduce((sum, value) => sum + value, 0);
  let feeOffset = 0;
  const donutStops = feeParts.map((value, index) => { const start = feeOffset; feeOffset += feeTotal > 0 ? value / feeTotal * 100 : 0; return `${feeColors[index]} ${start}% ${feeOffset}%`; }).join(", ");
  const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  const product = products.find(item => (item.selectionId || item.sku) === sku);
  function chooseSku(value: string) {
    setSku(value);
    const item = products.find(product => (product.selectionId || product.sku) === value);
    setManual({ referral: "", fba: "", rate: "" });
    if (!item) { setCost(""); setCarton({ length: "", width: "", height: "", qty: "" }); setUnit({ length: "", width: "", height: "", weightG: "" }); return; }
    setCategory(item.category || "");
    // Never convert currencies with a guessed exchange rate.
    setCost(market === "US" && item.costUsd !== null ? String(item.costUsd) : "");
    setCarton({ length: item.cartonDimensions.length?.toString() ?? "", width: item.cartonDimensions.width?.toString() ?? "", height: item.cartonDimensions.height?.toString() ?? "", qty: item.cartonQty?.toString() ?? "" });
    const dimensions = item.dimensions.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    setUnit({ length: dimensions[0]?.toString() ?? "", width: dimensions[1]?.toString() ?? "", height: dimensions[2]?.toString() ?? "", weightG: item.weightG?.toString() ?? "" });
  }
  return <div className="ops-calc-grid">
    <section className="ops-calc-inputs space-y-6">
      <h2 className="ops-section-title">产品与费用假设</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="站点"><select aria-label="站点" value={market} onChange={event => { setMarket(event.target.value); setCategory(""); setPrice(""); setScenarioPrices({ conservative: "", higher: "" }); setCost(""); setManual({ referral: "", fba: "", rate: "" }); }} className={inputClass}><option value="US">US · USD</option><option value="CA">CA · CAD</option><option value="MX">MX · MXN</option></select></Field>
        <Field label="类目"><select aria-label="类目" value={category} onChange={event => { setCategory(event.target.value); setManual({ referral: "", fba: "", rate: "" }); }} className={inputClass}><option value="">选择类目</option>{categories.map(item => <option key={item}>{item}</option>)}<option value="OTHER">其他 / 新类目</option></select></Field>
      </div>
      <Field label="选择相似产品，带入成本与包装"><select value={sku} onChange={event => chooseSku(event.target.value)} className={inputClass}><option value="">新产品，手动填写</option>{products.map(item => <option key={item.selectionId || item.sku} value={item.selectionId || item.sku}>{item.source || "产品"} · {item.sku || "未建立SKU"} · {item.name}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3"><NumberField label={`售价（${currency}）`} value={price} onChange={setPrice} /><NumberField label={`采购成本 / 件（${currency}）`} value={cost} onChange={setCost} /></div>
      <details className="rounded-lg border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer text-sm">自定义对比售价</summary><div className="grid grid-cols-2 gap-3"><NumberField label={`保守售价（${currency}）`} value={scenarioPrices.conservative} onChange={value => setScenarioPrices({ ...scenarioPrices, conservative: value })} placeholder="默认基准 -5%" /><NumberField label={`提价售价（${currency}）`} value={scenarioPrices.higher} onChange={value => setScenarioPrices({ ...scenarioPrices, higher: value })} placeholder="默认基准 +5%" /></div></details>
      {product && <p className="text-xs leading-6 text-slate-500">{product.source || "产品目录"}{product.costRmb !== null ? ` · 采购参考 ¥${product.costRmb}` : ""} · 成本按 {currency} 输入，类目按 Amazon 佣金类目选择。</p>}
      <div className="border-t border-slate-100 pt-5"><h2 className="text-sm font-semibold">箱规与头程</h2><p className="mt-1 text-xs leading-6 text-slate-500">体积头程 = 长 × 宽 × 高 ÷ 1,000,000 × 每立方费率 ÷ 装箱件数。</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{(["length", "width", "height", "qty"] as const).map((key, i) => <NumberField key={key} label={["长 cm", "宽 cm", "高 cm", "件 / 箱"][i]} value={carton[key]} onChange={value => setCarton({ ...carton, [key]: value })} />)}</div>
        <div className="mt-3 grid grid-cols-2 gap-3"><NumberField label={`头程费率（${currency}/m³）`} value={manual.rate} onChange={value => setManual({ ...manual, rate: value })} placeholder={rule ? String(rule.freightPerM3) : "需填写或配置预设"} /><div className="rounded-lg bg-[#f5f5f7] p-3"><p className="text-xs text-slate-500">自动分摊头程 / 件</p><p className="mt-1 font-semibold text-[#1d1d1f]">{money(freight)}</p></div></div>
      </div>
      <details className="rounded-lg border border-slate-200 p-3" open={!rule}><summary className="cursor-pointer text-sm font-medium">包装与平台费用 {rule ? "（已匹配配置）" : "（待确认）"}</summary><div className="mt-4 space-y-4">
        <p className="text-xs leading-6 text-slate-500">{rule ? `${market} / ${category} · 费率 ${rule.effectiveDate} · 手填值优先。` : "暂无匹配费率，请填写佣金和配送费。"}使用单件包装尺寸与毛重。</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(["length", "width", "height", "weightG"] as const).map((key, i) => <NumberField key={key} label={["单件长 cm", "单件宽 cm", "单件高 cm", "单件毛重 g"][i]} value={unit[key]} placeholder="自动匹配时填写" onChange={value => setUnit({ ...unit, [key]: value })} />)}</div>
        <div className="grid grid-cols-2 gap-3"><NumberField label="佣金率 %" value={manual.referral} onChange={value => setManual({ ...manual, referral: value })} placeholder={rule ? String(rule.referralPercent) : "按类目确认"} /><NumberField label={`配送费 / 件（${currency}）`} value={manual.fba} onChange={value => setManual({ ...manual, fba: value })} placeholder={fbaMatched === null ? "需确认配送费" : String(fbaMatched)} /></div>
      </div></details>
      <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">默认假设：广告 {ad || "—"}%、退货 {returns || "—"}%、税 0%</summary><div className="mt-2 grid grid-cols-2 gap-3"><NumberField label="广告预留 %" value={ad} onChange={setAd} /><NumberField label="退货预留 %" value={returns} onChange={setReturns} /></div></details>
      {needsConfirmation && <label className="flex min-h-11 items-start gap-3 text-xs leading-6 text-slate-600"><input type="checkbox" checked={confirmation === feeKey} onChange={event => setConfirmation(event.target.checked ? feeKey : "")} className="mt-1.5 h-4 w-4" />确认本次市场、类目、包装与费率</label>}
    </section>
    <section className="ops-calc-result"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="ops-section-title">当前选中方案</h2><p className="ops-subtext mt-2">{scenarios[selectedScenario].name} · {market} · {category || "未选类目"}</p></div><span className="ops-status">预计结果</span></div>
      {result ? <><div className="ops-result-focus" aria-live="polite"><div><p className={`ops-result-amount ${result.profit < 0 ? "text-rose-700" : ""}`}>{money(result.profit)}</p><p className="ops-subtext mt-2">预计单件利润</p></div><div><p className="ops-result-rate">{(result.margin * 100).toFixed(1)}%</p><p className="ops-subtext mt-2">预计利润率</p></div></div><div className="ops-result-body"><div className="ops-donut" style={{ background: `conic-gradient(${donutStops})` }} role="img" aria-label="成本与正利润构成，金额见右侧明细"><div className="ops-donut-hole"><span className="ops-subtext">售价</span><strong>{money(result.price)}</strong></div></div><div className="space-y-3">{[["采购成本", result.cost], ["佣金", result.referral], ["配送", result.fba], ["头程", result.freight], ["广告", result.ad], ["退货预留", result.returns]].map(([label, amount], index) => <div key={String(label)} className="flex items-center gap-2 text-xs text-slate-600"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: feeColors[index] }} /><span>{label}</span><strong className="ml-auto font-medium">{money(Number(amount))}</strong></div>)}</div></div><dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4"><div><dt className="text-xs text-slate-500">盈亏平衡售价</dt><dd className="mt-1 text-sm font-semibold">{result.breakeven === null ? "无法达到" : money(result.breakeven)}</dd></div><div><dt className="text-xs text-slate-500">盈亏平衡广告占比</dt><dd className="mt-1 text-sm font-semibold">{result.maxAdPercent.toFixed(1)}%</dd></div></dl></> : <div role="status" className="my-5 rounded-lg border border-dashed border-slate-300 p-6 text-sm leading-7 text-slate-500">{!feesConfirmed ? "请确认本次费率。" : complete ? "请检查金额与费率，售价须大于 0。" : "填写类目、售价、成本、箱规与费用后显示结果。"}</div>}
      <section aria-label="售价方案对比" className="mt-6 border-t border-slate-100 pt-5"><h3 className="ops-section-title">售价方案比较</h3><div className="ops-scenarios">{scenarios.map((item, index) => <button key={item.name} type="button" className="ops-scenario" aria-pressed={selectedScenario === index} onClick={() => setSelectedScenario(index)}><div><p className="text-xs font-semibold">{item.name} {selectedScenario === index ? "✓" : ""}</p><p className="ops-subtext mt-1">{item.label}</p></div><div><p className="mt-3 text-lg font-semibold">{money(item.price)}</p><p className={`mt-4 text-sm font-semibold ${item.result && item.result.profit < 0 ? "text-rose-700" : ""}`}>{money(item.result?.profit ?? null)}</p><p className="ops-subtext mt-1">利润率 {item.result ? (item.result.margin * 100).toFixed(1) + "%" : "—"}</p></div></button>)}</div></section>
      <details className="mt-5 text-xs leading-6 text-slate-500"><summary className="cursor-pointer">试算范围与费率</summary><p className="mt-2">{rule ? `配置费率 ${rule.effectiveDate}` : "手工确认费率"}。不含税、仓储、危险品、电池及额外附加费。最低佣金和分段佣金按已配置规则计算；各售价使用同一配送档位，低价优惠及价格相关附加费需单独填写。</p></details>
    </section>
  </div>;
}
const inputClass = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-blue-600";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0"><span className="mb-2 block text-xs text-slate-600">{label}</span>{children}</label>; }
function NumberField({ label, value, onChange, placeholder = "必填" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <Field label={label}><input aria-label={label} type="number" min="0" step="any" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></Field>; }
