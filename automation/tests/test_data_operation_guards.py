import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import openpyxl

from store_ops.report_versions import current_reports, report_baseline_fingerprint, restore_reports
from store_ops.uploaded_data import inspect_batch, publish_batch, publish_target_fingerprint


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def files(directory):
    return [[p.name, hashlib.sha256(p.read_bytes()).hexdigest()] for p in sorted(directory.glob("*.json")) if p.name != "current.json" and not p.name.startswith(".")]


class DataOperationGuardsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.reports = self.root / "reports"
        self.reports.mkdir()
        self.manual = self.reports / "manual.json"
        self.manual.write_text('{"notes":"human-kept"}')
        self.baseline = digest(["legacy-flat-v1", files(self.reports)])
        self.snapshots = self.root / "snapshots"
        self.version = "data-20261013-000000-test"
        self.source = self.snapshots / self.version / "reports"
        self.source.mkdir(parents=True)
        (self.source / "report.json").write_text('{"rows":[1]}')
        self.target = digest(files(self.source))

    def tearDown(self):
        self.temp.cleanup()

    def test_restore_rechecks_baseline_under_report_lock_without_overwriting_new_manual_edit(self):
        def concurrent_edit():
            self.manual.write_text('{"notes":"human-newer"}')
        with self.assertRaisesRegex(ValueError, "变化"):
            restore_reports(self.version, self.reports, self.snapshots, expected_baseline=self.baseline,
                            expected_target=self.target, before_commit=concurrent_edit)
        self.assertFalse((self.reports / "current.json").exists())
        self.assertEqual(json.loads(self.manual.read_text()), {"notes": "human-newer"})

    def test_restore_rechecks_target_after_staging_and_keeps_old_pointer_absent(self):
        def concurrent_edit():
            (self.source / "report.json").write_text('{"rows":[2]}')
        with self.assertRaisesRegex(ValueError, "变化"):
            restore_reports(self.version, self.reports, self.snapshots, expected_baseline=self.baseline,
                            expected_target=self.target, before_commit=concurrent_edit)
        self.assertFalse((self.reports / "current.json").exists())
        self.assertEqual(self.manual.read_text(), '{"notes":"human-kept"}')

    def test_publish_rechecks_manifest_and_source_inside_commit_lock(self):
        batch = self.root / "batch-20261013-synthetic"
        (batch / "source").mkdir(parents=True)
        original = batch / "source" / "synthetic.xlsx"
        original.write_bytes(b"synthetic-source")
        manifest = {"status": "ready", "files": [{"name": original.name, "sha256": hashlib.sha256(original.read_bytes()).hexdigest()}]}
        raw = json.dumps(manifest).encode()
        (batch / "manifest.json").write_bytes(raw)
        target = digest([hashlib.sha256(raw).hexdigest(), [[original.name, hashlib.sha256(original.read_bytes()).hexdigest()]]])
        def stage_only(batch, stage, version, image_output, *, config=None):
            (stage / "report.json").write_text('{"rows":[9]}')
            return {**manifest, "status": "published", "dataVersion": version}
        for edit in [lambda: original.write_bytes(b"changed-source"), lambda: (batch / "manifest.json").write_text(json.dumps({**manifest, "changed": True}))]:
            original.write_bytes(b"synthetic-source")
            (batch / "manifest.json").write_bytes(raw)
            with patch("store_ops.uploaded_data._publish_staged_batch", side_effect=stage_only), self.assertRaisesRegex(ValueError, "变化"):
                publish_batch(batch, self.reports, self.snapshots, expected_baseline=self.baseline, expected_target=target, before_commit=edit)
            self.assertFalse((self.reports / "current.json").exists())
            self.assertEqual(self.manual.read_text(), '{"notes":"human-kept"}')

    def test_correct_guard_allows_restore_and_legacy_callers_remain_compatible(self):
        result = restore_reports(self.version, self.reports, self.snapshots, expected_baseline=self.baseline, expected_target=self.target)
        self.assertEqual(json.loads((self.reports / "current.json").read_text())["version"], result["publishedVersion"])
        self.assertEqual((self.source / "report.json").read_text(), '{"rows":[1]}')
        self.assertEqual(restore_reports(self.version, self.reports, self.snapshots)["status"], "restored")

    def test_python_matches_browser_fingerprint_vector_and_absent_initial_baseline(self):
        self.assertEqual(report_baseline_fingerprint(self.root / "missing"), "9b5c11f88ed26c8f3d0c1bd7f7a9b1ae23bcad676bf256ed6482b6ea7e0d86aa")
        (self.reports / "盘点.json").write_text('{"rows":[1]}', encoding="utf-8")
        (self.reports / ".ignored.json").write_text('{}')
        (self.reports / "alias.json").symlink_to(self.manual)
        self.assertEqual(report_baseline_fingerprint(self.reports), "716a5b78a14df2d8b67c268b19c980611bcc8204f5e448b8abc9e01498fc1838")

    def test_restore_rejects_changed_current_pointer_at_actual_commit(self):
        current = restore_reports(self.version, self.reports, self.snapshots)
        baseline = report_baseline_fingerprint(self.reports)
        pointer = self.reports / "current.json"
        changed = json.loads(pointer.read_text())
        changed["externalRevision"] = "synthetic-concurrent-change"
        def concurrent_pointer_edit():
            pointer.write_text(json.dumps(changed))
        with self.assertRaisesRegex(ValueError, "变化"):
            restore_reports(self.version, self.reports, self.snapshots, expected_baseline=baseline,
                            expected_target=self.target, before_commit=concurrent_pointer_edit)
        self.assertEqual(json.loads(pointer.read_text()), changed)
        self.assertEqual(changed["version"], current["publishedVersion"])

    def test_guarded_real_inventory_publish_preserves_sources_and_manual_reports(self):
        batch = self.root / "batch-test123456"
        (batch / "source").mkdir(parents=True)
        workbook = openpyxl.Workbook()
        workbook.active.title = "库存规划"
        workbook.active.append(["SKU", "品名", "工厂库存及已下订单", "FBA库存", "FBA+在途库存", "最近月销售"])
        workbook.active.append(["ZZ001", "合成测试", 30, 20, 50, 60])
        source = batch / "source" / "库存规划20260813.xlsx"
        workbook.save(source)
        original = source.read_bytes()
        dashboard = {"schemaVersion": 2, "generatedAt": "2026-08-01T00:00:00+00:00", "market": "US", "summary": {}, "rows": [{"sku": "ZZ001", "productName": "合成旧测试", "fbaSellable": 5, "localInventory": 10, "pendingOrderQty": 2, "dailySales": 1, "salesHistoryByMonth": [], "salesByMonth": []}]}
        (self.reports / "inventory_dashboard.json").write_text(json.dumps(dashboard))
        inspect_batch(batch)
        result = publish_batch(batch, self.reports, self.snapshots, expected_baseline=report_baseline_fingerprint(self.reports), expected_target=publish_target_fingerprint(batch))
        self.assertEqual(result["status"], "published")
        self.assertEqual(json.loads((current_reports(self.reports) / "inventory_dashboard.json").read_text())["rows"][0]["fbaSellable"], 20)
        self.assertEqual((current_reports(self.reports) / "manual.json").read_text(), self.manual.read_text())
        self.assertEqual(source.read_bytes(), original)
