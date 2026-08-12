"use client";

import { Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

export function LoginForm({ bootstrapRequired }: { bootstrapRequired: boolean }) {
  const mode = bootstrapRequired ? "bootstrap" : "login";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      const response = await fetch(mode === "bootstrap" ? "/api/auth/bootstrap" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "请求失败，请稍后重试。");
        return;
      }
      window.location.assign("/inventory");
    } catch {
      setError("无法连接到服务，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070d1a] px-4 py-10 text-slate-950"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,.22),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(15,118,110,.12),transparent_28%)]" /><div className="relative w-full max-w-md rounded-3xl border border-white/80 bg-white p-7 shadow-2xl shadow-black/30 sm:p-9"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-xs font-black tracking-[0.08em] text-white shadow-lg shadow-blue-200">MM</span><div><p className="text-sm font-semibold">Measureman Commerce</p><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Operations OS</p></div></div><div className="mt-8"><h1 className="text-2xl font-semibold tracking-tight">{mode === "bootstrap" ? "初始化运营空间" : "登录运营看板"}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{mode === "bootstrap" ? "创建第一个管理员账户，之后即可邀请同事协作。" : "使用你的工作账户继续处理库存、采购与增长任务。"}</p></div><form onSubmit={submit} className="mt-7 space-y-4" aria-busy={busy}>{mode === "bootstrap" ? <label className="block text-sm font-medium">姓名<input name="name" required maxLength={80} autoComplete="name" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-500" placeholder="例如：王小明" /></label> : null}<label className="block text-sm font-medium">邮箱<input name="email" required type="email" autoComplete="email" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-500" placeholder="name@company.com" /></label><label className="block text-sm font-medium">密码<span className="relative mt-1.5 block"><input name="password" required minLength={8} type={showPassword ? "text" : "password"} autoComplete={mode === "bootstrap" ? "new-password" : "current-password"} className="w-full rounded-xl border border-slate-200 py-3 pl-3.5 pr-11 outline-none focus:border-blue-500" placeholder="至少 8 位" /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition hover:text-slate-700">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>{error ? <p role="alert" aria-live="polite" className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">{error}</p> : null}<button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{busy ? <><LoaderCircle className="h-4 w-4 animate-spin" />处理中…</> : mode === "bootstrap" ? "创建管理员并进入" : "登录"}</button></form><div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><p>{mode === "bootstrap" ? "管理员只需初始化一次；完成后系统将关闭初始化入口。" : "账户会话仅保存在当前部署环境中，不会发送到第三方服务。"}</p></div></div></main>;
}
