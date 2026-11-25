from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import os
import socket
from typing import Mapping

WORKER_TOKEN_PURPOSE = "measureman-internal-worker-v1"


def derive_worker_token(secret_key: str | None) -> str | None:
    trimmed = (secret_key or "").strip()
    if not trimmed:
        return None
    return hmac.new(
        trimmed.encode("utf-8"),
        WORKER_TOKEN_PURPOSE.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _parse_int(raw: str | None, default: int, minimum: int, maximum: int) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _parse_float(raw: str | None, default: float, minimum: float, maximum: float) -> float:
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw.strip())
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class WorkerConfig:
    worker_id: str
    api_base_url: str
    auth_token: str | None
    poll_interval_sec: float = 10.0
    erp_sync_interval_sec: float = 60.0
    heartbeat_interval_sec: float = 30.0
    http_timeout_sec: float = 45.0
    max_jobs_per_tick: int = 5
    heartbeat_file: str = "/tmp/worker-heartbeat.json"
    amazon_webhook_url: str | None = None
    supplier_1688_webhook_url: str | None = None
    webhook_token: str | None = None
    amazon_cmd: str | None = None
    supplier_1688_cmd: str | None = None
    cmd_timeout_sec: float = 120.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "WorkerConfig":
        source = os.environ if env is None else env
        worker_id = (source.get("WORKER_ID") or "").strip() or socket.gethostname() or "default-worker"
        base_url = ((source.get("WORKER_API_BASE_URL") or "http://app:3000").strip() or "http://app:3000").rstrip("/")
        explicit_token = (source.get("WORKER_AUTH_TOKEN") or "").strip() or None
        auth_token = explicit_token or derive_worker_token(source.get("SECRET_KEY"))
        heartbeat_file = (source.get("WORKER_HEARTBEAT_FILE") or "/tmp/worker-heartbeat.json").strip()

        return cls(
            worker_id=worker_id[:80],
            api_base_url=base_url,
            auth_token=auth_token,
            poll_interval_sec=_parse_float(source.get("WORKER_POLL_INTERVAL_SEC"), 10.0, 1.0, 3600.0),
            erp_sync_interval_sec=_parse_float(source.get("WORKER_ERP_SYNC_INTERVAL_SEC"), 60.0, 0.0, 86400.0),
            heartbeat_interval_sec=_parse_float(source.get("WORKER_HEARTBEAT_INTERVAL_SEC"), 30.0, 5.0, 3600.0),
            http_timeout_sec=_parse_float(source.get("WORKER_HTTP_TIMEOUT_SEC"), 45.0, 5.0, 300.0),
            max_jobs_per_tick=_parse_int(source.get("WORKER_MAX_JOBS_PER_TICK"), 5, 1, 50),
            heartbeat_file=heartbeat_file or "/tmp/worker-heartbeat.json",
            amazon_webhook_url=(source.get("CRAWLER_AMAZON_WEBHOOK_URL") or "").strip() or None,
            supplier_1688_webhook_url=(source.get("CRAWLER_1688_WEBHOOK_URL") or "").strip() or None,
            webhook_token=(source.get("CRAWLER_WEBHOOK_TOKEN") or "").strip() or None,
            amazon_cmd=(source.get("CRAWLER_AMAZON_CMD") or "").strip() or None,
            supplier_1688_cmd=(source.get("CRAWLER_1688_CMD") or "").strip() or None,
            cmd_timeout_sec=_parse_float(source.get("CRAWLER_CMD_TIMEOUT_SEC"), 120.0, 5.0, 900.0),
        )
