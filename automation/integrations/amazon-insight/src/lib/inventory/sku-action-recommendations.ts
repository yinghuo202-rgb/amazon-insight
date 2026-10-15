import type { OperatingSku, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import type { OperatingRules } from "@/lib/inventory/operating-rules";

export type SkuActionKind = "price" | "advertising";
export type SkuActionEvidence = {
  label: string;
  value: number;
  unit: "percent" | "currency";
  currency?: string;
  period: string;
  source: string;
};
export type SkuActionRecommendation = {
  kind: SkuActionKind;
  action: "test_price_increase" | "review_price_and_cost" | "review_ad_spend";
  title: string;
  suggestion: string;
  evidence: [SkuActionEvidence, SkuActionEvidence, SkuActionEvidence];
};
export type SkuActionAvailability = { available: boolean; reason: string | null };
export type SkuActionRecommendations = {
  recommendations: SkuActionRecommendation[];
  availability: Record<SkuActionKind, SkuActionAvailability>;
};

type Facts = ReturnType<typeof operatingFacts>;
const PRICE_DECLINE_MIN = 0.05;
const MAX_UNIT_GROWTH_FOR_PRICE_TEST = 0.05;

function previousMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthEnd(month: string) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
}

function realizedPrice(point: NonNullable<Facts["current"]>) {
  return point.averagePrice ?? (point.units > 0 ? point.productSales / point.units : null);
}

function source(point: NonNullable<Facts["current"]>) {
  return point.sourceKind === "gerpgo" ? "积加经营报告" : "月度利润报告";
}

const unavailable = (reason: string): SkuActionAvailability => ({ available: false, reason });
const available: SkuActionAvailability = { available: true, reason: null };

/** Decision support only: never treats realized price as a live listing price or an ad aggregate as a bid. */
export function buildSkuActionRecommendations(row: OperatingSku, period: string, facts: Facts, rules: OperatingRules): SkuActionRecommendations {
  const result: SkuActionRecommendations = {
    recommendations: [],
    availability: { price: unavailable("经营数据不足"), advertising: unavailable("广告数据不足") },
  };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || (row.market !== "US" && row.market !== "CA")) return result;
  const currency = row.market === "CA" ? "CAD" : "USD";
  const current = facts.current;
  if (!current || current.reportMonth !== period || current.market !== row.market || current.sku !== row.sku
    || current.currency !== currency || row.currency !== currency) {
    result.availability.price = unavailable("所选 SKU、期间或币种不匹配");
    result.availability.advertising = unavailable("所选 SKU、期间或币种不匹配");
    return result;
  }
  if (!facts.complete || current.quality?.completePeriod !== true) {
    result.availability.price = unavailable("仅对完整经营月份评估调价");
    result.availability.advertising = unavailable("仅对完整经营月份评估广告调整");
    return result;
  }
  if (current.quality?.profitVerified !== true || current.actualProfit === null || current.productSales <= 0 || current.units < rules.minSalesUnits) {
    result.availability.price = unavailable("实际利润未核验、销售额无效或销售样本不足");
    result.availability.advertising = unavailable("实际利润未核验、销售额无效或销售样本不足");
    return result;
  }
  const margin = current.actualProfit / current.productSales;
  const profitSource = source(current);
  const currentPrice = realizedPrice(current);
  if (currentPrice === null || currentPrice <= 0) result.availability.price = unavailable("本期成交均价不可计算");
  else result.availability.price = available;
  const previous = facts.previous;
  if (currentPrice !== null && currentPrice > 0 && previous && previous.reportMonth === previousMonth(period)
    && previous.market === row.market && previous.sku === row.sku && previous.currency === currency
    && previous.quality?.completePeriod === true && previous.quality.profitVerified === true
    && previous.actualProfit !== null && previous.productSales > 0 && previous.units >= rules.minSalesUnits) {
    const previousPrice = realizedPrice(previous);
    if (previousPrice !== null && previousPrice > 0) {
      const priceChange = currentPrice / previousPrice - 1;
      const unitChange = current.units / previous.units - 1;
      // A declining realized price is a correlation, not proof that changing the listing price will recover profit.
      if (margin < rules.profitMarginMinPercent / 100 && priceChange <= -PRICE_DECLINE_MIN
        && unitChange <= MAX_UNIT_GROWTH_FOR_PRICE_TEST && current.productSales < previous.productSales) {
        result.recommendations.push({
          kind: "price", action: "test_price_increase", title: "考虑小范围提价试验",
          suggestion: "历史成交均价下降、销量未明显增长，且实际利润率低于目标。先用真实费用试算并人工核对当前挂牌价，再小范围测试；不将历史成交均价当作挂牌价。",
          evidence: [
            { label: "历史成交均价变化", value: priceChange * 100, unit: "percent", period: `${previous.reportMonth}→${period}`, source: `${source(previous)} / ${profitSource}` },
            { label: "销量变化", value: unitChange * 100, unit: "percent", period: `${previous.reportMonth}→${period}`, source: `${source(previous)} / ${profitSource}` },
            { label: "已核验实际利润率", value: margin * 100, unit: "percent", period, source: profitSource },
          ],
        });
      }
    }
  }
  if (result.availability.price.available && margin < rules.profitMarginMinPercent / 100
    && !result.recommendations.some(item => item.kind === "price")) {
    result.recommendations.push({
      kind: "price", action: "review_price_and_cost", title: margin < 0 ? "亏损 SKU：核对定价与成本" : "复核售价与成本",
      suggestion: "实际利润率低于站点设定值。先核对当前挂牌价与单件成本，再试算提价或降本空间；仅凭成交均价不能确定应调整的售价。",
      evidence: [
        { label: "已核验实际利润率", value: margin * 100, unit: "percent", period, source: profitSource },
        { label: "本期成交均价", value: currentPrice!, unit: "currency", currency, period, source: profitSource },
        { label: "单件实际利润", value: current.actualProfit / current.units, unit: "currency", currency, period, source: profitSource },
      ],
    });
  }

  const ads = row.advertisingHistory.find(item => item.reportMonth === period && item.market === row.market && item.currency === currency);
  if (!ads || ads.cost === null || ads.sales === null || ads.startDate !== `${period}-01` || ads.businessAsOf !== monthEnd(period)
    || current.quality?.businessAsOf && current.quality.businessAsOf !== ads.businessAsOf) {
    result.availability.advertising = unavailable("缺少同期、同币种、完整月份的 SKU 广告汇总");
  } else {
    result.availability.advertising = available;
    const spendShare = ads.cost / current.productSales;
    if (spendShare > rules.adSpendMaxPercent / 100 && margin < rules.profitMarginMinPercent / 100) {
      result.recommendations.push({
        kind: "advertising", action: "review_ad_spend", title: "检查广告预算与投放",
        suggestion: "该 SKU 广告投入占比偏高且实际利润率偏低。先在广告后台排查高花费、低转化的活动及搜索词，再决定是否收紧预算；本站没有活动或关键词实际竞价，不给出竞价改幅。",
        evidence: [
          { label: "SKU 广告花费", value: ads.cost, unit: "currency", currency, period, source: "积加 SKU 广告汇总" },
          { label: "广告花费 / 商品销售额", value: spendShare * 100, unit: "percent", period, source: `积加 SKU 广告汇总 / ${profitSource}` },
          { label: "已核验实际利润率", value: margin * 100, unit: "percent", period, source: profitSource },
        ],
      });
    }
  }
  const priority: Record<SkuActionRecommendation["action"], number> = { test_price_increase: 0, review_ad_spend: 1, review_price_and_cost: 2 };
  result.recommendations.sort((left, right) => priority[left.action] - priority[right.action]);
  return result;
}
