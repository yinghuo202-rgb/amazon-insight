"use client";

import {
  Boxes,
  Calculator,
  ChartNoAxesCombined,
  ChevronRight,
  DatabaseZap,
  Download,
  FolderSearch,
  LogOut,
  Lightbulb,
  Megaphone,
  Menu,
  Paintbrush,
  PencilLine,
  ShoppingCart,
  Store,
  SunMedium,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";

type NavigationItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  combined?: boolean;
};

const navigation: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "指挥中心",
    items: [{ href: "/inventory", label: "运营总览", icon: ChartNoAxesCombined, combined: true }],
  },
  {
    label: "库存与供应",
    items: [
      { href: "/inventory/stock", label: "库存视图", icon: Warehouse },
      { href: "/inventory/stock/seasonal-clearance", label: "季节库存分析", icon: SunMedium, combined: true },
      { href: "/inventory/purchasing", label: "采购计划", icon: ShoppingCart, combined: true },
      { href: "/inventory/replenishment", label: "发货计划", icon: Boxes },
    ],
  },
  {
    label: "商品与增长",
    items: [
      { href: "/inventory/costs", label: "产品成本", icon: Calculator, combined: true },
      { href: "/inventory/advertising", label: "广告管理", icon: Megaphone },
      { href: "/inventory/content", label: "产品待办", icon: Paintbrush, combined: true },
      { href: "/inventory/research", label: "新品调研", icon: Lightbulb, combined: true },
    ],
  },
  {
    label: "协作",
    items: [{ href: "/inventory/team", label: "团队协作", icon: Users, combined: true }],
  },
  {
    label: "数据与输出",
    items: [
      { href: "/inventory/data/editor", label: "在线编辑", icon: PencilLine, combined: true },
      { href: "/inventory/data", label: "数据更新", icon: DatabaseZap, combined: true },
      { href: "/inventory/downloads", label: "下载中心", icon: Download, combined: true },
    ],
  },
];

const allNavigationItems = navigation.flatMap((group) => group.items);

function isNavigationActive(item: NavigationItem, pathname: string) {
  if (item.href === "/inventory" || item.href === "/inventory/stock") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function OperationsShell({ children, snapshots, currentUser }: { children: ReactNode; snapshots: Record<"US" | "CA", string | null>; currentUser: { name: string; email: string; role: string } }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const market = searchParams.get("market")?.toUpperCase() === "CA" ? "CA" : "US";
  const currentItem = allNavigationItems.find((item) => isNavigationActive(item, pathname));
  const combinedOverview = currentItem?.combined ?? false;

  function navigationHref(item: NavigationItem) {
    if (item.combined || item.href === "/inventory") return item.href;
    return market === "CA" ? `${item.href}?market=CA` : item.href;
  }

  function switchMarketHref(nextMarket: "US" | "CA") {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMarket === "CA") params.set("market", "CA");
    else params.delete("market");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function logout() {
    void fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"));
  }

  return (
    <div className="ops-root min-h-screen text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-white/[0.07] bg-[#0b1220] text-slate-200 xl:flex xl:flex-col">
        <div className="px-5 pb-4 pt-5">
          <Link href="/inventory" className="group flex items-center gap-3 rounded-xl p-1.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-xs font-black tracking-[0.08em] text-white shadow-lg shadow-blue-950/30 transition group-hover:bg-blue-500">MM</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-white">Measureman Commerce</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Operations OS</p>
            </div>
          </Link>
        </div>

        <div className="px-4 pb-4">
          {combinedOverview ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 text-xs font-medium text-slate-200">
              <Store className="h-3.5 w-3.5 text-blue-400" />US + CA 双站总览
            </div>
          ) : (
            <div className="grid grid-cols-2 rounded-xl border border-white/[0.07] bg-black/20 p-1" aria-label="选择店铺">
              {(["US", "CA"] as const).map((item) => (
                <Link key={item} href={switchMarketHref(item)} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition ${market === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-400 hover:bg-white/[0.05] hover:text-white"}`}>
                  <Store className="h-3.5 w-3.5" />{item === "US" ? "美国店" : "加拿大店"}
                </Link>
              ))}
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {navigation.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isNavigationActive(item, pathname);
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={navigationHref(item)} aria-current={active ? "page" : undefined} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition ${active ? "bg-blue-600 font-medium text-white shadow-md shadow-blue-950/25" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"}`}>
                      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-slate-500 transition group-hover:text-slate-300"}`} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.07] p-4">
          <div className="mb-3 rounded-xl border border-white/[0.06] bg-white/[0.035]">
            <button type="button" aria-expanded={selectionOpen} onClick={() => setSelectionOpen((open) => !open)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs font-medium text-slate-400 hover:text-white"><FolderSearch className="h-3.5 w-3.5" /><span className="flex-1">选品仓</span><ChevronRight className={`h-3.5 w-3.5 transition ${selectionOpen ? "rotate-90" : ""}`} /></button>
            {selectionOpen ? <div className="space-y-1 border-t border-white/[0.06] p-2"><Link href="/selection" className="block rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-white">选品首页</Link><Link href="/pool" className="block rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-white">选品池</Link></div> : null}
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3 text-[11px] leading-5 text-slate-500">
            {combinedOverview ? (
              <>
                <p className="mb-1 font-medium text-slate-300">双站数据状态</p>
                <SnapshotLine label="美国库存" value={snapshots.US} />
                <SnapshotLine label="加拿大库存" value={snapshots.CA} />
              </>
            ) : (
              <>
                <p className="mb-1 font-medium text-slate-300">{market === "CA" ? "加拿大店 · CAD" : "美国店 · USD"}</p>
                <SnapshotLine label="库存快照" value={snapshots[market]} />
                {market === "CA" ? <p className="mt-1 text-amber-400/80">AWD 数据源尚未接入</p> : null}
              </>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-2"><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-200">{currentUser.name}</p><p className="truncate text-[10px] text-slate-500">{currentUser.email}</p></div><button type="button" onClick={logout} className="shrink-0 text-[10px] text-slate-500 hover:text-white">退出</button></div>
        </div>
      </aside>

      <div className="min-w-0 xl:pl-[264px]">
        <header className="safe-top sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,.02)] backdrop-blur-xl xl:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Link href="/inventory" onClick={() => setMobileNavigationOpen(false)} className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-[10px] font-black text-white">MM</span><span className="truncate text-sm font-semibold tracking-tight text-slate-950">Measureman Commerce</span></Link>
            <div className="flex shrink-0 items-center gap-2">
              {combinedOverview ? <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-semibold text-white">US + CA</span> : <div className="flex rounded-lg bg-slate-100 p-0.5">{(["US", "CA"] as const).map((item) => <Link key={item} href={switchMarketHref(item)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${market === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{item}</Link>)}</div>}
              <button type="button" aria-label={mobileNavigationOpen ? "关闭导航" : "打开导航"} aria-expanded={mobileNavigationOpen} aria-controls="mobile-operations-navigation" onClick={() => setMobileNavigationOpen((open) => !open)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm">
                {mobileNavigationOpen ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-[11px]">
            <div className="flex min-w-0 items-center gap-2 text-slate-500"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" /><span className="truncate">当前模块 · <strong className="font-medium text-slate-800">{currentItem?.label ?? "运营工作台"}</strong></span></div>
            <span className="shrink-0 font-mono text-[10px] text-slate-400">库存 {combinedOverview ? snapshots.US ?? "—" : snapshots[market] ?? "—"}</span>
          </div>

          {mobileNavigationOpen ? (
            <>
              <button type="button" aria-label="关闭导航遮罩" onClick={() => setMobileNavigationOpen(false)} className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[2px]" />
              <div id="mobile-operations-navigation" className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 pb-5 pt-4 shadow-2xl shadow-slate-950/15">
                <nav aria-label="运营模块" className="space-y-5">
                  {navigation.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{group.label}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {group.items.map((item) => {
                          const active = isNavigationActive(item, pathname);
                          const Icon = item.icon;
                          return <Link key={item.href} href={navigationHref(item)} aria-current={active ? "page" : undefined} onClick={() => setMobileNavigationOpen(false)} className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition ${active ? "border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-200" : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-blue-200 hover:bg-blue-50"}`}><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span>{active ? <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" /> : null}</Link>;
                        })}
                      </div>
                    </div>
                  ))}
                </nav>
                <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{currentUser.name}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{currentUser.email}</p></div>
                  <button type="button" onClick={logout} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-rose-200 hover:text-rose-700"><LogOut className="h-3.5 w-3.5" />退出</button>
                </div>
                <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50"><summary className="cursor-pointer px-3.5 py-3 text-xs font-semibold text-slate-700">选品仓</summary><div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3"><Link href="/selection" onClick={() => setMobileNavigationOpen(false)} className="rounded-lg bg-white px-3 py-2 text-center text-xs text-slate-700">选品首页</Link><Link href="/pool" onClick={() => setMobileNavigationOpen(false)} className="rounded-lg bg-white px-3 py-2 text-center text-xs text-slate-700">选品池</Link></div></details>
              </div>
            </>
          ) : null}
        </header>
        <main className="mx-auto min-w-0 w-full max-w-[1600px] px-4 py-5 sm:px-6 xl:px-8 xl:py-7">{children}</main>
      </div>
    </div>
  );
}

export function OperationsShellFallback() {
  return (
    <div className="ops-root min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-white/[0.07] bg-[#0b1220] xl:block">
        <div className="flex items-center gap-3 px-5 py-6"><span className="ops-skeleton h-10 w-10 rounded-xl bg-slate-700" /><div className="space-y-2"><span className="ops-skeleton block h-3 w-32 rounded" /><span className="ops-skeleton block h-2 w-20 rounded" /></div></div>
        <div className="space-y-3 px-4 pt-5">{Array.from({ length: 8 }, (_, index) => <span key={index} className="ops-skeleton block h-9 rounded-xl bg-slate-800" />)}</div>
      </aside>
      <div className="xl:pl-[264px]">
        <div className="flex h-[93px] items-center justify-between border-b border-slate-200 bg-white px-4 xl:hidden"><span className="ops-skeleton h-8 w-48 rounded-lg" /><span className="ops-skeleton h-9 w-9 rounded-lg" /></div>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 xl:px-8 xl:py-7"><InventoryContentSkeleton /></main>
      </div>
    </div>
  );
}

export function InventoryContentSkeleton() {
  return (
    <div aria-label="正在加载运营数据" aria-busy="true">
      <div className="space-y-3 border-b border-slate-200 pb-6"><span className="ops-skeleton block h-3 w-32 rounded" /><span className="ops-skeleton block h-9 w-64 max-w-full rounded-lg" /><span className="ops-skeleton block h-4 w-[560px] max-w-full rounded" /></div>
      <div className="ops-kpi-grid mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <span key={index} className="ops-skeleton h-28 rounded-2xl" />)}</div>
      <span className="ops-skeleton mt-5 block h-[360px] rounded-2xl" />
    </div>
  );
}

function SnapshotLine({ label, value }: { label: string; value: string | null }) {
  return <div className="flex items-center justify-between gap-3"><span>{label}</span><span className={value ? "font-mono text-slate-300" : "text-rose-400"}>{value ?? "未生成"}</span></div>;
}
