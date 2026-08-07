from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AdvertisingParameters:
    target_acos_percent: float = 30.0
    minimum_evidence_spend: float = 20.0
    no_order_spend: float = 20.0
    winner_min_orders: int = 5
    scale_min_orders: int = 1
    low_volume_max_clicks: int = 30
    budget_utilization_threshold_percent: float = 80.0
    scale_max_acos_ratio: float = 0.9


def recommend_campaign(
    *,
    spend: float,
    advertising_sales: float,
    orders: int,
    clicks: int,
    impressions: int,
    budget: float,
    period_days: int,
    inventory_risk: str | None,
    parameters: AdvertisingParameters,
) -> dict:
    acos = spend / advertising_sales * 100 if advertising_sales > 0 else None
    ctr = clicks / impressions * 100 if impressions > 0 else None
    conversion_rate = orders / clicks * 100 if clicks > 0 else None
    average_daily_spend = spend / max(1, period_days)
    budget_utilization = average_daily_spend / budget * 100 if budget > 0 else None
    inventory_supports_scale = inventory_risk in {"healthy", "excess"}
    efficient_enough_to_scale = (
        acos is not None
        and acos <= parameters.target_acos_percent * parameters.scale_max_acos_ratio
        and orders >= parameters.scale_min_orders
        and inventory_supports_scale
    )

    if inventory_risk == "critical" and spend >= 1:
        action = "PAUSE_STOCK_RISK"
        reason = "关联 SKU 存在断货风险，先控制广告消耗。"
    elif orders <= 0 and spend >= parameters.no_order_spend:
        action = "NO_ORDER_REVIEW"
        reason = f"花费已达 ${spend:.0f} 但没有广告订单，先检查搜索词、主图和转化，不建议盲目加价。"
    elif (
        acos is not None
        and spend >= parameters.minimum_evidence_spend
        and acos > parameters.target_acos_percent
    ):
        action = "REDUCE_BID_OR_BUDGET"
        reason = f"ACOS {acos:.1f}% 高于目标 {parameters.target_acos_percent:.0f}%。"
    elif (
        efficient_enough_to_scale
        and budget_utilization is not None
        and budget_utilization >= parameters.budget_utilization_threshold_percent
    ):
        action = "INCREASE_BUDGET"
        reason = (
            f"ACOS {acos:.1f}%，日均花费占预算 {budget_utilization:.0f}%，"
            "预算可能限制流量，建议先提高 10%–20% 并观察 7 天。"
        )
    elif (
        efficient_enough_to_scale
        and orders < parameters.winner_min_orders
        and clicks <= parameters.low_volume_max_clicks
    ):
        action = "INCREASE_BID"
        reason = (
            f"已有 {orders} 单、ACOS {acos:.1f}%，但仅 {clicks} 次点击；"
            "预算尚未跑满，建议核心词竞价提高 5%–10% 测试起量。"
        )
    elif (
        acos is not None
        and orders >= parameters.winner_min_orders
        and acos <= parameters.target_acos_percent * 0.75
        and inventory_supports_scale
    ):
        action = "EXPAND_WINNER"
        reason = f"ACOS {acos:.1f}% 且订单量充足，预算未形成限制，优先扩关键词和投放范围。"
    elif clicks < 10 and spend < parameters.minimum_evidence_spend:
        action = "NO_CHANGE_LOW_DATA"
        reason = "尚无足够转化证据，继续积累数据，不直接提高竞价或预算。"
    else:
        action = "MONITOR"
        reason = "当前没有触发调整阈值，继续观察。"

    return {
        "acos": round(acos, 2) if acos is not None else None,
        "roas": round(advertising_sales / spend, 2) if spend > 0 else None,
        "ctr": round(ctr, 2) if ctr is not None else None,
        "conversionRate": round(conversion_rate, 2) if conversion_rate is not None else None,
        "averageDailySpend": round(average_daily_spend, 2),
        "budgetUtilizationPercent": round(budget_utilization, 2) if budget_utilization is not None else None,
        "action": action,
        "reason": reason,
    }
