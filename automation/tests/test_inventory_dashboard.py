import tempfile
import unittest
from datetime import date
from pathlib import Path

import openpyxl

from store_ops.jobs.inventory_dashboard import _read_sales_from_master, _reconcile_domestic_supply
from store_ops.sku import SkuNormalizer


class DomesticSupplyReconciliationTests(unittest.TestCase):
    def test_splits_combined_quantity_using_newest_open_orders_first(self):
        lots = [
            {"poNumber": "AM250101-1", "poDate": "2025-01-01", "factory": "A", "orderedQuantity": 80, "availableQuantity": 50},
            {"poNumber": "AM250201-1", "poDate": "2025-02-01", "factory": "B", "orderedQuantity": 80, "availableQuantity": 80},
        ]

        result = _reconcile_domestic_supply(100, lots, 45, as_of=date(2025, 4, 1))

        self.assertEqual(result["localInventory"], 0)
        self.assertEqual(result["pendingOrderQty"], 100)
        self.assertEqual([order["remainingQuantity"] for order in result["pendingOrders"]], [80, 20])
        self.assertEqual(result["pendingOrders"][0]["poNumber"], "AM250201-1")
        self.assertTrue(result["pendingOrders"][0]["overdue"])

    def test_leaves_unmatched_combined_quantity_as_on_hand(self):
        result = _reconcile_domestic_supply(
            120,
            [{"poNumber": "AM250301-1", "poDate": "2025-03-01", "factory": "A", "orderedQuantity": 30, "availableQuantity": 30}],
            45,
            as_of=date(2025, 3, 20),
        )

        self.assertEqual(result["localInventory"], 90)
        self.assertEqual(result["pendingOrderQty"], 30)
        self.assertFalse(result["pendingOrders"][0]["overdue"])

    def test_marks_order_overdue_only_after_day_45(self):
        lot = {"poNumber": "AM250101-1", "poDate": "2025-01-01", "factory": "A", "orderedQuantity": 10, "availableQuantity": 10}

        due_day = _reconcile_domestic_supply(10, [lot], 45, as_of=date(2025, 2, 15))
        next_day = _reconcile_domestic_supply(10, [lot], 45, as_of=date(2025, 2, 16))

        self.assertFalse(due_day["pendingOrders"][0]["overdue"])
        self.assertTrue(next_day["pendingOrders"][0]["overdue"])

    def test_includes_latest_archive_order_not_yet_reflected_in_combined_quantity(self):
        source = "一店/采购订单/最新采购订单.zip"
        result = _reconcile_domestic_supply(
            20,
            [{
                "poNumber": "AM260720-1",
                "poDate": "2026-07-20",
                "factory": "A",
                "orderedQuantity": 80,
                "availableQuantity": 80,
                "sourcePath": f"{source}::订单.xlsx",
            }],
            45,
            as_of=date(2026, 7, 18),
            latest_archive_source=source,
        )

        self.assertEqual(result["localInventory"], 0)
        self.assertEqual(result["pendingOrderQty"], 80)
        self.assertEqual(result["unreflectedLatestOrderQty"], 60)
        self.assertEqual(result["pendingOrders"][0]["remainingQuantity"], 80)


class PlanningWorkbookSalesTests(unittest.TestCase):
    def test_reads_latest_completed_month_sales(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "库存规划20260714.xlsx"
            workbook = openpyxl.Workbook()
            worksheet = workbook.active
            worksheet.title = "库存规划"
            worksheet.append(["MSKU", "品名", "最近月销售"])
            worksheet.append(["MA001", "产品一", 62])
            worksheet.append(["MA001_US", "产品一变体", 31])
            worksheet.append(["MA002", "产品二", 0])
            workbook.save(path)

            normalizer = SkuNormalizer(r"(?<![A-Z0-9])([A-Z]{2}\s*[-_]?\s*\d{3})(?!\d)", [""])
            sales, months, history = _read_sales_from_master(
                path,
                "库存规划",
                "2026-06",
                "最近月销售",
                normalizer,
            )

            self.assertEqual(months, ["2026-06"])
            self.assertEqual(sales["MA001"]["salesByMonth"][0]["units"], 93)
            self.assertEqual(sales["MA001"]["dailySales"], 3.1)
            self.assertEqual(history["MA002"]["2026-06"], 0)


if __name__ == "__main__":
    unittest.main()
