"use client";

import { ListFilter, SunMedium } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const tabs = [
  { href: "/inventory/stock", label: "SKU 库存", description: "库存清单、筛选与采购建议", icon: ListFilter },
  { href: "/inventory/stock/seasonal-clearance", label: "季节库存", description: "旺季补货与季末清货", icon: SunMedium },
];

export function StockViewTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const market = searchParams.get("market")?.toUpperCase();

  return <nav className="grid gap-2 border border-slate-200 bg-white p-2 sm:grid-cols-2" aria-label="库存视图子页面">
    {tabs.map((tab) => {
      const active = tab.href === "/inventory/stock" ? pathname === tab.href : pathname.startsWith(tab.href);
      const href = market === "CA" || market === "US" ? `${tab.href}?market=${market}` : tab.href;
      const Icon = tab.icon;
      return <Link key={tab.href} href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 px-4 py-3 transition ${active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}>
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-amber-300" : "text-slate-400"}`} />
        <span className="min-w-0"><span className="block text-sm font-semibold">{tab.label}</span><span className={`mt-0.5 block truncate text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>{tab.description}</span></span>
      </Link>;
    })}
  </nav>;
}
