import hashlib
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

    def test_env_credentials_do_not_authorize_first_automatic_publish_without_review(self):
        from unittest.mock import patch
        environment = {"GERPGO_APP_ID": "fixture-id", "GERPGO_APP_KEY": "fixture-key", "GERPGO_STORE_NAME": "MEASUREMAN", "GERPGO_AUTO_SYNC": "true"}
        with patch.dict(os.environ, environment):
            preview = self.scoped_preview()
            with self.assertRaisesRegex(ValueError, "首次"):
                publish(self.runtime, self.automatic_request(preview))
            self.assertFalse((self.reports / "current.json").exists())
            publish(self.runtime, self.approval(preview))
            preview = self.scoped_preview()
            result = publish(self.runtime, self.automatic_request(preview))
            report = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
            self.assertEqual(report["publication"]["actor"], "scheduled-worker")
            self.assertEqual(report["publication"]["initialReview"]["storeScope"], report["storeScope"])
            self.assertNotIn("initialAuthorization", report["publication"])
            source = next(s for s in self.sources if s["name"] == "performance-" + self.previous_month)
            source_file = self.folder / f"{source['name']}-1.json"
            original = source_file.read_text()
            source_file.write_text(json.dumps({"page": 1, "total": 1, "rows": [self.row(125)]}))
            protected = self.scoped_preview()
            with self.assertRaisesRegex(ValueError, "保护线"):
                publish(self.runtime, self.automatic_request(protected))
            source_file.write_text(original)
            self.assertEqual(current_reports(self.reports).parent.name, result["publishedVersion"])

    def test_actor_or_env_authorization_metadata_cannot_replace_initial_review(self):
        from unittest.mock import patch
        preview = self.scoped_preview()
        publish(self.runtime, self.approval(preview))
        file = current_reports(self.reports) / "gerpgo-performance.json"
        report = json.loads(file.read_text())
        report["publication"]["initialReview"] = None
        report["publication"]["initialAuthorization"] = {"actor": "environment-policy", "storeScope": report["storeScope"]}
        file.write_text(json.dumps(report))
        with patch.dict(os.environ, {"GERPGO_APP_ID": "fixture-id", "GERPGO_APP_KEY": "fixture-key", "GERPGO_STORE_NAME": "MEASUREMAN", "GERPGO_AUTO_SYNC": "true"}):
            preview = self.scoped_preview()
            with self.assertRaisesRegex(ValueError, "首次"):
                publish(self.runtime, self.automatic_request(preview))

    def historical_ads_preview(self, conflicting=False):
        self.scoped_preview()
        old_row = {"reportMonth": "2000-01", "currency": "USD", "market": "US", "sku": "SKU-A", "productName": "A", "cost": 1, "sales": 2,
                   "clicks": 1, "impressions": 10, "orders": 1, "startDate": "2000-01-01", "businessAsOf": "2000-01-31", "recordCount": 1, "asins": ["A"], "mskus": ["US-HISTORY"]}
        old_advertising = {"schemaVersion": 1, "capturedAt": "2000-02-01T00:00:00Z", "scopes": [
            {"market": "US", "reportMonth": "2000-01"}, {"market": "MX", "reportMonth": "2000-01"}],
            "rows": [old_row, {**old_row, "market": "MX", "currency": "MXN", "sku": "OLD-MX", "mskus": ["MX-HISTORY"]}],
            "identities": [{"sku": "SKU-A", "aliases": ["US-HISTORY"]}, {"sku": "OLD-MX", "aliases": ["SKU-A" if conflicting else "MX-HISTORY"]}], "issues": []}
        (self.reports / "gerpgo-performance.json").write_text(json.dumps({"schemaVersion": 1, "rows": [], "scopes": [], "advertising": old_advertising}))
        for day in range(1, self.now.day + 1):
            date = f"{self.month}-{day:02d}"
            self.source("ads-1-" + date, [{"marketId": 1, "msku": "SKU-A", "asin": "A", "currencySymbol": "$", "cost": 1, "sales": 2}],
                        {"marketId": 1, "startDateData": date, "endDateData": date})
        self.manifest()
        return build_preview(self.runtime, TASK, store_name="MEASUREMAN")

    def test_retained_historical_ads_rows_keep_their_explicit_identities(self):
        preview = self.historical_ads_preview()
        publish(self.runtime, self.approval(preview))
        ads = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())["advertising"]
        self.assertEqual(ads["identities"], [{"sku": "OLD-MX", "aliases": ["MX-HISTORY"]}, {"sku": "SKU-A", "aliases": ["SKU-A", "US-HISTORY"]}])
        self.assertEqual({(r["market"], r["reportMonth"], r["sku"]) for r in ads["rows"]}, {("US", "2000-01", "SKU-A"), ("MX", "2000-01", "OLD-MX"), ("US", self.month, "SKU-A")})

    def test_conflicting_retained_historical_ad_aliases_block_atomic_publication(self):
        preview = self.historical_ads_preview(conflicting=True)
        before = (self.reports / "gerpgo-performance.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "别名冲突"):
            publish(self.runtime, self.approval(preview))
        self.assertFalse((self.reports / "current.json").exists())
        self.assertEqual((self.reports / "gerpgo-performance.json").read_bytes(), before)

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

    def test_narrowed_store_scope_preserves_au_history_without_new_au_collection(self):
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
        self.assertTrue(any(r["market"] == "AU" for r in active["rows"]))
        self.assertTrue(any(r["reportMonth"] == "2000-01" for r in active["rows"]))
        self.assertEqual(active["storeScope"]["marketIds"], [1])
        restore_reports(result["publishedVersion"], self.reports, self.runtime / "snapshots")
        restored = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
        self.assertTrue(any(r["market"] == "AU" for r in restored["rows"]))

    def listing_manifest(self):
        self.scoped_preview()
        self.sales_manifest()
        shops = [{"marketListVos": [
            {"marketId": i, "market": market, "serverName": "MEASUREMAN", "serverId": 1}
            for i, market in [(1, "amazon-us"), (2, "amazon-ca"), (3, "amazon-mx"), (17, "amazon-au")]]}]
        (self.folder / "shops-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        old = [s for s in self.sources if s["name"].startswith("performance-")]
        self.sources = [s for s in self.sources if not s["name"].startswith("performance-")]
        for source in old:
            month = source["name"].removeprefix("performance-")
            for market_id, country, currency, sales in [(1, "US", "USD", 100), (2, "CA", "CAD", 40)]:
                self.source(f"performance-{market_id}-{month}", [{**self.row(sales), "serverId": 1, "marketId": market_id, "countryName": country,
                            "orderProductSalesAmount": {"currencyAmount": sales, "currencyCode": currency}}],
                            {**source["condition"], "marketList": [market_id], "showCurrencyType": "YUAN", "isShowTotal": False, "groupByType": "seller_sku"})
                self.sources[-1]["endpoint"] = "/operation/sts/listingAnalyzeMultiIndex/page"
        self.manifest()
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest.update(collectionMode="sales", performanceContract="listing-market-v1", storeScope={"storeName": "MEASUREMAN", "serverId": 1, "marketIds": [1, 2]})
        (self.folder / "manifest.json").write_text(json.dumps(manifest))

    def test_listing_market_contract_keeps_ca_currency_and_sales_separate(self):
        self.listing_manifest()
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        rows = json.loads((self.folder / "candidate.json").read_text())["rows"]
        self.assertEqual({(r["market"], r["currency"], r["productSales"]) for r in rows}, {("US", "USD", 100), ("CA", "CAD", 40)})

    def test_listing_market_contract_rejects_wrong_store_country_and_currency(self):
        self.listing_manifest()
        name = f"performance-2-{self.month}"
        original = json.loads((self.folder / f"{name}-1.json").read_text())
        for patch in [{"serverId": 2}, {"countryName": "US"}, {"marketId": 1}, {"orderProductSalesAmount": {"currencyAmount": 40, "currencyCode": "YUAN"}}]:
            (self.folder / f"{name}-1.json").write_text(json.dumps({**original, "rows": [{**original["rows"][0], **patch}]}))
            self.assertTrue(build_preview(self.runtime, TASK, store_name="MEASUREMAN")["blocked"])

    def test_listing_missing_ca_month_is_not_a_complete_sales_collection(self):
        self.listing_manifest()
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["sources"] = [s for s in manifest["sources"] if s["name"] != f"performance-2-{self.previous_month}"]
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "来源缺失"):
            build_preview(self.runtime, TASK, store_name="MEASUREMAN")

    def test_declared_page_sha_is_verified_before_preview(self):
        import hashlib
        source = next(s for s in self.sources if s["name"] == "performance-" + self.month)
        file = self.folder / f"{source['name']}-1.json"
        source["pageHashes"] = [{"page": 1, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}]
        self.manifest()
        self.assertFalse(build_preview(self.runtime, TASK)["blocked"])
        file.write_text(json.dumps({"page": 1, "total": 1, "rows": [self.row(150)]}))
        with self.assertRaisesRegex(ValueError, "SHA"):
            build_preview(self.runtime, TASK)

    def test_legacy_capture_hashes_are_checked_before_clean_preview_and_publication(self):
        shops_file = self.folder / "shops-1.json"
        shops = [{"serverId": 1, "key": "shop-business-key", "marketListVos": [{
            "marketId": 1, "market": "amazon-us", "serverName": "MEASUREMAN", "serverId": 1,
            "authToken": "fixture-auth", "publicToken": "fixture-public", "refreshToken": "fixture-refresh",
            "metadata": [{"X-API-Key": "fixture-api", "tokenCount": 7, "sku": "token-SKU"}],
        }]}]
        shops_file.write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        source = next(s for s in self.sources if s["name"] == "shops")
        original_hash = hashlib.sha256(shops_file.read_bytes()).hexdigest()
        source["pageHashes"] = [{"page": 1, "sha256": original_hash}]
        source["condition"] = {"appKey": "fixture-app", "key": "business-query"}
        self.manifest()
        original_files = {p.name: p.read_bytes() for p in self.folder.glob("*.json")}

        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        archived = json.loads((self.folder / "candidate-source-data.json").read_text())
        shop_source = next(s for s in archived["sources"] if s["name"] == "shops")
        expected_shops = [{"serverId": 1, "key": "shop-business-key", "marketListVos": [{
            "marketId": 1, "market": "amazon-us", "serverName": "MEASUREMAN", "serverId": 1,
            "metadata": [{"tokenCount": 7, "sku": "token-SKU"}],
        }]}]
        self.assertEqual(shop_source["records"], expected_shops)
        self.assertEqual(shop_source["condition"], {"key": "business-query"})
        self.assertEqual(shop_source["pageHashes"], [{"page": 1, "sha256": original_hash}])
        self.assertEqual((shop_source["queryTotal"], shop_source["selectedRecordCount"], preview["recordCount"]), (1, 1, 7))
        result = publish(self.runtime, self.approval(preview))
        active = current_reports(self.reports)
        published = json.loads((active / "gerpgo-source-data.json").read_text())
        self.assertEqual(next(s for s in published["sources"] if s["name"] == "shops")["records"], expected_shops)
        rows = json.loads((active / "gerpgo-performance.json").read_text())["rows"]
        self.assertEqual([(r["sku"], r["units"], r["productSales"], r["currency"]) for r in rows], [("SKU-A", 40, 100, "USD")] * 7)
        pointer = json.loads((self.reports / "current.json").read_text())
        self.assertEqual(pointer["version"], result["publishedVersion"])
        for name, sha in pointer["files"].items():
            self.assertEqual(hashlib.sha256((active / name).read_bytes()).hexdigest(), sha)
        for name, content in original_files.items():
            self.assertEqual((self.folder / name).read_bytes(), content)
        self.assertEqual((active / "manual.json").read_bytes(), b'{"notes":"preserve"}')

        # Even an authentication-only edit invalidates the ORIGINAL capture SHA.
        shops[0]["marketListVos"][0]["authToken"] = "fixture-changed"
        shops_file.write_text(json.dumps({"page": 1, "total": 1, "rows": shops}))
        with self.assertRaisesRegex(ValueError, "SHA"):
            build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertEqual(current_reports(self.reports), active)

    def test_approved_legacy_raw_candidate_is_sanitized_only_after_hash_validation(self):
        preview = build_preview(self.runtime, TASK)
        source_file = self.folder / "candidate-source-data.json"
        legacy = json.loads(source_file.read_text())
        legacy["token"] = "fixture-token"
        shop = next(s for s in legacy["sources"] if s["name"] == "shops")["records"][0]["marketListVos"][0]
        shop.update({"Authorization": "fixture-bearer", "tokenCount": 3})
        source_file.write_text(json.dumps(legacy))
        original_candidate = source_file.read_bytes()
        preview["sourceDataHash"] = digest(legacy)
        preview["previewHash"] = digest({k: v for k, v in preview.items() if k != "previewHash"})
        (self.folder / "preview.json").write_text(json.dumps(preview))

        publish(self.runtime, self.approval(preview))
        published = json.loads((current_reports(self.reports) / "gerpgo-source-data.json").read_text())
        self.assertNotIn("token", published)
        published_shop = next(s for s in published["sources"] if s["name"] == "shops")["records"][0]["marketListVos"][0]
        self.assertEqual(published_shop, {"marketId": 1, "market": "amazon-us", "tokenCount": 3})
        self.assertEqual(source_file.read_bytes(), original_candidate)

    def test_listing_zero_core_identityless_record_is_archived_with_reason_not_verified_profit(self):
        self.listing_manifest()
        name = f"performance-1-{self.month}"
        source = next(s for s in self.sources if s["name"] == name)
        source["total"] = 2
        original = json.loads((self.folder / f"{name}-1.json").read_text())
        unknown = {**self.row(0), "serverId": 1, "countryName": "US", "sku": None, "msku": None, "asin": None, "unitsOrdered": 0, "orderProductSales": 0,
                   "returns": 0, "adsSpend": 0, "adsSpendAmount": {"currencyAmount": 0, "currencyCode": "USD"}, "salesNetProfitAmount": {"currencyAmount": -12, "currencyCode": "USD"}}
        (self.folder / f"{name}-1.json").write_text(json.dumps({**original, "total": 2, "rows": original["rows"] + [unknown]}))
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["sources"] = self.sources
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        archive = json.loads((self.folder / "candidate-source-data.json").read_text())
        self.assertEqual(archive["skippedIdentityRecords"][0]["source"], name)
        self.assertIn("利润未核验", archive["skippedIdentityRecords"][0]["reason"])
        self.assertEqual(archive["skippedIdentityRecords"][0]["record"]["salesNetProfitAmount"]["currencyAmount"], -12)
        self.assertTrue(any("身份缺失" in reason for reason in preview["withheld"]))
        unknown["unitsOrdered"] = 1
        (self.folder / f"{name}-1.json").write_text(json.dumps({**original, "total": 2, "rows": original["rows"] + [unknown]}))
        self.assertTrue(build_preview(self.runtime, TASK, store_name="MEASUREMAN")["blocked"])

    def replace_listing_rows(self, name, rows):
        source = next(s for s in self.sources if s["name"] == name)
        source["total"] = len(rows)
        (self.folder / f"{name}-1.json").write_text(json.dumps({"page": 1, "total": len(rows), "rows": rows}))
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["sources"] = self.sources
        (self.folder / "manifest.json").write_text(json.dumps(manifest))

    def linked_listing(self, sku="SKU-A", asin="ASIN-A", sales=100):
        return {**self.row(sales), "serverId": 1, "countryName": "US", "sku": sku, "msku": sku, "asin": asin, "orderProductSales": sales,
                "adsSpend": 5, "adsSpendAmount": {"currencyAmount": 5, "currencyCode": "USD"}, "adsSalesAmount": {"currencyAmount": 30, "currencyCode": "USD"}, "returns": 0}

    def unknown_listing(self, ads=-2, asin="ASIN-A"):
        return {**self.linked_listing("Amazon.Found.ASIN-A", asin, 0), "unitsOrdered": 0, "adsSpend": ads,
                "adsSpendAmount": {"currencyAmount": ads, "currencyCode": "USD"}, "adsSalesAmount": {"currencyAmount": 4 if ads else 0, "currencyCode": "USD"},
                "adsItemSalesAmount": {"currencyAmount": 3, "currencyCode": None}, "salesNetProfitAmount": {"currencyAmount": -12, "currencyCode": "USD"}}

    def test_same_source_unique_provider_asin_link_preserves_nonzero_ad_adjustments(self):
        self.listing_manifest()
        name = f"performance-1-{self.month}"
        # Evidence may appear after the unknown row; link from the complete source, not a prefix.
        self.replace_listing_rows(name, [self.unknown_listing(), self.linked_listing()])
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        rows = json.loads((self.folder / "candidate.json").read_text())["rows"]
        row = next(r for r in rows if r["market"] == "US" and r["reportMonth"] == self.month)
        self.assertEqual((row["sku"], row["units"], row["productSales"], row["advertisingCost"], row["advertisingSales"]), ("SKU-A", 40, 100, 3, 34))
        self.assertFalse(row["quality"]["profitVerified"])
        archive = json.loads((self.folder / "candidate-source-data.json").read_text())
        resolution = archive["resolvedIdentityRecords"][0]
        self.assertEqual(resolution["original"], {"sku": "Amazon.Found.ASIN-A", "msku": "Amazon.Found.ASIN-A", "asin": "ASIN-A"})
        self.assertEqual(resolution["resolvedSku"], "SKU-A")
        self.assertEqual(resolution["basis"], {"rule": "same-source-provider-asin", "serverId": 1, "marketId": 1, "asin": "ASIN-A", "reportMonth": self.month, "supportingRows": [2]})

    def test_same_source_asin_with_two_known_skus_remains_blocked_even_for_zero_core(self):
        self.listing_manifest()
        source = next(s for s in self.sources if s["name"] == "products")
        source["total"] = 2
        (self.folder / "products-1.json").write_text(json.dumps({"page": 1, "total": 2, "rows": [{"sku": "SKU-A"}, {"sku": "SKU-B"}]}))
        self.replace_listing_rows(f"performance-1-{self.month}", [self.unknown_listing(ads=0), self.linked_listing(), self.linked_listing("SKU-B")])
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertTrue(preview["blocked"])
        self.assertIn("多个 SKU", preview["issues"][0]["reason"])

    def test_provider_asin_links_do_not_cross_markets(self):
        self.listing_manifest()
        known_ca = {**self.linked_listing(), "marketId": 2, "countryName": "CA", "orderProductSalesAmount": {"currencyAmount": 100, "currencyCode": "CAD"},
                    "adsSpendAmount": {"currencyAmount": 5, "currencyCode": "CAD"}, "adsSalesAmount": {"currencyAmount": 30, "currencyCode": "CAD"}}
        self.replace_listing_rows(f"performance-2-{self.month}", [known_ca])
        self.replace_listing_rows(f"performance-1-{self.month}", [self.unknown_listing(), self.linked_listing(asin="OTHER-ASIN")])
        self.assertTrue(build_preview(self.runtime, TASK, store_name="MEASUREMAN")["blocked"])

    def test_provider_asin_links_do_not_cross_months(self):
        self.listing_manifest()
        self.replace_listing_rows(f"performance-1-{self.previous_month}", [self.linked_listing()])
        self.replace_listing_rows(f"performance-1-{self.month}", [self.unknown_listing(), self.linked_listing(asin="OTHER-ASIN")])
        self.assertTrue(build_preview(self.runtime, TASK, store_name="MEASUREMAN")["blocked"])

    def test_unlinked_unknown_sku_skips_only_complete_strict_zero_core_facts(self):
        self.listing_manifest()
        name = f"performance-1-{self.month}"
        unknown = self.unknown_listing(ads=0)
        self.replace_listing_rows(name, [unknown, self.linked_listing(asin="OTHER-ASIN")])
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        archive = json.loads((self.folder / "candidate-source-data.json").read_text())
        self.assertIn("SKU 未在产品主数据", archive["skippedIdentityRecords"][0]["reason"])
        self.assertEqual(archive["skippedIdentityRecords"][0]["record"]["sku"], "Amazon.Found.ASIN-A")
        for change in [{"unitsOrdered": 1}, {"returns": None}, {"adsSpend": -0.73}, {"adsSpendAmount": None}, {"orderProductSalesAmount": {"currencyAmount": 0, "currencyCode": "CAD"}}]:
            self.replace_listing_rows(name, [{**unknown, **change}, self.linked_listing(asin="OTHER-ASIN")])
            self.assertTrue(build_preview(self.runtime, TASK, store_name="MEASUREMAN")["blocked"])

    def test_advertising_aliases_only_use_products_explicitly_selected_for_current_store(self):
        self.scoped_preview()
        self.source("ads-1-" + self.month + "-01", [{"marketId": 1, "msku": "SKU-A", "asin": "A", "currencySymbol": "$", "cost": 1, "sales": 2}],
                    {"marketId": 1, "startDateData": self.month + "-01", "endDateData": self.month + "-01"})
        # Restrict capture to the first day so this fixture is a complete ad period.
        for source in self.sources:
            if source["name"] == "performance-" + self.month:
                source["condition"]["endDate"] = self.month + "-01"
            if source["name"] == "products":
                source["total"] = 2
        (self.folder / "products-1.json").write_text(json.dumps({"page": 1, "total": 2, "rows": [{"sku": "SKU-A"}, {"sku": "OTHER-STORE", "mskuList": ["SKU-A"]}]}))
        self.manifest()
        manifest = json.loads((self.folder / "manifest.json").read_text())
        manifest["capturedAt"] = self.month + "-01T00:00:00+00:00"
        (self.folder / "manifest.json").write_text(json.dumps(manifest))
        preview = build_preview(self.runtime, TASK, now=datetime.fromisoformat(manifest["capturedAt"]), store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        ads = json.loads((self.folder / "candidate.json").read_text())["advertising"]
        self.assertEqual(ads["issues"], [])
        self.assertEqual(ads["rows"][0]["sku"], "SKU-A")

    def test_replaced_sales_month_preserves_historically_verified_profit_and_returns(self):
        preview = self.scoped_preview()
        publish(self.runtime, self.approval(preview))
        current = current_reports(self.reports) / "gerpgo-performance.json"
        report = json.loads(current.read_text())
        record = next(r for r in report["rows"] if r["reportMonth"] == self.previous_month)
        record.update(actualProfit=25, grossProfit=30, returns=3, actualMargin=.25)
        record["quality"].update(profitVerified=True, returnsVerified=True)
        current.write_text(json.dumps(report))
        preview = self.scoped_preview()
        publish(self.runtime, self.approval(preview))
        report = json.loads((current_reports(self.reports) / "gerpgo-performance.json").read_text())
        record = next(r for r in report["rows"] if r["reportMonth"] == self.previous_month)
        self.assertEqual((record["actualProfit"], record["returns"], record["quality"]["profitVerified"], record["quality"]["returnsVerified"]), (25, 3, True, True))

    def legacy_finance_row(self, market="US", month=None):
        return {"market": market, "reportMonth": month or self.previous_month, "sku": "LEGACY", "currency": "USD" if market == "US" else "CAD",
                "units": 40, "productSales": 100, "actualProfit": 25, "grossProfit": 30, "returns": 3, "sourceKind": "excel",
                "quality": {"profitVerified": True, "returnsVerified": True, "completePeriod": True}}

    def prepare_financial_alias(self, *, month=None, ambiguous=False):
        self.listing_manifest()
        source = next(s for s in self.sources if s["name"] == "products")
        products = [{"sku": "SKU-A", "mskuList": ["LEGACY"]}]
        rows = [{**self.linked_listing(), "msku": "LEGACY"}]
        if ambiguous:
            products.append({"sku": "SKU-B", "mskuList": ["LEGACY"]})
            rows.append({**self.linked_listing("SKU-B", "ASIN-B"), "msku": "LEGACY"})
        source["total"] = len(products)
        (self.folder / "products-1.json").write_text(json.dumps({"page": 1, "total": len(products), "rows": products}))
        self.replace_listing_rows(f"performance-1-{month or self.previous_month}", rows)

    def test_declared_alias_and_same_month_listing_msku_inherit_verified_financial_facts(self):
        self.prepare_financial_alias()
        old = self.legacy_finance_row()
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [old]}))
        # A prior provider generation must not hide the unchanged verified Excel baseline.
        provider = {**old, "sku": "SKU-A", "actualProfit": None, "grossProfit": None, "returns": None, "quality": {"profitVerified": False, "returnsVerified": False}}
        (self.reports / "gerpgo-performance.json").write_text(json.dumps({"scopes": [{"market": "US", "reportMonth": self.previous_month}], "rows": [provider]}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        candidate = json.loads((self.folder / "candidate.json").read_text())
        row = next(r for r in candidate["rows"] if r["market"] == "US" and r["reportMonth"] == self.previous_month)
        self.assertEqual((row["sku"], row["productSales"], row["actualProfit"], row["grossProfit"], row["returns"]), ("SKU-A", 100, 25, 30, 3))
        self.assertTrue(row["quality"]["profitVerified"])
        self.assertTrue(row["quality"]["returnsVerified"])
        audit = json.loads((self.folder / "candidate-source-data.json").read_text())["verifiedFactInheritance"]
        self.assertEqual(audit[0]["oldSku"], "LEGACY")
        self.assertEqual(audit[0]["sku"], "SKU-A")
        self.assertEqual(audit[0]["basis"]["source"], f"performance-1-{self.previous_month}")
        self.assertEqual(audit[0]["basis"]["supportingRows"], [1])
        self.assertEqual(audit[0]["verifiedFacts"], {"actualProfit": 25, "grossProfit": 30, "returns": 3, "profitVerified": True, "returnsVerified": True})

    def test_linked_standard_snapshot_restores_verified_returns_not_in_profitability(self):
        self.prepare_financial_alias()
        version = "data-20261012-000000-test"
        legacy = self.legacy_finance_row()
        legacy["actualProfit"] = None
        legacy["grossProfit"] = None
        legacy["quality"]["profitVerified"] = False
        snapshot = self.runtime / "snapshots" / version / "reports"
        snapshot.mkdir(parents=True)
        (snapshot / "gerpgo-performance.json").write_text(json.dumps({"rows": [legacy]}))
        (self.reports / "gerpgo-performance.json").write_text(json.dumps({"scopes": [], "rows": [], "publication": {"version": version}}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        row = next(r for r in json.loads((self.folder / "candidate.json").read_text())["rows"] if r["market"] == "US" and r["reportMonth"] == self.previous_month)
        self.assertEqual(row["returns"], 3)
        self.assertTrue(row["quality"]["returnsVerified"])
        self.assertFalse(row["quality"]["profitVerified"])
        audit = json.loads((self.folder / "candidate-source-data.json").read_text())["verifiedFactInheritance"]
        self.assertEqual(audit[0]["sourceReport"], f"snapshot:{version}/gerpgo-performance.json")

    def test_declared_same_month_msku_link_does_not_require_an_asin(self):
        self.prepare_financial_alias()
        self.replace_listing_rows(f"performance-1-{self.previous_month}", [{**self.linked_listing(), "msku": "LEGACY", "asin": None}])
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [self.legacy_finance_row()]}))
        build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        row = next(r for r in json.loads((self.folder / "candidate.json").read_text())["rows"] if r["market"] == "US" and r["reportMonth"] == self.previous_month)
        self.assertEqual((row["actualProfit"], row["returns"]), (25, 3))

    def test_verified_financial_aliases_do_not_cross_month_or_market(self):
        self.prepare_financial_alias(month=self.month)
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [self.legacy_finance_row(), self.legacy_finance_row(market="CA", month=self.month)]}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        rows = json.loads((self.folder / "candidate.json").read_text())["rows"]
        self.assertTrue(all(not r["quality"]["profitVerified"] and not r["quality"]["returnsVerified"] for r in rows))
        archive = json.loads((self.folder / "candidate-source-data.json").read_text())
        self.assertEqual(len(archive["unresolvedVerifiedFacts"]), 2)

    def test_ambiguous_verified_financial_aliases_block_without_migrating_fields(self):
        self.prepare_financial_alias(ambiguous=True)
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [self.legacy_finance_row()]}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertTrue(preview["blocked"])
        self.assertTrue(any("已核验" in issue["reason"] and "多个 SKU" in issue["reason"] for issue in preview["issues"]))

    def test_two_legacy_keys_resolving_to_one_sku_with_different_verified_facts_block_publication(self):
        self.prepare_financial_alias()
        products = [{"sku": "SKU-A", "mskuList": ["LEGACY", "LEGACY-2"]}]
        (self.folder / "products-1.json").write_text(json.dumps({"page": 1, "total": 1, "rows": products}))
        self.replace_listing_rows(f"performance-1-{self.previous_month}", [{**self.linked_listing(), "msku": alias} for alias in ["LEGACY", "LEGACY-2"]])
        file = self.reports / "profitability.json"
        file.write_text(json.dumps({"rows": [self.legacy_finance_row(), {**self.legacy_finance_row(), "sku": "LEGACY-2", "actualProfit": 19, "returns": 7}]}))
        original = file.read_bytes()
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertTrue(preview["blocked"])
        self.assertTrue(any("核验事实冲突" in issue["reason"] for issue in preview["issues"]))
        with self.assertRaises(ValueError):
            publish(self.runtime, self.approval(preview))
        self.assertEqual(file.read_bytes(), original)
        self.assertFalse((self.reports / "current.json").exists())

    def test_exact_target_key_does_not_hide_conflicting_verified_alias_facts(self):
        self.prepare_financial_alias()
        exact = {**self.legacy_finance_row(), "sku": "SKU-A", "actualProfit": 19, "returns": 7}
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [self.legacy_finance_row()]}))
        provider = self.reports / "gerpgo-performance.json"
        provider.write_text(json.dumps({"scopes": [{"market": "US", "reportMonth": self.previous_month}], "rows": [exact]}))
        original = provider.read_bytes()
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertTrue(preview["blocked"])
        self.assertTrue(any("核验事实冲突" in issue["reason"] for issue in preview["issues"]))
        with self.assertRaises(ValueError):
            publish(self.runtime, self.approval(preview))
        self.assertEqual(provider.read_bytes(), original)

    def test_duplicate_same_legacy_key_with_different_verified_values_is_not_first_wins(self):
        self.prepare_financial_alias()
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [self.legacy_finance_row(), {**self.legacy_finance_row(), "actualProfit": 19}]}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertTrue(preview["blocked"])
        self.assertTrue(any("核验事实冲突" in issue["reason"] for issue in preview["issues"]))

    def test_same_verified_key_conflicting_between_reports_blocks_instead_of_using_priority(self):
        self.prepare_financial_alias()
        (self.reports / "profitability.json").write_text(json.dumps({"rows": [self.legacy_finance_row()]}))
        (self.reports / "gerpgo-performance.json").write_text(json.dumps({"scopes": [], "rows": [{**self.legacy_finance_row(), "actualProfit": 19}]}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertTrue(preview["blocked"])
        self.assertTrue(any("核验事实冲突" in issue["reason"] for issue in preview["issues"]))

    def test_consistent_exact_and_alias_facts_deduplicate_with_all_source_keys_and_hashes(self):
        import hashlib
        self.prepare_financial_alias()
        alias = self.reports / "profitability.json"
        exact = self.reports / "gerpgo-performance.json"
        alias.write_text(json.dumps({"rows": [self.legacy_finance_row()]}))
        exact.write_text(json.dumps({"scopes": [], "rows": [{**self.legacy_finance_row(), "sku": "SKU-A"}]}))
        preview = build_preview(self.runtime, TASK, store_name="MEASUREMAN")
        self.assertFalse(preview["blocked"])
        row = next(r for r in json.loads((self.folder / "candidate.json").read_text())["rows"] if r["market"] == "US" and r["reportMonth"] == self.previous_month)
        self.assertEqual((row["actualProfit"], row["grossProfit"], row["returns"]), (25, 30, 3))
        audit = json.loads((self.folder / "candidate-source-data.json").read_text())["verifiedFactInheritance"]
        for flag in ["profitVerified", "returnsVerified"]:
            sources = next(group["sources"] for item in audit for group in item["consistentSources"] if group["flag"] == flag)
            self.assertEqual({tuple(s["oldKey"]) for s in sources}, {("US", self.previous_month, "LEGACY", "USD"), ("US", self.previous_month, "SKU-A", "USD")})
            self.assertEqual({s["sourceSha256"] for s in sources}, {hashlib.sha256(alias.read_bytes()).hexdigest(), hashlib.sha256(exact.read_bytes()).hexdigest()})

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
