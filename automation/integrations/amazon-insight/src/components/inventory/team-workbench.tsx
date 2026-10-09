"use client";
import { useCallback, useEffect, useState } from "react";

type Evidence = { version: string; period: string; currency: string; sales: number | null; profit: number | null; profitVerified: boolean };
type Task = { id: string; sku: string; market: string | null; title: string; note: string | null; status: string; updatedAt: string;
  context: { issue: string; baseline: Evidence; latest: Evidence } | null; history: { at: string; actor: string; action: string; status: string; note: string | null }[] };
type Snapshot = { workspace: { name: string }; tasks: Task[]; limited: boolean };
type Review = { sku: string; market: string; period: string; version: string; issues: string[] };
const statuses = [["OPEN", "新发现"], ["REVIEW", "待复核"], ["IN_PROGRESS", "处理中"], ["DONE", "已处理"], ["DISMISSED", "无需处理"]];
const inputClass = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
export function TeamWorkbench({ review }: { review?: Review }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState({ sku: review?.sku || "", title: "", note: "" });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const endpoint = review ? "/api/team?" + new URLSearchParams({ sku: review.sku, market: review.market }) : "/api/team";
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" }), data = await response.json();
    if (!response.ok) throw new Error(data.error || "记录读取失败。");
    setSnapshot(data); setNotes(Object.fromEntries(data.tasks.map((task: Task) => [task.id, task.note || ""])));
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void refresh().catch(e => { if (active) setError(e instanceof Error ? e.message : "读取失败。"); }); }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);
  async function save(method: string, body: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/team", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败。");
      await refresh();
      if (method === "POST" && !("issue" in body)) setTaskForm({ sku: review?.sku || "", title: "", note: "" });
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  function update(task: Task, status: string) {
    if (["DONE", "DISMISSED"].includes(status) && !window.confirm("确认保存本次复核结论？请先在备注中写明依据。")) return;
    void save("PATCH", { id: task.id, expectedUpdatedAt: task.updatedAt, status, note: notes[task.id] || "" });
  }
  return <div className="space-y-4">
    <section className="rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="text-base font-semibold">{review ? "SKU 复核与处理记录" : "共享任务与复核"}</h2>
      <p className="mt-2 text-xs leading-6 text-slate-500">共用账号记录，不区分个人身份。首次基线与人工结论保留，刷新证据不等于问题已解决。{review && "这里仅显示本站点记录；未标站点的历史任务在共享任务页查看。"}{snapshot?.limited && "当前显示最近 100 条记录，请按 SKU 筛选查看。"}</p>
      {review && <div className="mt-4 flex flex-wrap gap-2">{review.issues.map(issue => <button key={issue} disabled={busy} onClick={() => void save("POST", { kind: "review", ...review, issues: undefined, issue })} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs text-[#0071e3] disabled:opacity-50">{issue} · 建立 / 更新依据</button>)}{!review.issues.length && <p className="text-xs text-slate-500">当前未触发规则；仍可手工记录运营动作。</p>}</div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500">任务 SKU<input aria-label="任务 SKU" value={taskForm.sku} readOnly={!!review} onChange={e => setTaskForm({ ...taskForm, sku: e.target.value })} className={inputClass} /></label>
        <label className="text-xs text-slate-500">任务标题<input aria-label="任务标题" value={taskForm.title} maxLength={160} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} className={inputClass} /></label>
        <label className="text-xs text-slate-500">任务备注<input aria-label="任务备注" value={taskForm.note} maxLength={500} onChange={e => setTaskForm({ ...taskForm, note: e.target.value })} className={inputClass} /></label>
        <button disabled={busy || !taskForm.sku.trim() || !taskForm.title.trim()} onClick={() => void save("POST", { kind: "task", ...taskForm, market: review?.market })} className="min-h-11 rounded-lg bg-[#0071e3] px-4 text-sm text-white disabled:opacity-50">新增任务</button>
      </div>
      {!snapshot && !error && <p role="status" className="mt-5 text-xs text-slate-500">正在加载记录…</p>}
      <div className="mt-5 space-y-4">{snapshot?.tasks.map(task => <article key={task.id} className="rounded-xl border border-slate-200 p-4">
        <h3 className="break-words text-sm font-semibold">{task.sku} · {task.market || "历史记录 / 未标站点"} · {task.title}</h3>
        {task.context && <div className="mt-3 rounded-lg bg-[#f5f5f7] p-3 text-xs leading-6">
          <p>首次基线：{task.context.baseline.period} · {task.context.baseline.currency} · 销售额 {task.context.baseline.sales ?? "—"} · {task.context.baseline.profitVerified ? "已核验利润" : "来源利润待对账"} {task.context.baseline.profit ?? "—"}</p>
          <p>最新依据：{task.context.latest.period} · {task.context.latest.currency} · 销售额 {task.context.latest.sales ?? "—"} · {task.context.latest.profitVerified ? "已核验利润" : "来源利润待对账"} {task.context.latest.profit ?? "—"}</p>
          <p className="break-all text-slate-500">基线版本 {task.context.baseline.version}；最新版本 {task.context.latest.version}</p>
          <p className="text-slate-500">期间可能不同；金额变化仅供复核，不是动作效果或因果证明。</p>
          {review && <button disabled={busy} className="mt-2 min-h-11 rounded-lg border bg-white px-3 text-[#0071e3]" onClick={() => void save("POST", { kind: "review", sku: review.sku, market: review.market, period: review.period, version: review.version, issue: task.context!.issue })}>按当前期间更新证据（不改结论）</button>}
        </div>}
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_170px]">
          <label className="text-xs text-slate-500">复核备注<textarea aria-label={task.title + "复核备注"} maxLength={500} value={notes[task.id] || ""} onChange={e => setNotes({ ...notes, [task.id]: e.target.value })} className={inputClass + " py-2"} /></label>
          <label className="text-xs text-slate-500">处理状态<select aria-label={task.title + "处理状态"} disabled={busy} value={task.status} onChange={e => update(task, e.target.value)} className={inputClass}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button disabled={busy} onClick={() => update(task, task.status)} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-xs">保存备注</button></label>
        </div>
        <details className="mt-3 text-xs text-slate-500"><summary className="min-h-11 cursor-pointer">共用账号操作记录 · {task.history.length} 条</summary><ol className="space-y-2">{task.history.map((event, i) => <li key={i} className="break-words">{event.at} · 共用账号 · {event.action} · {statuses.find(([value]) => value === event.status)?.[1] || event.status}{event.note && " · " + event.note}</li>)}</ol></details>
      </article>)}</div>
      {snapshot && !snapshot.tasks.length && <p className="mt-5 text-sm text-slate-500">暂无记录。</p>}
    </section>
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700"><p>{error}</p><button className="mt-2 min-h-11 rounded-lg border px-3" onClick={() => void refresh().then(() => setError("")).catch(e => setError(e instanceof Error ? e.message : "读取失败。"))}>重新加载记录</button></div>}
  </div>;
}
