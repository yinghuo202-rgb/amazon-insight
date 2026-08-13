from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import openpyxl

from ..config import ProjectConfig
from ..db import StateDb


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _number(value: object) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def _safe_url(value: object) -> str:
    raw = _text(value)
    if not raw.startswith(("http://", "https://")):
        return ""
    parts = urlsplit(raw)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _candidate_rows(sheet) -> list[dict]:
    rows = list(sheet.iter_rows(values_only=True))
    candidates: list[dict] = []
    for index, row in enumerate(rows):
        sku = _text(row[0] if row else None)
        if not sku or sku in {"SKU", "序号"}:
            continue
        detail = rows[index + 1] if index + 1 < len(rows) else row
        url = _safe_url(row[15] if len(row) > 15 else None) or _safe_url(detail[15] if len(detail) > 15 else None)
        price = _number(detail[2] if len(detail) > 2 else None)
        purchase = _number(detail[9] if len(detail) > 9 else None)
        margin = _number(detail[13] if len(detail) > 13 else None)
        profit = _number(detail[12] if len(detail) > 12 else None)
        if price is None and purchase is None and margin is None:
            continue
        candidates.append({
            "sku": sku,
            "name": sku,
            "amazonPrice": price,
            "firstMile": _number(detail[3] if len(detail) > 3 else None),
            "storageFee": _number(detail[4] if len(detail) > 4 else None),
            "commission": _number(detail[5] if len(detail) > 5 else None),
            "orderFee": _number(detail[6] if len(detail) > 6 else None),
            "importDutyRate": _number(detail[8] if len(detail) > 8 else None),
            "purchaseCostRmb": purchase,
            "grossProfit": profit,
            "grossMargin": margin,
            "competitorUrl": url,
        })
    return candidates


def _monthly_rows(sheet, month: str) -> list[dict]:
    rows = list(sheet.iter_rows(values_only=True))
    result: list[dict] = []
    for row in rows[2:]:
        sku = _text(row[1] if len(row) > 1 else None)
        if not sku or sku in {"SKU", "货号"}:
            continue
        result.append({
            "month": month,
            "sku": sku,
            "name": _text(row[3] if len(row) > 3 else None) or sku,
            "orderQuantity": _number(row[4] if len(row) > 4 else None),
            "costRmb": _number(row[5] if len(row) > 5 else None),
            "status": _text(row[6] if len(row) > 6 else None),
            "usStatus": _text(row[7] if len(row) > 7 else None),
            "caStatus": _text(row[8] if len(row) > 8 else None),
        })
    return result


def build_report(config: ProjectConfig, workbook_path: Path) -> dict:
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    try:
        candidates = _candidate_rows(workbook["Sheet1"]) if "Sheet1" in workbook.sheetnames else []
        monthly_orders: list[dict] = []
        for sheet_name in workbook.sheetnames:
            match = re.fullmatch(r"(\d{1,2})月新品", sheet_name.strip())
            if match:
                monthly_orders.extend(_monthly_rows(workbook[sheet_name], f"2026-{int(match.group(1)):02d}"))
    finally:
        workbook.close()

    margins = [row["grossMargin"] for row in candidates if row["grossMargin"] is not None]
    ordered = [row for row in monthly_orders if (row["orderQuantity"] or 0) > 0]
    modified_at = datetime.fromtimestamp(workbook_path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"path": str(workbook_path.relative_to(config.data_root)).replace("\\", "/"), "modifiedAt": modified_at, "sha256": _fingerprint(workbook_path), "sheet": "Sheet1"},
        "summary": {
            "candidateCount": len(candidates),
            "viableCandidateCount": sum(1 for margin in margins if margin >= 0.3),
            "averageGrossMargin": sum(margins) / len(margins) if margins else 0,
            "latestOrderMonth": max((row["month"] for row in ordered), default=None),
            "orderedSkuCount": len({row["sku"] for row in ordered}),
            "plannedUnits": int(sum(row["orderQuantity"] or 0 for row in ordered)),
            "monthCount": len({row["month"] for row in monthly_orders}),
        },
        "candidates": candidates,
        "monthlyOrders": monthly_orders,
    }


def run(config: ProjectConfig, db: StateDb) -> dict:
    relative = str(config.inventory_dashboard.get("new_product_research_workbook", "新品调研表8.13.xlsx"))
    source = (config.data_root / relative).resolve()
    if not source.exists():
        raise FileNotFoundError(f"新品调研源文件不存在: {source}")
    report = build_report(config, source)
    output = config.runtime_root / "reports" / "new_product_research.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"status": "completed", "report": str(output), "summary": report["summary"]}
