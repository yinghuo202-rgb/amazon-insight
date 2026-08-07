from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from ..config import ProjectConfig
from ..db import StateDb
from ..sku import SkuNormalizer
from .inventory_dashboard import _read_monthly_sales_reports, _source_meta


def _atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _settings_by_market(config: ProjectConfig) -> dict[str, dict]:
    base = dict(config.inventory_dashboard)
    overrides = dict(base.pop("markets", {}))
    result = {str(base.get("market", "US")).upper(): base}
    for market, values in overrides.items():
        result[str(market).upper()] = {**base, **dict(values)}
    return result


def _apply_monthly_history(
    payload: dict,
    history_by_sku: dict[str, dict[str, float]],
    actual_sales: dict[str, dict],
    actual_year: int,
    current_sales: dict[str, dict] | None = None,
) -> dict:
    current_sales = current_sales or {}
    imported_months = sorted({
        month
        for months in history_by_sku.values()
        for month in months
        if month.startswith(f"{actual_year:04d}-")
    })
    existing_months = set(payload.get("sales", {}).get("historyMonths", []))
    all_months = sorted(existing_months | set(imported_months))

    updated_skus = 0
    for row in payload.get("rows", []):
        sku = str(row.get("sku", ""))
        history = {
            str(item.get("month")): float(item.get("units", 0) or 0)
            for item in row.get("salesHistoryByMonth", [])
        }
        imported = history_by_sku.get(sku, {})
        if imported:
            updated_skus += 1
            history.update({month: float(units) for month, units in imported.items()})
        row["salesHistoryByMonth"] = [
            {"month": month, "units": history.get(month, 0.0)}
            for month in all_months
        ]
        latest = current_sales.get(sku)
        if latest:
            row["salesByMonth"] = latest["salesByMonth"]
            row["dailySales"] = latest["dailySales"]

    payload.setdefault("sales", {})["historyMonths"] = all_months
    payload["sales"]["historyMethod"] = "按月销售和毛利报告、历史月销主表与最新库存规划月销合并后的 SKU 实际销量"

    business = payload.setdefault("businessPerformance", {})
    prior_series = {str(item.get("month")): item for item in business.get("series", [])}
    series = []
    for month_number in range(1, 13):
        month = f"{month_number:02d}"
        month_key = f"{actual_year:04d}-{month}"
        actual = actual_sales.get(month_key, {})
        prior = prior_series.get(month, {})
        series.append({
            "month": month,
            "actualUnits": int(actual.get("units", 0) or 0),
            "forecastUnits": int(prior.get("forecastUnits", 0) or 0),
            "actualRevenue": round(float(actual.get("revenue", 0) or 0), 2),
            "promotionRevenue": round(float(actual.get("promotionRevenue", 0) or 0), 2),
            "advertisingRevenue": round(float(actual.get("advertisingRevenue", 0) or 0), 2),
        })

    available_months = sorted(
        month for month in actual_sales
        if month.startswith(f"{actual_year:04d}-")
    )
    latest_key = available_months[-1] if available_months else None
    previous_key = available_months[-2] if len(available_months) > 1 else None
    latest = actual_sales.get(latest_key, {}) if latest_key else {}
    previous = actual_sales.get(previous_key, {}) if previous_key else {}
    latest_units = int(latest.get("units", 0) or 0)
    previous_units = int(previous.get("units", 0) or 0)
    latest_change = (
        round((latest_units - previous_units) / previous_units * 100, 1)
        if previous_units > 0 else None
    )
    business["actualYear"] = actual_year
    business["series"] = series
    business["summary"] = {
        "annualActualUnits": sum(item["actualUnits"] for item in series),
        "annualActualRevenue": round(sum(item["actualRevenue"] for item in series), 2),
        "annualAdvertisingRevenue": round(sum(item["advertisingRevenue"] for item in series), 2),
        "latestMonthUnits": latest_units,
        "latestMonthRevenue": round(float(latest.get("revenue", 0) or 0), 2),
        "latestMonthUnitChangePercent": latest_change,
    }
    payload["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "importedMonths": imported_months,
        "updatedSkuCount": updated_skus,
        "latestMonth": latest_key,
        "latestMonthUnits": latest_units,
    }


def run(config: ProjectConfig, db: StateDb) -> dict:
    run_id = db.start_run("refresh-sales-history")
    normalizer = SkuNormalizer(config.sku_pattern, config.ignore_values)
    results = {}
    try:
        for market, settings in _settings_by_market(config).items():
            report_name = "inventory_dashboard.json" if market == "US" else f"inventory_dashboard.{market.lower()}.json"
            report_path = config.runtime_root / "reports" / report_name
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            folder_value = settings.get("sales_history_monthly_folder") or settings.get("sales_monthly_folder")
            if not folder_value:
                raise ValueError(f"{market} 未配置月度销量历史目录")
            folders = [(config.data_root / str(folder_value)).resolve()]
            folders.extend(
                (config.data_root / str(value)).resolve()
                for value in settings.get("sales_history_additional_folders", [])
            )
            for folder in folders:
                if not folder.exists():
                    raise FileNotFoundError(folder)

            current_sales, _, actual_sales, source_paths, history_by_sku = _read_monthly_sales_reports(
                folders,
                market,
                int(settings.get("sales_window_months", 3)),
                normalizer,
            )
            actual_year = int(settings.get("actual_sales_year", datetime.now().year))
            result = _apply_monthly_history(payload, history_by_sku, actual_sales, actual_year, current_sales)
            retained_sources = [
                item for item in payload.get("sources", [])
                if item.get("kind") != "sales_history_month"
            ]
            payload["sources"] = [
                *retained_sources,
                *[_source_meta(config, path, "sales_history_month") for path in source_paths],
            ]
            _atomic_json(report_path, payload)
            results[market] = {
                **result,
                "sourceCount": len(source_paths),
                "reportPath": str(report_path),
            }

        db.finish_run(run_id, "completed", summary=results)
        return {"run_id": run_id, "markets": results}
    except Exception as exc:
        db.finish_run(run_id, "failed", error=repr(exc))
        raise
