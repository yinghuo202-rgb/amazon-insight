import tempfile
import unittest
from pathlib import Path

import openpyxl

from store_ops.config import ProjectConfig
from store_ops.jobs.document_master import _read_purchase_order_summary
from store_ops.jobs.inventory_dashboard import _read_fba_from_master
from store_ops.sku import SkuNormalizer


class LatestWorkbookImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.normalizer = SkuNormalizer(r"(?<![A-Z0-9])([A-Z]{2}\s*[-_]?\s*\d{3})(?!\d)", frozenset())

    def tearDown(self):
        self.temporary.cleanup()

    def config(self, workbook: Path) -> ProjectConfig:
        return ProjectConfig(
            config_path=self.root / "project.json",
            project_root=self.root,
            data_root=self.root,
            runtime_root=self.root / "runtime",
            sku_pattern=r"(?<![A-Z0-9])([A-Z]{2}\s*[-_]?\s*\d{3})(?!\d)",
            ignore_values=frozenset(),
            sources=(),
            inventory_dashboard={
                "document_master_sources": {
                    "purchase_order_summary_workbook": workbook.name,
                }
            },
        )

    def test_purchase_summary_inherits_group_context_and_tracks_arrival(self):
        path = self.root / "purchase-summary.xlsx"
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(["时   间", "订单号", "供应商", "采购产品编号", "品名", "采购数量", "采购单价", "到货时间"])
        sheet.append(["2026-07-03", "AM260703-1", "可名", "MA001", "压力表", 100, 31, None])
        sheet.append([None, None, None, "MA002", "压力表", 50, 32, "2026-07-12"])
        workbook.save(path)

        lots, exceptions, _ = _read_purchase_order_summary(self.config(path), self.normalizer)

        self.assertEqual(exceptions, [])
        self.assertEqual([(lot["sku"], lot["poNumber"]) for lot in lots], [("MA001", "AM260703-1"), ("MA002", "AM260703-1")])
        self.assertFalse(lots[0]["received"])
        self.assertTrue(lots[1]["received"])
        self.assertEqual(lots[1]["receivedAt"], "2026-07-12")

    def test_reads_fba_inventory_from_dated_planning_sheet(self):
        path = self.root / "inventory20260714.xlsx"
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "库存规划"
        sheet.append(["MSKU", "FBA库存"])
        sheet.append(["MA001", 123])
        sheet.append(["MA002-2PK", 45])
        workbook.save(path)

        values, invalid = _read_fba_from_master(path, "库存规划", "FBA库存", self.normalizer)

        self.assertEqual(invalid, [])
        self.assertEqual(values["MA001"]["fbaSellable"], 123)
        self.assertEqual(values["MA002"]["fbaSellable"], 45)


if __name__ == "__main__":
    unittest.main()
