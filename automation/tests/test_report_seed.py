import json
import tempfile
import unittest
from pathlib import Path

from store_ops.report_seed import seed_reports


class ReportSeedTests(unittest.TestCase):
    def test_upgrades_legacy_research_snapshot_when_import_has_more_candidates(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            imported = root / "imported"
            runtime = root / "runtime"
            imported.mkdir()
            runtime.mkdir()
            (runtime / "new_product_research.json").write_text(json.dumps({"summary": {"candidateCount": 5}, "candidates": [{"sku": str(index)} for index in range(5)]}), encoding="utf-8")
            (imported / "new_product_research.json").write_text(json.dumps({"summary": {"candidateCount": 143}, "candidates": [{"sku": str(index)} for index in range(143)]}), encoding="utf-8")

            actions = seed_reports(imported, runtime)

            result = json.loads((runtime / "new_product_research.json").read_text())
            self.assertEqual(len(result["candidates"]), 143)
            self.assertEqual(actions, ["upgraded:new_product_research.json:5->143"])

    def test_preserves_newer_research_snapshot_when_import_is_smaller(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            imported = root / "imported"
            runtime = root / "runtime"
            imported.mkdir()
            runtime.mkdir()
            (runtime / "new_product_research.json").write_text(json.dumps({"candidates": [{"sku": str(index)} for index in range(10)]}), encoding="utf-8")
            (imported / "new_product_research.json").write_text(json.dumps({"candidates": [{"sku": str(index)} for index in range(5)]}), encoding="utf-8")

            self.assertEqual(seed_reports(imported, runtime), [])
            result = json.loads((runtime / "new_product_research.json").read_text())
            self.assertEqual(len(result["candidates"]), 10)

    def test_backfills_only_missing_shipment_history_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            imported = root / "imported"
            runtime = root / "runtime"
            imported.mkdir()
            runtime.mkdir()
            current = {"shipmentHistory": [{"market": "US", "batch": 320, "shipmentDate": "2026-07-10", "sku": "MA001", "quantity": 10}], "coverage": {}, "sources": {"shipments": ["current.xlsx"]}, "purchaseOrderLots": [{"poNumber": "KEEP"}]}
            incoming = {"shipmentHistory": [{"market": "US", "batch": 320, "shipmentDate": "2026-07-10", "sku": "MA001", "quantity": 12}, {"market": "CA", "batch": 321, "shipmentDate": "2026-07-14", "sku": "MA002", "quantity": 20}], "sources": {"shipments": ["imported.xlsx"]}, "purchaseOrderLots": [{"poNumber": "DO-NOT-REPLACE"}]}
            (runtime / "document_master.json").write_text(json.dumps(current), encoding="utf-8")
            (imported / "document_master.json").write_text(json.dumps(incoming), encoding="utf-8")

            actions = seed_reports(imported, runtime)

            result = json.loads((runtime / "document_master.json").read_text())
            self.assertEqual(len(result["shipmentHistory"]), 2)
            self.assertEqual(result["shipmentHistory"][0]["quantity"], 10)
            self.assertEqual(result["shipmentHistory"][1]["quantity"], 20)
            self.assertEqual(result["coverage"]["shipmentHistoryEvents"], 2)
            self.assertEqual(result["sources"]["shipments"], ["current.xlsx", "imported.xlsx"])
            self.assertEqual(result["purchaseOrderLots"], [{"poNumber": "KEEP"}])
            self.assertEqual(actions, ["backfilled:document_master.json:+1"])


if __name__ == "__main__":
    unittest.main()
