from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ProjectConfig:
    config_path: Path
    project_root: Path
    data_root: Path
    runtime_root: Path
    sku_pattern: str
    ignore_values: frozenset[str]
    sources: tuple[dict[str, Any], ...]
    inventory_dashboard: dict[str, Any]


def load_config(path: str | Path) -> ProjectConfig:
    config_path = Path(path).resolve()
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    project_root = config_path.parent.parent
    configured_data_root = os.environ.get("STORE_OPS_DATA_ROOT", "").strip()
    configured_runtime_root = os.environ.get("STORE_OPS_RUNTIME_ROOT", "").strip()
    return ProjectConfig(
        config_path=config_path,
        project_root=project_root,
        data_root=(Path(configured_data_root) if configured_data_root else project_root / raw["data_root"]).resolve(),
        runtime_root=(Path(configured_runtime_root) if configured_runtime_root else project_root / raw.get("runtime_root", "runtime")).resolve(),
        sku_pattern=raw["sku_pattern"],
        ignore_values=frozenset(str(v).strip().upper() for v in raw.get("ignore_values", [])),
        sources=tuple(raw["sources"]),
        inventory_dashboard=dict(raw.get("inventory_dashboard", {})),
    )


def source_path(config: ProjectConfig, source: dict[str, Any]) -> Path:
    return (config.data_root / source["path"]).resolve()
