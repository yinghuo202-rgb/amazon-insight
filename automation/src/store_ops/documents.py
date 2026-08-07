from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable


@dataclass(frozen=True)
class PurchaseOrderLot:
    po_number: str
    po_date: date
    sku: str
    factory: str
    ordered_quantity: int
    previously_shipped_quantity: int
    unit_price: float
    product_name: str = ""

    @property
    def available_quantity(self) -> int:
        return max(0, self.ordered_quantity - self.previously_shipped_quantity)


@dataclass(frozen=True)
class PurchaseOrderAllocation:
    po_number: str
    po_date: date
    sku: str
    factory: str
    quantity: int
    unit_price: float
    product_name: str


class PurchaseOrderShortage(ValueError):
    def __init__(self, sku: str, requested: int, available: int):
        self.sku = sku
        self.requested = requested
        self.available = available
        super().__init__(f"{sku} 采购订单可分配数量不足：需要 {requested}，可用 {available}")


def allocate_purchase_orders_fifo(
    sku: str,
    requested_quantity: int,
    lots: Iterable[PurchaseOrderLot],
    *,
    factory: str | None = None,
) -> list[PurchaseOrderAllocation]:
    """按采购日期和订单号稳定分配，任何缺口都显式失败。"""
    if requested_quantity <= 0:
        raise ValueError("requested_quantity 必须大于 0")
    normalized_sku = sku.strip().upper()
    normalized_factory = (factory or "").strip()
    eligible = [
        lot
        for lot in lots
        if lot.sku.strip().upper() == normalized_sku
        and (not normalized_factory or lot.factory.strip() == normalized_factory)
        and lot.available_quantity > 0
    ]
    eligible.sort(key=lambda item: (item.po_date, item.po_number, item.factory, item.unit_price))
    available = sum(item.available_quantity for item in eligible)
    if available < requested_quantity:
        raise PurchaseOrderShortage(normalized_sku, requested_quantity, available)

    remaining = requested_quantity
    allocations: list[PurchaseOrderAllocation] = []
    for lot in eligible:
        quantity = min(remaining, lot.available_quantity)
        if quantity <= 0:
            continue
        allocations.append(
            PurchaseOrderAllocation(
                po_number=lot.po_number,
                po_date=lot.po_date,
                sku=normalized_sku,
                factory=lot.factory,
                quantity=quantity,
                unit_price=lot.unit_price,
                product_name=lot.product_name,
            )
        )
        remaining -= quantity
        if remaining == 0:
            break
    return allocations
