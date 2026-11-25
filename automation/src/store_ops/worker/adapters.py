from __future__ import annotations

from dataclasses import dataclass, field
import json
import shlex
import subprocess
from typing import Any
from urllib import error, request

from .config import WorkerConfig

_BOT_CHALLENGE_MARKERS = (
    "captcha",
    "verify you are human",
    "turnstile",
    "hcaptcha",
    "recaptcha",
    "robot check",
    "anti-bot",
)


class AdapterError(RuntimeError):
    def __init__(self, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass
class AdapterResult:
    items: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] = field(default_factory=dict)


def _contains_bot_challenge(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _BOT_CHALLENGE_MARKERS)


def _parse_adapter_payload(raw_text: str, source_label: str) -> AdapterResult:
    stripped = raw_text.strip()
    if not stripped:
        return AdapterResult()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise AdapterError(f"{source_label} 返回了无效的 JSON：{exc}", retryable=False) from exc

    if isinstance(parsed, list):
        items = [entry for entry in parsed if isinstance(entry, dict)]
        return AdapterResult(items=items, result={"itemCount": len(items)})

    if isinstance(parsed, dict):
        if parsed.get("error"):
            err_msg = str(parsed["error"])
            retryable = bool(parsed.get("retryable", True)) and not _contains_bot_challenge(err_msg)
            raise AdapterError(err_msg, retryable=retryable)
        raw_items = parsed.get("items") or []
        if not isinstance(raw_items, list):
            raise AdapterError(f"{source_label} 的 items 字段必须是数组。", retryable=False)
        items = [entry for entry in raw_items if isinstance(entry, dict)]
        meta = parsed.get("meta") if isinstance(parsed.get("meta"), dict) else {}
        return AdapterResult(items=items, result={**meta, "itemCount": len(items)})

    raise AdapterError(f"{source_label} 返回结构不受支持。", retryable=False)


def _run_webhook(url: str, job: dict[str, Any], config: WorkerConfig) -> AdapterResult:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if config.webhook_token:
        headers["Authorization"] = f"Bearer {config.webhook_token}"

    body = json.dumps({
        "jobId": job.get("id"),
        "target": job.get("target"),
        "action": job.get("action"),
        "marketplace": job.get("marketplace"),
        "query": job.get("query"),
        "linkedAsin": job.get("linkedAsin"),
        "linkedSku": job.get("linkedSku"),
        "syncToPool": bool(job.get("syncToPool")),
        "payload": job.get("payload") or {},
    }).encode("utf-8")

    req = request.Request(url, data=body, method="POST", headers=headers)
    try:
        with request.urlopen(req, timeout=config.cmd_timeout_sec) as resp:
            return _parse_adapter_payload(resp.read().decode("utf-8"), "Webhook")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if _contains_bot_challenge(detail):
            raise AdapterError("目标站点触发反爬或验证码拦截，任务已停止并等待人工处理。", retryable=False) from exc
        retryable = exc.code >= 500 or exc.code == 429
        raise AdapterError(f"Webhook 返回 HTTP {exc.code}: {detail[:300]}", retryable=retryable) from exc
    except (error.URLError, TimeoutError, OSError) as exc:
        raise AdapterError(f"Webhook 请求失败: {exc}", retryable=True) from exc


def _run_command(cmd: str, job: dict[str, Any], config: WorkerConfig) -> AdapterResult:
    argv = shlex.split(cmd)
    if not argv:
        raise AdapterError("爬虫命令配置为空。", retryable=False)
    try:
        proc = subprocess.run(
            argv,
            input=json.dumps(job),
            capture_output=True,
            text=True,
            timeout=config.cmd_timeout_sec,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AdapterError(f"爬虫命令执行超时（>{config.cmd_timeout_sec}s）。", retryable=True) from exc
    except OSError as exc:
        raise AdapterError(f"无法启动爬虫命令：{exc}", retryable=False) from exc

    if proc.returncode != 0:
        err_text = (proc.stderr or proc.stdout or f"exit code {proc.returncode}").strip()
        if _contains_bot_challenge(err_text):
            raise AdapterError("目标站点触发反爬或验证码拦截，任务已停止并等待人工处理。", retryable=False)
        raise AdapterError(f"爬虫命令失败 ({proc.returncode}): {err_text[:400]}", retryable=True)

    return _parse_adapter_payload(proc.stdout, "爬虫命令")


def execute_crawl_job(job: dict[str, Any], config: WorkerConfig) -> AdapterResult:
    target = str(job.get("target") or "").strip().lower()
    if target == "amazon":
        if config.amazon_webhook_url:
            return _run_webhook(config.amazon_webhook_url, job, config)
        if config.amazon_cmd:
            return _run_command(config.amazon_cmd, job, config)
        raise AdapterError(
            "未配置 Amazon 爬虫适配器，请设置 CRAWLER_AMAZON_WEBHOOK_URL 或 CRAWLER_AMAZON_CMD。",
            retryable=False,
        )

    if target == "1688":
        if config.supplier_1688_webhook_url:
            return _run_webhook(config.supplier_1688_webhook_url, job, config)
        if config.supplier_1688_cmd:
            return _run_command(config.supplier_1688_cmd, job, config)
        raise AdapterError(
            "未配置 1688 爬虫适配器，请设置 CRAWLER_1688_WEBHOOK_URL 或 CRAWLER_1688_CMD。",
            retryable=False,
        )

    raise AdapterError(f"不支持的爬虫目标：{target}", retryable=False)
