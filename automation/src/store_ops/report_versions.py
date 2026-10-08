"""One publisher for immutable report generations; source workbooks are untouched."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

VERSION_RE = re.compile(r"data-\d{8}-\d{6}-[a-zA-Z0-9-]{1,20}")


def current_reports(root: Path) -> Path:
    pointer = root / "current.json"
    if not pointer.exists():
        return root
    value = json.loads(pointer.read_text(encoding="utf-8"))
    version = value.get("version", "")
    if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
        raise ValueError("Invalid report version pointer")
    target = root / ".versions" / version / "reports"
    if not target.is_dir():
        raise FileNotFoundError("Published report generation is missing")
    return target


def _copy_reports(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for item in source.glob("*.json"):
        if item.name != "current.json":
            shutil.copy2(item, destination / item.name)


def _json_write(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _sync_directory(path: Path) -> None:
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


@contextmanager
def report_transaction(root: Path, snapshots: Path, before_commit=None):
    """Yield (staged reports, backup version). Publish only on successful exit.

    Snapshot identifiers retain the existing UI's 'before this import' meaning.
    The current pointer always addresses the NEW immutable generation.
    """
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / ".publish.lock").open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            lock.write(b"0")
            lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            deadline = time.monotonic() + 5
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Another report publication is running") from None
                    time.sleep(0.05)
        version = "data-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:12]
        active = current_reports(root)
        _copy_reports(active, snapshots / version / "reports")
        stage = root / ".versions" / version / "reports"
        _copy_reports(active, stage)
        yield stage, version
        files = {}
        for item in sorted(stage.glob("*.json")):
            value = json.loads(item.read_text(encoding="utf-8"))
            json.dumps(value, allow_nan=False)
            if not isinstance(value, dict):
                raise ValueError(f"Report must contain an object: {item.name}")
            files[item.name] = hashlib.sha256(item.read_bytes()).hexdigest()
            with item.open("rb") as handle:
                os.fsync(handle.fileno())
        if not files:
            raise ValueError("Cannot publish an empty report generation")
        manifest = {"schemaVersion": 1, "version": version,
                    "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "files": files}
        _json_write(stage.parent / "manifest.json", manifest)
        _sync_directory(stage)
        _sync_directory(stage.parent)
        _sync_directory(stage.parent.parent)
        # Same-filesystem rename is the sole commit point. Interrupted stages are never read.
        if before_commit is not None:
            before_commit()
        _json_write(root / "current.json", manifest)
        _sync_directory(root)
    finally:
        lock.close()  # OS releases the lease even if the process exits unexpectedly.


def restore_reports(version: str, root: Path, snapshots: Path) -> dict:
    if not VERSION_RE.fullmatch(version):
        raise ValueError("数据版本编号不正确")
    source = snapshots / version / "reports"
    if not source.is_dir():
        raise FileNotFoundError(f"数据版本不存在: {version}")
    with report_transaction(root, snapshots) as (stage, new_version):
        # Deletions belong to a version too; never leave new-only files after rollback.
        for item in stage.glob("*.json"):
            item.unlink()
        _copy_reports(source, stage)
        restored = sorted(item.name for item in stage.glob("*.json"))
    return {"status": "restored", "dataVersion": version, "publishedVersion": new_version,
            "restoredReports": restored, "restoredAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
