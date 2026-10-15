"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";

type Topic = { topic: string; mentions: number | null; ratingImpact: number | null; occurrencePercentage: number | null; examples: string[] };
type TopicTrend = { topic: string; sentiment: "positive" | "negative"; points: Array<{ period: string; occurrencePercentage: number }> };
type Snapshot = {
  asin: string; market: string; source: string; fetchedAt: string; rangeStart: string | null; rangeEnd: string | null;
  positiveTopics: Topic[]; negativeTopics: Topic[]; topicTrends: TopicTrend[];
};
type Result = { configured: boolean; status: "unconfigured" | "empty" | "ready"; snapshot: Snapshot | null; error?: string };

const asinPattern = /^[A-Z0-9]{10}$/;

export function ReviewInsightsBoard({ initialAsin = "" }: { initialAsin?: string }) {
  const [asin, setAsin] = useState(initialAsin);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"read" | "sync" | null>(null);
  const [error, setError] = useState("");

  async function load(value: string, mode: "read" | "sync", signal?: AbortSignal) {
    if (!asinPattern.test(value)) { setError("请输入 10 位 ASIN。"); return; }
    setBusy(mode); setError("");
    try {
      const response = await fetch(mode === "read" ? `/api/inventory/review-insights?asin=${encodeURIComponent(value)}&market=US` : "/api/inventory/review-insights", {
        method: mode === "read" ? "GET" : "POST", cache: "no-store", signal,
        ...(mode === "sync" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asin: value, market: "US" }) } : {}),
      });
      const payload = await response.json() as Result;
      if (signal?.aborted) return;
      if (!response.ok) {
        if (payload.status === "unconfigured") setResult(payload);
        throw new Error(payload.error || "评论洞察暂不可用。");
      }
      setResult(payload);
      const url = new URL(window.location.href);
      url.searchParams.set("asin", value);
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "评论洞察暂不可用。");
    } finally { if (!signal?.aborted) setBusy(null); }
  }

  useEffect(() => {
    if (!initialAsin) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(initialAsin, "read", controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [initialAsin]);

  const normalized = asin.trim().toUpperCase();
  const snapshot = result?.snapshot;
  return <div className="space-y-5">
    <section className="ops-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="ops-section-title">Amazon US · 买家反馈</h2><p className="ops-subtext mt-1">以官方 Customer Feedback 洞察为来源。仅同步已授权的子 ASIN，不采集零售页面全文评论。</p></div>
        <span className="ops-badge ops-badge-slate">目前仅 US</span>
      </div>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={event => { event.preventDefault(); void load(normalized, "read"); }}>
        <label className="relative min-w-0 flex-1"><span className="sr-only">产品 ASIN</span><Search size={17} aria-hidden="true" className="absolute left-3 top-3.5 text-slate-400" /><input value={asin} disabled={!!busy} onChange={event => { setAsin(event.target.value.toUpperCase()); setResult(null); setError(""); }} maxLength={10} autoComplete="off" placeholder="输入 10 位子 ASIN" className="min-h-11 w-full rounded-xl border px-10 text-sm" /></label>
        <button type="submit" disabled={!!busy || !asinPattern.test(normalized)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-[#0071e3]">{busy === "read" ? "正在读取…" : "读取已存洞察"}</button>
        <button type="button" disabled={!!busy || !asinPattern.test(normalized) || result?.configured === false} onClick={() => void load(normalized, "sync")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-4 text-sm font-medium text-white disabled:opacity-50"><RefreshCw size={15} aria-hidden="true" />{busy === "sync" ? "正在同步…" : "同步官方洞察"}</button>
      </form>
      {busy && <p role="status" className="ops-subtext mt-3">{busy === "sync" ? "正在请求授权接口并保存快照…" : "正在读取最近保存的快照…"}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {result?.status === "unconfigured" && <p className="ops-subtext mt-4 rounded-xl bg-slate-50 p-4">尚未配置亚马逊 Selling Partner API 授权。需在部署环境中提供 LWA 应用凭证、卖家授权，以及 Brand Analytics 或 Selling Partner Insights 权限；配置完成后再同步。不要在网页或聊天中粘贴密钥。</p>}
      {result?.status === "empty" && <p className="ops-subtext mt-4 rounded-xl bg-slate-50 p-4">这个 ASIN 尚无已保存的评论洞察。授权后点“同步官方洞察”；目前不会把空值解释为没有差评。</p>}
    </section>
    {snapshot && <>
      <section className="ops-surface p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 className="ops-section-title">{snapshot.asin} · 已存反馈快照</h2><p className="ops-subtext mt-1">采集 {snapshot.fetchedAt || "—"} · 覆盖 {snapshot.rangeStart || "—"} 至 {snapshot.rangeEnd || "—"}</p></div><span className="ops-badge ops-badge-emerald">官方洞察</span></div><p className="ops-subtext mt-3">主题和趋势用于形成调研线索，不代表全部原始评论，也不能直接推断价格或广告调整效果。</p></section>
      <div className="grid gap-4 lg:grid-cols-2">
        <TopicPanel title="好评主题" topics={snapshot.positiveTopics} tone="positive" />
        <TopicPanel title="差评主题" topics={snapshot.negativeTopics} tone="negative" />
      </div>
      <section className="ops-surface p-5"><h2 className="ops-section-title">评论主题趋势</h2><p className="ops-subtext mt-1">每条趋势表示该主题的月度提及占比；不同主题可能来自同一评论，不能相加成好评率或差评率。</p>{snapshot.topicTrends?.some(item => item.points.length) ? <TopicTrends trends={snapshot.topicTrends} /> : <p className="ops-subtext py-8 text-center">当前快照未提供可比较的主题趋势。</p>}</section>
      <a href="https://developer-docs.amazon.com/sp-api/docs/customer-feedback-api" target="_blank" rel="noopener noreferrer" className="ops-text-link">查看 Amazon 数据说明 <ArrowUpRight size={14} /></a>
    </>}
  </div>;
}

function TopicPanel({ title, topics, tone }: { title: string; topics: Topic[]; tone: "positive" | "negative" }) {
  return <section className="ops-surface p-5"><h2 className="ops-section-title">{title}</h2>{topics.length ? <ul className="mt-4 divide-y divide-slate-100">{topics.map((item, index) => <li key={`${item.topic}-${index}`} className="py-3 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm font-semibold">{item.topic}</strong><span className={`ops-badge ${tone === "negative" ? "ops-badge-amber" : "ops-badge-emerald"}`}>{item.mentions === null ? "提及数未知" : `${item.mentions} 次提及`}</span></div>{typeof item.occurrencePercentage === "number" && <p className="ops-subtext mt-1">主题提及占比 {item.occurrencePercentage.toFixed(1)}%</p>}{typeof item.ratingImpact === "number" && <p className="ops-subtext mt-1">星级影响指标 {item.ratingImpact.toFixed(2)}</p>}{item.examples?.length > 0 && <p className="ops-subtext mt-2">短摘录：{item.examples[0]}</p>}</li>)}</ul> : <p className="ops-subtext py-8 text-center">这份快照没有可展示的{title}。</p>}</section>;
}

function TopicTrends({ trends }: { trends: TopicTrend[] }) {
  return <div className="mt-5 grid gap-3 sm:grid-cols-2">{trends.filter(item => item.points.length).slice(0, 6).map(item => <article key={`${item.sentiment}:${item.topic}`} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{item.topic}</h3><span className={`ops-badge ${item.sentiment === "negative" ? "ops-badge-amber" : "ops-badge-emerald"}`}>{item.sentiment === "negative" ? "差评主题" : "好评主题"}</span></div>
    <div className="mt-4 space-y-2">{item.points.map(point => <div key={point.period} className="grid grid-cols-[48px_minmax(0,1fr)_52px] items-center gap-2 text-xs"><span className="text-slate-500">{point.period.slice(5)}月</span><div className="h-2 rounded-full bg-white"><div className={`h-2 rounded-full ${item.sentiment === "negative" ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${Math.min(100, Math.max(0, point.occurrencePercentage))}%` }} /></div><span className="text-right tabular-nums">{point.occurrencePercentage.toFixed(1)}%</span></div>)}</div>
  </article>)}</div>;
}
