import unittest
import tempfile
from pathlib import Path

import openpyxl

from store_ops.jobs.local_sources import _apply_shipment_events_to_lots, _planning_shipment_totals


class LocalSourceRefreshTests(unittest.TestCase):
    def test_duplicate_planning_columns_are_not_double_counted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "库存规划20260714.xlsx"
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet.title = "加拿大库存计划 "
            sheet.append(["SKU", "20260714发货（CM321）", "20260714发货（CM321）"])
            sheet.append(["MA001", 100, 100])
            sheet.append(["MA002", 50, 50])
            workbook.save(path)
            workbook.close()
            self.assertEqual(_planning_shipment_totals(path)[("CA", 321)], 150)

    def test_shipment_consumes_only_orders_ready_by_shipment_date(self):
        lots = [
            {"sku": "MA001", "poNumber": "AM260601-1", "poDate": "2026-06-01", "availableQuantity": 80, "previouslyShippedQuantity": 20},
            {"sku": "MA001", "poNumber": "AM260720-1", "poDate": "2026-07-20", "availableQuantity": 100, "previouslyShippedQuantity": 0},
        ]
        unmatched = _apply_shipment_events_to_lots(lots, [{
            "market": "CA",
            "batch": 321,
            "shipmentDate": "2026-07-14",
            "sku": "MA001",
            "quantity": 100,
        }])
        self.assertEqual(lots[0]["availableQuantity"], 0)
        self.assertEqual(lots[0]["previouslyShippedQuantity"], 100)
        self.assertEqual(lots[1]["availableQuantity"], 100)
        self.assertEqual(unmatched, 20)


if __name__ == "__main__":
    unittest.main()
