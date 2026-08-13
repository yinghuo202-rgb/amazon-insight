import type { Metadata } from "next";

import { NewProductResearchBoard } from "@/components/inventory/new-product-research-board";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadNewProductResearchData } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "新品调研", description: "查看新品候选毛利、成本与下单进度。" };
export const dynamic = "force-dynamic";

export default async function NewProductResearchPage() {
  return <><OpsPageHeader eyebrow="商品与增长 · Research" title="新品调研" description="用一页查看候选毛利、关键成本和最新下单进度，先筛选，再进入产品成本和库存计划。" /><NewProductResearchBoard data={await loadNewProductResearchData()} /></>;
}
