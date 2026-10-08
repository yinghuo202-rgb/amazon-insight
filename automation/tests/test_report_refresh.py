import json
import tempfile
import unittest
from pathlib import Path

from store_ops.config import ProjectConfig
from store_ops.db import StateDb
from store_ops.jobs.report_refresh import run
from store_ops.report_versions import current_reports, report_transaction


class ReportRefreshTests(unittest.TestCase):
    def test_rebuild_retains_uploaded_sources_and_commits_one_generation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            runtime = root / "runtime"
            reports = runtime / "reports"
            with report_transaction(reports, runtime / "snapshots") as (stage, _):
                (stage / "one.json").write_text('{"n":1}')
                incoming = stage.parent / "incoming" / "monthly-sales-reports"
                incoming.mkdir(parents=True)
                (incoming / "uploaded.xlsx").write_bytes(b"test-only-source")
            old = current_reports(reports)
            original_pointer = (reports / "current.json").read_bytes()
            config = ProjectConfig(root / "config.json", root, root, runtime, r"(MA\d{3})", frozenset(), (), {})
            db = StateDb(runtime / "db" / "operations.sqlite3")
            db.init()

            def operation(staged, database):
                self.assertIs(database, db)
                self.assertEqual((reports / "current.json").read_bytes(), original_pointer)
                self.assertEqual((staged.runtime_root / "incoming" / "monthly-sales-reports" / "uploaded.xlsx").read_bytes(), b"test-only-source")
                (staged.runtime_root / "reports" / "one.json").write_text('{"n":2}')
                return {"status": "test"}

            try:
                result = run(config, db, [operation])
                self.assertEqual(result["status"], "completed")
                self.assertEqual(json.loads((current_reports(reports) / "one.json").read_text())["n"], 2)
                self.assertEqual(json.loads((old / "one.json").read_text())["n"], 1)
                self.assertEqual(db.conn.execute("SELECT status FROM runs ORDER BY id DESC LIMIT 1").fetchone()[0], "completed")
            finally:
                db.close()
