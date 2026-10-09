import { operatingFilters, operatingSorts, queryOperatingModel } from "@/lib/inventory/operating-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadOperatingModel } from "@/lib/inventory/data";
import { operatingMarkets } from "@/lib/inventory/operating-performance";
export const metadata: Metadata = { title: "SKU 经营简报", description: "一张卡片看销售、利润、广告、退货、仓储和季节性。" };
export const dynamic = "force-dynamic";
export default async function BriefPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.market !== undefined && (typeof params.market !== "string" || !(operatingMarkets as readonly string[]).includes(params.market))) notFound();
  const market = typeof params.market === "string" && (operatingMarkets as readonly string[]).includes(params.market) ? params.market : undefined;
  const period = typeof params.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period) ? params.period : undefined;
  const filter = typeof params.filter === "string" && (operatingFilters as readonly string[]).includes(params.filter) ? params.filter : "focus";
  const query = typeof params.query === "string" ? params.query.slice(0, 100) : "";
  const sort = typeof params.sort === "string" && (operatingSorts as readonly string[]).includes(params.sort) ? params.sort : undefined;
  return <><OpsPageHeader title="SKU 经营简报" description="先看简短建议，再展开证据。默认聚焦少量 SKU，也可搜索 SKU、产品或 ASIN。" /><RevenueOverviewDashboard initial={queryOperatingModel(await loadOperatingModel(), { brief: true, market, period, filter, query, sort })} brief /></>;
}
