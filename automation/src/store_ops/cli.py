from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .config import load_config
from .db import StateDb
from .jobs.audit_skus import run as run_sku_audit
from .jobs.inventory_dashboard import run as run_inventory_dashboard
from .jobs.document_master import run as run_document_master
from .jobs.export_documents import run as run_export_documents
from .jobs.product_catalog import run as run_product_catalog
from .jobs.content_workflow import run as run_content_workflow
from .jobs.purchase_plan import run as run_purchase_plan
from .jobs.local_sources import run as run_local_sources
from .jobs.profitability_snapshot import run as run_profitability_snapshot
from .jobs.sales_history import run as run_sales_history
from .jobs.monthly_reports import run as run_monthly_reports
from .jobs.new_product_research import run as run_new_product_research
from .jobs.report_refresh import run as run_report_refresh
from .jobs.gerpgo_preview import run as run_gerpgo_preview


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="store-ops")
    parser.add_argument("--config",required=True)
    parser.add_argument("command",choices=["preview-gerpgo","publish-gerpgo","init","audit-skus","rebuild-reports","build-inventory-dashboard-data","build-profitability-data","build-product-catalog","build-content-workflow","build-document-master","build-purchase-plan","build-new-product-research","refresh-local-sources","refresh-sales-history","import-monthly-reports","export-documents","status"])
    parser.add_argument("--request")
    parser.add_argument("--local-root")
    parser.add_argument("--source", action="append", default=[])
    args = parser.parse_args(argv)
    config = load_config(args.config)
    for folder in ["db","reports","output","archive","quarantine","logs"]:
        (config.runtime_root/folder).mkdir(parents=True,exist_ok=True)
    db = StateDb(Path(os.environ.get("STORE_OPS_STATE_DB") or config.runtime_root/"db"/"operations.sqlite3"))
    try:
        db.init()
        report_commands = {
            "rebuild-reports": [run_sku_audit, run_product_catalog, run_content_workflow, run_new_product_research, run_document_master, run_inventory_dashboard, run_purchase_plan, run_profitability_snapshot],
            "build-inventory-dashboard-data": [run_inventory_dashboard, run_purchase_plan, run_profitability_snapshot],
            "build-profitability-data": [run_profitability_snapshot],
            "build-document-master": [run_document_master],
            "build-product-catalog": [run_product_catalog],
            "build-content-workflow": [run_content_workflow],
            "build-purchase-plan": [run_purchase_plan],
            "build-new-product-research": [run_new_product_research],
            "refresh-sales-history": [run_sales_history],
        }
        if args.command in ("preview-gerpgo", "publish-gerpgo"):
            if not args.request:
                parser.error("积加审核任务需要 --request")
            payload = run_gerpgo_preview(config, db, json.loads(Path(args.request).read_text(encoding="utf-8")), approve=args.command == "publish-gerpgo")
        elif args.command in report_commands:
            payload = run_report_refresh(config, db, report_commands[args.command])
        elif args.command=="init":
            payload = {"status":"initialized","project_root":str(config.project_root),"data_root":str(config.data_root),"runtime_root":str(config.runtime_root),"database":str(db.path)}
        elif args.command=="audit-skus":
            payload = run_sku_audit(config,db)
        elif args.command=="refresh-local-sources":
            if not args.local_root:
                parser.error("refresh-local-sources 需要 --local-root")
            payload = run_report_refresh(config, db, [lambda staged, database: run_local_sources(staged, database, Path(args.local_root))])
        elif args.command=="import-monthly-reports":
            payload = run_monthly_reports(config, db, [Path(value) for value in args.source])
        elif args.command=="export-documents":
            if not args.request:
                parser.error("export-documents 需要 --request JSON 文件")
            payload = run_export_documents(config,db,Path(args.request).resolve())
        else:
            payload = db.status()
        print(json.dumps(payload,ensure_ascii=False,indent=2))
        return 0
    finally:
        db.close()
