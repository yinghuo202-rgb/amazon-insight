from pathlib import Path
from unittest import TestCase

from store_ops.jobs.monthly_reports import _report_identity


class MonthlyReportImportTests(TestCase):
    def test_identifies_all_supported_markets(self):
        self.assertEqual(_report_identity(Path("2026.7月-Measureman销售和毛利报告-US.xlsx")), ("2026-07", "US"))
        self.assertEqual(_report_identity(Path("2026.7月-Measureman销售和毛利报告-CA.xlsx")), ("2026-07", "CA"))
        self.assertEqual(_report_identity(Path("2026.7月-Measureman销售和毛利报告-MX.xlsx")), ("2026-07", "MX"))

    def test_rejects_unrecognized_files(self):
        with self.assertRaises(ValueError):
            _report_identity(Path("销售表.xlsx"))
