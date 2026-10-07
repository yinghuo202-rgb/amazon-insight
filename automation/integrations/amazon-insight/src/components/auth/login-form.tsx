"use client";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
export function LoginForm({ bootstrapRequired }: { bootstrapRequired: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(bootstrapRequired ? "/api/auth/bootstrap" : "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "登录失败，请重试。"); return; }
      window.location.assign("/inventory");
    } catch { setError("无法连接服务，请检查网络。"); } finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-[#f5f5f7] p-5"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-9">
    <p className="text-lg font-semibold text-[#1d1d1f]">Measureman</p><h1 className="mt-8 text-2xl font-semibold">{bootstrapRequired ? "建立共用账号" : "登录经营工作台"}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{bootstrapRequired ? "仅需初始化一次，之后所有人使用同一个账号。" : "使用团队共用账号，进入同一个工作区。"}</p>
    <form onSubmit={submit} className="mt-7 space-y-5" aria-busy={busy}>
      {bootstrapRequired && <label className="block text-sm">账号名称<input name="name" required maxLength={80} autoComplete="name" className={inputClass} /></label>}
      <label className="block text-sm">共用账号邮箱<input name="email" required type="email" autoComplete="username" className={inputClass} /></label>
      <label className="block text-sm">密码<span className="relative block"><input name="password" required minLength={8} maxLength={200} type={showPassword ? "text" : "password"} autoComplete={bootstrapRequired ? "new-password" : "current-password"} className={inputClass + " pr-12"} /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)} className="absolute bottom-0 right-0 grid h-12 w-12 place-items-center text-slate-500">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <button disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0071e3] text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={18} /> : null}{bootstrapRequired ? "创建账号并进入" : "进入工作台"}</button>
    </form><p className="mt-6 text-xs leading-5 text-slate-500">各设备独立保存登录会话；退出当前设备不会影响其他设备。</p>
  </section></main>;
}
const inputClass = "mt-2 block min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base focus:border-blue-600";
