"use client";

import { useState } from "react";
import { defaultOperatingRules, resolveOperatingRules, type OperatingRuleOverride, type OperatingRules } from "@/lib/inventory/operating-rules";

const fields: Array<[keyof OperatingRules, string]> = [
  ["profitMarginMinPercent", "利润率下限 %"], ["adSpendMaxPercent", "广告投入占比上限 %"],
  ["returnRateMaxPercent", "退货率上限 %"], ["revenueDeclinePercent", "销售下降幅度 %"],
  ["minSalesUnits", "销售最低样本件数"], ["minReturnSalesUnits", "退货最低销售件数"],
  ["minReturnUnits", "退货最低件数"], ["fbaCoverDays", "FBA 覆盖下限天数"],
  ["supplyCoverDays", "供应目标天数"], ["inventoryStaleDays", "库存有效天数"],
];
export function OperatingRulesEditor({ initialRules }: { initialRules: OperatingRuleOverride[] }) {
  const [rules, setRules] = useState(initialRules), [market, setMarket] = useState("US"), [sku, setSku] = useState("");
  const [values, setValues] = useState<Partial<OperatingRules>>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const effective = resolveOperatingRules(market, sku.trim().toUpperCase(), rules);
  async function save(reset = false) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_operating_rules", market, sku: sku.trim().toUpperCase(), values: reset ? {} : { ...(rules.find(item => item.market === market && item.sku === sku.trim().toUpperCase())?.values ?? {}), ...values } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败。");
      setRules(result.rules); setValues({}); setMessage(reset ? "已恢复继承值。" : "已保存，重新打开经营页面后生效。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  return <details className="mb-6 rounded-2xl border border-black/5 bg-white p-5">
    <summary className="cursor-pointer text-sm font-semibold">经营提醒规则</summary>
    <p className="mt-3 text-sm leading-6 text-slate-500">单 SKU 优先于站点默认。留空 SKU 设置站点；空白字段继承原值。提醒只用于核查，不自动执行业务操作，与利润试算参数分开。</p>
    <div className="mt-4 flex flex-wrap gap-3"><label className="text-sm">站点<select aria-label="提醒站点" value={market} onChange={event => { setMarket(event.target.value); setValues({}); setMessage(""); }} className="ml-2 min-h-11 rounded-lg border px-3">{["US", "CA", "MX", "AU"].map(site => <option key={site}>{site}</option>)}</select></label><label className="text-sm">SKU<input aria-label="提醒SKU" value={sku} onChange={event => { setSku(event.target.value); setValues({}); setMessage(""); }} placeholder="空白为站点默认" className="ml-2 min-h-11 rounded-lg border px-3" /></label></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label]) => <label key={key} className="text-sm text-slate-600">{label}<input type="number" step={key.endsWith("Percent") ? "0.1" : "1"} aria-label={label} value={values[key] ?? ""} placeholder={String(effective[key] ?? defaultOperatingRules[key])} onChange={event => setValues(current => ({ ...current, [key]: event.target.value === "" ? undefined : Number(event.target.value) }))} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>)}</div>
    <div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} onClick={() => void save()} className="min-h-11 rounded-full bg-[#0071e3] px-5 text-sm text-white disabled:opacity-50">保存规则</button><button disabled={busy} onClick={() => void save(true)} className="min-h-11 rounded-full border px-5 text-sm">恢复继承值</button></div>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </details>;
}
