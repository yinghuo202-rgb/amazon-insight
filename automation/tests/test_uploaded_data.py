import json
import tempfile
import unittest
from pathlib import Path

import openpyxl

from store_ops.uploaded_data import inspect_batch, publish_batch, restore_version


def dashboard(market: str):
    return {
        "schemaVersion": 2,
        "generatedAt": "2026-08-01T00:00:00+00:00",
        "market": market,
        "summary": {"fbaSellable": 5, "localInventory": 10},
        "rows": [{"sku": "MA001", "productName": "旧名称", "fbaSellable": 5, "localInventory": 10, "pendingOrderQty": 2, "domesticSupplyTotal": 12, "dailySales": 1, "salesHistoryByMonth": [], "salesByMonth": []}],
    }


class UploadedDataTests(unittest.TestCase):
    def test_inventory_upload_previews_publishes_and_restores(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            batch = root / "batch-test123456"
            source = batch / "source"
            reports = root / "reports"
            snapshots = root / "snapshots"
            source.mkdir(parents=True)
            reports.mkdir()
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet.title = "库存规划"
            sheet.append(["SKU", "品名", "工厂库存及已下订单", "FBA库存", "最近月销售"])
            sheet.append(["MA001", "新名称", 30, 20, 60])
            ca = workbook.create_sheet("加拿大库存计划 ")
            ca.append(["SKU", "品名", "工厂库存及已下订单", "FBA库存", "最近月销"])
            ca.append(["MA001", "新名称", 25, 15, 30])
            workbook.save(source / "库存规划20260813.xlsx")
            (reports / "inventory_dashboard.json").write_text(json.dumps(dashboard("US")), encoding="utf-8")
            (reports / "inventory_dashboard.ca.json").write_text(json.dumps(dashboard("CA")), encoding="utf-8")

            preview = inspect_batch(batch)
            self.assertEqual(preview["summary"]["recognizedCount"], 1)
            self.assertEqual(preview["files"][0]["preview"]["markets"]["US"]["skuCount"], 1)

            published = publish_batch(batch, reports, snapshots)
            self.assertEqual(set(published["updatedReports"]), {"inventory_dashboard.json", "inventory_dashboard.ca.json"})
            current = json.loads((reports / "inventory_dashboard.json").read_text())
            self.assertEqual(current["rows"][0]["fbaSellable"], 20)
            self.assertEqual(current["rows"][0]["localInventory"], 30)
            self.assertEqual(current["rows"][0]["salesByMonth"][0]["units"], 60)

            restored = restore_version(published["dataVersion"], reports, snapshots)
            self.assertIn("inventory_dashboard.json", restored["restoredReports"])
            previous = json.loads((reports / "inventory_dashboard.json").read_text())
            self.assertEqual(previous["rows"][0]["fbaSellable"], 5)


if __name__ == "__main__":
    unittest.main()
