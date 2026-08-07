import unittest

from store_ops.replenishment import ReplenishmentParameters, calculate_replenishment, round_up_to_pack


class ReplenishmentTests(unittest.TestCase):
    def setUp(self):
        self.parameters = ReplenishmentParameters()

    def test_rounds_up_to_full_carton(self):
        self.assertEqual(round_up_to_pack(101, 50), 150)
        self.assertEqual(round_up_to_pack(0, 50), 0)

    def test_flags_stockout_before_sea_eta_as_urgent(self):
        result = calculate_replenishment(
            daily_sales=10,
            fba_sellable=200,
            awd_available=100,
            awd_outbound_to_fba=0,
            carton_quantity=50,
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "URGENT_AIR_OR_TRANSFER")
        self.assertEqual(result["daysCoverNetwork"], 30.0)

    def test_awd_transfer_only_when_network_can_cover_sea_eta(self):
        result = calculate_replenishment(
            daily_sales=10,
            fba_sellable=100,
            awd_available=700,
            awd_outbound_to_fba=0,
            carton_quantity=50,
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "AWD_TRANSFER")
        self.assertEqual(result["suggestedAwdTransferQty"], 200)

    def test_missing_carton_is_review_data(self):
        result = calculate_replenishment(
            daily_sales=5,
            fba_sellable=500,
            awd_available=500,
            awd_outbound_to_fba=0,
            carton_quantity=None,
            parameters=self.parameters,
        )
        self.assertEqual(result["action"], "REVIEW_DATA")


if __name__ == "__main__":
    unittest.main()
