from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class ReplenishmentParameters:
    lead_time_days: int = 75
    review_cycle_days: int = 7
    target_cover_days: int = 45
    safety_stock_days: int = 21
    excess_cover_days: int = 240
    fba_transfer_trigger_days: int = 30


def round_up_to_pack(quantity: float, carton_quantity: int | None) -> int:
    if quantity <= 0:
        return 0
    pack = carton_quantity if carton_quantity and carton_quantity > 0 else 1
    return int(math.ceil(quantity / pack) * pack)


def calculate_replenishment(
    *,
    daily_sales: float,
    fba_sellable: int,
    awd_available: int,
    awd_outbound_to_fba: int,
    carton_quantity: int | None,
    parameters: ReplenishmentParameters,
) -> dict:
    eligible_inventory = max(0, fba_sellable) + max(0, awd_available) + max(0, awd_outbound_to_fba)
    fba_cover = fba_sellable / daily_sales if daily_sales > 0 else None
    network_cover = eligible_inventory / daily_sales if daily_sales > 0 else None

    horizon_days = (
        parameters.lead_time_days
        + parameters.review_cycle_days
        + parameters.target_cover_days
        + parameters.safety_stock_days
    )
    gross_need = max(0.0, daily_sales * horizon_days - eligible_inventory)
    suggested_shipment = round_up_to_pack(gross_need, carton_quantity)
    fba_target = daily_sales * parameters.fba_transfer_trigger_days
    transfer_need = max(0.0, fba_target - fba_sellable - awd_outbound_to_fba)
    transfer_quantity = min(
        max(0, awd_available),
        round_up_to_pack(transfer_need, carton_quantity),
    )

    if daily_sales <= 0:
        action = "REVIEW_DATA"
        reason = "缺少可用日销，无法计算补货节奏。"
    elif not carton_quantity or carton_quantity <= 0:
        action = "REVIEW_DATA"
        reason = "缺少有效装箱量，建议数量不能按整箱取整。"
    elif network_cover is not None and network_cover > parameters.excess_cover_days:
        action = "HOLD_EXCESS"
        reason = f"可计入库存覆盖约 {network_cover:.0f} 天，超过 {parameters.excess_cover_days} 天上限。"
    elif network_cover is not None and network_cover < parameters.lead_time_days:
        action = "URGENT_AIR_OR_TRANSFER"
        reason = f"可计入库存仅覆盖约 {network_cover:.0f} 天，早于 {parameters.lead_time_days} 天海运到货。"
    elif fba_cover is not None and fba_cover < parameters.fba_transfer_trigger_days and transfer_quantity > 0:
        action = "AWD_TRANSFER"
        reason = f"FBA 仅覆盖约 {fba_cover:.0f} 天，可先从 AWD 调拨。"
    elif suggested_shipment > 0:
        action = "SEA_SHIP"
        reason = f"按 {horizon_days} 天补货视窗计算，建议安排海运补货。"
    else:
        action = "NO_ACTION"
        reason = "当前可计入库存可覆盖补货视窗，暂不新增发货。"

    if daily_sales <= 0:
        risk_level = "data"
    elif network_cover is not None and network_cover < parameters.lead_time_days:
        risk_level = "critical"
    elif network_cover is not None and network_cover < parameters.lead_time_days + parameters.target_cover_days:
        risk_level = "watch"
    elif network_cover is not None and network_cover > parameters.excess_cover_days:
        risk_level = "excess"
    else:
        risk_level = "healthy"

    return {
        "eligibleInventoryPosition": eligible_inventory,
        "daysCoverFba": round(fba_cover, 1) if fba_cover is not None else None,
        "daysCoverNetwork": round(network_cover, 1) if network_cover is not None else None,
        "suggestedShipmentQty": suggested_shipment,
        "suggestedAwdTransferQty": transfer_quantity,
        "action": action,
        "riskLevel": risk_level,
        "reason": reason,
    }
