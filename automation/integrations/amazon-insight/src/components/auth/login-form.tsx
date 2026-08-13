"use client";

import { Eye, EyeOff, LoaderCircle, ShieldCheck, UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";

export function LoginForm({ bootstrapRequired }: { bootstrapRequired: boolean }) {
  const [mode, setMode] = useState<"bootstrap" | "login" | "member">(bootstrapRequired ? "bootstrap" : "login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const endpoint = mode === "bootstrap" ? "/api/auth/bootstrap" : mode === "member" ? "/api/auth/create-member" : "/api/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "请求失败，请稍后重试。");
        return;
      }
      if (mode === "member") {
        setSuccess("成员账号已创建，现在可以使用新账号登录。");
        setMode("login");
        form.reset();
        return;
      }
      window.location.assign("/inventory");
    } catch {
      setError("无法连接到服务，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-base outline-none focus:border-blue-500";
  return <main className="safe-top safe-bottom relative grid min-h-screen place-items-center overflow-hidden bg-[#070d1a] px-3 py-6 text-slate-950 sm:px-4 sm:py-10"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,.22),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(15,118,110,.12),transparent_28%)]" /><div className="relative w-full max-w-md rounded-2xl border border-white/80 bg-white p-5 shadow-2xl shadow-black/30 sm:rounded-3xl sm:p-9"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-[11px] font-black tracking-[0.08em] text-white shadow-lg shadow-blue-200 sm:h-11 sm:w-11 sm:text-xs">MM</span><div className="min-w-0"><p className="truncate text-sm font-semibold">Measureman Commerce</p><p className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Operations OS</p></div></div>{!bootstrapRequired ? <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-xs font-semibold"><button type="button" onClick={() => { setMode("login"); setError(""); }} className={`rounded-lg px-3 py-2.5 ${mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>账号登录</button><button type="button" onClick={() => { setMode("member"); setError(""); setSuccess(""); }} className={`rounded-lg px-3 py-2.5 ${mode === "member" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><UserPlus className="mr-1 inline h-3.5 w-3.5" />创建成员</button></div> : null}<div className="mt-6"><h1 className="text-[1.4rem] font-semibold tracking-tight sm:text-2xl">{mode === "bootstrap" ? "初始化运营空间" : mode === "member" ? "创建成员账号" : "登录运营仓"}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{mode === "bootstrap" ? "创建第一个管理员账户，之后即可邀请同事协作。" : mode === "member" ? "验证管理员身份后，为同事创建普通成员账号。" : "登录后直接进入库存、采购与增长运营仓。"}</p></div><form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy}>{mode === "member" ? <><label className="block text-sm font-medium">管理员邮箱<input name="adminEmail" required type="email" autoComplete="username" className={inputClass} /></label><label className="block text-sm font-medium">管理员密码<input name="adminPassword" required minLength={8} type="password" autoComplete="current-password" className={inputClass} /></label><div className="border-t border-slate-100 pt-4"><p className="text-xs font-semibold text-slate-500">新成员信息</p></div></> : null}{mode !== "login" ? <label className="block text-sm font-medium">姓名<input name="name" required maxLength={80} autoComplete="name" className={inputClass} placeholder="例如：王小明" /></label> : null}<label className="block text-sm font-medium">{mode === "member" ? "成员邮箱" : "邮箱"}<input name="email" required type="email" autoComplete={mode === "member" ? "off" : "email"} className={inputClass} placeholder="name@company.com" /></label><label className="block text-sm font-medium">{mode === "member" ? "成员初始密码" : "密码"}<span className="relative mt-1.5 block"><input name="password" required minLength={8} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} className="min-h-12 w-full rounded-xl border border-slate-200 py-3 pl-3.5 pr-11 text-base outline-none focus:border-blue-500" placeholder="至少 8 位" /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition hover:text-slate-700">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>{error ? <p role="alert" aria-live="polite" className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">{error}</p> : null}{success ? <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs leading-5 text-emerald-700">{success}</p> : null}<button type="submit" disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{busy ? <><LoaderCircle className="h-4 w-4 animate-spin" />处理中…</> : mode === "bootstrap" ? "创建管理员并进入" : mode === "member" ? "创建成员账号" : "进入运营仓"}</button></form><div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><p>{mode === "member" ? "只有通过验证的管理员可以创建成员；新成员不能继续创建账号。" : mode === "bootstrap" ? "管理员只需初始化一次；完成后系统将关闭初始化入口。" : "账户会话仅保存在当前部署环境中，不会发送到第三方服务。"}</p></div></div></main>;
}
