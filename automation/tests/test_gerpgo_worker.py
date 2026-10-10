"""Opt-in acceptance of the compiled worker, with isolated evidence and SQLite."""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import unittest
from pathlib import Path

import test_gerpgo_preview as fixtures
from store_ops.jobs.gerpgo_preview import build_preview
from store_ops.report_versions import current_reports


@unittest.skipUnless(os.environ.get("MEASUREMAN_TEST_COMPILED_WORKER") and os.environ.get("MEASUREMAN_TEST_NODE"), "opt-in compiled worker acceptance")
class CompiledWorkerTests(unittest.TestCase):
    def test_env_worker_collects_and_publishes_without_any_webpage_action(self):
        self.run_environment_worker(include_ads=False)

    def test_env_worker_collects_all_ad_days_and_empty_markets_before_publication(self):
        self.run_environment_worker(include_ads=True)

    def test_failed_ad_day_preserves_reports_and_does_not_skip_other_days_or_markets(self):
        self.run_environment_worker(include_ads=True, fail_ad=True)

    def run_environment_worker(self, *, include_ads, fail_ad=False):
        from urllib.parse import quote
        fixture = fixtures.GerpgoPreviewTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        state = fixture.runtime / "db" / "operations.sqlite3"
        with sqlite3.connect(state) as db:
            db.execute("UPDATE data_refresh_tasks_v1 SET status='completed'")
        automation = Path(__file__).resolve().parents[1]
        bundle = fixture.runtime / "isolated-worker"
        shutil.copytree(Path(os.environ["MEASUREMAN_TEST_COMPILED_WORKER"]).resolve().parents[1], bundle)
        # Intercept the official URLs rather than configuring an untrusted credential endpoint.
        # Unexpected requests fail closed: no external provider calls in this acceptance test.
        preload = """// Accelerate the collector's fixed pacing in this isolated, network-free test only.
const timer = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => timer(callback, ms === 1200 ? 1 : ms, ...args);
let failedAd = false;
globalThis.fetch = async (url, options) => {
  const endpoint = new URL(url).pathname.replace('/api/open', '');
  const request = JSON.parse(options.body);
  let data;
  if (endpoint === '/api_token') data = {accessToken:'fixture-token', expiresIn:3600};
  else if (endpoint === '/middle/base/market/page') data = {rows:[{marketListVos:[1,2,3].map((marketId,index)=>({marketId,market:['amazon-us','amazon-ca','amazon-mx'][index],serverName:'MEASUREMAN',serverId:1}))}],total:1};
  else if (endpoint === '/purchase/goods/product/page') data = {rows:[{sku:'SKU-A'}],total:1};
  else if (endpoint === '/operation/sts/productAnalyzeMultiIndex/page') data = {rows:[{marketId:1,sku:'SKU-A',isParent:false,unitsOrdered:40,returns:null,orderProductSalesAmount:{currencyAmount:100,currencyCode:'USD'}}],total:1};
  else if (endpoint === '/operation/ads/adsAsinAnalytical/page') {
    if (process.env.TEST_FAIL_AD === 'true' && request.marketId === 2 && !failedAd) {
      failedAd = true;
      data = {rows:null,total:1}; // A malformed day must fail, not masquerade as no ads.
    } else data = request.marketId === 3 ? {rows:null,total:0} : {rows:[{marketId:request.marketId,msku:'SKU-A'}],total:1};
  }
  else throw new Error('Unmocked provider request');
  return Response.json({code:200,data});
};
"""
        environment = {**os.environ, "STORE_OPS_RUNTIME_ROOT": str(fixture.runtime), "STORE_OPS_STATE_DB": str(state),
                       "STORE_OPS_AUTOMATION_ROOT": str(automation), "STORE_OPS_PYTHON": sys.executable,
                       "GERPGO_APP_ID": "fixture-id", "GERPGO_APP_KEY": "fixture-key", "GERPGO_STORE_NAME": "MEASUREMAN",
                       "GERPGO_AUTO_SYNC": "true", "GERPGO_SYNC_SUPPLEMENTAL": str(include_ads).lower(), "GERPGO_SYNC_INTERVAL_MINUTES": "1440", "NODE_PATH": "",
                       "TEST_FAIL_AD": str(fail_ad).lower()}
        process = subprocess.Popen([os.environ["MEASUREMAN_TEST_NODE"], "--import=data:text/javascript," + quote(preload), str(bundle / "worker" / "data-worker.js")], cwd=bundle, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 40
            status = None
            while time.monotonic() < deadline and process.poll() is None:
                with sqlite3.connect(state) as db:
                    exists = db.execute("SELECT name FROM sqlite_master WHERE name='data_sync_schedules_v1'").fetchone()
                    row = db.execute("SELECT t.status,t.id FROM data_sync_schedules_v1 s JOIN data_refresh_tasks_v1 t ON t.id=s.last_task_id WHERE s.key='gerpgo'").fetchone() if exists else None
                status = row[0] if row else None
                if status in ("completed", "failed", "awaiting_review", "awaiting_mapping"):
                    break
                time.sleep(.1)
            self.assertEqual(status, "failed" if fail_ad else "completed")
            manifest = json.loads((fixture.runtime / "incoming" / "gerpgo" / row[1] / "manifest.json").read_text())
            self.assertEqual(manifest["collectionMode"], "sales_ads" if include_ads else "sales")
            sources = manifest["sources"]
            self.assertFalse(any(source["name"].startswith(("fba", "returns", "storage")) for source in sources))
            if include_ads:
                ads = [source for source in sources if source["name"].startswith("ads-")]
                self.assertGreater(len(ads), 500)
                self.assertEqual(sum(source["status"] == "failed" for source in ads), int(fail_ad))
                self.assertFalse(any(source["status"] == "skipped" for source in ads))
                self.assertTrue(any(source["condition"]["marketId"] == 3 and source["total"] == 0 for source in ads))
                self.assertTrue(any(source["condition"]["marketId"] == 2 and source["status"] == "completed" for source in ads))
            if fail_ad:
                self.assertFalse((current_reports(fixture.reports) / "gerpgo-performance.json").exists())
                self.assertEqual(json.loads((current_reports(fixture.reports) / "manual.json").read_text()), {"notes": "preserve"})
                return
            report = json.loads((current_reports(fixture.reports) / "gerpgo-performance.json").read_text())
            self.assertEqual(len(report["rows"]), 7)
            self.assertEqual(report["storeScope"]["storeName"], "MEASUREMAN")
            self.assertEqual(report["publication"]["initialAuthorization"]["actor"], "environment-policy")
            self.assertIsNone(report["publication"]["initialReview"])
            self.assertNotIn("fixture-key", json.dumps(report))
            self.assertEqual(json.loads((current_reports(fixture.reports) / "manual.json").read_text()), {"notes": "preserve"})
        finally:
            process.terminate()
            _, errors = process.communicate(timeout=10)
            if process.returncode not in (0, -15):
                self.fail("Compiled env worker startup failed: " + errors[-1000:])

    def test_reviewed_queue_publishes_and_audits_without_provider_calls(self):
        fixture = fixtures.GerpgoPreviewTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        preview = build_preview(fixture.runtime, fixtures.TASK)
        state = fixture.runtime / "db" / "operations.sqlite3"
        request = {"sourceTaskId": fixtures.TASK, "previewHash": preview["previewHash"], "confirmed": True}
        with sqlite3.connect(state) as db:
            db.execute("UPDATE data_refresh_tasks_v1 SET status='completed'")
            db.execute("INSERT INTO data_refresh_tasks_v1(id,kind,status,created_at,updated_at,request_json) VALUES('queued-publish','gerpgo_publish','queued','2000','2000',?)", (json.dumps(request),))
        automation = Path(__file__).resolve().parents[1]
        # Running under the checkout accidentally resolves missing image
        # packages from the developer's node_modules. Test the actual worker
        # bundle outside that tree, with no inherited module search path.
        bundle = fixture.runtime / "isolated-worker"
        shutil.copytree(Path(os.environ["MEASUREMAN_TEST_COMPILED_WORKER"]).resolve().parents[1], bundle)
        environment = {**os.environ, "STORE_OPS_RUNTIME_ROOT": str(fixture.runtime), "STORE_OPS_STATE_DB": str(state),
                       "STORE_OPS_AUTOMATION_ROOT": str(automation), "STORE_OPS_PYTHON": sys.executable,
                       "GERPGO_APP_ID": "", "GERPGO_APP_KEY": "", "NODE_PATH": ""}
        process = subprocess.Popen([os.environ["MEASUREMAN_TEST_NODE"], str(bundle / "worker" / "data-worker.js")], cwd=bundle, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 20
            status = "queued"
            while time.monotonic() < deadline and process.poll() is None:
                with sqlite3.connect(state) as db:
                    status = db.execute("SELECT status FROM data_refresh_tasks_v1 WHERE id='queued-publish'").fetchone()[0]
                if status in ("completed", "failed"):
                    break
                time.sleep(.1)
            self.assertEqual(status, "completed")
            active = current_reports(fixture.reports)
            report = json.loads((active / "gerpgo-performance.json").read_text())
            self.assertEqual(report["sourceTaskId"], fixtures.TASK)
            self.assertEqual(report["publication"]["actor"], "shared-account")
            source_data = json.loads((active / "gerpgo-source-data.json").read_text())
            self.assertEqual(source_data["sourceTaskId"], fixtures.TASK)
            self.assertEqual(len(source_data["sources"]), 10)
            with sqlite3.connect(state) as db:
                jobs = db.execute("SELECT job_name,status FROM runs").fetchall()
            self.assertIn(("worker-gerpgo_publish", "completed"), jobs)
            self.assertIn(("publish-gerpgo-performance", "completed"), jobs)
        finally:
            process.terminate()
            _, errors = process.communicate(timeout=10)
            if process.returncode not in (0, -15):
                self.fail("Compiled worker startup failed: " + errors[-1000:])
