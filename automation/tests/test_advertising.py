import unittest

from store_ops.advertising import AdvertisingParameters, recommend_campaign


class AdvertisingRecommendationTests(unittest.TestCase):
    def setUp(self):
        self.parameters = AdvertisingParameters()

    def test_pauses_campaign_when_linked_inventory_is_critical(self):
        result = recommend_campaign(
            spend=25,
            advertising_sales=200,
            orders=8,
            clicks=40,
            impressions=2000,
            budget=20,
            period_days=30,
            inventory_risk="critical",
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "PAUSE_STOCK_RISK")

    def test_reduces_campaign_above_target_acos(self):
        result = recommend_campaign(
            spend=60,
            advertising_sales=100,
            orders=3,
            clicks=50,
            impressions=3000,
            budget=20,
            period_days=30,
            inventory_risk="healthy",
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "REDUCE_BID_OR_BUDGET")
        self.assertEqual(result["acos"], 60.0)

    def test_expands_profitable_campaign_with_healthy_inventory(self):
        result = recommend_campaign(
            spend=40,
            advertising_sales=400,
            orders=8,
            clicks=60,
            impressions=4000,
            budget=20,
            period_days=30,
            inventory_risk="healthy",
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "EXPAND_WINNER")

    def test_increases_bid_for_efficient_campaign_without_volume(self):
        result = recommend_campaign(
            spend=15,
            advertising_sales=100,
            orders=1,
            clicks=15,
            impressions=2000,
            budget=10,
            period_days=30,
            inventory_risk="healthy",
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "INCREASE_BID")
        self.assertEqual(result["conversionRate"], 6.67)

    def test_increases_budget_only_when_profitable_campaign_is_budget_limited(self):
        result = recommend_campaign(
            spend=270,
            advertising_sales=2000,
            orders=20,
            clicks=120,
            impressions=8000,
            budget=10,
            period_days=30,
            inventory_risk="healthy",
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "INCREASE_BUDGET")
        self.assertEqual(result["budgetUtilizationPercent"], 90.0)


if __name__ == "__main__":
    unittest.main()
