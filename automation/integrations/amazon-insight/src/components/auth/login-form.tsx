"use client";

import { FormEvent, useState } from "react";

export function LoginForm({ bootstrapRequired }: { bootstrapRequired: boolean }) {
  const [mode, setMode] = useState<"login" | "bootstrap">(bootstrapRequired ? "bootstrap" : "login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch(mode === "bootstrap" ? "/api/auth/bootstrap" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error ?? "请求失败，请稍后重试。");
      setBusy(false);
      return;
    }
    window.location.assign("/inventory");
  }

  return <main className="grid min-h-screen place-items-center bg-slate-950 px-4 py-10 text-slate-950"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-2xl shadow-black/25 sm:p-9"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-xs font-black tracking-[0.08em] text-white">MM</span><div><p className="text-sm font-semibold">Measureman Commerce</p><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Operations OS</p></div></div><div className="mt-8"><h1 className="text-2xl font-semibold tracking-tight">{mode === "bootstrap" ? "初始化运营空间" : "登录运营看板"}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{mode === "bootstrap" ? "创建第一个管理员账户，之后即可邀请同事协作。" : "使用你的工作账户继续。"}</p></div><form onSubmit={submit} className="mt-7 space-y-4">{mode === "bootstrap" ? <label className="block text-sm font-medium">姓名<input name="name" required maxLength={80} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-500" placeholder="例如：王小明" /></label> : null}<label className="block text-sm font-medium">邮箱<input name="email" required type="email" autoComplete="email" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-500" placeholder="name@company.com" /></label><label className="block text-sm font-medium">密码<input name="password" required minLength={8} type="password" autoComplete={mode === "bootstrap" ? "new-password" : "current-password"} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-500" placeholder="至少 8 位" /></label>{error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">{error}</p> : null}<button type="submit" disabled={busy} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{busy ? "处理中…" : mode === "bootstrap" ? "创建管理员并进入" : "登录"}</button></form>{!bootstrapRequired ? <button type="button" onClick={() => { setMode(mode === "login" ? "bootstrap" : "login"); setError(""); }} className="mt-5 w-full text-center text-xs text-slate-500 hover:text-blue-700">{mode === "login" ? "需要重新初始化管理员？" : "返回登录"}</button> : null}</div></main>;
}
