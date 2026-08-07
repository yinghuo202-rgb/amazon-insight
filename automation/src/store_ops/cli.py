from __future__ import annotations

import argparse
import json
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="store-ops")
    parser.add_argument("--config",required=True)
    parser.add_argument("command",choices=["init","audit-skus","build-inventory-dashboard-data","build-profitability-data","build-product-catalog","build-content-workflow","build-document-master","build-purchase-plan","refresh-local-sources","refresh-sales-history","import-monthly-reports","export-documents","status"])
    parser.add_argument("--request")
    parser.add_argument("--local-root")
    parser.add_argument("--source", action="append", default=[])
    args = parser.parse_args(argv)
    config = load_config(args.config)
    for folder in ["db","reports","output","archive","quarantine","logs"]:
        (config.runtime_root/folder).mkdir(parents=True,exist_ok=True)
    db = StateDb(config.runtime_root/"db"/"operations.sqlite3")
    try:
        db.init()
        if args.command=="init":
            payload = {"status":"initialized","project_root":str(config.project_root),"data_root":str(config.data_root),"runtime_root":str(config.runtime_root),"database":str(db.path)}
        elif args.command=="audit-skus":
            payload = run_sku_audit(config,db)
        elif args.command=="build-inventory-dashboard-data":
            payload = run_inventory_dashboard(config,db)
            payload["purchasePlan"] = run_purchase_plan(config,db)
            payload["profitability"] = run_profitability_snapshot(config,db)
        elif args.command=="build-profitability-data":
            payload = run_profitability_snapshot(config,db)
        elif args.command=="build-document-master":
            payload = run_document_master(config,db)
        elif args.command=="build-product-catalog":
            payload = run_product_catalog(config,db)
        elif args.command=="build-content-workflow":
            payload = run_content_workflow(config,db)
        elif args.command=="build-purchase-plan":
            payload = run_purchase_plan(config,db)
        elif args.command=="refresh-local-sources":
            if not args.local_root:
                parser.error("refresh-local-sources 需要 --local-root")
            payload = run_local_sources(config,db,Path(args.local_root))
        elif args.command=="refresh-sales-history":
            payload = run_sales_history(config,db)
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
