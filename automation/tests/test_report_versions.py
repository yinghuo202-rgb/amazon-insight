import json
import tempfile
import unittest
from pathlib import Path

from store_ops.report_versions import current_reports, report_transaction, restore_reports


class ReportVersionTests(unittest.TestCase):
    def test_appledouble_files_are_not_copied_or_published(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "reports"
            root.mkdir()
            (root / "one.json").write_text('{"n":1}')
            (root / "._one.json").write_bytes(b'\x00\x05\x16\x07\xff')
            with report_transaction(root, Path(folder) / "snapshots") as (stage, _):
                self.assertFalse((stage / "._one.json").exists())
                # Metadata can also appear after copying on a mounted share.
                (stage / "._two.json").write_bytes(b'\xff')
            pointer = json.loads((root / "current.json").read_text())
            self.assertEqual(set(pointer["files"]), {"one.json"})
            self.assertEqual(json.loads((current_reports(root) / "one.json").read_text()), {"n": 1})

    def test_publish_and_rollback_remove_new_only_files_and_keep_captured_reader(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "reports"
            snapshots = Path(folder) / "snapshots"
            root.mkdir()
            (root / "one.json").write_text('{"n":1}')
            with report_transaction(root, snapshots) as (stage, version):
                (stage / "one.json").write_text('{"n":2}')
                (stage / "two.json").write_text('{"n":3}')
                self.assertFalse((root / "current.json").exists())
            captured = current_reports(root)
            self.assertEqual(json.loads((captured / "one.json").read_text())["n"], 2)
            restore_reports(version, root, snapshots)
            self.assertFalse((current_reports(root) / "two.json").exists())
            self.assertEqual(json.loads((current_reports(root) / "one.json").read_text())["n"], 1)
            self.assertEqual(json.loads((captured / "one.json").read_text())["n"], 2)

    def test_failed_stage_never_changes_pointer_or_active_reports(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "reports"
            snapshots = Path(folder) / "snapshots"
            with report_transaction(root, snapshots) as (stage, _):
                (stage / "one.json").write_text('{"n":1}')
            previous = (root / "current.json").read_bytes()
            with self.assertRaises(ValueError):
                with report_transaction(root, snapshots) as (stage, _):
                    (stage / "one.json").write_text('{"n":2}')
                    (stage / "two.json").write_text('invalid')
            self.assertEqual((root / "current.json").read_bytes(), previous)
            self.assertEqual(json.loads((current_reports(root) / "one.json").read_text())["n"], 1)

    def test_invalid_pointer_does_not_silently_fall_back(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "current.json").write_text('{"version":"../../other"}')
            with self.assertRaises(ValueError):
                current_reports(root)
