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
        bundle = fixture.runtime.parent / "isolated-worker"
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
