import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from store_ops.report_versions import current_reports, report_transaction, restore_reports


class MetricContractPublicationTests(unittest.TestCase):
    def test_configured_source_checkout_loads_same_code_asset(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'STORE_OPS_AUTOMATION_ROOT': str(Path(__file__).resolve().parents[1])}):
            root, snapshots = Path(folder) / 'reports', Path(folder) / 'snapshots'
            try:
                self.publish(root, snapshots)
            except FileNotFoundError:
                self.fail('Configured source checkout must resolve its explicit code-owned fallback')
            self.assertTrue((current_reports(root) / 'metric-contract.json').exists())

    def test_contract_alone_does_not_make_empty_business_generation_publishable(self):
        with tempfile.TemporaryDirectory() as folder:
            root, snapshots = Path(folder) / 'reports', Path(folder) / 'snapshots'
            with self.assertRaises(ValueError):
                with report_transaction(root, snapshots):
                    pass
            self.assertFalse((root / 'current.json').exists())

    def publish(self, root, snapshots):
        with report_transaction(root, snapshots) as (stage, version):
            (stage / 'one.json').write_text('{"sales":100}', encoding='utf-8')
        return version

    def test_new_publication_archives_complete_definition_and_sha(self):
        with tempfile.TemporaryDirectory() as folder:
            root, snapshots = Path(folder) / 'reports', Path(folder) / 'snapshots'
            self.publish(root, snapshots)
            active = current_reports(root)
            self.assertTrue((active / 'metric-contract.json').exists())
            contract = json.loads((active / 'metric-contract.json').read_text())
            self.assertEqual(len(contract['definitions']), 11)
            pointer = json.loads((root / 'current.json').read_text())
            self.assertEqual(pointer['metricDefinitionVersion'], contract['metricDefinitionVersion'])
            self.assertEqual(pointer['calculationRuleVersion'], contract['calculationRuleVersion'])
            self.assertEqual(pointer['files']['metric-contract.json'], hashlib.sha256((active / 'metric-contract.json').read_bytes()).hexdigest())
            self.assertEqual(json.loads((active.parent / 'manifest.json').read_text()), pointer)

    def test_missing_and_invalid_code_asset_leave_previous_pointer(self):
        with tempfile.TemporaryDirectory() as folder:
            root, snapshots = Path(folder) / 'reports', Path(folder) / 'snapshots'
            self.publish(root, snapshots)
            previous = (root / 'current.json').read_bytes()
            config = Path(folder) / 'config'
            config.mkdir()
            with patch.dict(os.environ, {'STORE_OPS_AUTOMATION_ROOT': folder}):
                for content in (None, '{"metricDefinitionVersion":"fake"}'):
                    if content is not None:
                        (config / 'metric-definitions.json').write_text(content)
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        self.publish(root, snapshots)
                    self.assertEqual((root / 'current.json').read_bytes(), previous)

    def test_boolean_schema_version_is_not_a_valid_code_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            root, snapshots = Path(folder) / 'reports', Path(folder) / 'snapshots'
            self.publish(root, snapshots)
            previous = (root / 'current.json').read_bytes()
            contract = json.loads((current_reports(root) / 'metric-contract.json').read_text())
            contract['schemaVersion'] = True
            config = Path(folder) / 'config'
            config.mkdir()
            (config / 'metric-definitions.json').write_text(json.dumps(contract))
            with patch.dict(os.environ, {'STORE_OPS_AUTOMATION_ROOT': folder}):
                with self.assertRaises(ValueError):
                    self.publish(root, snapshots)
            self.assertEqual((root / 'current.json').read_bytes(), previous)

    def test_restore_preserves_archived_contract_and_legacy_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            root, snapshots = Path(folder) / 'reports', Path(folder) / 'snapshots'
            self.publish(root, snapshots)
            self.assertTrue((current_reports(root) / 'metric-contract.json').exists())
            archived = json.loads((current_reports(root) / 'metric-contract.json').read_text())
            archived['calculationRuleVersion'] = 'archived-rule-v0'
            known, legacy = 'data-20261001-000000-known', 'data-20261001-000000-legacy'
            for version in (known, legacy):
                source = snapshots / version / 'reports'
                source.mkdir(parents=True)
                (source / 'one.json').write_text('{"sales":50}')
                if version == known:
                    (source / 'metric-contract.json').write_text(json.dumps(archived))
            # Restore must not depend on today's code asset, even when missing.
            with patch.dict(os.environ, {'STORE_OPS_AUTOMATION_ROOT': folder}):
                restore_reports(known, root, snapshots)
                self.assertEqual(json.loads((current_reports(root) / 'metric-contract.json').read_text()), archived)
                self.assertEqual(json.loads((root / 'current.json').read_text())['calculationRuleVersion'], 'archived-rule-v0')
                restore_reports(legacy, root, snapshots)
            self.assertFalse((current_reports(root) / 'metric-contract.json').exists())
            self.assertIsNone(json.loads((root / 'current.json').read_text())['metricDefinitionVersion'])
            self.assertIsNone(json.loads((root / 'current.json').read_text())['calculationRuleVersion'])
