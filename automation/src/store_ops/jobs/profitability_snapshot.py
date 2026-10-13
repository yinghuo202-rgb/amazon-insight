from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from ..config import ProjectConfig
from ..db import StateDb
from ..monthly_report_values import open_monthly_report, validated_monthly_rows
from ..sku import SkuNormalizer
from .monthly_reports import _report_identity, _report_paths


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _latest_reports(root: Path) -> dict[tuple[str, str], Path]:
    latest: dict[tuple[str, str], Path] = {}
    for path in _report_paths(root):
        try:
            month, market = _report_identity(path)
        except ValueError:
            continue
        key = (market, month)
        current = latest.get(key)
        if current is None or (path.stat().st_mtime, str(path)) > (current.stat().st_mtime, str(current)):
            latest[key] = path
    return latest


def _read_report(path: Path, market: str, report_month: str, normalizer: SkuNormalizer) -> list[dict]:
    aggregate: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    with open_monthly_report(path) as workbook:
        for sku, values in validated_monthly_rows(workbook, path, normalizer):
            item = aggregate[sku]
            item["units"] += max(0, values["units"])
            item["productSales"] += values["productSales"]
            item["settlementPayout"] += values["settlementPayout"]
            item["returns"] += max(0, values["returns"])
            item["landedCost"] += max(0, values["landedCost"])
            item["grossProfit"] += values["grossProfit"]
            item["advertisingCost"] += max(0, -values["advertisingCost"])
            item["storageCost"] += max(0, -values["storageCost"])
            item["actualProfit"] += values["actualProfit"]

    rows = []
    for sku, item in sorted(aggregate.items()):
        units = int(round(item["units"]))
        returns = int(round(item["returns"]))
        net_units = max(0, units - returns)
        product_sales = round(item["productSales"], 2)
        actual_profit = round(item["actualProfit"], 2)
        storage_cost = round(item["storageCost"], 2)
        rows.append({
            "market": market,
            "currency": {"CA": "CAD", "MX": "MXN"}.get(market, "USD"),
            "reportMonth": report_month,
            "sku": sku,
            "units": units,
            "returns": returns,
            "netUnits": net_units,
            "productSales": product_sales,
            "settlementPayout": round(item["settlementPayout"], 2),
            "landedCost": round(item["landedCost"], 2),
            "grossProfit": round(item["grossProfit"], 2),
            "advertisingCost": round(item["advertisingCost"], 2),
            "storageCost": storage_cost,
            "actualProfit": actual_profit,
            "currentPrice": None,
            "averagePrice": round(product_sales / units, 2) if units > 0 else None,
            "sourceKind": "excel",
            "quality": {"profitVerified": False, "returnsVerified": False, "completePeriod": report_month < datetime.now(timezone.utc).strftime("%Y-%m")},
            "grossMargin": round(item["grossProfit"] / product_sales, 4) if product_sales > 0 else None,
            "actualMargin": round(actual_profit / product_sales, 4) if product_sales > 0 else None,
            "conservativeMargin": round((actual_profit - storage_cost) / product_sales, 4) if product_sales > 0 else None,
        })
    return rows


def run(config: ProjectConfig, db: StateDb) -> dict:
    run_id = db.start_run("build-profitability-data")
    try:
        configured_root = os.environ.get("STORE_OPS_PROFITABILITY_ROOT") or config.inventory_dashboard.get("profitability_report_root")
        if not configured_root:
            raise ValueError("profitability_report_root is not configured")
        report_root = Path(str(configured_root)).expanduser().resolve()
        reports = _latest_reports(report_root)
        if not reports:
            raise FileNotFoundError(f"No profitability reports found in {report_root}")
        normalizer = SkuNormalizer(config.sku_pattern, config.ignore_values)
        sources = []
        rows = []
        markets = sorted({market for market, _ in reports})
        for (market, report_month), path in sorted(reports.items()):
            rows.extend(_read_report(path, market, report_month, normalizer))
            sources.append({
                "market": market,
                "reportMonth": report_month,
                "path": str(path),
                "modifiedAt": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds"),
                "sha256": _sha256(path),
                "sheet": "SKU销售汇总",
            })
        report_path = config.runtime_root / "reports" / "profitability.json"
        if report_path.exists():
            previous = json.loads(report_path.read_text(encoding="utf-8"))
            replaced = set(reports)
            rows = [row for row in previous.get("rows", [])
                    if (row.get("market"), row.get("reportMonth")) not in replaced] + rows
            sources = [source for source in previous.get("sources", [])
                       if (source.get("market"), source.get("reportMonth")) not in replaced] + sources
        rows.sort(key=lambda row: (row["market"], row["reportMonth"], row["sku"]))
        payload = {
            "schemaVersion": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "method": "按 SKU 汇总产品销售额、结算净额、FOB+头程、广告与仓储；清货期暂停广告，定价按每件平台扣费、FOB+头程和仓储保留 5% 毛利缓冲。",
            "sources": sources,
            "rows": rows,
        }
        report_path = config.runtime_root / "reports" / "profitability.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = report_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(report_path)
        summary = {
            "run_id": run_id,
            "report_path": str(report_path),
            "row_count": len(rows),
            "markets": {market: sorted(month for code, month in reports if code == market) for market in markets},
        }
        db.finish_run(run_id, "completed", summary=summary)
        return summary
    except Exception as exc:
        db.finish_run(run_id, "failed", error=repr(exc))
        raise
