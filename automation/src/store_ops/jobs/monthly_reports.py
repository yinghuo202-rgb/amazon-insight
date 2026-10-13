from __future__ import annotations

import hashlib
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from ..config import ProjectConfig
from ..db import StateDb
from ..monthly_report_values import open_monthly_report, validated_monthly_rows
from ..sku import SkuNormalizer


REPORT_NAME_RE = re.compile(
    r"(20\d{2})[._-]?(0?[1-9]|1[0-2])月.*销售和毛利报告-(US|CA|MX)\.xlsx$",
    re.IGNORECASE,
)
# AU is recognized only to exclude its historical files from US/CA readers;
# it is deliberately not a supported import identity above.
REPORT_MARKET_RE = re.compile(r"-(US|CA|MX|AU)\.xlsx$", re.IGNORECASE)


def _report_paths(root: Path):
    """All consumers recognize the same named .xlsx candidates, case-insensitively."""
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() == ".xlsx" and "销售和毛利报告" in path.name:
            yield path


def _report_market(path: Path) -> str:
    """Read only the authoritative suffix before validating a target market's period."""
    match = REPORT_MARKET_RE.search(path.name)
    if not match:
        raise ValueError(f"无法从文件名识别月报站点后缀: {path.name}")
    return match.group(1).upper()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _report_identity(path: Path) -> tuple[str, str]:
    match = REPORT_NAME_RE.search(path.name)
    if not match:
        raise ValueError(f"无法从文件名识别月份和站点: {path.name}")
    return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}", match.group(3).upper()


def _validate_report(path: Path, normalizer: SkuNormalizer) -> tuple[str, str, int]:
    if not path.is_file():
        raise FileNotFoundError(path)
    report_month, market = _report_identity(path)
    with open_monthly_report(path) as workbook:
        data_rows = sum(1 for _ in validated_monthly_rows(workbook, path, normalizer))
    return report_month, market, data_rows


def run(config: ProjectConfig, db: StateDb, sources: list[Path]) -> dict:
    run_id = db.start_run("import-monthly-reports")
    try:
        if not sources:
            raise ValueError("至少需要一个 --source 月报文件")
        normalizer = SkuNormalizer(config.sku_pattern, config.ignore_values)
        validated = []
        for source in sources:
            resolved = source.expanduser().resolve()
            report_month, market, data_rows = _validate_report(resolved, normalizer)
            digest = _sha256(resolved)
            validated.append((resolved, report_month, market, data_rows, digest))
        imported = []
        for resolved, report_month, market, data_rows, digest in validated:
            destination_dir = config.runtime_root / "incoming" / "monthly-sales-reports" / report_month / market
            destination_dir.mkdir(parents=True, exist_ok=True)
            destination = destination_dir / resolved.name
            temporary = destination.with_suffix(destination.suffix + ".tmp")
            shutil.copy2(resolved, temporary)
            temporary.replace(destination)
            imported.append({
                "market": market,
                "reportMonth": report_month,
                "sourcePath": str(resolved),
                "storedPath": str(destination),
                "sha256": digest,
                "dataRows": data_rows,
                "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            })
        summary = {"run_id": run_id, "imported": imported, "count": len(imported)}
        db.finish_run(run_id, "completed", summary=summary)
        return summary
    except Exception as exc:
        db.finish_run(run_id, "failed", error=repr(exc))
        raise
