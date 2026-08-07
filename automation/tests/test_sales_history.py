import unittest

from store_ops.jobs.sales_history import _apply_monthly_history


class SalesHistoryRefreshTests(unittest.TestCase):
    def test_merges_sku_history_and_updates_partial_year_performance(self):
        payload = {
            "sales": {"historyMonths": ["2025-12"]},
            "businessPerformance": {
                "actualYear": 2025,
                "series": [
                    {"month": f"{month:02d}", "forecastUnits": month * 100}
                    for month in range(1, 13)
                ],
            },
            "rows": [
                {
                    "sku": "MA001",
                    "salesHistoryByMonth": [{"month": "2025-12", "units": 10}],
                },
                {
                    "sku": "MA002",
                    "salesHistoryByMonth": [{"month": "2025-12", "units": 20}],
                },
            ],
        }
        history = {
            "MA001": {"2026-01": 100, "2026-02": 150},
            "MA002": {"2026-01": 50, "2026-02": 25},
        }
        actual = {
            "2026-01": {"units": 150, "revenue": 3000},
            "2026-02": {"units": 175, "revenue": 3500},
        }

        result = _apply_monthly_history(payload, history, actual, 2026)

        self.assertEqual(result["importedMonths"], ["2026-01", "2026-02"])
        self.assertEqual(payload["sales"]["historyMonths"], ["2025-12", "2026-01", "2026-02"])
        self.assertEqual(payload["rows"][0]["salesHistoryByMonth"][-1]["units"], 150)
        self.assertEqual(payload["businessPerformance"]["actualYear"], 2026)
        self.assertEqual(payload["businessPerformance"]["summary"]["annualActualUnits"], 325)
        self.assertEqual(payload["businessPerformance"]["summary"]["latestMonthUnits"], 175)
        self.assertEqual(payload["businessPerformance"]["summary"]["latestMonthUnitChangePercent"], 16.7)
        self.assertEqual(payload["businessPerformance"]["series"][1]["forecastUnits"], 200)


if __name__ == "__main__":
    unittest.main()
