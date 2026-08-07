import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { PurchaseBacktestView } from "@/components/inventory/purchase-backtest-view";
import { loadInventoryDashboardData } from "@/lib/inventory/data";
import { backtestPurchaseDemand } from "@/lib/inventory/purchase-backtest";

export const metadata: Metadata = { title: "采购算法回测", description: "使用历史销量比较采购需求预测模型。" };
export const dynamic = "force-dynamic";
export default async function PurchaseBacktestPage() { const [us, ca] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]); return <><OpsPageHeader eyebrow="US + CA · Forecast Backtest" title="采购算法回测" description="比较近 3 月均值、去年同月季节模型与 Croston 断续需求模型，先验证再决定是否升级默认采购算法。" /><PurchaseBacktestView result={backtestPurchaseDemand(us, ca)} /></>; }
