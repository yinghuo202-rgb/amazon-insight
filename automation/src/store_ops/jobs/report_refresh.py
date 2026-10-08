from __future__ import annotations

import os
import shutil
from dataclasses import replace
from pathlib import Path

from ..config import ProjectConfig
from ..db import StateDb
from ..report_versions import current_reports, report_transaction


def run(config: ProjectConfig, db: StateDb, operations: list) -> dict:
    run_id = db.start_run("publish-report-refresh")
    try:
        snapshots = Path(os.environ.get("STORE_OPS_SNAPSHOT_ROOT") or config.runtime_root / "snapshots")
        with report_transaction(config.runtime_root / "reports", snapshots) as (stage, version):
            incoming = config.runtime_root / "incoming"
            if incoming.is_dir():
                shutil.copytree(incoming, stage.parent / "incoming", dirs_exist_ok=True)
            published_incoming = current_reports(config.runtime_root / "reports").parent / "incoming"
            if published_incoming.is_dir() and published_incoming != incoming:
                shutil.copytree(published_incoming, stage.parent / "incoming", dirs_exist_ok=True)
            settings = dict(config.inventory_dashboard)
            # Product image names contain a content hash; additions do not invalidate old versions.
            settings["product_image_output"] = str(config.runtime_root / "output" / "product-images")
            staged_config = replace(config, runtime_root=stage.parent, inventory_dashboard=settings)
            results = [operation(staged_config, db) for operation in operations]
        result = {"status": "completed", "dataVersion": version, "commands": results}
        db.finish_run(run_id, "completed", summary=result)
        return result
    except Exception as exc:
        db.finish_run(run_id, "failed", error=str(exc))
        raise
