"use client";

import { useEffect, useState } from "react";

type Member = { id: string; name: string; email: string; role: string };
type Task = { id: string; sku: string; title: string; note: string | null; status: string; assignee: { id: string; name: string } | null; createdBy: string; updatedAt: string };
type Snapshot = { workspace: { name: string }; members: Member[]; tasks: Task[] };

export function TeamWorkbench() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState({ sku: "", title: "", note: "", assigneeId: "" });

  async function refresh() { const response = await fetch("/api/team", { cache: "no-store" }); const data = await response.json(); if (!response.ok) { setError(data.error ?? "协作数据读取失败。"); return; } setSnapshot(data); }
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, []);
  async function submit() {
    setBusy(true); setError("");
    const body = { kind: "task", ...taskForm, assigneeId: taskForm.assigneeId || null };
    const response = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "保存失败。"); else { setTaskForm({ sku: "", title: "", note: "", assigneeId: "" }); await refresh(); }
    setBusy(false);
  }
  async function updateTask(id: string, status: string, assigneeId?: string | null) { await fetch("/api/team", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status, assigneeId }) }); await refresh(); }

  if (!snapshot) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{error || "正在加载协作空间…"}</div>;
  return <div className="space-y-4"><div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">共享任务</h2><p className="mt-1 text-xs text-slate-500">{snapshot.workspace.name} · {snapshot.tasks.length} 项任务</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-600">保存后同步</span></div><div className="mt-5 grid gap-2 sm:grid-cols-4"><input value={taskForm.sku} onChange={(e) => setTaskForm({ ...taskForm, sku: e.target.value })} placeholder="SKU" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="任务标题" className="rounded-lg border border-slate-200 px-3 py-2 text-xs sm:col-span-2" /><select value={taskForm.assigneeId} onChange={(e) => setTaskForm({ ...taskForm, assigneeId: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">未分配</option>{snapshot.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><input value={taskForm.note} onChange={(e) => setTaskForm({ ...taskForm, note: e.target.value })} placeholder="备注（可选）" className="rounded-lg border border-slate-200 px-3 py-2 text-xs sm:col-span-3" /><button type="button" disabled={busy || !taskForm.sku || !taskForm.title} onClick={() => void submit()} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">新增任务</button></div><div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">{snapshot.tasks.length ? snapshot.tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-blue-700">{task.sku}</span><span className="text-sm font-medium text-slate-900">{task.title}</span></div><p className="mt-1 text-[11px] text-slate-500">{task.note || "无备注"} · {task.assignee?.name || "未分配"} · {task.createdBy} 创建</p></div><div className="flex items-center gap-2"><select value={task.status} onChange={(e) => void updateTask(task.id, e.target.value, task.assignee?.id)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"><option value="OPEN">待处理</option><option value="IN_PROGRESS">进行中</option><option value="DONE">已完成</option></select><select value={task.assignee?.id || ""} onChange={(e) => void updateTask(task.id, task.status, e.target.value || null)} className="max-w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"><option value="">未分配</option>{snapshot.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div></div>) : <p className="py-8 text-center text-xs text-slate-500">还没有共享任务，可从上方添加一条。</p>}</div></section><section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-semibold">共用工作区</h2><p className="mt-3 text-xs leading-6 text-slate-500">所有人使用同一个登录账号，不再创建成员或区分角色。原有协作任务和历史分配保留。</p></section></div>{error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</p> : null}</div>;
}
