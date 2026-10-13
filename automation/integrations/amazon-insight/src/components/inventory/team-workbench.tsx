"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Evidence = { version: string; period: string; currency: string; sales: number | null; profit: number | null; profitVerified: boolean; adShare?: number | null; returnRate?: number | null; fbaDays?: number | null; supplyDays?: number | null };
type Task = { id: string; sku: string; market: string | null; title: string; note: string | null; status: string; updatedAt: string;
  context: { issue: string; baseline: Evidence; latest: Evidence } | null; history: { at: string; actor: string; action: string; status: string; note: string | null; previousStatus?: string; evidence?: Evidence; triggered?: boolean }[] };
type Snapshot = { workspace: { name: string }; tasks: Task[]; limited: boolean; nextCursor?: string | null };
type Review = { sku: string; market: string; period: string; version: string; issues: string[] };
const statuses = [["OPEN", "新发现"], ["REVIEW", "待复核"], ["IN_PROGRESS", "处理中"], ["DONE", "已处理"], ["DISMISSED", "无需处理"]];
const inputClass = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
export function TeamWorkbench({ review }: { review?: Review }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState({ sku: review?.sku || "", title: "", note: "" });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const drafts = useRef<Record<string, { note: string; baseNote: string }>>({});
  const [notice, setNotice] = useState("");
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({});
  const [filterForm, setFilterForm] = useState({ sku: "", market: "" }), [filters, setFilters] = useState({ sku: "", market: "" });
  const [queryRun, setQueryRun] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const snapshotRef = useRef<Snapshot | null>(null), requestSequence = useRef(0);
  const params = new URLSearchParams(review ? { sku: review.sku, market: review.market } : Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  const endpoint = "/api/team" + (params.size ? "?" + params : "");
  const refresh = useCallback(async (cursor?: string) => {
    const sequence = ++requestSequence.current;
    const url = endpoint + (cursor ? (endpoint.includes("?") ? "&" : "?") + "cursor=" + encodeURIComponent(cursor) : "");
    const response = await fetch(url, { cache: "no-store" }), data = await response.json();
    if (sequence !== requestSequence.current) return;
    if (!response.ok) throw new Error(data.error || "记录读取失败。");
    const tasks: Task[] = cursor ? [...new Map([...(snapshotRef.current?.tasks ?? []), ...data.tasks].map((task: Task) => [task.id, task])).values()] : data.tasks;
    snapshotRef.current = { ...data, tasks };
    setSnapshot(snapshotRef.current);
    const changed: Record<string, boolean> = {};
    setNotes(Object.fromEntries(tasks.map((task: Task) => {
      const draft = drafts.current[task.id], note = task.note ?? "";
      if (draft && draft.note !== note) {
        if (draft.baseNote !== note) changed[task.id] = true;
        return [task.id, draft.note];
      }
      delete drafts.current[task.id];
      return [task.id, note];
    })));
    if (Object.keys(changed).length) setConflicts(current => ({ ...current, ...changed }));
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void refresh().catch(e => { if (active) setError(e instanceof Error ? e.message : "读取失败。"); }); }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [refresh, queryRun]);
  async function loadMore() {
    if (!snapshot?.nextCursor || loadingMore) return;
    setLoadingMore(true); setError("");
    try { await refresh(snapshot.nextCursor); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败。"); }
    finally { setLoadingMore(false); }
  }
  async function save(method: string, body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      const response = await fetch("/api/team", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && typeof body.id === "string") {
          setConflicts(current => ({ ...current, [String(body.id)]: true }));
          await refresh();
          throw new Error("保存冲突：服务端记录已更新，未保存草稿已保留。请核对最新记录后再次保存。");
        }
        throw new Error(data.error || "保存失败。");
      }
      saved = true;
      if (method === "PATCH" && typeof body.id === "string") {
        // Edits made while this request was in flight are still unsaved drafts.
        const draft = drafts.current[body.id];
        if (draft?.note === body.note) delete drafts.current[body.id];
        else if (draft && typeof body.note === "string") draft.baseNote = body.note.trim();
        setConflicts(current => ({ ...current, [String(body.id)]: false }));
      }
      await refresh();
      if (method === "POST" && !("issue" in body)) setTaskForm({ sku: review?.sku || "", title: "", note: "" });
      setNotice(method === "POST" && "issue" in body ? "依据已更新，未保存备注草稿已保留。" : "记录已保存，其他未保存备注草稿已保留。");
    } catch (e) { setError(saved ? "保存已成功，但记录重新加载失败；未保存草稿已保留，请重新加载。" : e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  function update(task: Task, status: string) {
    if (conflicts[task.id] && !window.confirm(`服务端当前备注：${task.note || "（空）"}\n确认已核对最新记录，并保存你保留的备注草稿？`)) return;
    if (["DONE", "DISMISSED"].includes(status) && !window.confirm("确认保存本次复核结论？请先在备注中写明依据。")) return;
    void save("PATCH", { id: task.id, expectedUpdatedAt: task.updatedAt, status, note: notes[task.id] || "" });
  }
  return <div className="space-y-4">
    <section className="rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="text-base font-semibold">{review ? "SKU 复核与处理记录" : "共享任务与复核"}</h2>
      <p className="mt-2 text-xs leading-6 text-slate-500">共用账号记录，不区分个人身份。首次基线与人工结论保留，新版本再次触发时重新待复核；未触发不自动关闭。按创建时间由新到旧排列，每次最多加载 100 条。{review && "这里仅显示本站点记录；未标站点的历史任务在共享任务页查看。"}</p>
      {!review && <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={event => { event.preventDefault(); if (busy) return; requestSequence.current++; setError(""); snapshotRef.current = null; setSnapshot(null); setFilters({ sku: filterForm.sku.trim().toUpperCase(), market: filterForm.market }); setQueryRun(value => value + 1); }}>
        <label className="text-xs text-slate-500">记录 SKU 筛选<input aria-label="记录 SKU 筛选" value={filterForm.sku} maxLength={64} onChange={event => setFilterForm({ ...filterForm, sku: event.target.value })} className={inputClass} /></label>
        <label className="text-xs text-slate-500">记录站点筛选<select aria-label="记录站点筛选" value={filterForm.market} onChange={event => setFilterForm({ ...filterForm, market: event.target.value })} className={inputClass}><option value="">全部站点及历史</option><option value="US">US</option><option value="CA">CA</option><option value="legacy">历史 / 未标站点</option></select></label>
        <button type="submit" disabled={busy} className="min-h-11 self-end rounded-lg border px-4 text-xs disabled:opacity-50">查询记录</button>
      </form>}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
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
        {conflicts[task.id] && <p role="status" className="mt-2 text-xs leading-6 text-amber-800">记录发生冲突，草稿未覆盖。服务端最新备注：{task.note || "（空）"}。再次保存前请核对。</p>}
        {task.context && <div className="mt-3 rounded-lg bg-[#f5f5f7] p-3 text-xs leading-6">
          <p>首次基线：{task.context.baseline.period} · {task.context.baseline.currency} · 销售额 {task.context.baseline.sales ?? "—"} · {task.context.baseline.profitVerified ? "已核验利润" : "来源利润待对账"} {task.context.baseline.profit ?? "—"}</p>
          <p>最新依据：{task.context.latest.period} · {task.context.latest.currency} · 销售额 {task.context.latest.sales ?? "—"} · {task.context.latest.profitVerified ? "已核验利润" : "来源利润待对账"} {task.context.latest.profit ?? "—"}</p>
          <p className="break-all text-slate-500">基线版本 {task.context.baseline.version}；最新版本 {task.context.latest.version}</p>
          <p className="text-slate-500">期间可能不同；金额变化仅供复核，不是动作效果或因果证明。</p>
          {review && <button disabled={busy} className="mt-2 min-h-11 rounded-lg border bg-white px-3 text-[#0071e3]" onClick={() => void save("POST", { kind: "review", sku: review.sku, market: review.market, period: review.period, version: review.version, issue: task.context!.issue })}>按当前期间更新证据（不改结论）</button>}
        </div>}
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_170px]">
          <label className="text-xs text-slate-500">复核备注{(notes[task.id] ?? "") !== (task.note ?? "") && <span className="ml-2 text-amber-700">未保存草稿</span>}<textarea aria-label={task.title + "复核备注"} maxLength={500} value={notes[task.id] || ""} onChange={e => { const value = e.target.value; if (value === (task.note ?? "")) { delete drafts.current[task.id]; setConflicts(current => ({ ...current, [task.id]: false })); } else drafts.current[task.id] = { note: value, baseNote: drafts.current[task.id]?.baseNote ?? task.note ?? "" }; setNotes(current => ({ ...current, [task.id]: value })); setNotice(""); }} className={inputClass + " py-2"} /></label>
          <label className="text-xs text-slate-500">处理状态<select aria-label={task.title + "处理状态"} disabled={busy} value={task.status} onChange={e => update(task, e.target.value)} className={inputClass}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button disabled={busy} onClick={() => update(task, task.status)} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-xs">保存备注</button></label>
        </div>
        <details className="mt-3 text-xs text-slate-500"><summary className="min-h-11 cursor-pointer">操作与证据历史 · {task.history.length} 条</summary><ol className="space-y-2">{task.history.map((event, i) => <li key={i} className="break-words rounded-lg border border-slate-100 p-2">{event.at} · {event.actor === "system" ? "系统自动复核" : "共用账号"} · {event.action} · {event.previousStatus && `${statuses.find(([value]) => value === event.previousStatus)?.[1] || event.previousStatus} → `}{statuses.find(([value]) => value === event.status)?.[1] || event.status}{event.note && " · " + event.note}
          {event.evidence && <div className="mt-1 leading-6"><p>版本 {event.evidence.version} · {event.evidence.period} · {event.triggered ? "仍触发提醒" : "当前未触发；不自动关闭"}</p><p>{event.evidence.currency} · 销售额 {event.evidence.sales ?? "—"} · {event.evidence.profitVerified ? "已核验利润" : "利润待对账"} {event.evidence.profit ?? "—"}</p><p>广告花费比 {event.evidence.adShare == null ? "—" : `${(event.evidence.adShare * 100).toFixed(1)}%`} · 退货率 {event.evidence.returnRate == null ? "—" : `${(event.evidence.returnRate * 100).toFixed(1)}%`} · FBA 覆盖 {event.evidence.fbaDays ?? "—"} 天 · 网络覆盖 {event.evidence.supplyDays ?? "—"} 天</p></div>}
        </li>)}</ol></details>
      </article>)}</div>
      {snapshot && !snapshot.tasks.length && <p className="mt-5 text-sm text-slate-500">暂无记录。</p>}
      {snapshot?.nextCursor && <button disabled={loadingMore || busy} onClick={() => void loadMore()} className="mt-4 min-h-11 w-full rounded-lg border px-4 text-sm disabled:opacity-50">{loadingMore ? "正在加载…" : "加载更早记录"}</button>}
    </section>
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700"><p>{error}</p><button className="mt-2 min-h-11 rounded-lg border px-3" onClick={() => void refresh().then(() => setError("")).catch(e => setError(e instanceof Error ? e.message : "读取失败。"))}>重新加载记录</button></div>}
  </div>;
}
