from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from ..config import ProjectConfig, source_path
from ..db import StateDb
from ..readers import SourceRecord, read_source
from ..sku import SkuNormalizer


def _atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp = path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    tmp.replace(path)


def run(config: ProjectConfig, db: StateDb) -> dict:
    normalizer = SkuNormalizer(config.sku_pattern,config.ignore_values)
    run_id = db.start_run("audit-skus")
    records: list[tuple[dict,SourceRecord]] = []
    missing_sources: list[str] = []
    try:
        for source in config.sources:
            path = source_path(config,source)
            if not path.exists():
                missing_sources.append(source["name"])
                db.add_exception(run_id,category="source_file_missing",severity="high",source=source["name"],raw=str(path),base=None,cell=None,details={"configured_path":source["path"]})
                continue
            records.extend((source,record) for record in read_source(path,source,normalizer))

        canonical: set[str] = set()
        parsed = []
        for source,record in records:
            match = normalizer.extract(record.raw)
            if match:
                parsed.append((source,record,match.bases,match.confidence))
                if source.get("canonical"):
                    canonical.update(match.bases)

        per_source = defaultdict(lambda:{"rows":0,"mapped":0,"unmapped":0,"ambiguous":0})
        fnsku_links: dict[str,list[dict]] = defaultdict(list)
        unique_exceptions: set[tuple[str,str,str]] = set()
        relation_exceptions = 0

        for source,record,bases,confidence in parsed:
            stats = per_source[record.source]
            stats["rows"] += 1
            if len(bases)>1:
                stats["ambiguous"] += 1
                key = ("ambiguous_sku",record.source,record.raw)
                if key not in unique_exceptions:
                    unique_exceptions.add(key)
                    db.add_exception(run_id,category="ambiguous_sku",severity="high",source=record.source,raw=record.raw,base=None,cell=record.cell,details={"candidates":list(bases)})
                continue
            base = bases[0]
            mapping_status = "confirmed" if base in canonical else "not_in_master"
            if base in canonical:
                stats["mapped"] += 1
            else:
                stats["unmapped"] += 1
                key = ("sku_not_in_master",record.source,base)
                if key not in unique_exceptions:
                    unique_exceptions.add(key)
                    db.add_exception(run_id,category="sku_not_in_master",severity="medium",source=record.source,raw=record.raw,base=base,cell=record.cell,details={"source_path":source["path"]})
            db.upsert_alias(run_id,record.raw,base,record.source,confidence,mapping_status)
            if record.fnsku:
                marker = (record.status_marker or "").strip()
                fnsku_links[record.fnsku.upper()].append({"base":base,"source":record.source,"cell":record.cell,"retired":"作废" in marker,"marker":marker})

        for fnsku,links in fnsku_links.items():
            active_bases = sorted({x["base"] for x in links if not x["retired"]})
            all_bases = sorted({x["base"] for x in links})
            if len(active_bases)>1:
                relation_exceptions += 1
                db.add_exception(run_id,category="fnsku_conflict",severity="high",source="产品明细",raw=fnsku,base=None,cell=None,details={"active_bases":active_bases,"links":links})
            elif len(all_bases)>1:
                relation_exceptions += 1
                db.add_exception(run_id,category="retired_fnsku_alias",severity="low",source="产品明细",raw=fnsku,base=active_bases[0] if active_bases else None,cell=None,details={"all_bases":all_bases,"links":links})

        db.commit()
        summary = {"run_id":run_id,"canonical_skus":len(canonical),"source_records":len(records),"parsed_records":len(parsed),"missing_sources":missing_sources,"sources":dict(sorted(per_source.items())),"issues_seen":len(unique_exceptions)+relation_exceptions+len(missing_sources)}
        report = config.runtime_root/"reports"/f"sku_audit_run_{run_id}.json"
        _atomic_json(report,summary)
        summary["report_path"] = str(report)
        db.finish_run(run_id,"completed",summary=summary)
        return summary
    except Exception as exc:
        db.finish_run(run_id,"failed",error=repr(exc))
        raise
