"use client";
import { ChartNoAxesCombined, ClipboardList, Calculator, ChevronDown, ChevronRight, Database, LogOut, Menu, Search, Warehouse, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

const primary = [
  { href: "/inventory", label: "运营总览", icon: ChartNoAxesCombined },
  { href: "/inventory/brief", label: "SKU 经营简报", icon: ClipboardList },
  { href: "/inventory/calculator", label: "利润试算", icon: Calculator },
];
const backendGroups = [
  { label: "供货与仓库", links: [
  { href: "/inventory/supply-chain", label: "供应链追溯" },
  { href: "/inventory/warehouse", label: "仓库管理" },
  { href: "/inventory/stock", label: "库存视图" },
  { href: "/inventory/purchasing", label: "采购计划" },
  { href: "/inventory/replenishment", label: "发货计划" },
  ] }, { label: "产品与经营资料", links: [
  { href: "/inventory/costs", label: "产品成本" },
  { href: "/inventory/advertising", label: "广告明细" },
  { href: "/inventory/research", label: "新品调研" },
  { href: "/inventory/data/editor", label: "在线编辑" },
  ] }, { label: "运营协作", links: [
  { href: "/inventory/content", label: "产品待办" },
  { href: "/inventory/team", label: "协作记录" },
  ] }, { label: "数据管理", links: [
  { href: "/inventory/data", label: "数据更新" },
  { href: "/inventory/downloads", label: "数据下载" },
  ] },
];
const backend = backendGroups.flatMap(group => group.links);
function active(href: string, path: string) { return href === "/inventory/brief" && path.startsWith("/inventory/sku/") || (href === "/inventory" || href === "/inventory/data" ? path === href : path === href || path.startsWith(href + "/")); }
export function OperationsShell({ children, currentUser }: { children: ReactNode; snapshots: Record<"US" | "CA", string | null>; currentUser: { name: string; email: string; role: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const drawer = useRef<HTMLDialogElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [backendOpen, setBackendOpen] = useState(backend.some(item => active(item.href, pathname)));
  useEffect(() => {
    if (!backend.some(item => active(item.href, pathname))) return;
    const timer = setTimeout(() => setBackendOpen(true), 0);
    return () => clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    const dialog = drawer.current;
    if (mobileOpen && !dialog?.open) dialog?.showModal();
    if (!mobileOpen && dialog?.open) dialog.close();
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const media = window.matchMedia("(min-width: 1024px)");
    const resize = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener("change", resize);
    return () => { document.body.style.overflow = previous; media.removeEventListener("change", resize); };
  }, [mobileOpen]);
  const title = pathname.startsWith("/inventory/sku/") ? "单 SKU 业务详情" : [...primary, ...backend].find(item => active(item.href, pathname))?.label || "经营工作台";
  const brand = <Link href="/inventory" className="ops-brand" onClick={() => setMobileOpen(false)}><span className="ops-brand-mark">M</span><span><strong>MEASUREMAN</strong><small>OPERATIONS DESK</small></span></Link>;
  const navigation = (prefix: string) => <><p className="ops-nav-label">OPERATIONS</p><nav className="space-y-1" aria-label="主导航">{primary.map(({ href, label, icon: Icon }) => <Link onClick={() => setMobileOpen(false)} key={href} href={href} aria-current={active(href, pathname) ? "page" : undefined} className="ops-nav-item"><Icon size={18} />{label}</Link>)}</nav>
    <div className="ops-backend-nav"><button onClick={() => setBackendOpen(!backendOpen)} aria-expanded={backendOpen} aria-controls={`${prefix}-business-navigation`} className="ops-backend-toggle"><Warehouse size={17} />业务后台<ChevronDown size={15} className={`ml-auto transition-transform ${backendOpen ? "rotate-180" : ""}`} /></button>
    {backendOpen && <nav id={`${prefix}-business-navigation`} aria-label="业务后台" className="mt-2 space-y-3">{backendGroups.map(group => <details key={group.label} open={group.links.some(link => active(link.href, pathname))}><summary className="ops-backend-group">{group.label}</summary>{group.links.map(({ href, label }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={active(href, pathname) ? "page" : undefined} className="ops-backend-link">{label}</Link>)}</details>)}</nav>}</div></>;
  return <div className="ops-root min-h-screen">
    <aside className="ops-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col lg:flex">{brand}<div className="ops-nav-scroll min-h-0 flex-1 overflow-y-auto">{navigation("desktop")}</div><div className="ops-sidebar-footer"><p>共用经营工作区</p><p className="mt-1 truncate">{currentUser.email}</p></div></aside>
    <div className="ops-workspace"><header className="ops-topbar sticky top-0 z-30"><div className="ops-breadcrumb"><span>经营工作台</span><ChevronRight size={13} /><strong>{title}</strong></div><div className="flex items-center gap-2"><button onClick={() => setMobileOpen(true)} aria-label="展开导航" aria-expanded={mobileOpen} aria-controls="ops-mobile-drawer" className="ops-tool-button lg:hidden"><Menu size={20} /></button><form className="ops-global-search" role="search" onSubmit={event => { event.preventDefault(); const params = new URLSearchParams(window.location.search); params.set("query", search.trim()); params.set("filter", "all"); params.delete("tab"); router.push(`/inventory/brief?${params}`); setMobileOpen(false); }}><Search size={15} aria-hidden="true" /><input aria-label="全局搜索 SKU 或 ASIN" placeholder="搜索 SKU / ASIN" value={search} onChange={event => setSearch(event.target.value)} /></form><Link href="/inventory/data" className="ops-tool-button" aria-label="数据管理"><Database size={17} /></Link><span className="ops-avatar" title={`共享账号 · ${currentUser.name}`}>MM</span><button onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login")); }} aria-label="退出当前设备" className="ops-tool-button"><LogOut size={17} /></button></div></header><main className="ops-view">{children}</main></div>
    <dialog ref={drawer} id="ops-mobile-drawer" aria-label="业务导航" className="ops-mobile-drawer" onClose={() => setMobileOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMobileOpen(false); }}><aside className="ops-mobile-drawer-panel"><div className="flex items-center justify-between">{brand}<button onClick={() => setMobileOpen(false)} aria-label="关闭导航" className="ops-tool-button"><X size={20} /></button></div>{navigation("mobile")}</aside></dialog>
    <nav aria-label="快捷导航" className="ops-mobile-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 lg:hidden">{primary.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={active(href, pathname) ? "page" : undefined} className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px]"><Icon size={20} />{label === "运营总览" ? "总览" : label === "SKU 经营简报" ? "SKU 简报" : label}</Link>)}</nav>
  </div>;
}
export function OperationsShellFallback() { return <main className="p-8 text-sm text-slate-500">正在加载经营工作台…</main>; }
export function InventoryContentSkeleton() { return <div role="status" className="space-y-4"><p className="text-sm text-slate-500">正在读取经营数据…</p><div className="h-24 rounded-xl bg-slate-200/60" /><div className="h-60 rounded-xl bg-slate-200/60" /></div>; }
