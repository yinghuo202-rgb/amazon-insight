import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from store_ops.report_versions import current_reports, report_transaction, restore_reports


class ReportVersionTests(unittest.TestCase):
    def test_non_gerpgo_publication_cleans_new_copies_but_keeps_legacy_version(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "reports"
            snapshots = Path(folder) / "snapshots"
            old_version = "data-20261012-000000-legacy"
            old = root / ".versions" / old_version / "reports"
            old.mkdir(parents=True)
            source = {"schemaVersion": 1, "sources": [{"name": "shops", "total": 1, "records": [{
                "key": "business-key", "marketListVos": [{"marketId": 1, "authToken": "fixture-auth", "tokenCount": 2}],
            }]}]}
            expected = {"schemaVersion": 1, "sources": [{"name": "shops", "total": 1, "records": [{
                "key": "business-key", "marketListVos": [{"marketId": 1, "tokenCount": 2}],
            }]}]}
            (old / "gerpgo-source-data.json").write_text(json.dumps(source))
            (old / "inventory.json").write_text('{"rows":[{"sku":"SKU-A","fba":40,"currency":"USD"}]}')
            original = {p.name: p.read_bytes() for p in old.glob("*.json")}
            (root / "current.json").write_text(json.dumps({"version": old_version, "files": {name: hashlib.sha256(value).hexdigest() for name, value in original.items()}}))

            # A WPS/local inventory-only transaction inherits the old GERPgo evidence.
            with report_transaction(root, snapshots) as (stage, version):
                self.assertEqual(json.loads((stage / "gerpgo-source-data.json").read_text()), expected)
                (stage / "inventory.json").write_text('{"rows":[{"sku":"SKU-A","fba":50,"currency":"USD"}]}')
            active = current_reports(root)
            self.assertEqual(json.loads((active / "gerpgo-source-data.json").read_text()), expected)
            self.assertEqual(json.loads((snapshots / version / "reports" / "gerpgo-source-data.json").read_text()), expected)
            self.assertEqual((snapshots / version / "reports" / "inventory.json").read_bytes(), original["inventory.json"])
            self.assertEqual(json.loads((active / "inventory.json").read_text())["rows"], [{"sku": "SKU-A", "fba": 50, "currency": "USD"}])
            for name, value in original.items():
                self.assertEqual((old / name).read_bytes(), value)
            pointer = json.loads((root / "current.json").read_text())
            self.assertEqual(pointer["version"], version)
            for name, sha in pointer["files"].items():
                self.assertEqual(hashlib.sha256((active / name).read_bytes()).hexdigest(), sha)

    def test_rollback_of_legacy_snapshot_publishes_clean_new_version(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "reports"
            snapshots = Path(folder) / "snapshots"
            legacy_version = "data-20261011-000000-legacy"
            legacy = snapshots / legacy_version / "reports"
            legacy.mkdir(parents=True)
            (legacy / "gerpgo-source-data.json").write_text(json.dumps({"sources": [{"records": [{
                "sku": "SKU-A", "quantity": 4, "refresh_token": "fixture-refresh", "details": [{"publicToken": "fixture-public", "currency": "USD"}],
            }]}]}))
            (legacy / "profitability.json").write_text('{"rows":[{"sku":"SKU-A","productSales":100,"currency":"USD"}]}')
            original = {p.name: p.read_bytes() for p in legacy.glob("*.json")}
            with report_transaction(root, snapshots) as (stage, _):
                (stage / "manual.json").write_text('{"notes":"new-only"}')
            previous_active = current_reports(root)
            previous_manual = (previous_active / "manual.json").read_bytes()

            result = restore_reports(legacy_version, root, snapshots)
            active = current_reports(root)
            self.assertNotEqual(result["publishedVersion"], legacy_version)
            self.assertEqual(json.loads((active / "gerpgo-source-data.json").read_text()), {"sources": [{"records": [{
                "sku": "SKU-A", "quantity": 4, "details": [{"currency": "USD"}],
            }]}]})
            self.assertEqual((active / "profitability.json").read_bytes(), original["profitability.json"])
            self.assertFalse((active / "manual.json").exists())
            self.assertEqual((previous_active / "manual.json").read_bytes(), previous_manual)
            for name, value in original.items():
                self.assertEqual((legacy / name).read_bytes(), value)
            pointer = json.loads((root / "current.json").read_text())
            for name, sha in pointer["files"].items():
                self.assertEqual(hashlib.sha256((active / name).read_bytes()).hexdigest(), sha)

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
