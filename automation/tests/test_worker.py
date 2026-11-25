from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

from store_ops.worker.adapters import AdapterError, AdapterResult, execute_crawl_job
from store_ops.worker.client import WorkerApiError
from store_ops.worker.config import WorkerConfig, derive_worker_token
from store_ops.worker.runner import WorkerRunner


class FakeWorkerClient:
    def __init__(self, jobs: list[dict] | None = None, fail_erp: bool = False) -> None:
        self.jobs = list(jobs or [])
        self.fail_erp = fail_erp
        self.erp_calls = 0
        self.completed: list[dict] = []
        self.heartbeats: list[dict] = []

    def trigger_erp_sync(self) -> dict:
        self.erp_calls += 1
        if self.fail_erp:
            raise WorkerApiError("HTTP 500: erp timeout", status_code=500)
        return {"ok": True, "skipped": False, "lastSyncedAt": "2026-11-25T07:00:00Z"}

    def claim_job(self, worker_id: str, targets=None) -> dict | None:
        if not self.jobs:
            return None
        return self.jobs.pop(0)

    def complete_job(self, payload: dict) -> dict:
        self.completed.append(payload)
        return {"ok": True}

    def heartbeat(self, payload: dict) -> dict:
        self.heartbeats.append(payload)
        return {"ok": True}


class WorkerTests(unittest.TestCase):
    def test_derive_worker_token_matches_node_hmac_vector(self) -> None:
        self.assertEqual(
            derive_worker_token("test-worker-secret-123"),
            "b385054519f34cce333a5469c4f8c5a814617e08c3183e9fc1c72f91f37733ae",
        )
        self.assertIsNone(derive_worker_token("  "))

    def test_runner_tick_syncs_erp_processes_jobs_and_writes_heartbeat(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            hb_path = Path(tmpdir) / "heartbeat.json"
            config = WorkerConfig.from_env({
                "WORKER_ID": "test-worker",
                "SECRET_KEY": "test-worker-secret-123",
                "WORKER_HEARTBEAT_FILE": str(hb_path),
                "WORKER_ERP_SYNC_INTERVAL_SEC": "60",
                "WORKER_HEARTBEAT_INTERVAL_SEC": "30",
            })
            client = FakeWorkerClient(jobs=[
                {"id": "job-1", "target": "amazon", "marketplace": "US", "query": "B012345678"},
                {"id": "job-2", "target": "1688", "marketplace": "CN", "query": "pressure gauge"},
            ])

            def fake_executor(job: dict, _cfg: WorkerConfig) -> AdapterResult:
                if job["id"] == "job-2":
                    raise AdapterError("target blocked by captcha", retryable=False)
                return AdapterResult(
                    items=[{"asin": "B012345678", "title": "Gauge"}],
                    result={"itemCount": 1},
                )

            runner = WorkerRunner(config, client=client, executor=fake_executor)
            summary = runner.run_tick(now_mono=100.0, now_epoch=1_700_000_000.0)

            self.assertEqual(client.erp_calls, 1)
            self.assertEqual(summary["jobsProcessed"], 1)
            self.assertEqual(len(client.completed), 2)
            self.assertTrue(client.completed[0]["ok"])
            self.assertEqual(client.completed[0]["items"][0]["asin"], "B012345678")
            self.assertFalse(client.completed[1]["ok"])
            self.assertFalse(client.completed[1]["retryable"])
            self.assertEqual(len(client.heartbeats), 1)
            self.assertTrue(hb_path.exists())
            hb_data = json.loads(hb_path.read_text(encoding="utf-8"))
            self.assertEqual(hb_data["workerId"], "test-worker")
            self.assertEqual(hb_data["ts"], 1_700_000_000.0)

    def test_runner_handles_erp_sync_error_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            hb_path = Path(tmpdir) / "heartbeat.json"
            config = WorkerConfig.from_env({
                "WORKER_ID": "test-worker",
                "SECRET_KEY": "test-worker-secret-123",
                "WORKER_HEARTBEAT_FILE": str(hb_path),
            })
            client = FakeWorkerClient(fail_erp=True)
            runner = WorkerRunner(config, client=client)

            summary = runner.run_tick(now_mono=10.0, now_epoch=1_700_000_010.0)
            self.assertEqual(summary["status"], "ERROR")
            self.assertIn("HTTP 500", runner.last_erp_error or "")
            self.assertTrue(hb_path.exists())

    def test_execute_crawl_job_command_and_unconfigured_target(self) -> None:
        unconfigured = WorkerConfig.from_env({"SECRET_KEY": "abc"})
        with self.assertRaises(AdapterError) as ctx:
            execute_crawl_job({"id": "j1", "target": "amazon", "query": "B012345678"}, unconfigured)
        self.assertFalse(ctx.exception.retryable)

        script = (
            "import json,sys; j=json.load(sys.stdin); "
            "print(json.dumps({'items':[{'asin':j['query'],'title':'Gauge'}],'meta':{'via':'cmd'}}))"
        )
        cmd = f'"{sys.executable}" -c "{script}"'
        configured = WorkerConfig.from_env({
            "SECRET_KEY": "abc",
            "CRAWLER_AMAZON_CMD": cmd,
        })
        res = execute_crawl_job({"id": "j2", "target": "amazon", "query": "B012345678"}, configured)
        self.assertEqual(len(res.items), 1)
        self.assertEqual(res.items[0]["asin"], "B012345678")
        self.assertEqual(res.result.get("via"), "cmd")


if __name__ == "__main__":
    unittest.main()
