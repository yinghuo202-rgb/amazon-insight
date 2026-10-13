"""Read the code-owned metric definition asset, never business upload data."""
from __future__ import annotations

import json
import os
from pathlib import Path

METRIC_IDS = {'sales', 'source-profit', 'source-margin', 'average-price', 'ad-attribution-ratio', 'ad-spend-ratio', 'return-rate', 'acos', 'storage-cost', 'fba-cover', 'overseas-supply-cover'}
DEFINITION_FIELDS = ("id", "name", "formula", "unit", "denominator", "period", "currencyIsolation", "source", "missingRule", "verificationBoundary")


def validate_metric_contract(value: object) -> dict:
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        raise ValueError("Invalid metric contract schema")
    for field in ("metricDefinitionVersion", "calculationRuleVersion", "scope"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError(f"Invalid metric contract {field}")
    definitions = value.get("definitions")
    if not isinstance(definitions, list) or len(definitions) != len(METRIC_IDS):
        raise ValueError("Incomplete metric definitions")
    for definition in definitions:
        if not isinstance(definition, dict) or any(not isinstance(definition.get(field), str) or not definition[field].strip() for field in DEFINITION_FIELDS):
            raise ValueError("Invalid metric definition")
    if {definition["id"] for definition in definitions} != METRIC_IDS:
        raise ValueError("Invalid metric identifiers")
    return value


def load_metric_contract() -> dict:
    configured = os.environ.get("STORE_OPS_AUTOMATION_ROOT", "").strip()
    automation = Path(configured).resolve() if configured else Path(__file__).resolve().parents[2]
    asset = automation / "config" / "metric-definitions.json"
    if not asset.exists():
        asset = automation / "integrations" / "amazon-insight" / "src" / "lib" / "inventory" / "metric-definitions.json"
    return validate_metric_contract(json.loads(asset.read_text(encoding="utf-8")))
