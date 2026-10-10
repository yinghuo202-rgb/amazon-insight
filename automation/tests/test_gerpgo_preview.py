import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from store_ops.jobs.gerpgo_preview import build_preview, publish, digest
from store_ops.db import StateDb
from store_ops.report_versions import current_reports, restore_reports

TASK = "d8a4f702-f57b-4aa1-8300-9bfcb005e001"


class GerpgoPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name)
        self.reports = self.runtime / "reports"
        self.reports.mkdir()
        (self.reports / "manual.json").write_text('{"notes":"preserve"}')
        self.folder = self.runtime / "incoming" / "gerpgo" / TASK
        self.folder.mkdir(parents=True)
        self.now = datetime.now(timezone.utc)
        self.month = self.now.strftime("%Y-%m")
        self.previous_month = f"{(self.now.year * 12 + self.now.month - 2) // 12:04d}-{(self.now.year * 12 + self.now.month - 2) % 12 + 1:02d}"
        self.sources = []
        self.source("shops", [{"marketListVos": [{"marketId": 1, "market": "amazon-us"}]}])
        self.source("products", [{"sku": "SKU-A"}])
        self.source("fba", [])
        for offset in range(7):
            absolute = self.now.year * 12 + self.now.month - 1 - offset
            month = f"{absolute // 12:04d}-{absolute % 12 + 1:02d}"
            import calendar
            end = self.now.date().isoformat() if offset == 0 else f"{month}-{calendar.monthrange(absolute // 12, absolute % 12 + 1)[1]:02d}"
            self.source("performance-" + month, [self.row()], {"beginDate": month + "-01", "endDate": end})
        self.manifest()
        db = StateDb(self.runtime / "db" / "operations.sqlite3")
        db.init()
        db.conn.executescript("CREATE TABLE data_refresh_tasks_v1(id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'gerpgo_publish', lease TEXT, status TEXT, updated_at TEXT, created_at TEXT NOT NULL DEFAULT '2000', progress TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', request_json TEXT NOT NULL DEFAULT '{}'); INSERT INTO data_refresh_tasks_v1(id,lease,status,updated_at) VALUES('publish-task','lease','running','2000');")
        db.close()

    def row(self, revenue=100):
        return {"marketId": 1, "sku": "SKU-A", "isParent": False, "unitsOrdered": 40, "returns": None,
                "orderProductSalesAmount": {"currencyAmount": revenue, "currencyCode": "USD"}}

    def source(self, name, rows, condition=None):
        self.sources.append({"name": name, "pages": 1, "total": len(rows), "condition": condition or {}})
        (self.folder / f"{name}-1.json").write_text(json.dumps({"page": 1, "total": len(rows), "rows": rows}))

    def manifest(self):
        (self.folder / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "source": "gerpgo", "taskId": TASK, "capturedAt": self.now.isoformat(), "sources": self.sources}))

    def approval(self, preview):
        return {"sourceTaskId": TASK, "previewHash": preview["previewHash"], "confirmed": True, "taskId": "publish-task", "lease": "lease"}

    def automatic_request(self, preview):
        import sqlite3
        with sqlite3.connect(self.runtime / "db" / "operations.sqlite3") as db:
            db.executescript("CREATE TABLE IF NOT EXISTS data_sync_schedules_v1(key TEXT PRIMARY KEY,enabled INTEGER,auto_publish INTEGER,last_task_id TEXT); INSERT OR REPLACE INTO data_sync_schedules_v1 VALUES('gerpgo',1,1,'publish-task');")
            db.execute("UPDATE data_refresh_tasks_v1 SET kind='gerpgo',request_json=? WHERE id='publish-task'", (json.dumps({"scheduled": True}),))
        return {"sourceTaskId": TASK, "previewHash": preview["previewHash"], "automatic": True, "taskId": "publish-task", "lease": "lease"}

    def scoped_preview(self):
        shops = [{"marketListVos": [{"marketId": 1, "market": "amazon-us", "serverName": "MEASUREMAN", "serverId": 1}]}]
        (self.folder / "shops-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        return build_preview(self.runtime, TASK, store_name="MEASUREMAN")

    def test_automatic_publication_requires_manual_review_and_durable_schedule_authorization(self):
        import sqlite3
        preview = self.scoped_preview()
        with self.assertRaisesRegex(ValueError, "首次"):
            publish(self.runtime, self.automatic_request(preview))
        publish(self.runtime, self.approval(preview))
        next_preview = self.scoped_preview()
        result = publish(self.runtime, self.automatic_request(next_preview))
        report = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
        self.assertEqual(report["publication"]["actor"], "scheduled-worker")
        self.assertEqual(report["publication"]["initialReview"]["sourceTaskId"], TASK)
        after = self.scoped_preview()
        with sqlite3.connect(self.runtime / "db" / "operations.sqlite3") as db:
            db.execute("UPDATE data_sync_schedules_v1 SET enabled=0")
        with self.assertRaisesRegex(ValueError, "授权已关闭"):
            publish(self.runtime, {"sourceTaskId": TASK, "previewHash": after["previewHash"], "automatic": True, "taskId": "publish-task", "lease": "lease"})
        self.assertEqual(current_reports(self.reports).parent.name, result["publishedVersion"])

    def test_env_authorized_first_publish_is_automatic_not_a_fake_manual_review(self):
        from unittest.mock import patch
        environment = {"GERPGO_APP_ID": "fixture-id", "GERPGO_APP_KEY": "fixture-key", "GERPGO_STORE_NAME": "MEASUREMAN", "GERPGO_AUTO_SYNC": "true"}
        with patch.dict(os.environ, environment):
            preview = self.scoped_preview()
            result = publish(self.runtime, self.automatic_request(preview))
            report = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
            self.assertEqual(report["publication"]["actor"], "scheduled-worker")
            self.assertIsNone(report["publication"]["initialReview"])
            self.assertEqual(report["publication"]["initialAuthorization"]["actor"], "environment-policy")
            source = next(s for s in self.sources if s["name"] == "performance-" + self.previous_month)
            source_file = self.folder / f"{source['name']}-1.json"
            original = source_file.read_text()
            source_file.write_text(json.dumps({"page": 1, "total": 1, "rows": [self.row(125)]}))
            protected = self.scoped_preview()
            with self.assertRaisesRegex(ValueError, "保护线"):
                publish(self.runtime, self.automatic_request(protected))
            source_file.write_text(original)
            next_preview = self.scoped_preview()
            with patch.dict(os.environ, {"GERPGO_AUTO_SYNC": "false"}):
                with self.assertRaisesRegex(ValueError, "首次"):
                    publish(self.runtime, self.automatic_request(next_preview))
            self.assertEqual(current_reports(self.reports).parent.name, result["publishedVersion"])

    def test_recent_collection_preserves_older_history_and_protected_changes_stop_automatic_publish(self):
        preview = self.scoped_preview()
        publish(self.runtime, self.approval(preview))
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["collectionScope"] = "recent"
        manifest["sources"] = [s for s in manifest["sources"] if not s["name"].startswith("performance-") or s["name"] in {"performance-" + self.month, "performance-" + self.previous_month}]
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        recent = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertEqual(recent["recordCount"], 2)
        publish(self.runtime, self.automatic_request(recent))
        report = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
        self.assertEqual(len(report["rows"]), 7)
        source = next(s for s in self.sources if s["name"] == "performance-" + self.previous_month)
        (self.folder / f"{source['name']}-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": [self.row(125)]}))
        protected = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        with self.assertRaisesRegex(ValueError, "保护线"):
            publish(self.runtime, self.automatic_request(protected))

    def test_store_identity_excludes_other_store_same_sku_and_australia(self):
        shops = [{"marketListVos": [
            {"marketId": 1, "market": "amazon-us", "serverName": "MEASUREMAN", "serverId": 1, "warehouseName": "MEASUREMAN:US_FBA"},
            {"marketId": 17, "market": "amazon-au", "serverName": "MEASUREMAN", "serverId": 1, "warehouseName": "MEASUREMAN:AU_FBA"},
            {"marketId": 8, "market": "amazon-us", "serverName": "OTHER", "serverId": 2, "warehouseName": "OTHER:US_FBA"}]}]
        (self.folder / "shops-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        source = next(s for s in self.sources if s["name"] == "performance-" + self.month)
        rows = [self.row(), {**self.row(50), "marketId": 17, "orderProductSalesAmount": {"currencyAmount": 50, "currencyCode": "AUD"}}, {**self.row(900), "marketId": 8}]
        source["total"] = 3
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 3, "rows": rows}))
        self.source("returns-" + self.month, [{"marketId": 1, "id": 1}, {"marketId": 8, "id": 2}])
        self.source("storage-" + self.month, [{"serverId": 1, "marketId": None, "countryCode": "US", "id": 1}, {"serverId": 2, "marketId": None, "countryCode": "US", "id": 2}, {"serverId": 1, "marketId": None, "countryCode": "AU", "id": 3}])
        self.manifest()
        preview = build_preview(self.runtime, TASK, store_name="measureman")
        self.assertFalse(preview["blocked"])
        candidate = json.loads((self.folder / "candidate.json").read_text())
        self.assertEqual(candidate["storeScope"], {"storeName": "MEASUREMAN", "serverId": 1, "marketIds": [1]})
        current = [r for r in candidate["rows"] if r["reportMonth"] == self.month]
        self.assertEqual({(r["market"], r["currency"], r["productSales"]) for r in current}, {("US", "USD", 100)})
        archive = json.loads((self.folder / "candidate-source-data.json").read_text())
        for name in ["performance-" + self.month, "returns-" + self.month, "storage-" + self.month]:
            actual = next(s for s in archive["sources"] if s["name"] == name)
            self.assertEqual(actual["selectedRecordCount"], 1)
        self.assertTrue(any("其他店铺" in item for item in preview["withheld"]))
        with self.assertRaisesRegex(ValueError, "指定店铺"):
            build_preview(self.runtime, TASK, store_name="MEASURE")

    def sales_manifest(self, ads=False):
        from datetime import timedelta
        self.sources = [s for s in self.sources if s["name"] != "fba"]
        if ads:
            for performance in list(self.sources):
                if not performance["name"].startswith("performance-"):
                    continue
                date = datetime.fromisoformat(performance["condition"]["beginDate"])
                end = performance["condition"]["endDate"]
                while date.date().isoformat() <= end:
                    day = date.date().isoformat()
                    self.source(f"ads-1-{day}", [], {"marketId": 1, "startDateData": day, "endDateData": day})
                    date += timedelta(days=1)
        self.manifest()
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["collectionMode"] = "sales_ads" if ads else "sales"
        (self.folder / "manifest.json").write_text(json.dumps(manifest))

    def test_sales_only_does_not_require_inventory_and_preserves_local_shipment_report(self):
        self.scoped_preview()
        self.sales_manifest()
        original = '{"shipmentHistory":[{"sku":"SKU-A","quantity":80,"shipmentDate":"2026-08-01"}]}'
        (self.reports / "document_master.json").write_text(original)
        preview = self.scoped_preview()
        self.assertFalse(preview["blocked"])
        publish(self.runtime, self.approval(preview))
        self.assertEqual((current_reports(self.reports) / "document_master.json").read_text(), original)

    def test_sales_ads_requires_every_day_market_and_page_before_publication(self):
        self.scoped_preview()
        self.sales_manifest(ads=True)
        preview = self.scoped_preview()
        self.assertFalse(preview["blocked"])
        manifest = json.loads((self.folder / "manifest.json").read_text())
        index = next(i for i, s in enumerate(manifest["sources"]) if s["name"].startswith("ads-"))
        manifest["sources"][index]["status"] = "failed"
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "广告逐日"):
            self.scoped_preview()
        manifest["sources"][index]["status"] = "completed"
        manifest["sources"][index]["condition"]["marketId"] = 17
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "范围不匹配"):
            self.scoped_preview()

    def test_declared_scope_must_match_shop_evidence(self):
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["storeScope"] = {"storeName": "MEASUREMAN", "serverId": 1, "marketIds": [1]}
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "指定店铺"):
            build_preview(self.runtime, TASK)

    def test_narrowed_store_scope_removes_au_history_only_from_active_version(self):
        shops = [{"marketListVos": [{"marketId": 1, "market": "amazon-us", "serverName": "MEASUREMAN", "serverId": 1}]}]
        (self.folder / "shops-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        previous = json.loads((self.folder / "candidate.json").read_text())
        previous["storeScope"]["marketIds"].append(17)
        old_us = {**previous["rows"][0], "reportMonth": "2000-01"}
        old_au = {**old_us, "market": "AU", "currency": "AUD"}
        previous["rows"] = [old_us, old_au]
        previous["scopes"] = [{"market": "US", "reportMonth": "2000-01"}, {"market": "AU", "reportMonth": "2000-01"}]
        (self.reports / "gerpgo-performance.json").write_text(json.dumps(previous))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        result = publish(self.runtime, self.approval(preview))
        active = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
        self.assertTrue(all(r["market"] == "US" for r in active["rows"]))
        self.assertTrue(any(r["reportMonth"] == "2000-01" for r in active["rows"]))
        self.assertEqual(active["storeScope"]["marketIds"], [1])
        restore_reports(result["publishedVersion"], self.reports, self.runtime / "snapshots")
        restored = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
        self.assertTrue(any(r["market"] == "AU" for r in restored["rows"]))

    def test_old_au_preview_cannot_be_published(self):
        preview = build_preview(self.runtime, TASK)
        candidate = json.loads((self.folder / "candidate.json").read_text())
        candidate["rows"].append({**candidate["rows"][0], "market": "AU", "currency": "AUD"})
        (self.folder / "candidate.json").write_text(json.dumps(candidate))
        preview["reportHash"] = digest(candidate)
        preview["previewHash"] = digest({k: v for k, v in preview.items() if k != "previewHash"})
        (self.folder / "preview.json").write_text(json.dumps(preview))
        with self.assertRaisesRegex(ValueError, "范围外"):
            publish(self.runtime, self.approval(preview))
        self.assertFalse((self.reports / "current.json").exists())

    def old(self, amount):
        rows = [{"market": "US", "currency": "USD", "reportMonth": m, "sku": "SKU-A", "productSales": amount} for m in [self.month, self.previous_month]]
        (self.reports / "profitability.json").write_text(json.dumps({"rows": rows}))

    def test_missing_optional_facts_are_null_and_manual_data_retained_with_rollback(self):
        preview = build_preview(self.runtime, TASK)
        self.assertFalse(preview["blocked"])
        candidate = json.loads((self.folder / "candidate.json").read_text())
        self.assertIsNone(candidate["rows"][0]["actualProfit"])
        self.assertIsNone(candidate["rows"][0]["returns"])
        self.assertFalse(candidate["rows"][0]["quality"]["profitVerified"])
        result = publish(self.runtime, self.approval(preview))
        pointer = (self.reports / "current.json").read_bytes()
        self.assertTrue(publish(self.runtime, self.approval(preview))["alreadyPublished"])
        self.assertEqual((self.reports / "current.json").read_bytes(), pointer)
        active = current_reports(self.reports)
        self.assertEqual(json.loads((active / "manual.json").read_text())["notes"], "preserve")
        self.assertEqual(json.loads((active / "gerpgo-performance.json").read_text())["publication"]["version"], result["publishedVersion"])
        restore_reports(result["publishedVersion"], self.reports, self.runtime / "snapshots")
        self.assertFalse((current_reports(self.reports) / "gerpgo-performance.json").exists())

    def test_exact_ten_percent_boundary_and_current_month_growth(self):
        self.old(100 / 1.1)
        preview = build_preview(self.runtime, TASK)
        previous = next(d for d in preview["differences"] if d["reportMonth"] == self.previous_month)
        self.assertAlmostEqual(previous["revenueChangePercent"], 10)
        self.assertFalse(previous["protected"])
        self.old(50)
        preview = build_preview(self.runtime, TASK)
        self.assertTrue(next(d for d in preview["differences"] if d["reportMonth"] == self.previous_month)["protected"])
        self.assertFalse(next(d for d in preview["differences"] if d["reportMonth"] == self.month)["protected"])

    def test_missing_primary_fact_unknown_mapping_and_wrong_currency_block(self):
        for extra in [{"sku": "UNKNOWN"}, {"marketId": 99}, {"unitsOrdered": None}, {"orderProductSalesAmount": {"currencyAmount": 100, "currencyCode": "CAD"}}]:
            row = {**self.row(), **extra}
            (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": [row]}))
            preview = build_preview(self.runtime, TASK)
            self.assertTrue(preview["blocked"])
            with self.assertRaises(ValueError):
                publish(self.runtime, self.approval(preview))
            self.assertFalse((self.reports / "current.json").exists())

    def test_original_currency_sentinel_requires_explicit_query_and_mapped_market(self):
        source = next(s for s in self.sources if s["name"] == "performance-" + self.month)
        row = {**self.row(), "orderProductSalesAmount": {"currencyAmount": 100, "currencyCode": "YUAN"}}
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": [row]}))
        self.assertTrue(build_preview(self.runtime, TASK)["blocked"])
        source["condition"]["showCurrencyType"] = "YUAN"
        self.manifest()
        self.assertFalse(build_preview(self.runtime, TASK)["blocked"])
        candidate = json.loads((self.folder / "candidate.json").read_text())
        record = next(r for r in candidate["rows"] if r["reportMonth"] == self.month)
        self.assertEqual((record["currency"], record["productSales"]), ("USD", 100))
        row["currency"] = "CAD"
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": [row]}))
        self.assertTrue(build_preview(self.runtime, TASK)["blocked"])
        row["currency"] = None
        row["adsSpendAmount"] = {"currencyAmount": 10, "currencyCode": "CAD"}
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": [row]}))
        self.assertTrue(build_preview(self.runtime, TASK)["blocked"])

    def test_known_out_of_page_scope_markets_are_explicitly_withheld_and_archived(self):
        shops = [{"marketListVos": [{"marketId": 1, "market": "amazon-us"}, {"marketId": 2, "market": "amazon-uk"}]}]
        (self.folder / "shops-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        source = next(s for s in self.sources if s["name"] == "performance-" + self.month)
        source["total"] = 2
        rows = [self.row(), {**self.row(), "marketId": 2, "sku": "UK-ONLY", "orderProductSalesAmount": {"currencyAmount": 40, "currencyCode": "GBP"}}]
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 2, "rows": rows}))
        self.manifest()
        preview = build_preview(self.runtime, TASK)
        self.assertFalse(preview["blocked"])
        self.assertTrue(any("amazon-uk，1 条" in item for item in preview["withheld"]))
        candidate = json.loads((self.folder / "candidate.json").read_text())
        self.assertTrue(all(r["market"] == "US" for r in candidate["rows"]))
        archive = json.loads((self.folder / "candidate-source-data.json").read_text())
        actual = next(s for s in archive["sources"] if s["name"] == source["name"])
        self.assertEqual(len(actual["records"]), 2)

    def test_changed_baseline_or_modified_candidate_prevents_commit(self):
        preview = build_preview(self.runtime, TASK)
        (self.reports / "manual.json").write_text('{"notes":"new"}')
        with self.assertRaisesRegex(ValueError, "现有报告"):
            publish(self.runtime, self.approval(preview))
        preview = build_preview(self.runtime, TASK)
        candidate = json.loads((self.folder / "candidate.json").read_text())
        candidate["rows"][0]["units"] = 999
        (self.folder / "candidate.json").write_text(json.dumps(candidate))
        with self.assertRaisesRegex(ValueError, "暂存报告"):
            publish(self.runtime, self.approval(preview))
        self.assertFalse((self.reports / "current.json").exists())

    def test_wrong_lease_and_duplicate_page_evidence_fail_closed(self):
        preview = build_preview(self.runtime, TASK)
        with self.assertRaisesRegex(ValueError, "租约"):
            publish(self.runtime, {**self.approval(preview), "lease": "expired"})
        self.assertFalse((self.reports / "current.json").exists())
        source = next(s for s in self.sources if s["name"] == "performance-" + self.month)
        source["total"] = 2
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 2, "rows": [self.row(), self.row()]}))
        self.manifest()
        with self.assertRaisesRegex(ValueError, "重复"):
            build_preview(self.runtime, TASK)

    def test_ambiguous_date_or_missing_scope_rejected(self):
        self.sources.pop()
        self.manifest()
        with self.assertRaisesRegex(ValueError, "来源缺失"):
            build_preview(self.runtime, TASK)

    def test_original_evidence_change_invalidates_review(self):
        preview = build_preview(self.runtime, TASK)
        (self.folder / "products-1.json").write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, "原始证据"):
            publish(self.runtime, self.approval(preview))
        self.assertFalse((self.reports / "current.json").exists())

    def test_supplemental_payloads_are_archived_without_replacing_manual_inventory(self):
        self.source("returns-" + self.month, [{"id": 1, "sku": "SKU-A", "quantity": 1, "reason": "reason"}])
        self.source("storage-" + self.month, [{"id": 1, "currency": "USD", "storageFee": 1}])
        self.sources.append({"name": "ads-1-" + self.now.date().isoformat(), "status": "failed", "pages": 0, "total": None, "error": "广告未开通"})
        self.manifest()
        preview = build_preview(self.runtime, TASK)
        self.assertFalse(preview["blocked"])
        self.assertTrue(any("广告未开通" in item for item in preview["withheld"]))
        publish(self.runtime, self.approval(preview))
        archived = json.loads((current_reports(self.reports) / "gerpgo-source-data.json").read_text())
        returns = next(source for source in archived["sources"] if source["name"].startswith("returns-"))
        self.assertEqual(returns["records"][0]["reason"], "reason")
        self.assertEqual(len(archived["incomplete"]), 1)

    def test_raw_candidate_tampering_blocks_entire_publish(self):
        preview = build_preview(self.runtime, TASK)
        (self.folder / "candidate-source-data.json").write_text('{"modified": true}')
        with self.assertRaisesRegex(ValueError, "暂存原始数据"):
            publish(self.runtime, self.approval(preview))
        self.assertFalse((self.reports / "current.json").exists())

    def test_grouped_shop_market_total_is_preserved(self):
        source = next(s for s in self.sources if s["name"] == "shops")
        source.update(total=2, totalUnit="markets")
        (self.folder / "shops-1.json").write_text(json.dumps({"page": 1, "total": 2, "totalUnit": "markets", "rows": [{"marketListVos": [{"marketId": 1, "market": "amazon-us"}, {"marketId": 2, "market": "amazon-ca"}]}]}))
        self.manifest()
        self.assertFalse(build_preview(self.runtime, TASK)["blocked"])

    def test_same_scope_sku_removal_requires_review_and_listings_aggregate_once(self):
        self.old(100)
        previous = json.loads((self.reports / "profitability.json").read_text())
        previous["rows"].append({**previous["rows"][0], "sku": "SKU-B", "productSales": 0})
        (self.reports / "profitability.json").write_text(json.dumps(previous))
        preview = build_preview(self.runtime, TASK)
        self.assertTrue(next(d for d in preview["differences"] if d["reportMonth"] == self.month)["protected"])
        source = next(s for s in self.sources if s["name"] == "performance-" + self.month)
        source["total"] = 2
        rows = [{**self.row(), "msku": "listing-a"}, {**self.row(50), "msku": "listing-b", "unitsOrdered": 20}]
        (self.folder / f"performance-{self.month}-1.json").write_text(json.dumps({"page": 1, "total": 2, "rows": rows}))
        self.manifest()
        build_preview(self.runtime, TASK)
        candidate = json.loads((self.folder / "candidate.json").read_text())
        row = next(r for r in candidate["rows"] if r["reportMonth"] == self.month)
        self.assertEqual(row["units"], 60)
        self.assertEqual(row["productSales"], 150)
        self.assertEqual(row["averagePrice"], 2.5)
        self.assertEqual(row["msku"], "")


if __name__ == "__main__":
    unittest.main()
