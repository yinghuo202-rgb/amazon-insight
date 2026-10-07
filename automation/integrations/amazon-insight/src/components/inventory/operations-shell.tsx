"use client";
import { ChartNoAxesCombined, ClipboardList, Calculator, ChevronDown, Database, LogOut, Menu, Warehouse, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const primary = [
  { href: "/inventory", label: "运营总览", icon: ChartNoAxesCombined },
  { href: "/inventory/brief", label: "SKU 经营简报", icon: ClipboardList },
  { href: "/inventory/calculator", label: "利润试算", icon: Calculator },
];
const backend = [
  { href: "/inventory/supply-chain", label: "供应链追溯" },
  { href: "/inventory/warehouse", label: "仓库管理" },
  { href: "/inventory/stock", label: "库存视图" },
  { href: "/inventory/purchasing", label: "采购计划" },
  { href: "/inventory/replenishment", label: "发货计划" },
  { href: "/inventory/costs", label: "产品成本" },
  { href: "/inventory/advertising", label: "广告明细" },
  { href: "/inventory/research", label: "新品调研" },
  { href: "/inventory/content", label: "产品待办" },
  { href: "/inventory/team", label: "协作记录" },
  { href: "/inventory/data/editor", label: "在线编辑" },
  { href: "/inventory/data", label: "数据更新" },
  { href: "/inventory/downloads", label: "数据下载" },
];
function active(href: string, path: string) { return href === "/inventory" || href === "/inventory/data" ? path === href : path === href || path.startsWith(href + "/"); }
export function OperationsShell({ children, currentUser }: { children: ReactNode; snapshots: Record<"US" | "CA", string | null>; currentUser: { name: string; email: string; role: string } }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [backendOpen, setBackendOpen] = useState(backend.some(item => active(item.href, pathname)));
  const nav = <><nav className="space-y-2" aria-label="主导航">{primary.map(({ href, label, icon: Icon }) => <Link onClick={() => setMobileOpen(false)} key={href} href={href} aria-current={active(href, pathname) ? "page" : undefined} className={`flex min-h-12 items-center gap-3 rounded-lg px-4 text-sm ${active(href, pathname) ? "bg-white font-semibold text-[#0071e3] shadow-sm" : "text-[#6e6e73] hover:bg-white/70"}`}><Icon size={19} />{label}</Link>)}</nav>
    <div className="mt-7 border-t border-black/5 pt-5"><button onClick={() => setBackendOpen(!backendOpen)} aria-expanded={backendOpen} aria-controls="business-navigation" className="flex min-h-11 w-full items-center gap-3 px-4 text-sm text-[#6e6e73]"><Warehouse size={18} />业务后台<ChevronDown size={16} className={`ml-auto transition-transform ${backendOpen ? "rotate-180" : ""}`} /></button>
    {backendOpen && <nav id="business-navigation" aria-label="业务后台" className="mt-2 space-y-1">{backend.map(({ href, label }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={active(href, pathname) ? "page" : undefined} className={`block min-h-10 rounded-md py-2.5 pl-12 text-xs ${active(href, pathname) ? "bg-white text-[#0071e3]" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}>{label}</Link>)}</nav>}</div></>;
  return <div className="ops-root min-h-screen">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col bg-[#f5f5f7] px-3 py-6 lg:flex"><Link href="/inventory" className="mb-10 px-4 text-xl font-semibold tracking-tight text-[#1d1d1f]">Measureman</Link><div className="min-h-0 flex-1 overflow-y-auto">{nav}</div><div className="mt-5 border-t border-black/5 px-4 pt-5 text-xs leading-5 text-[#6e6e73]"><p>共用经营工作区</p><p className="mt-1 truncate text-slate-400">{currentUser.email}</p></div></aside>
    <div className="lg:pl-56"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 backdrop-blur-xl px-4 sm:px-7"><div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} aria-label="展开导航" aria-expanded={mobileOpen} className="grid h-11 w-11 place-items-center lg:hidden"><Menu size={21} /></button><span className="text-sm font-medium text-[#1d1d1f]">经营工作台</span></div><div className="flex items-center gap-3"><Link href="/inventory/data" className="flex min-h-11 items-center gap-2 text-xs text-slate-500"><Database size={15} /><span className="hidden sm:inline">数据管理</span></Link><button onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login")); }} aria-label="退出当前设备" className="flex min-h-11 items-center gap-2 text-xs text-slate-500"><LogOut size={16} /><span>退出</span></button></div></header><main className="mx-auto max-w-[1320px] px-4 pb-24 pt-6 sm:px-7 lg:pb-10">{children}</main></div>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="关闭导航遮罩" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-slate-950/40" /><aside aria-label="移动导航" className="relative flex h-full w-[min(300px,85vw)] flex-col overflow-y-auto bg-[#f5f5f7] p-4"><div className="mb-7 flex items-center justify-between text-[#1d1d1f]"><span className="text-lg font-semibold">Measureman</span><button onClick={() => setMobileOpen(false)} aria-label="关闭导航" className="grid h-11 w-11 place-items-center"><X size={21} /></button></div>{nav}</aside></div>}
    <nav aria-label="快捷导航" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden">{primary.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={active(href, pathname) ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] ${active(href, pathname) ? "font-semibold text-[#0071e3]" : "text-slate-500"}`}><Icon size={19} />{label}</Link>)}</nav>
  </div>;
}
export function OperationsShellFallback() { return <main className="p-8 text-sm text-slate-500">正在加载经营工作台…</main>; }
export function InventoryContentSkeleton() { return <div role="status" className="space-y-4"><p className="text-sm text-slate-500">正在读取经营数据…</p><div className="h-24 rounded-xl bg-slate-200/60" /><div className="h-60 rounded-xl bg-slate-200/60" /></div>; }
