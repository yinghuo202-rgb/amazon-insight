from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import openpyxl


TYPE_LABELS = {
    "inventory": "库存规划",
    "research": "新品调研",
    "product_details": "产品明细",
    "product_cost": "产品成本",
    "sales_us": "美国销售报告",
    "sales_ca": "加拿大销售报告",
    "advertising": "广告活动报告",
    "monthly_analysis": "月度分析",
    "unknown": "未识别文件",
}


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _number(value: object) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_url(value: object) -> str:
    raw = _text(value)
    match = re.match(r"(https?://[^?\s]+)", raw)
    return match.group(1) if match else ""


def _header_map(row: tuple[Any, ...]) -> dict[str, int]:
    return {_text(value).replace("\n", "").replace(" ", ""): index for index, value in enumerate(row) if _text(value)}


def _field(indexes: dict[str, int], *names: str) -> int | None:
    for name in names:
        key = name.replace("\n", "").replace(" ", "")
        if key in indexes:
            return indexes[key]
    return None


def _detect(path: Path, workbook) -> str:
    name = path.name.lower()
    sheets = {value.strip() for value in workbook.sheetnames}
    if "新品调研" in name or any(re.fullmatch(r"\d{1,2}月新品", value) for value in sheets):
        return "research"
    if "库存规划" in name or "库存规划" in sheets:
        return "inventory"
    if "产品总成本" in name or {"美国", "加拿大"}.issubset(sheets):
        return "product_cost"
    if "产品明细" in name or "一店" in sheets and path.stat().st_size > 20 * 1024 * 1024:
        return "product_details"
    if "广告活动" in name or "按月" in sheets:
        return "advertising"
    if "月度分析" in name or "仓租详情" in " ".join(sheets):
        return "monthly_analysis"
    if "report" in name and "Report" in workbook.sheetnames:
        return "sales_ca" if "-ca-" in name else "sales_us"
    return "unknown"


def _inventory_preview(workbook) -> dict[str, Any]:
    markets: dict[str, Any] = {}
    for market, sheet_name in (("US", "库存规划"), ("CA", "加拿大库存计划 ")):
        if sheet_name not in workbook.sheetnames:
            continue
        sheet = workbook[sheet_name]
        rows = sheet.iter_rows(values_only=True)
        header = next(rows)
        indexes = _header_map(header)
        sku_index = _field(indexes, "SKU")
        fba_index = _field(indexes, "FBA库存")
        local_index = _field(indexes, "工厂库存及已下订单")
        sales_index = _field(indexes, "最近月销售", "最近月销")
        valid = 0
        total_fba = 0
        total_local = 0
        for row in rows:
            if sku_index is None or not _text(row[sku_index] if len(row) > sku_index else None):
                continue
            valid += 1
            total_fba += int(_number(row[fba_index] if fba_index is not None and len(row) > fba_index else None) or 0)
            total_local += int(_number(row[local_index] if local_index is not None and len(row) > local_index else None) or 0)
        markets[market] = {"sheet": sheet_name, "skuCount": valid, "fbaUnits": total_fba, "domesticUnits": total_local, "hasRecentSales": sales_index is not None}
    return {"markets": markets, "impacts": ["运营总览", "库存视图", "采购计划"]}


def _research_preview(workbook) -> dict[str, Any]:
    candidates = 0
    viable = 0
    if "Sheet1" in workbook.sheetnames:
        rows = list(workbook["Sheet1"].iter_rows(values_only=True))
        for index, row in enumerate(rows):
            if not _text(row[0] if row else None) or index + 1 >= len(rows):
                continue
            detail = rows[index + 1]
            margin = _number(detail[13] if len(detail) > 13 else None)
            if _number(detail[2] if len(detail) > 2 else None) is not None:
                candidates += 1
                viable += int(margin is not None and margin >= 0.3)
    month_sheets = sorted([value for value in workbook.sheetnames if re.fullmatch(r"\d{1,2}月新品", value.strip())])
    return {"candidateCount": candidates, "viableCandidateCount": viable, "monthSheets": month_sheets, "impacts": ["新品调研"]}


def _sales_preview(workbook, market: str) -> dict[str, Any]:
    sheet = workbook["Report"]
    header = tuple(cell.value for cell in next(sheet.iter_rows(min_row=2, max_row=2)))
    indexes = _header_map(header)
    sku_index = _field(indexes, "SKU")
    units_index = _field(indexes, "售出的商品总数")
    revenue_index = _field(indexes, "净销售额", "总销售额")
    count = 0
    units = 0
    revenue = 0.0
    for row in sheet.iter_rows(min_row=3, values_only=True):
        sku = _text(row[sku_index] if sku_index is not None and len(row) > sku_index else None)
        if not sku or sku.lower() in {"total", "总计"}:
            continue
        count += 1
        units += int(_number(row[units_index] if units_index is not None and len(row) > units_index else None) or 0)
        revenue += _number(row[revenue_index] if revenue_index is not None and len(row) > revenue_index else None) or 0
    return {"market": market, "skuCount": count, "units": units, "revenue": round(revenue, 2), "impacts": ["运营总览", "库存销量"]}


def _generic_preview(workbook, kind: str) -> dict[str, Any]:
    sheets = [{"name": name, "rows": workbook[name].max_row, "columns": workbook[name].max_column} for name in workbook.sheetnames if name != "WpsReserved_CellImgList"]
    impacts = {
        "product_cost": ["产品成本", "利润分析"],
        "product_details": ["产品目录", "产品待办"],
        "advertising": ["广告管理", "运营总览"],
        "monthly_analysis": ["运营总览", "仓储分析"],
    }.get(kind, [])
    return {"sheets": sheets[:12], "impacts": impacts}


def inspect_batch(batch_dir: Path) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    warnings: list[str] = []
    for path in sorted((batch_dir / "source").iterdir()):
        if not path.is_file() or path.name.startswith("~$"):
            continue
        item: dict[str, Any] = {"name": path.name, "size": path.stat().st_size, "sha256": _sha256(path), "type": "unknown", "label": TYPE_LABELS["unknown"], "publishable": False}
        try:
            workbook = openpyxl.load_workbook(path, read_only=True, data_only=True, keep_links=False)
            try:
                kind = _detect(path, workbook)
                item.update({"type": kind, "label": TYPE_LABELS[kind], "publishable": kind in {"inventory", "research"}, "sheets": workbook.sheetnames})
                if kind == "inventory":
                    item["preview"] = _inventory_preview(workbook)
                elif kind == "research":
                    item["preview"] = _research_preview(workbook)
                elif kind == "sales_us":
                    item["preview"] = _sales_preview(workbook, "US")
                elif kind == "sales_ca":
                    item["preview"] = _sales_preview(workbook, "CA")
                else:
                    item["preview"] = _generic_preview(workbook, kind)
            finally:
                workbook.close()
        except Exception as error:
            item["error"] = str(error)
            warnings.append(f"{path.name}: {error}")
        files.append(item)
    recognized = sum(1 for item in files if item["type"] != "unknown")
    manifest = {
        "schemaVersion": 1,
        "batchId": batch_dir.name,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "ready" if recognized else "needs_review",
        "summary": {"fileCount": len(files), "recognizedCount": recognized, "unknownCount": len(files) - recognized, "publishableCount": sum(1 for item in files if item["publishable"])},
        "warnings": warnings,
        "files": files,
    }
    (batch_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _research_report(path: Path) -> dict[str, Any]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True, keep_links=False)
    try:
        candidates: list[dict[str, Any]] = []
        if "Sheet1" in workbook.sheetnames:
            rows = list(workbook["Sheet1"].iter_rows(values_only=True))
            for index, row in enumerate(rows):
                sku = _text(row[0] if row else None)
                if not sku or index + 1 >= len(rows):
                    continue
                detail = rows[index + 1]
                price = _number(detail[2] if len(detail) > 2 else None)
                if price is None:
                    continue
                candidates.append({"sku": sku, "name": sku, "amazonPrice": price, "firstMile": _number(detail[3]), "storageFee": _number(detail[4]), "commission": _number(detail[5]), "orderFee": _number(detail[6]), "importDutyRate": _number(detail[8]), "purchaseCostRmb": _number(detail[9]), "grossProfit": _number(detail[12]), "grossMargin": _number(detail[13]), "competitorUrl": _safe_url(row[15] if len(row) > 15 else None) or _safe_url(detail[15] if len(detail) > 15 else None)})
        monthly: list[dict[str, Any]] = []
        for sheet_name in workbook.sheetnames:
            match = re.fullmatch(r"(\d{1,2})月新品", sheet_name.strip())
            if not match:
                continue
            for row in workbook[sheet_name].iter_rows(min_row=3, values_only=True):
                sku = _text(row[1] if len(row) > 1 else None)
                if sku:
                    monthly.append({"month": f"{datetime.now().year}-{int(match.group(1)):02d}", "sku": sku, "name": _text(row[3] if len(row) > 3 else None) or sku, "orderQuantity": _number(row[4] if len(row) > 4 else None), "costRmb": _number(row[5] if len(row) > 5 else None), "status": _text(row[6] if len(row) > 6 else None), "usStatus": _text(row[7] if len(row) > 7 else None), "caStatus": _text(row[8] if len(row) > 8 else None)})
    finally:
        workbook.close()
    margins = [item["grossMargin"] for item in candidates if item["grossMargin"] is not None]
    ordered = [item for item in monthly if (item["orderQuantity"] or 0) > 0]
    return {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": {"path": path.name, "modifiedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"), "sha256": _sha256(path), "sheet": "Sheet1"}, "summary": {"candidateCount": len(candidates), "viableCandidateCount": sum(1 for value in margins if value >= 0.3), "averageGrossMargin": sum(margins) / len(margins) if margins else 0, "latestOrderMonth": max((item["month"] for item in ordered), default=None), "orderedSkuCount": len({item["sku"] for item in ordered}), "plannedUnits": int(sum(item["orderQuantity"] or 0 for item in ordered)), "monthCount": len({item["month"] for item in monthly})}, "candidates": candidates, "monthlyOrders": monthly}


def _patch_inventory(path: Path, reports_dir: Path) -> list[str]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True, keep_links=False)
    updated: list[str] = []
    try:
        for market, sheet_name, report_name in (("US", "库存规划", "inventory_dashboard.json"), ("CA", "加拿大库存计划 ", "inventory_dashboard.ca.json")):
            report_path = reports_dir / report_name
            if sheet_name not in workbook.sheetnames or not report_path.exists():
                continue
            report = json.loads(report_path.read_text(encoding="utf-8"))
            rows = workbook[sheet_name].iter_rows(values_only=True)
            indexes = _header_map(next(rows))
            sku_i = _field(indexes, "SKU")
            name_i = _field(indexes, "品名")
            fba_i = _field(indexes, "FBA库存")
            local_i = _field(indexes, "工厂库存及已下订单")
            sales_i = _field(indexes, "最近月销售", "最近月销")
            incoming: dict[str, tuple[Any, ...]] = {}
            for row in rows:
                sku = _text(row[sku_i] if sku_i is not None and len(row) > sku_i else None).upper()
                if sku:
                    incoming[sku] = row
            month = datetime.now().strftime("%Y-%m")
            for item in report.get("rows", []):
                row = incoming.get(_text(item.get("sku")).upper())
                if not row:
                    continue
                if name_i is not None and _text(row[name_i]):
                    item["productName"] = _text(row[name_i])
                if fba_i is not None:
                    item["fbaSellable"] = max(0, int(_number(row[fba_i]) or 0))
                if local_i is not None:
                    item["localInventory"] = max(0, int(_number(row[local_i]) or 0))
                    item["domesticSupplyTotal"] = item["localInventory"] + int(item.get("pendingOrderQty", 0))
                if sales_i is not None and _number(row[sales_i]) is not None:
                    units = max(0, int(_number(row[sales_i]) or 0))
                    item["dailySales"] = units / 30
                    history = [entry for entry in item.get("salesHistoryByMonth", []) if entry.get("month") != month]
                    item["salesHistoryByMonth"] = [*history, {"month": month, "units": units}]
                    item["salesByMonth"] = [{"month": month, "units": units}]
            report["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            report["summary"]["fbaSellable"] = sum(int(item.get("fbaSellable", 0)) for item in report["rows"])
            report["summary"]["localInventory"] = sum(int(item.get("localInventory", 0)) for item in report["rows"])
            report.setdefault("localRefresh", {})["uploadedBatch"] = path.name
            _atomic_json(report_path, report)
            updated.append(report_name)
    finally:
        workbook.close()
    return updated


def publish_batch(batch_dir: Path, reports_dir: Path, snapshots_dir: Path) -> dict[str, Any]:
    manifest = json.loads((batch_dir / "manifest.json").read_text(encoding="utf-8"))
    version = f"data-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{batch_dir.name[-6:]}"
    snapshot = snapshots_dir / version / "reports"
    snapshot.mkdir(parents=True, exist_ok=False)
    if reports_dir.exists():
        for path in reports_dir.glob("*.json"):
            shutil.copy2(path, snapshot / path.name)
    reports_dir.mkdir(parents=True, exist_ok=True)
    updated: list[str] = []
    skipped: list[str] = []
    for item in manifest["files"]:
        source = batch_dir / "source" / item["name"]
        if item["type"] == "research":
            _atomic_json(reports_dir / "new_product_research.json", _research_report(source))
            updated.append("new_product_research.json")
        elif item["type"] == "inventory":
            updated.extend(_patch_inventory(source, reports_dir))
        else:
            skipped.append(item["name"])
    manifest.update({"status": "published", "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dataVersion": version, "updatedReports": sorted(set(updated)), "stagedFiles": skipped})
    (batch_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (snapshots_dir / version / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def restore_version(version: str, reports_dir: Path, snapshots_dir: Path) -> dict[str, Any]:
    if not re.fullmatch(r"data-\d{8}-\d{6}-[a-zA-Z0-9-]{1,20}", version):
        raise ValueError("数据版本编号不正确")
    source = snapshots_dir / version / "reports"
    if not source.is_dir():
        raise FileNotFoundError(f"数据版本不存在: {version}")
    backup = snapshots_dir / f"data-{datetime.now().strftime('%Y%m%d-%H%M%S')}-rollback" / "reports"
    backup.mkdir(parents=True, exist_ok=False)
    reports_dir.mkdir(parents=True, exist_ok=True)
    for path in reports_dir.glob("*.json"):
        shutil.copy2(path, backup / path.name)
    restored: list[str] = []
    for path in source.glob("*.json"):
        temporary = reports_dir / f"{path.name}.tmp"
        shutil.copy2(path, temporary)
        os.replace(temporary, reports_dir / path.name)
        restored.append(path.name)
    return {"status": "restored", "dataVersion": version, "restoredReports": sorted(restored), "restoredAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["inspect", "publish", "restore"])
    parser.add_argument("--batch-dir")
    parser.add_argument("--reports-dir")
    parser.add_argument("--snapshots-dir")
    parser.add_argument("--version")
    args = parser.parse_args()
    if args.command == "inspect":
        if not args.batch_dir:
            parser.error("inspect requires --batch-dir")
        payload = inspect_batch(Path(args.batch_dir))
    elif args.command == "publish":
        if not args.batch_dir or not args.reports_dir or not args.snapshots_dir:
            parser.error("publish requires --batch-dir, --reports-dir and --snapshots-dir")
        payload = publish_batch(Path(args.batch_dir), Path(args.reports_dir), Path(args.snapshots_dir))
    else:
        if not args.version or not args.reports_dir or not args.snapshots_dir:
            parser.error("restore requires --version, --reports-dir and --snapshots-dir")
        payload = restore_version(str(args.version), Path(args.reports_dir), Path(args.snapshots_dir))
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
