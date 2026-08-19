from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _candidate_count(payload: dict[str, Any] | None) -> int:
    if not payload:
        return 0
    candidates = payload.get("candidates")
    if isinstance(candidates, list):
        return len(candidates)
    try:
        return int(payload.get("summary", {}).get("candidateCount", 0))
    except (AttributeError, TypeError, ValueError):
        return 0


def _history_key(item: dict[str, Any]) -> tuple[str, int, str, str]:
    return (
        str(item.get("market", "")),
        int(item.get("batch", 0) or 0),
        str(item.get("shipmentDate", "")),
        str(item.get("sku", "")),
    )


def _merge_shipment_history(current: dict[str, Any], imported: dict[str, Any]) -> int:
    existing = current.get("shipmentHistory")
    incoming = imported.get("shipmentHistory")
    current_rows = [item for item in existing if isinstance(item, dict)] if isinstance(existing, list) else []
    imported_rows = [item for item in incoming if isinstance(item, dict)] if isinstance(incoming, list) else []
    if not imported_rows:
        return 0
    merged = {_history_key(item): item for item in current_rows}
    before = len(merged)
    for item in imported_rows:
        merged.setdefault(_history_key(item), item)
    current["shipmentHistory"] = sorted(
        merged.values(),
        key=lambda item: (
            str(item.get("shipmentDate", "")),
            int(item.get("batch", 0) or 0),
            str(item.get("market", "")),
            str(item.get("sku", "")),
        ),
    )
    coverage = current.setdefault("coverage", {})
    if isinstance(coverage, dict):
        coverage["shipmentHistoryEvents"] = len(merged)
    current_sources = current.setdefault("sources", {})
    imported_sources = imported.get("sources", {})
    if isinstance(current_sources, dict) and isinstance(imported_sources, dict):
        current_shipments = current_sources.get("shipments", [])
        incoming_shipments = imported_sources.get("shipments", [])
        current_sources["shipments"] = sorted({
            str(value)
            for value in [
                *(current_shipments if isinstance(current_shipments, list) else []),
                *(incoming_shipments if isinstance(incoming_shipments, list) else []),
            ]
            if value
        })
    return len(merged) - before


def seed_reports(imported_dir: Path, runtime_dir: Path) -> list[str]:
    runtime_dir.mkdir(parents=True, exist_ok=True)
    actions: list[str] = []
    if not imported_dir.is_dir():
        return actions
    for source in sorted(imported_dir.glob("*.json")):
        target = runtime_dir / source.name
        if not target.exists():
            shutil.copy2(source, target)
            actions.append(f"seeded:{source.name}")
            continue
        if source.name == "new_product_research.json":
            imported = _read_json(source)
            current = _read_json(target)
            imported_count = _candidate_count(imported)
            current_count = _candidate_count(current)
            if imported_count > current_count:
                shutil.copy2(source, target)
                actions.append(f"upgraded:{source.name}:{current_count}->{imported_count}")
        elif source.name == "document_master.json":
            imported = _read_json(source)
            current = _read_json(target)
            if imported is not None and current is not None:
                added = _merge_shipment_history(current, imported)
                if added:
                    _atomic_json(target, current)
                    actions.append(f"backfilled:{source.name}:+{added}")
    return actions


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed or enrich persistent runtime reports from an imported report folder.")
    parser.add_argument("--imported-dir", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path, required=True)
    args = parser.parse_args()
    for action in seed_reports(args.imported_dir, args.runtime_dir):
        print(action)


if __name__ == "__main__":
    main()
