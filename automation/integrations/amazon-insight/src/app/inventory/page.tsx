import { operatingFilters, operatingSorts, queryOperatingModel } from "@/lib/inventory/operating-query";
import { operatingMarkets } from "@/lib/inventory/operating-performance";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadOperatingModel } from "@/lib/inventory/data";
export const metadata: Metadata = { title: "运营总览", description: "按站点和月份查看销售额、利润与经营证据。" };
export const dynamic = "force-dynamic";
export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  if (p.market !== undefined && (typeof p.market !== "string" || !(operatingMarkets as readonly string[]).includes(p.market))) notFound();
  const market = typeof p.market === "string" && (operatingMarkets as readonly string[]).includes(p.market) ? p.market : undefined;
  const period = typeof p.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.period) ? p.period : undefined;
  const filter = typeof p.filter === "string" && (operatingFilters as readonly string[]).includes(p.filter) ? p.filter : undefined;
  const sort = typeof p.sort === "string" && (operatingSorts as readonly string[]).includes(p.sort) ? p.sort : undefined;
  const query = typeof p.query === "string" ? p.query.slice(0, 100) : "";
  const model = await loadOperatingModel();
  return <><OpsPageHeader eyebrow="OPERATIONS OVERVIEW" title="运营总览" description="先看整体变化，再定位具体产品。" /><RevenueOverviewDashboard initial={queryOperatingModel(model, { market, period, filter, sort, query })} /></>;
}
