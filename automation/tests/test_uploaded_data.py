from store_ops.report_versions import current_reports
import json
import tempfile
import unittest
from pathlib import Path

import openpyxl

from store_ops.uploaded_data import inspect_batch, publish_batch, restore_version, receive_wps_download, auto_publish_wps
from store_ops.config import load_config
from dataclasses import replace


def dashboard(market: str):
    return {
        "schemaVersion": 2,
        "generatedAt": "2026-08-01T00:00:00+00:00",
        "market": market,
        "summary": {"fbaSellable": 5, "localInventory": 10},
        "rows": [{"sku": "MA001", "productName": "旧名称", "fbaSellable": 5, "localInventory": 10, "pendingOrderQty": 2, "domesticSupplyTotal": 12, "dailySales": 1, "salesHistoryByMonth": [], "salesByMonth": []}],
    }


class UploadedDataTests(unittest.TestCase):
    def test_confirmed_wps_actual_inventory_adds_skus_without_double_counting_or_history_loss(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = replace(load_config(Path(__file__).parents[1] / "config/project.json"), runtime_root=root)
            reports = root / "reports"
            reports.mkdir()
            old = dashboard("US")
            old["snapshots"] = {"fbaDate": "2026-07-14", "awdDate": "2026-06-26", "staleAfterDays": 14}
            old["rows"][0]["pendingOrders"] = [{"poNumber": "manual-kept"}]
            old["rows"][0]["salesHistoryByMonth"] = [{"month": "2026-09", "units": 17}]
            old["rows"].append({**old["rows"][0], "sku": "MA003"})
            (reports / "inventory_dashboard.json").write_text(json.dumps(old))
            (reports / "inventory_dashboard.ca.json").write_text(json.dumps(dashboard("CA")))
            history = {"shipmentHistory": [{"manual": True}], "purchaseOrderLots": [{"manual": True}]}
            (reports / "document_master.json").write_text(json.dumps(history))
            book = openpyxl.Workbook()
            us = book.active
            us.title = "库存规划"
            us.append(["SKU", "品名", "工厂", "箱规", "工厂库存及已下订单", "FBA库存", "AWD备货", "FBA+在途库存", "最近月销售", "参考月销"])
            us.append(["MA001", "真实名称", "工厂甲", 12, 30, 20, 8, 50, 60, 50])
            us.append(["MA002", "新增产品", "工厂乙", 24, 10, 3, 2, 10, 30, 20])
            ca = book.create_sheet("加拿大库存计划 ")
            ca.append(["SKU", "品名", "工厂库存及已下订单", "FBA库存", "FBA+在途库存", "最近月销"])
            ca.append(["MA001", "加拿大", 999, 15, 45, 30])
            source = root / "wps-inventory-20261012.xlsx"
            book.save(source)
            before = source.read_bytes()
            unconfirmed = receive_wps_download(config, source, "https://www.kdocs.cn/l/Example123")
            publish_batch(root / "uploads" / unconfirmed["batchId"], reports, root / "snapshots")
            planning = json.loads((current_reports(reports) / "inventory_dashboard.json").read_text())
            self.assertEqual(planning["rows"][0]["fbaSellable"], 5)
            self.assertEqual(planning["snapshots"]["fbaDate"], "2026-07-14")
            self.assertEqual(len(planning["rows"]), 2)
            self.assertTrue(planning["snapshots"]["businessDateUnknown"])
            preview = receive_wps_download(config, source, "https://www.kdocs.cn/l/Example123", confirmed_inventory_date="2026-10-12", inventory_scope="actual")
            self.assertEqual(preview["source"]["confirmedInventoryDate"], "2026-10-12")
            published = publish_batch(root / "uploads" / preview["batchId"], reports, root / "snapshots")
            current = current_reports(reports)
            us_report = json.loads((current / "inventory_dashboard.json").read_text())
            rows = {row["sku"]: row for row in us_report["rows"]}
            self.assertEqual(rows["MA001"]["inTransitInventory"], 22)
            self.assertEqual(rows["MA001"]["awdAvailable"], 8)
            self.assertEqual(rows["MA001"]["domesticSupplyTotal"], 30)
            self.assertEqual(rows["MA001"]["localInventory"], 10)
            self.assertEqual(rows["MA001"]["pendingOrderQty"], 2)
            self.assertEqual(rows["MA001"]["readyToShipQty"], 0)
            self.assertEqual(rows["MA001"]["pendingOrders"], [{"poNumber": "manual-kept"}])
            self.assertEqual(rows["MA001"]["salesHistoryByMonth"], [{"month": "2026-09", "units": 17}])
            self.assertEqual(rows["MA001"]["inventorySnapshotDate"], "2026-10-12")
            self.assertEqual(rows["MA003"]["inventorySnapshotDate"], "2026-07-14")
            self.assertEqual(rows["MA002"]["salesHistoryByMonth"], [])
            self.assertEqual(rows["MA002"]["factory"], "工厂乙")
            self.assertEqual(rows["MA002"]["cartonQty"], 24)
            self.assertAlmostEqual(rows["MA002"]["dailySales"], 1)
            self.assertFalse(rows["MA002"]["domesticSupplyBreakdownVerified"])
            self.assertTrue(us_report["snapshots"]["inTransitConfirmed"])
            self.assertTrue(us_report["snapshots"]["awdAvailableConfirmed"])
            self.assertEqual(next(item for item in us_report["sources"] if item["kind"] == "fba_inventory")["sha256"], preview["source"]["sha256"])
            ca_report = json.loads((current / "inventory_dashboard.ca.json").read_text())
            self.assertEqual(ca_report["rows"][0]["inTransitInventory"], 30)
            self.assertEqual(ca_report["rows"][0]["domesticSupplyTotal"], 30)
            self.assertEqual(json.loads((current / "document_master.json").read_text()), history)
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(set(published["updatedReports"]), {"inventory_dashboard.json", "inventory_dashboard.ca.json"})

    def test_actual_wps_inventory_requires_explicit_valid_date_and_matching_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            config = replace(load_config(Path(__file__).parents[1] / "config/project.json"), runtime_root=Path(folder))
            for arguments in ({"inventory_scope": "actual"}, {"inventory_scope": "actual", "confirmed_inventory_date": "2026-02-30"},
                              {"confirmed_inventory_date": "2026-10-12"}, {"inventory_scope": "unexpected"}):
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    receive_wps_download(config, Path(folder) / "not-read.xlsx", "https://www.kdocs.cn/l/Example123", **arguments)

    def test_authorized_wps_sync_requires_first_review_then_publishes_only_planning_with_valid_lease(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = replace(load_config(Path(__file__).parents[1] / "config/project.json"), runtime_root=root / "runtime")
            reports, snapshots = config.runtime_root / "reports", config.runtime_root / "snapshots"
            reports.mkdir(parents=True)
            (reports / "inventory_dashboard.json").write_text(json.dumps(dashboard("US")))
            source = root / "库存规划.xlsx"
            def write_source(quantity, reference=30):
                book = openpyxl.Workbook()
                book.active.title = "库存规划"
                book.active.append(["SKU", "品名", "工厂库存及已下订单", "参考月销", "FBA库存", "FBA+在途库存"])
                book.active.append(["MA001", "产品", quantity, reference, 999, 1999])
                book.save(source)
            write_source(30)
            first = receive_wps_download(config, source, "https://www.kdocs.cn/l/Example123", file_token="authorized-file")
            self.assertEqual(first["source"]["authentication"], "official-oauth")
            batch = config.runtime_root / "uploads" / first["batchId"]
            self.assertEqual(auto_publish_wps(batch, reports, snapshots, "task", "lease")["status"], "awaiting_review")
            publish_batch(batch, reports, snapshots)
            current = json.loads((current_reports(reports) / "inventory_dashboard.json").read_text())
            self.assertEqual(current["rows"][0]["fbaSellable"], 5)
            self.assertEqual(current["rows"][0]["localInventory"], 10)
            self.assertEqual(current["rows"][0]["domesticSupplyTotal"], 30)  # not 30 + pending orders
            write_source(45)
            second = receive_wps_download(config, source, "https://www.kdocs.cn/l/Example123", file_token="authorized-file")
            batch = config.runtime_root / "uploads" / second["batchId"]
            with sqlite3.connect(config.runtime_root / "db" / "operations.sqlite3") as db:
                db.executescript("CREATE TABLE data_refresh_tasks_v1(id TEXT,kind TEXT,request_json TEXT,lease TEXT,status TEXT,updated_at TEXT); INSERT INTO data_refresh_tasks_v1 VALUES('task','wps_inventory','{\"scheduled\":true}','lease','running','2000'); CREATE TABLE data_sync_schedules_v1(key TEXT,enabled INTEGER,auto_publish INTEGER,last_task_id TEXT); INSERT INTO data_sync_schedules_v1 VALUES('wps_inventory',1,1,'task');")
            with self.assertRaisesRegex(ValueError, "租约"):
                auto_publish_wps(batch, reports, snapshots, "task", "wrong")
            result = auto_publish_wps(batch, reports, snapshots, "task", "lease")
            self.assertEqual(result["status"], "completed")
            current = json.loads((current_reports(reports) / "inventory_dashboard.json").read_text())
            self.assertEqual(current["rows"][0]["domesticSupplyTotal"], 45)
            self.assertEqual(current["rows"][0]["fbaSellable"], 5)
            self.assertEqual(current["rows"][0]["referenceMonthlySales"], 30)
            write_source(-1)
            invalid = receive_wps_download(config, source, "https://www.kdocs.cn/l/Example123", file_token="authorized-file")
            self.assertEqual(invalid["status"], "needs_review")
            self.assertEqual(auto_publish_wps(config.runtime_root / "uploads" / invalid["batchId"], reports, snapshots, "task", "lease")["status"], "awaiting_review")
            write_source(45)
            book = openpyxl.load_workbook(source)
            book.active.append(["unrecognized-sku", "新增产品", 10, 30, 0, 0])
            book.save(source); book.close()
            skipped = receive_wps_download(config, source, "https://www.kdocs.cn/l/Example123", file_token="authorized-file")
            self.assertEqual(skipped["status"], "needs_review")
            self.assertEqual(skipped["files"][0]["preview"]["markets"]["US"]["skipped"]["invalidSku"], 1)
            self.assertEqual(auto_publish_wps(config.runtime_root / "uploads" / skipped["batchId"], reports, snapshots, "task", "lease")["status"], "awaiting_review")

    def test_shipment_upload_adds_sku_history_to_document_master(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            batch = root / "batch-ship123456"
            source = batch / "source"
            reports = root / "reports"
            snapshots = root / "snapshots"
            source.mkdir(parents=True)
            reports.mkdir()
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet.title = "Measureman"
            sheet["B2"] = "产品编号"
            sheet["B3"] = "MA001"
            sheet["D3"] = 10
            sheet["K3"] = 120
            workbook.save(source / "CM320-US2026.7.10发货清单.xlsx")
            (reports / "document_master.json").write_text(json.dumps({
                "generatedAt": "2026-08-01T00:00:00+00:00",
                "logistics": {"US": {}, "CA": {}},
                "shipmentHistory": [],
                "coverage": {"shipmentHistoryEvents": 0},
                "sources": {"shipments": []},
            }), encoding="utf-8")

            preview = inspect_batch(batch)

            self.assertEqual(preview["files"][0]["type"], "shipment")
            self.assertTrue(preview["files"][0]["publishable"])
            self.assertEqual(preview["files"][0]["preview"]["shipmentEventCount"], 1)
            published = publish_batch(batch, reports, snapshots)
            self.assertEqual(published["updatedReports"], ["document_master.json"])
            report = json.loads((current_reports(reports) / "document_master.json").read_text())
            self.assertEqual(report["coverage"]["shipmentHistoryEvents"], 1)
            self.assertEqual(report["shipmentHistory"][0]["sku"], "MA001")
            self.assertEqual(report["shipmentHistory"][0]["quantity"], 120)

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
            sheet.append(["SKU", "品名", "工厂库存及已下订单", "FBA库存", "FBA+在途库存", "最近月销售"])
            sheet.append(["MA001", "新名称", 30, 20, 50, 60])
            ca = workbook.create_sheet("加拿大库存计划 ")
            ca.append(["SKU", "品名", "工厂库存及已下订单", "FBA库存", "FBA+在途库存", "最近月销"])
            ca.append(["MA001", "新名称", 25, 15, 45, 30])
            workbook.save(source / "库存规划20260813.xlsx")
            (reports / "inventory_dashboard.json").write_text(json.dumps(dashboard("US")), encoding="utf-8")
            (reports / "inventory_dashboard.ca.json").write_text(json.dumps(dashboard("CA")), encoding="utf-8")

            preview = inspect_batch(batch)
            self.assertEqual(preview["summary"]["recognizedCount"], 1)
            self.assertEqual(preview["files"][0]["preview"]["markets"]["US"]["skuCount"], 1)

            published = publish_batch(batch, reports, snapshots)
            self.assertEqual(set(published["updatedReports"]), {"inventory_dashboard.json", "inventory_dashboard.ca.json"})
            current = json.loads((current_reports(reports) / "inventory_dashboard.json").read_text())
            self.assertEqual(current["rows"][0]["fbaSellable"], 20)
            self.assertEqual(current["rows"][0]["inTransitInventory"], 30)
            self.assertEqual(current["rows"][0]["localInventory"], 30)
            self.assertEqual(current["rows"][0]["planningMonthlySales"], 60)
            self.assertEqual(current["rows"][0]["salesByMonth"], [])
            self.assertEqual(current["rows"][0]["dailySales"], 1)
            self.assertEqual(current["snapshots"]["fbaDate"], "2026-08-13")
            self.assertEqual(current["parameters"]["targetCoverDays"], 90)

            restored = restore_version(published["dataVersion"], reports, snapshots)
            self.assertIn("inventory_dashboard.json", restored["restoredReports"])
            previous = json.loads((current_reports(reports) / "inventory_dashboard.json").read_text())
            self.assertEqual(previous["rows"][0]["fbaSellable"], 5)

    def test_wps_download_received_readonly_with_provenance_and_audit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = replace(load_config(Path(__file__).parents[1] / "config/project.json"), runtime_root=root / "runtime")
            source = root / "库存规划.xlsx"
            workbook = openpyxl.Workbook()
            workbook.active.title = "库存规划"
            workbook.active.append(["SKU", "品名", "参考月销"])
            workbook.active.append(["MA001", "产品", 10])
            workbook.save(source)
            original = source.read_bytes()
            result = receive_wps_download(config, source, "https://www.kdocs.cn/l/cg2kkbtoinHk")
            self.assertEqual(source.read_bytes(), original)
            self.assertIsNone(result["source"]["businessAsOf"])
            self.assertEqual(result["source"]["sha256"], result["files"][0]["sha256"])
            self.assertEqual(result["status"], "needs_review")
            self.assertFalse((config.runtime_root / "reports/current.json").exists())
            with self.assertRaises(ValueError):
                receive_wps_download(config, source, "https://attacker.invalid/l/test")

    def test_advertising_upload_replaces_month_and_publishes_latest_campaigns(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            batch = root / "batch-ads123456"
            source = batch / "source"
            reports = root / "reports"
            snapshots = root / "snapshots"
            source.mkdir(parents=True)
            reports.mkdir()
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet.title = "按月"
            sheet.append(["数据开始时间", "数据结束时间", "国家", "广告活动", "状态", "预算", "曝光量", "点击量", "花费", "广告总销售额", "广告总订单量"])
            sheet.append(["2026-08-01", "2026-08-11", "US", "MA001 核心词", "正在投放", 20, 1000, 50, 25, 100, 5])
            workbook.save(source / "广告活动报表-按月-20260813.xlsx")
            current = dashboard("US")
            current["snapshots"] = {"fbaDate": "2026-08-13"}
            current["rows"][0]["riskLevel"] = "healthy"
            current["rows"][0]["daysCoverNetwork"] = 90
            current["advertising"] = {
                "parameters": {"targetAcosPercent": 30},
                "latestMonth": "2026-07",
                "monthlySeries": [{"month": "2026-07", "spend": 10, "advertisingSales": 50, "orders": 2, "clicks": 20, "impressions": 500, "acos": 20, "roas": 5}],
                "campaigns": [],
            }
            current["sources"] = []
            (reports / "inventory_dashboard.json").write_text(json.dumps(current), encoding="utf-8")

            preview = inspect_batch(batch)
            self.assertTrue(preview["files"][0]["publishable"])
            published = publish_batch(batch, reports, snapshots)
            self.assertEqual(published["updatedReports"], ["inventory_dashboard.json"])
            updated = json.loads((current_reports(reports) / "inventory_dashboard.json").read_text())
            self.assertEqual(updated["advertising"]["latestMonth"], "2026-08")
            self.assertEqual(updated["advertising"]["monthlySeries"][-1]["spend"], 25)
            self.assertEqual(updated["advertising"]["campaigns"][0]["sku"], "MA001")


if __name__ == "__main__":
    unittest.main()
