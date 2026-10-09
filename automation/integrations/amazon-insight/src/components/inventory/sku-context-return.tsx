import Link from "next/link";
import { safeSkuReturnHref } from "@/lib/inventory/operating-navigation";
export function SkuContextReturn({ returnTo, market, query }: { returnTo?: string; market?: string; query?: string }) {
  const href = safeSkuReturnHref(returnTo);
  return href ? <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-500"><Link href={href} className="inline-flex min-h-11 items-center text-sm text-[#0071e3]">返回 SKU 分析</Link><span>{market} · {query} · 当前后台资料；历史经营月份在返回页保留</span></div> : null;
}
