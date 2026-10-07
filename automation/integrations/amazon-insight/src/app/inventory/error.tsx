"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function InventoryError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="grid min-h-[440px] place-items-center rounded-2xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm">
      <div className="max-w-md">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600"><CircleAlert className="h-5 w-5" /></span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">运营数据暂时无法显示</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">可能是数据文件正在更新或服务短暂不可用。你可以重新加载当前模块，已有业务数据不会被修改。</p>
        {error.digest ? <p className="mt-3 font-mono text-[10px] text-slate-400">错误编号 {error.digest}</p> : null}
        <button type="button" onClick={() => unstable_retry()} className="mx-auto mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"><RefreshCw className="h-4 w-4" />重新加载</button>
      </div>
    </section>
  );
}
