import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import openpyxl

from store_ops.config import ProjectConfig
from store_ops.db import StateDb
from store_ops.jobs.profitability_snapshot import run


class ProfitabilityHistoryTests(unittest.TestCase):
    def test_single_market_import_preserves_other_months_and_returns(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            reports = root / "reports"
            reports.mkdir()
            (reports / "profitability.json").write_text(json.dumps({"rows": [{"market": "CA", "reportMonth": "2026-07", "sku": "MA001", "productSales": 100}], "sources": []}))
            for month in [7, 8]:
                book = openpyxl.Workbook()
                sheet = book.active
                sheet.title = "SKU销售汇总"
                sheet.append([])
                sheet.append([])
                sheet.append([])
                sheet.append(["MA001", 10, 200, 150, None, 12, None, None, 40, 110, None, -20, -5, 85])
                book.save(root / f"2026.{month}月-Measureman销售和毛利报告-US.xlsx")
            config = ProjectConfig(root / "config.json", root, root, root, r"(MA\d{3})", frozenset(), (), {})
            db = StateDb(root / "db" / "operations.sqlite3")
            db.init()
            try:
                with patch.dict(os.environ, {"STORE_OPS_PROFITABILITY_ROOT": str(root)}):
                    run(config, db)
                    run(config, db)
            finally:
                db.close()
            value = json.loads((reports / "profitability.json").read_text())
            self.assertEqual(len(value["rows"]), 3)
            us = [row for row in value["rows"] if row["market"] == "US"]
            self.assertEqual([row["reportMonth"] for row in us], ["2026-07", "2026-08"])
            self.assertEqual(us[0]["returns"], 12)
            self.assertIsNone(us[0]["currentPrice"])
            self.assertEqual(us[0]["averagePrice"], 20)
