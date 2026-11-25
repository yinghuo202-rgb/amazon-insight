from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import signal
import threading
import time
from typing import Any, Callable

from .adapters import AdapterError, AdapterResult, execute_crawl_job
from .client import WorkerApiClient, WorkerApiError
from .config import WorkerConfig

logger = logging.getLogger("store_ops.worker")


def _utc_iso(now_epoch: float | None = None) -> str:
    ts = time.time() if now_epoch is None else now_epoch
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class WorkerRunner:
    def __init__(
        self,
        config: WorkerConfig,
        client: WorkerApiClient | None = None,
        executor: Callable[[dict[str, Any], WorkerConfig], AdapterResult] = execute_crawl_job,
    ) -> None:
        self.config = config
        self.client = client or WorkerApiClient(
            base_url=config.api_base_url,
            auth_token=config.auth_token,
            timeout_sec=config.http_timeout_sec,
        )
        self.executor = executor
        self.last_erp_sync_mono: float | None = None
        self.last_heartbeat_mono: float | None = None
        self.last_erp_sync_iso: str | None = None
        self.last_erp_error: str | None = None
        self.last_crawl_job_id: str | None = None
        self.last_crawl_iso: str | None = None

    def write_heartbeat_file(self, status: str, now_epoch: float | None = None) -> None:
        target = Path(self.config.heartbeat_file)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        payload = {
            "workerId": self.config.worker_id,
            "status": status,
            "ts": time.time() if now_epoch is None else now_epoch,
            "lastErpSyncAt": self.last_erp_sync_iso,
            "lastCrawlJobId": self.last_crawl_job_id,
        }
        tmp_path.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(tmp_path, target)

    def _build_heartbeat_payload(self, status: str) -> dict[str, Any]:
        return {
            "workerId": self.config.worker_id,
            "status": status,
            "lastErpSyncAt": self.last_erp_sync_iso,
            "lastErpError": self.last_erp_error,
            "lastCrawlJobId": self.last_crawl_job_id,
            "lastCrawlAt": self.last_crawl_iso,
            "meta": {
                "pollIntervalSec": self.config.poll_interval_sec,
                "erpSyncIntervalSec": self.config.erp_sync_interval_sec,
                "amazonAdapter": bool(self.config.amazon_webhook_url or self.config.amazon_cmd),
                "supplier1688Adapter": bool(self.config.supplier_1688_webhook_url or self.config.supplier_1688_cmd),
            },
        }

    def run_tick(
        self,
        now_mono: float | None = None,
        now_epoch: float | None = None,
    ) -> dict[str, Any]:
        mono = time.monotonic() if now_mono is None else now_mono
        epoch = time.time() if now_epoch is None else now_epoch
        tick_status = "IDLE"
        had_error = False
        jobs_processed = 0
        erp_synced = False

        if self.config.erp_sync_interval_sec > 0 and (
            self.last_erp_sync_mono is None
            or mono - self.last_erp_sync_mono >= self.config.erp_sync_interval_sec
        ):
            self.last_erp_sync_mono = mono
            try:
                res = self.client.trigger_erp_sync()
                if not res.get("skipped"):
                    self.last_erp_sync_iso = res.get("lastSyncedAt") or _utc_iso(epoch)
                    erp_synced = True
                self.last_erp_error = None
            except WorkerApiError as exc:
                had_error = True
                self.last_erp_error = str(exc)[:500]
                logger.warning("ERP sync failed: %s", exc)

        for _ in range(self.config.max_jobs_per_tick):
            try:
                job = self.client.claim_job(self.config.worker_id)
            except WorkerApiError as exc:
                had_error = True
                logger.warning("Failed to claim crawl job: %s", exc)
                break

            if not job:
                break

            tick_status = "RUNNING"
            job_id = str(job.get("id") or "")
            try:
                outcome = self.executor(job, self.config)
                self.client.complete_job({
                    "workerId": self.config.worker_id,
                    "jobId": job_id,
                    "ok": True,
                    "items": outcome.items,
                    "result": outcome.result,
                })
                self.last_crawl_job_id = job_id or self.last_crawl_job_id
                self.last_crawl_iso = _utc_iso(epoch)
                jobs_processed += 1
            except AdapterError as exc:
                had_error = True
                logger.warning("Crawl job %s failed (retryable=%s): %s", job_id, exc.retryable, exc)
                try:
                    self.client.complete_job({
                        "workerId": self.config.worker_id,
                        "jobId": job_id,
                        "ok": False,
                        "error": str(exc),
                        "retryable": exc.retryable,
                    })
                except WorkerApiError as report_exc:
                    logger.warning("Failed to report job %s failure: %s", job_id, report_exc)
            except WorkerApiError as exc:
                had_error = True
                logger.warning("Failed to complete job %s: %s", job_id, exc)
            except Exception as exc:  # pragma: no cover - defensive catch
                had_error = True
                logger.exception("Unexpected error in crawl job %s", job_id)
                try:
                    self.client.complete_job({
                        "workerId": self.config.worker_id,
                        "jobId": job_id,
                        "ok": False,
                        "error": str(exc),
                        "retryable": True,
                    })
                except WorkerApiError:
                    pass

        report_status = "ERROR" if had_error and jobs_processed == 0 and not erp_synced else tick_status
        heartbeat_due = (
            self.last_heartbeat_mono is None
            or jobs_processed > 0
            or mono - self.last_heartbeat_mono >= self.config.heartbeat_interval_sec
        )
        if heartbeat_due:
            self.last_heartbeat_mono = mono
            try:
                self.client.heartbeat(self._build_heartbeat_payload(report_status))
            except WorkerApiError as exc:
                logger.warning("Heartbeat failed: %s", exc)

        self.write_heartbeat_file(report_status, now_epoch=epoch)
        return {
            "status": report_status,
            "erpSynced": erp_synced,
            "jobsProcessed": jobs_processed,
        }

    def run_forever(self, stop_event: threading.Event | None = None) -> None:
        stopper = stop_event or threading.Event()

        def _handle_signal(signum: int, _frame: Any) -> None:
            logger.info("Received signal %s, stopping worker...", signum)
            stopper.set()

        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, _handle_signal)
            signal.signal(signal.SIGINT, _handle_signal)

        logger.info("Worker %s started (api=%s)", self.config.worker_id, self.config.api_base_url)
        while not stopper.is_set():
            self.run_tick()
            stopper.wait(timeout=self.config.poll_interval_sec)

        try:
            self.client.heartbeat(self._build_heartbeat_payload("STOPPED"))
        except WorkerApiError:
            pass
        self.write_heartbeat_file("STOPPED")
        logger.info("Worker %s stopped cleanly.", self.config.worker_id)
