from __future__ import annotations

import json
from typing import Any
from urllib import error, request


class WorkerApiError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class WorkerApiClient:
    def __init__(
        self,
        base_url: str,
        auth_token: str | None,
        timeout_sec: float = 45.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth_token = (auth_token or "").strip() or None
        self.timeout_sec = timeout_sec

    def _post_json(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.auth_token:
            raise WorkerApiError("未配置 WORKER_AUTH_TOKEN 或 SECRET_KEY，Worker 无法调用内部接口。")

        body = json.dumps(payload or {}).encode("utf-8")
        req = request.Request(
            f"{self.base_url}{path}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with request.urlopen(req, timeout=self.timeout_sec) as resp:
                raw = resp.read().decode("utf-8") or "{}"
                return json.loads(raw)
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            message = detail
            try:
                parsed = json.loads(detail)
                if isinstance(parsed, dict) and parsed.get("error"):
                    message = str(parsed["error"])
            except json.JSONDecodeError:
                pass
            raise WorkerApiError(f"HTTP {exc.code} on {path}: {message}", status_code=exc.code) from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise WorkerApiError(f"Network error on {path}: {exc}") from exc

    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._post_json("/api/worker/heartbeat", payload)

    def trigger_erp_sync(self) -> dict[str, Any]:
        return self._post_json("/api/worker/erp-sync", {})

    def claim_job(self, worker_id: str, targets: list[str] | None = None) -> dict[str, Any] | None:
        payload: dict[str, Any] = {"workerId": worker_id}
        if targets:
            payload["targets"] = targets
        data = self._post_json("/api/worker/jobs/claim", payload)
        job = data.get("job")
        return job if isinstance(job, dict) else None

    def complete_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._post_json("/api/worker/jobs/complete", payload)
