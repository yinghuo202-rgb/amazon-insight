function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableRatio(numerator, denominator) {
  const top = numberOrZero(numerator);
  const bottom = numberOrZero(denominator);
  if (bottom === 0) return null;
  return Number((top / bottom).toFixed(6));
}

function calculateMetrics(row) {
  const impressions = Math.trunc(numberOrZero(row.impressions));
  const clicks = Math.trunc(numberOrZero(row.clicks));
  const spend = numberOrZero(row.spend);
  const sales = numberOrZero(row.sales);
  const orders = Math.trunc(numberOrZero(row.orders));

  return {
    impressions,
    clicks,
    spend: Number(spend.toFixed(2)),
    sales: Number(sales.toFixed(2)),
    orders,
    acos: nullableRatio(spend, sales),
    roas: nullableRatio(sales, spend),
    cpc: nullableRatio(spend, clicks),
    ctr: nullableRatio(clicks, impressions),
    cvr: nullableRatio(orders, clicks),
    cpa: nullableRatio(spend, orders)
  };
}

function anomalyFlags(metrics, rules = {}) {
  const targetAcos = Number(rules.target_acos ?? 0.3);
  const maxAcos = Number(rules.max_acos ?? 0.4);
  const highSpendThreshold = Number(rules.high_spend_threshold ?? 20);
  const minClicks = Number(rules.min_clicks ?? 8);

  return {
    is_zero_order_high_spend: metrics.orders === 0 && metrics.spend >= highSpendThreshold,
    is_high_acos: metrics.acos !== null && metrics.acos > maxAcos,
    is_low_acos: metrics.acos !== null && metrics.acos <= targetAcos && metrics.orders > 0,
    is_high_cvr: metrics.cvr !== null && metrics.cvr >= 0.08,
    is_low_cvr: metrics.cvr !== null && metrics.cvr < 0.02 && metrics.clicks >= minClicks,
    is_data_insufficient: metrics.clicks < minClicks,
    is_unmapped_entity: false
  };
}

function calculateProfitAfterAds(adSales, grossMargin, adSpend) {
  return Number((numberOrZero(adSales) * numberOrZero(grossMargin) - numberOrZero(adSpend)).toFixed(2));
}

module.exports = {
  anomalyFlags,
  calculateMetrics,
  calculateProfitAfterAds,
  nullableRatio,
  numberOrZero
};
