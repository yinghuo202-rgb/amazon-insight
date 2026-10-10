"""Aggregate collected ASIN-day ads; bind only explicit, unique product aliases."""
from collections import defaultdict
from datetime import date, timedelta
import calendar
import math


FIELDS = {"cost": "cost", "sales": "sales", "clicks": "clicks", "impressions": "impressions", "orders": "orders"}
SYMBOLS = {"USD": {"$", "US$", "USD"}, "CAD": {"CA$", "C$", "CAD"}, "MXN": {"MX$", "MXN"}}


def aggregate_advertising(sources, products, markets, captured_at):
    aliases, names = defaultdict(set), {}
    for product in products:
        sku = product.get("sku")
        if not isinstance(sku, str) or not sku.strip():
            continue
        sku = sku.strip()
        names[sku] = product.get("name") or sku
        for alias in [sku, *(product.get("mskuList") or [])]:
            if isinstance(alias, str) and alias.strip():
                aliases[alias.strip()].add(sku)
    identities = defaultdict(list)
    for alias, skus in aliases.items():
        if len(skus) == 1:
            identities[next(iter(skus))].append(alias)
    scopes, grouped, issues = {}, defaultdict(list), []
    for source in sources:
        if not source.get("name", "").startswith("ads-") or source.get("status", "completed") != "completed":
            continue
        condition = source.get("condition", {})
        market_id, day = condition.get("marketId"), condition.get("startDateData")
        mapping = markets.get(str(market_id))
        if not mapping:
            continue
        market, currency = mapping
        if not isinstance(day, str) or condition.get("endDateData") != day:
            raise ValueError("广告必须按单日采集")
        date.fromisoformat(day)
        key = (market, day[:7])
        scope = scopes.setdefault(key, {"market": market, "currency": currency, "reportMonth": day[:7], "days": set(), "records": [], "unmatchedRecords": 0})
        if day in scope["days"]:
            raise ValueError("广告采集日期重复")
        scope["days"].add(day)
        seen = set()
        for row in source.get("records", []):
            if row.get("marketId") != market_id or row.get("currencySymbol") not in SYMBOLS[currency]:
                raise ValueError("广告站点或币种不一致")
            identity = (row.get("msku"), row.get("asin"))
            if identity in seen:
                raise ValueError("同一 ASIN/MSKU 的广告日记录重复")
            seen.add(identity)
            values = {}
            for target, field in FIELDS.items():
                value = row.get(field)
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0):
                    raise ValueError("广告数值格式变化")
                values[target] = value
            scope["records"].append(values)
            candidates = aliases.get(row.get("msku"), set())
            if len(candidates) != 1:
                scope["unmatchedRecords"] += 1
                issues.append({"market": market, "date": day, "msku": row.get("msku"), "reason": "产品关联缺失" if not candidates else "MSKU 对应多个产品"})
                continue
            sku = next(iter(candidates))
            grouped[(market, day[:7], sku)].append({**values, "asin": row.get("asin"), "msku": row.get("msku")})

    def totals(records):
        return {field: round(sum(r[field] for r in records), 6) if records and all(r[field] is not None for r in records) else None for field in FIELDS}

    published_scopes = []
    for scope in scopes.values():
        days = sorted(scope.pop("days"))
        records = scope.pop("records")
        start, end = date.fromisoformat(days[0]), date.fromisoformat(days[-1])
        capture_date = date.fromisoformat(captured_at[:10])
        month_end = date(end.year, end.month, calendar.monthrange(end.year, end.month)[1])
        expected = {(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)}
        if start.day != 1 or set(days) != expected or end != min(month_end, capture_date):
            raise ValueError("广告月份缺少采集日期")
        scope.update(**totals(records), startDate=days[0], businessAsOf=days[-1], recordCount=len(records), dayCount=len(days))
        published_scopes.append(scope)
    rows = []
    scope_map = {(s["market"], s["reportMonth"]): s for s in published_scopes}
    for (market, month, sku), records in sorted(grouped.items()):
        scope = scope_map[(market, month)]
        rows.append({"market": market, "currency": scope["currency"], "reportMonth": month, "sku": sku, "productName": names[sku],
                     **totals(records), "startDate": scope["startDate"], "businessAsOf": scope["businessAsOf"], "recordCount": len(records),
                     "asins": sorted({r["asin"] for r in records if r["asin"]}), "mskus": sorted({r["msku"] for r in records if r["msku"]})})
    return {"schemaVersion": 1, "capturedAt": captured_at, "identities": [{"sku": sku, "aliases": sorted(values)} for sku, values in sorted(identities.items())],
            "scopes": sorted(published_scopes, key=lambda s: (s["market"], s["reportMonth"])), "rows": rows, "issues": issues}


def attach_advertising(report, advertising):
    """Fill nullable matching-month fields for old images; do not change accounting."""
    report["advertising"] = advertising
    aliases = {alias: identity["sku"] for identity in advertising["identities"] for alias in identity["aliases"]}
    lookup = {(r["market"], r["reportMonth"], r["sku"]): r for r in advertising["rows"]}
    filled = 0
    for row in report["rows"]:
        ads = lookup.get((row["market"], row["reportMonth"], aliases.get(row["sku"])))
        if not ads:
            continue
        changed = False
        for target, source in [("advertisingCost", "cost"), ("advertisingSales", "sales")]:
            if row.get(target) is None and ads[source] is not None:
                row[target] = ads[source]
                changed = True
        filled += changed
    return filled
