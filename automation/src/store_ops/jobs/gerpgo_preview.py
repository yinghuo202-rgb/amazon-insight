"""Reviewed performance imports. Raw evidence and unverified inventory stay private."""
from __future__ import annotations

import calendar
import hashlib
import json
import math
import os
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

from ..db import StateDb
from ..report_versions import _json_write, current_reports, report_transaction
from .gerpgo_advertising import aggregate_advertising, attach_advertising

TASK_RE = re.compile(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}")
MARKETS = {"amazon-us": ("US", "USD"), "amazon-ca": ("CA", "CAD"), "amazon-mx": ("MX", "MXN")}
MONEY = {"productSales": "orderProductSalesAmount", "actualProfit": "salesNetProfitAmount",
         "grossProfit": "salesGrossProfitAmount", "advertisingCost": "adsSpendAmount",
         "advertisingSales": "adsSalesAmount", "storageCost": "storageFeeAmount",
         "averagePrice": "averagePriceAmount"}


def digest(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def baseline(root: Path) -> str:
    active = current_reports(root)
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(active.glob("*.json")) if p.name != "current.json"}
    return digest(files)


def task_folder(runtime: Path, task_id: str) -> Path:
    if not isinstance(task_id, str) or not TASK_RE.fullmatch(task_id):
        raise ValueError("同步任务编号无效")
    folder = runtime / "incoming" / "gerpgo" / task_id
    # Do not allow a mounted or replaced symlink to escape the evidence directory.
    if folder.resolve().parent != (runtime / "incoming" / "gerpgo").resolve():
        raise ValueError("同步任务路径无效")
    return folder


def pages(folder: Path, source: dict) -> list[dict]:
    name, count, total = source["name"], source["pages"], source["total"]
    if not re.fullmatch(r"shops|products|fba|(?:performance|returns|storage)-\d{4}-\d{2}|ads-\d+-\d{4}-\d{2}-\d{2}", name) or type(count) is not int or not 1 <= count <= 10000 or type(total) is not int or total < 0:
        raise ValueError("分页清单无效")
    rows, seen = [], set()
    for number in range(1, count + 1):
        page = json.loads((folder / f"{name}-{number}.json").read_text(encoding="utf-8"))
        items = page.get("rows")
        if page.get("page") != number or page.get("total") != total or not isinstance(items, list) or len(items) > 100:
            raise ValueError("暂存分页不完整或总数变化")
        if source.get("totalUnit") != "markets" and number < count and len(items) != 100:
            raise ValueError("暂存分页提前结束")
        for row in items:
            if not isinstance(row, dict) or digest(row) in seen:
                raise ValueError("暂存分页记录重复或格式无效")
            seen.add(digest(row))
        rows.extend(items)
    actual = len(rows)
    if source.get("totalUnit") == "markets":
        if name != "shops" or any(not isinstance(r.get("marketListVos"), list) for r in rows):
            raise ValueError("店铺站点计数口径无效")
        markets = [s for r in rows for s in r["marketListVos"]]
        if any(not isinstance(s, dict) or not s.get("marketId") for s in markets) or len({str(s["marketId"]) for s in markets}) != len(markets):
            raise ValueError("店铺站点缺少标识或重复")
        actual = len(markets)
    if actual != total:
        raise ValueError("暂存记录数与接口总数不符")
    return rows


def number(value, integer=False):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("数值字段格式变化")
    if integer and (value < 0 or int(value) != value):
        raise ValueError("件数字段不是非负整数")
    return int(value) if integer else value


def money(row: dict, field: str, currency: str, *, original_currency=False):
    value = row.get(field)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("金额字段结构变化")
    amount = number(value.get("currencyAmount"))
    # Official YUAN means original currency, not CNY. Accept this sentinel only
    # for an explicitly original-currency query and an already mapped market.
    valid_codes = {currency, "YUAN"} if original_currency else {currency}
    if amount is not None and value.get("currencyCode") not in valid_codes:
        raise ValueError("金额币种与站点原币种不一致")
    return amount


def change(previous, candidate):
    if previous is None or candidate is None:
        return None
    if previous == 0:
        return 0 if candidate == 0 else None
    return round((candidate - previous) / abs(previous) * 100, 6)


def resolve_store_scope(shops: list[dict], name: str) -> dict:
    matches = [s for s in shops if isinstance(s.get("serverName"), str) and s["serverName"].strip().casefold() == name.strip().casefold()]
    identities = {s.get("serverId") for s in matches}
    if not matches or len(identities) != 1 or any(type(i) is not int or i <= 0 for i in identities):
        raise ValueError("指定店铺未找到或对应多个店铺身份")
    ids = [s.get("marketId") for s in matches]
    if any(type(i) is not int or i <= 0 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError("指定店铺站点标识缺失或重复")
    selected_ids = [s["marketId"] for s in matches if s.get("market") in MARKETS]
    if not selected_ids:
        raise ValueError("指定店铺没有本站纳入的 US、CA、MX 站点")
    return {"storeName": matches[0]["serverName"].strip(), "serverId": matches[0]["serverId"], "marketIds": sorted(selected_ids)}


def build_preview(runtime: Path, task_id: str, now: datetime | None = None, *, store_name: str | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    folder, root = task_folder(runtime, task_id), runtime / "reports"
    stamp = baseline(root)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("taskId") != task_id or manifest.get("schemaVersion") != 1 or manifest.get("source") != "gerpgo":
        raise ValueError("采集清单无效")
    captured = datetime.fromisoformat(manifest["capturedAt"].replace("Z", "+00:00"))
    if captured.tzinfo is None or captured > now or (now - captured).days > 7:
        raise ValueError("采集日期无效或超过七天，请重新拉取")
    sources = {source["name"]: source for source in manifest["sources"]}
    expected_months = set()
    if manifest.get("collectionScope", "initial") not in {"initial", "recent"}:
        raise ValueError("采集历史范围无效")
    for offset in range(2 if manifest.get("collectionScope") == "recent" else 7):
        absolute = captured.year * 12 + captured.month - 1 - offset
        expected_months.add(f"performance-{absolute // 12:04d}-{absolute % 12 + 1:02d}")
    mode = manifest.get("collectionMode", "legacy")
    sales_only = mode in {"sales", "sales_ads"}
    required = {"shops", "products", *expected_months} | (set() if sales_only else {"fba"})
    extra_pattern = r"ads-\d+-\d{4}-\d{2}-\d{2}" if mode == "sales_ads" else (r"(?!)" if mode == "sales" else r"(?:returns|storage)-\d{4}-\d{2}|ads(?:-\d+-\d{4}-\d{2}-\d{2})?")
    if len(sources) != len(manifest["sources"]) or not required.issubset(sources) or any(not re.fullmatch(extra_pattern, name) for name in set(sources) - required):
        raise ValueError("采集来源缺失或重复")
    if any(sources[name].get("status", "completed") != "completed" for name in required):
        raise ValueError("基础数据采集未完成，旧报告未修改")
    if "fba" in sources:
        pages(folder, sources["fba"])  # legacy completeness only; new jobs do not collect inventory
    sellers = pages(folder, sources["shops"])
    all_shops = []
    for seller in sellers:
        shops = seller.get("marketListVos")
        if not isinstance(shops, list):
            raise ValueError("店铺字段结构变化，需核验 marketListVos")
        if any(not isinstance(shop, dict) for shop in shops):
            raise ValueError("店铺站点格式变化")
        all_shops.extend(shops)
    declared_scope = manifest.get("storeScope")
    if declared_scope is not None and not isinstance(declared_scope, dict):
        raise ValueError("采集店铺范围格式无效")
    configured_name = (store_name or os.environ.get("GERPGO_STORE_NAME") or (declared_scope or {}).get("storeName") or "").strip()
    selected_scope = resolve_store_scope(all_shops, configured_name) if configured_name else None
    if declared_scope is not None and declared_scope != selected_scope:
        raise ValueError("采集店铺范围与当前配置或原始店铺证据不一致")
    selected_ids = set(selected_scope["marketIds"]) if selected_scope else None
    if sales_only and not selected_scope:
        raise ValueError("销售及广告采集必须确认唯一店铺和站点范围")
    if mode == "sales_ads":
        expected_ads = set()
        for source_name in sorted(expected_months):
            month = source_name.removeprefix("performance-")
            year, mon = map(int, month.split("-"))
            date = datetime(year, mon, 1, tzinfo=timezone.utc)
            end = min(f"{month}-{calendar.monthrange(year, mon)[1]:02d}", captured.date().isoformat())
            while date.date().isoformat() <= end:
                day = date.date().isoformat()
                for market_id in sorted(selected_ids):
                    name = f"ads-{market_id}-{day}"
                    expected_ads.add(name)
                    source = sources.get(name)
                    if not source or source.get("status", "completed") != "completed":
                        raise ValueError("广告逐日逐站点分页缺失或采集失败，旧报告未修改")
                    if source.get("condition") != {"marketId": market_id, "startDateData": day, "endDateData": day}:
                        raise ValueError("广告采集日期或站点范围不匹配")
                    if any(row.get("marketId") != market_id for row in pages(folder, source)):
                        raise ValueError("广告记录包含其他站点，不能发布")
                date += timedelta(days=1)
        if {name for name in sources if name.startswith("ads-")} != expected_ads:
            raise ValueError("广告采集包含期间或店铺范围外的请求")
    markets, excluded_markets, issues, ignored = {}, {}, [], 0
    for seller in sellers:
        shops = seller["marketListVos"]
        for shop in shops:
            identity = str(shop.get("marketId", ""))
            mapping = MARKETS.get(shop.get("market"))
            if not identity or identity == "None":
                raise ValueError("店铺缺少 marketId")
            if identity in markets or identity in excluded_markets:
                raise ValueError("店铺站点标识重复")
            if selected_ids is not None and shop["marketId"] not in selected_ids:
                label = "当前范围外 " if shop.get("serverId") == selected_scope["serverId"] else "其他店铺 "
                excluded_markets[identity] = label + str(shop.get("market", "未识别站点"))
            elif mapping:
                markets[identity] = mapping
            elif isinstance(shop.get("market"), str) and re.fullmatch(r"amazon-[a-z]{2}", shop["market"]):
                excluded_markets[identity] = shop["market"]
            else:
                raise ValueError("店铺站点字段结构变化")
    products = set()
    for product in pages(folder, sources["products"]):
        sku = product.get("sku")
        if isinstance(sku, str) and sku.strip():
            products.add(sku.strip())
    grouped, scopes, excluded_counts = defaultdict(list), set(), defaultdict(int)
    for name, source in sorted(sources.items()):
        if not name.startswith("performance-"):
            continue
        month = name.removeprefix("performance-")
        year, mon = map(int, month.split("-"))
        start = f"{month}-01"
        end = min(f"{month}-{calendar.monthrange(year, mon)[1]:02d}", captured.date().isoformat())
        if source.get("condition", {}).get("beginDate") != start or source["condition"].get("endDate") != end or start > end:
            raise ValueError("经营期间不是整月或当月截至采集日")
        for market, _ in markets.values():
            scopes.add((market, month))
        for index, row in enumerate(pages(folder, source), 1):
            try:
                if row.get("isParent") in (True, 1):
                    ignored += 1
                    continue
                identity = str(row.get("marketId", ""))
                if identity in excluded_markets:
                    excluded_counts[excluded_markets[identity]] += 1
                    continue
                mapping = markets.get(identity)
                if mapping is None:
                    raise ValueError("店铺站点未映射（支持 US、CA、MX）")
                market, currency = mapping
                original_currency = source["condition"].get("showCurrencyType") == "YUAN"
                if row.get("currency") not in (None, "", currency) and not (original_currency and row["currency"] == "YUAN"):
                    raise ValueError("记录币种与站点原币种不一致")
                sku = row.get("sku")
                if not isinstance(sku, str) or sku.strip() not in products:
                    raise ValueError("SKU 未在积加产品主数据中精确匹配")
                values = {key: money(row, field, currency, original_currency=original_currency) for key, field in MONEY.items()}
                # Missing primary facts block publication; optional facts remain null.
                units, returns = number(row.get("unitsOrdered"), True), number(row.get("returns"), True)
                if units is None or values["productSales"] is None:
                    raise ValueError("销售件数或商品销售额缺失")
                if values["productSales"] < 0 or values["advertisingSales"] is not None and values["advertisingSales"] < 0:
                    raise ValueError("销售额字段为负，需重新核验统计口径")
                if any(row.get(key) is not None and not isinstance(row[key], str) for key in ["asin", "msku", "productName"]):
                    raise ValueError("产品标识字段结构变化")
                grouped[(market, month, sku.strip(), currency)].append({**values, "units": units, "returns": returns,
                    "asin": row.get("asin") or "", "msku": row.get("msku") or "", "productName": row.get("productName") or sku.strip()})
            except ValueError as exc:
                issues.append({"source": name, "row": index, "reason": str(exc)})
    if not scopes:
        raise ValueError("没有受支持的经营期间与店铺")
    normalized = []
    for (market, month, sku, currency), records in sorted(grouped.items()):
        def total(key):
            return None if any(r[key] is None for r in records) else round(sum(r[key] for r in records), 6)
        item = {key: total(key) for key in ["units", "returns", *MONEY] if key != "averagePrice"}
        # Report-level averages must not be summed across listings/shops.
        item["averagePrice"] = item["productSales"] / item["units"] if item["units"] > 0 else None
        item["actualMargin"] = item["actualProfit"] / item["productSales"] if item["actualProfit"] is not None and item["productSales"] > 0 else None
        item.update(market=market, currency=currency, reportMonth=month, sku=sku, sourceTaskId=task_id,
                    productName=records[0]["productName"], asin=records[0]["asin"] if len({r["asin"] for r in records}) == 1 else "",
                    msku=records[0]["msku"] if len({r["msku"] for r in records}) == 1 else "", currentPrice=None, sourceKind="gerpgo",
                    quality={"profitVerified": False, "returnsVerified": False, "completePeriod": month < captured.strftime("%Y-%m"), "businessAsOf": sources["performance-" + month]["condition"]["endDate"]})
        normalized.append(item)
    active = current_reports(root)
    previous = []
    for filename in ["profitability.json", "gerpgo-performance.json"]:
        file = active / filename
        if file.exists():
            data = json.loads(file.read_text(encoding="utf-8"))
            replaced = {(s["market"], s["reportMonth"]) for s in data.get("scopes", [])} if filename.startswith("gerpgo") else set()
            previous = [r for r in previous if (r["market"], r["reportMonth"]) not in replaced] + data.get("rows", [])
    differences, reasons = [], ["首次或手动发布须人工对账；利润、退货口径确认单独进行"]
    for market, month in sorted(scopes):
        old = [r for r in previous if (r["market"], r["reportMonth"]) == (market, month)]
        new = [r for r in normalized if (r["market"], r["reportMonth"]) == (market, month)]
        currency = dict(MARKETS.values())[market]
        if old and any(r.get("currency") != currency for r in old):
            issues.append({"source": f"baseline-{market}-{month}", "row": 0, "reason": "历史对账范围存在混币，请先核验"})
        old_amount = sum(r["productSales"] for r in old) if old and all(r.get("productSales") is not None and r.get("currency") == currency for r in old) else None
        new_amount = sum(r["productSales"] for r in new)
        revenue_change, sku_change = change(old_amount, new_amount), change(len({r["sku"] for r in old}), len(new))
        complete = month < captured.strftime("%Y-%m")
        revised = complete and (revenue_change is None and old_amount != new_amount or revenue_change is not None and abs(revenue_change) > 10)
        protected = bool(old and (revised or sku_change is not None and abs(sku_change) > 10))
        if protected:
            reasons.append(f"{market} {month}：完整月金额修订或同范围 SKU 数变化超过 10%")
        differences.append({"market": market, "reportMonth": month, "currency": dict(MARKETS.values())[market], "previousRevenue": old_amount,
            "candidateRevenue": new_amount, "revenueChangePercent": revenue_change, "previousSkuCount": len({r["sku"] for r in old}),
            "candidateSkuCount": len(new), "skuChangePercent": sku_change, "completePeriod": complete, "protected": protected})
    if baseline(root) != stamp:
        raise ValueError("预览期间报告已变化，请重新生成预览")
    successful = {name: source for name, source in sources.items() if source.get("status", "completed") == "completed"}
    # Persist the complete approved source payloads separately from browser-facing facts.
    warehouses = {s.get("warehouseName") for s in all_shops if selected_ids is not None and s["marketId"] in selected_ids and isinstance(s.get("warehouseName"), str)}
    selected_skus = {row["sku"] for row in normalized} | {r["sku"].strip() for r in (pages(folder, sources["fba"]) if "fba" in sources else []) if r.get("warehouseName") in warehouses and isinstance(r.get("sku"), str)}
    ad_sources = [{**source, "records": pages(folder, source)} for source in successful.values() if source["name"].startswith("ads-")]
    advertising = aggregate_advertising(ad_sources, pages(folder, sources["products"]), markets, captured.isoformat()) if ad_sources else None
    if advertising:
        selected_skus.update(row["sku"] for row in advertising["rows"])
    def selected_records(source):
        records = pages(folder, source)
        if selected_ids is None:
            return records
        name = source["name"]
        if name == "shops":
            return [{**r, "marketListVos": [s for s in r["marketListVos"] if s["marketId"] in selected_ids]} for r in records if any(s["marketId"] in selected_ids for s in r["marketListVos"])]
        if name == "fba":
            return [r for r in records if r.get("warehouseName") in warehouses]
        if name == "products":
            return [r for r in records if isinstance(r.get("sku"), str) and r["sku"].strip() in selected_skus]
        if name.startswith("ads-"):
            return records if source.get("condition", {}).get("marketId") in selected_ids else []
        if name.startswith("storage-"):
            countries = {m for m, _ in markets.values()}
            return [r for r in records if r.get("serverId") == selected_scope["serverId"] and (r.get("marketId") in selected_ids or r.get("marketId") is None and r.get("countryCode") in countries)]
        return [r for r in records if r.get("marketId") in selected_ids]
    archived_sources = []
    for source in successful.values():
        records = selected_records(source)
        archived_sources.append({**source, "queryTotal": source["total"], "selectedRecordCount": len(records), "records": records})
    source_data = {"schemaVersion": 1, "sourceTaskId": task_id, "capturedAt": captured.isoformat(),
                   "sources": archived_sources,
                   "incomplete": [source for source in sources.values() if source.get("status", "completed") != "completed"]}
    evidence_files = [folder / "manifest.json"] + [folder / f"{name}-{page}.json" for name, source in sorted(successful.items()) for page in range(1, source["pages"] + 1)]
    evidence = [{"sourceTaskId": task_id, "file": file.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()} for file in evidence_files]
    report = {"schemaVersion": 1, "sourceTaskId": task_id, "generatedAt": captured.isoformat(), "scopes": [{"market": m, "reportMonth": p} for m, p in sorted(scopes)], "rows": normalized, "evidence": evidence}
    if sales_only:
        report["collectionMode"] = source_data["collectionMode"] = mode
    if selected_scope:
        source_data["storeScope"] = report["storeScope"] = selected_scope
    if advertising:
        attach_advertising(report, advertising)
    report_hash = digest(report)
    preview = {"schemaVersion": 1, "taskId": task_id, "baseline": stamp, "reportHash": report_hash, "capturedAt": captured.isoformat(),
               "recordCount": len(normalized), "blocked": bool(issues) or not normalized, "issueCount": len(issues), "issues": issues[:50],
               "ignoredParentRows": ignored, "differences": differences, "reviewReasons": reasons,
               "sourceDataHash": digest(source_data),
               "withheld": ["完整原始产品、库存及成功采集的广告、退货、仓储数据随审核版本归档；未核验映射不覆盖手工资料和库存", "来源利润与退货未经对账，不触发相关经营提醒"]
                   + ([f"店铺范围：{selected_scope['storeName']}；站点 {', '.join(sorted({m for m, _ in markets.values()}))}；其他店铺不参与统计"] if selected_scope else [])
                   + (["本批为核心采集；逐日广告、退货明细和仓储明细尚未采集，可另行发起全量采集"] if manifest.get("deferredDomains") else [])
                   + [f"页面范围外：{market}，{count} 条经营记录；原始证据保留，不混入当前店铺统计" for market, count in sorted(excluded_counts.items())]
                   + [f"未完成：{s['name']}；{s.get('error', '待核验')}" for s in source_data["incomplete"][:20]]}
    if sales_only:
        preview["withheld"][0] = "本轮仅同步销售及广告；不采集 FBA、退货明细、仓储明细或历史发货，不覆盖本地库存和发货记录"
        if manifest.get("deferredDomains"):
            preview["withheld"] = [item for item in preview["withheld"] if not item.startswith("本批为核心采集")]
            preview["withheld"].append("本批为销售预览；逐日广告尚未采集，不能视为销售及广告完整同步")
    preview["previewHash"] = digest(preview)
    _json_write(folder / "candidate.json", report)
    _json_write(folder / "candidate-source-data.json", source_data)
    _json_write(folder / "preview.json", preview)
    return preview


def publish(runtime: Path, request: dict) -> dict:
    folder = task_folder(runtime, request["sourceTaskId"])
    preview = json.loads((folder / "preview.json").read_text(encoding="utf-8"))
    hashed = {key: value for key, value in preview.items() if key != "previewHash"}
    if request.get("previewHash") != digest(hashed) or preview.get("previewHash") != request["previewHash"] or preview.get("blocked"):
        raise ValueError("预览已变化或校验未通过，请重新预览")
    captured = datetime.fromisoformat(preview["capturedAt"])
    if not 0 <= (datetime.now(timezone.utc) - captured).total_seconds() <= 7 * 86400:
        raise ValueError("预览过期，请重新拉取")
    candidate = json.loads((folder / "candidate.json").read_text(encoding="utf-8"))
    if digest(candidate) != preview["reportHash"] or candidate["sourceTaskId"] != request["sourceTaskId"]:
        raise ValueError("暂存报告已变化")
    configured_name = os.environ.get("GERPGO_STORE_NAME", "").strip()
    if configured_name and candidate.get("storeScope", {}).get("storeName", "").casefold() != configured_name.casefold():
        raise ValueError("发布候选未限定当前店铺，禁止发布")
    allowed_markets = {m for m, _ in MARKETS.values()}
    if any(r["market"] not in allowed_markets for r in candidate["rows"]) or any(s["market"] not in allowed_markets for s in candidate["scopes"]):
        raise ValueError("候选包含当前范围外的站点，请重新拉取和对账")
    if candidate.get("storeScope"):
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        shop_source = next(s for s in manifest["sources"] if s["name"] == "shops")
        shops = [s for seller in pages(folder, shop_source) for s in seller["marketListVos"]]
        if resolve_store_scope(shops, configured_name or candidate["storeScope"]["storeName"]) != candidate["storeScope"]:
            raise ValueError("候选店铺站点范围已变化，请重新拉取和对账")
    source_data = None
    if preview.get("sourceDataHash"):
        source_data = json.loads((folder / "candidate-source-data.json").read_text(encoding="utf-8"))
        if digest(source_data) != preview["sourceDataHash"] or source_data.get("sourceTaskId") != request["sourceTaskId"]:
            raise ValueError("暂存原始数据已变化")
    for item in candidate["evidence"]:
        if item["sourceTaskId"] != request["sourceTaskId"] or Path(item["file"]).name != item["file"] or hashlib.sha256((folder / item["file"]).read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("采集原始证据已变化，请重新拉取")
    root = runtime / "reports"
    automatic = request.get("automatic") is True
    environment_authorized = bool(os.environ.get("GERPGO_APP_ID", "").strip() and os.environ.get("GERPGO_APP_KEY", "").strip()
                                  and configured_name and (os.environ.get("GERPGO_AUTO_SYNC", "").strip() or "true") == "true")
    def guard():
        if not request.get("taskId") or not request.get("lease"):
            raise ValueError("发布任务缺少有效 worker 租约")
        connection = sqlite3.connect(Path(os.environ.get("STORE_OPS_STATE_DB") or runtime / "db" / "operations.sqlite3"), timeout=5)
        try:
            cursor = connection.execute("UPDATE data_refresh_tasks_v1 SET updated_at=? WHERE id=? AND lease=? AND status='running'", (datetime.now(timezone.utc).isoformat(), request["taskId"], request["lease"]))
            if cursor.rowcount != 1:
                raise ValueError("发布任务租约失效，已停止发布")
            if automatic:
                schedule = connection.execute("SELECT enabled,auto_publish,last_task_id FROM data_sync_schedules_v1 WHERE key='gerpgo'").fetchone()
                task = connection.execute("SELECT kind,request_json FROM data_refresh_tasks_v1 WHERE id=?", (request["taskId"],)).fetchone()
                if not schedule or schedule[:2] != (1, 1) or schedule[2] != request["taskId"] or not task or task[0] != "gerpgo" or json.loads(task[1]).get("scheduled") is not True:
                    raise ValueError("自动发布授权已关闭或任务不属于当前定时任务")
            connection.commit()
        finally:
            connection.close()
    guard()
    existing_file = current_reports(root) / "gerpgo-performance.json"
    if existing_file.exists():
        existing = json.loads(existing_file.read_text(encoding="utf-8"))
        publication = existing.get("publication", {})
        if publication.get("previewHash") == request["previewHash"] and existing.get("sourceTaskId") == request["sourceTaskId"]:
            return {"status": "completed", "publishedVersion": current_reports(root).parent.name,
                    "sourceTaskId": request["sourceTaskId"], "alreadyPublished": True}
    snapshots = Path(os.environ.get("STORE_OPS_SNAPSHOT_ROOT") or runtime / "snapshots")
    with report_transaction(root, snapshots, before_commit=guard) as (stage, version):
        if baseline(root) != preview["baseline"]:
            raise ValueError("现有报告已更新，本次确认失效，请重新拉取和对账")
        file = stage / "gerpgo-performance.json"
        previous = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {"scopes": [], "rows": []}
        prior_publication = previous.get("publication", {})
        initial_review = prior_publication.get("initialReview")
        if not initial_review and prior_publication.get("actor") == "shared-account":
            initial_review = {"storeScope": previous.get("storeScope"), "reviewedAt": prior_publication.get("reviewedAt"), "sourceTaskId": previous.get("sourceTaskId")}
        if automatic:
            authorized_scope = (previous.get("storeScope") or candidate.get("storeScope")) if environment_authorized else (initial_review or {}).get("storeScope")
            if not candidate.get("storeScope") or authorized_scope != candidate.get("storeScope"):
                raise ValueError("首次或店铺范围变化须人工对账，已保留差异预览")
            if any(item.get("protected") for item in preview["differences"]):
                raise ValueError("修订超过发布保护线，已保留预览，请人工对账")
        if previous.get("rows") and previous.get("storeScope") != candidate.get("storeScope"):
            old_scope, new_scope = previous.get("storeScope") or {}, candidate.get("storeScope") or {}
            narrowing = old_scope.get("serverId") == new_scope.get("serverId") and old_scope.get("storeName") == new_scope.get("storeName") and bool(new_scope.get("marketIds")) and set(new_scope["marketIds"]).issubset(old_scope.get("marketIds", []))
            if not narrowing:
                raise ValueError("已发布积加数据属于不同店铺范围，需先核对和回退，不允许混合历史")
        replaced = {(s["market"], s["reportMonth"]) for s in candidate["scopes"]}
        candidate["rows"] = [r for r in previous["rows"] if r["market"] in allowed_markets and (r["market"], r["reportMonth"]) not in replaced] + candidate["rows"]
        candidate["scopes"] = [s for s in previous["scopes"] if s["market"] in allowed_markets and (s["market"], s["reportMonth"]) not in replaced] + candidate["scopes"]
        candidate["evidence"] = previous.get("evidence", []) + candidate["evidence"]
        previous_ads = previous.get("advertising")
        if previous_ads:
            new_ads = candidate.get("advertising")
            if not new_ads:
                candidate["advertising"] = previous_ads
            else:
                ad_scopes = {(s["market"], s["reportMonth"]) for s in new_ads["scopes"]}
                for key in ("scopes", "rows"):
                    new_ads[key] = [r for r in previous_ads[key] if r["market"] in allowed_markets and (r["market"], r["reportMonth"]) not in ad_scopes] + new_ads[key]
        reviewed_at = datetime.now(timezone.utc).isoformat()
        candidate["publication"] = {"version": version, "actor": "scheduled-worker" if automatic else "shared-account", "previewHash": request["previewHash"], "baseline": preview["baseline"], "reviewedAt": reviewed_at,
                                    "initialReview": initial_review if automatic else {"storeScope": candidate.get("storeScope"), "reviewedAt": reviewed_at, "sourceTaskId": request["sourceTaskId"]}}
        if automatic and environment_authorized:
            candidate["publication"]["initialAuthorization"] = prior_publication.get("initialAuthorization") or {"actor": "environment-policy", "storeScope": candidate.get("storeScope"), "authorizedAt": reviewed_at, "sourceTaskId": request["sourceTaskId"]}
        _json_write(file, candidate)
        if source_data is not None:
            source_data["publication"] = candidate["publication"]
            _json_write(stage / "gerpgo-source-data.json", source_data)
    return {"status": "completed", "publishedVersion": version, "sourceTaskId": request["sourceTaskId"]}


def run(config, db: StateDb, request: dict, *, approve=False) -> dict:
    run_id = db.start_run("publish-gerpgo-performance" if approve else "preview-gerpgo-performance")
    try:
        if approve:
            if request.get("confirmed") is not True and request.get("automatic") is not True:
                raise ValueError("需要人工对账确认")
            result = publish(config.runtime_root, request)
        else:
            result = build_preview(config.runtime_root, request["sourceTaskId"], store_name=request.get("storeName"))
            for item in result["issues"]:
                db.add_exception(run_id, category="gerpgo-mapping", severity="high", source=item["source"], raw=None, base=None, cell=str(item["row"]), details={"reason": item["reason"]})
            db.commit()
        db.finish_run(run_id, "completed", summary=result)
        return result
    except Exception as exc:
        safe = str(exc) if isinstance(exc, ValueError) else "积加暂存文件缺失或损坏，请重新采集"
        db.add_exception(run_id, category="gerpgo-publication", severity="high", source="gerpgo", raw=None, base=None, cell=None, details={"reason": safe})
        db.commit()
        db.finish_run(run_id, "failed", error=safe)
        raise ValueError(safe) from None
