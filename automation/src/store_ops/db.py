from __future__ import annotations

import json
import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_name TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, summary_json TEXT, error_text TEXT);
CREATE TABLE IF NOT EXISTS sku_aliases (raw_sku TEXT NOT NULL, base_sku TEXT NOT NULL, source_name TEXT NOT NULL, confidence REAL NOT NULL, mapping_status TEXT NOT NULL, last_run_id INTEGER NOT NULL REFERENCES runs(id), last_seen_at TEXT NOT NULL, PRIMARY KEY(raw_sku,base_sku,source_name));
CREATE TABLE IF NOT EXISTS exceptions (id INTEGER PRIMARY KEY AUTOINCREMENT, first_run_id INTEGER NOT NULL REFERENCES runs(id), last_run_id INTEGER NOT NULL REFERENCES runs(id), fingerprint TEXT NOT NULL UNIQUE, category TEXT NOT NULL, severity TEXT NOT NULL, source_name TEXT NOT NULL, raw_value TEXT, base_sku TEXT, cell_ref TEXT, details_json TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'open', occurrences INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_order_review_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL,
    po_number TEXT NOT NULL,
    po_date TEXT NOT NULL,
    market TEXT NOT NULL,
    factory TEXT NOT NULL DEFAULT '',
    remaining_quantity INTEGER NOT NULL DEFAULT 0,
    action TEXT NOT NULL CHECK(action IN ('cancel', 'restore')),
    reason TEXT NOT NULL,
    reviewer TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exceptions_status ON exceptions(review_status,category);
CREATE INDEX IF NOT EXISTS idx_aliases_base ON sku_aliases(base_sku);
CREATE INDEX IF NOT EXISTS idx_purchase_order_review_key ON purchase_order_review_events(sku,po_number,po_date,id DESC);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class StateDb:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self.conn.close()

    def init(self) -> None:
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def start_run(self, job_name: str) -> int:
        cur = self.conn.execute("INSERT INTO runs(job_name,status,started_at) VALUES(?,?,?)", (job_name,"running",utc_now()))
        self.conn.commit()
        return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str, summary: dict | None = None, error: str | None = None) -> None:
        self.conn.execute("UPDATE runs SET status=?,finished_at=?,summary_json=?,error_text=? WHERE id=?", (status,utc_now(),json.dumps(summary,ensure_ascii=False) if summary else None,error,run_id))
        self.conn.commit()

    def upsert_alias(self, run_id: int, raw: str, base: str, source: str, confidence: float, status: str) -> None:
        self.conn.execute("""INSERT INTO sku_aliases(raw_sku,base_sku,source_name,confidence,mapping_status,last_run_id,last_seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(raw_sku,base_sku,source_name) DO UPDATE SET confidence=excluded.confidence,mapping_status=excluded.mapping_status,last_run_id=excluded.last_run_id,last_seen_at=excluded.last_seen_at""", (raw,base,source,confidence,status,run_id,utc_now()))

    def add_exception(self, run_id: int, *, category: str, severity: str, source: str, raw: str | None, base: str | None, cell: str | None, details: dict) -> None:
        stable_key = json.dumps([category,source,raw,base,cell],ensure_ascii=False,separators=(",",":"))
        fingerprint = hashlib.sha256(stable_key.encode("utf-8")).hexdigest()
        now = utc_now()
        self.conn.execute("""
            INSERT INTO exceptions(first_run_id,last_run_id,fingerprint,category,severity,source_name,raw_value,base_sku,cell_ref,details_json,review_status,occurrences,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?, 'open',1,?,?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                last_run_id=excluded.last_run_id,
                severity=excluded.severity,
                details_json=excluded.details_json,
                review_status='open',
                occurrences=exceptions.occurrences+1,
                updated_at=excluded.updated_at
        """, (run_id,run_id,fingerprint,category,severity,source,raw,base,cell,json.dumps(details,ensure_ascii=False),now,now))

    def commit(self) -> None:
        self.conn.commit()

    def status(self) -> dict:
        runs = [dict(r) for r in self.conn.execute("SELECT id,job_name,status,started_at,finished_at FROM runs ORDER BY id DESC LIMIT 10")]
        exceptions = [dict(r) for r in self.conn.execute("SELECT category,severity,COUNT(*) AS count,SUM(occurrences) AS total_occurrences FROM exceptions WHERE review_status='open' GROUP BY category,severity ORDER BY count DESC")]
        aliases = self.conn.execute("SELECT COUNT(*) FROM sku_aliases").fetchone()[0]
        return {"latest_runs":runs,"open_exceptions":exceptions,"alias_records":aliases}
