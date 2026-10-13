import copy
import unittest

from store_ops.gerpgo_evidence import sanitize_gerpgo_evidence


class GerpgoEvidenceTests(unittest.TestCase):
    def test_exact_normalized_authentication_keys_are_removed_at_every_depth(self):
        value = {
            "APP_KEY": "fixture-1", "app-secret": "fixture-2", "ClientSecret": "fixture-3",
            "api.key": "fixture-4", "accessToken": "fixture-5", "refresh_token": "fixture-6",
            "authToken": "fixture-7", "publicToken": "fixture-8", "auth-token-url": "fixture-9",
            "records": [{
                "Authorization": "fixture-10", "cookie": "fixture-11", "Set-Cookie": "fixture-12",
                "PASSWORD": "fixture-13", "secret": "fixture-14", "token": "fixture-15",
                "nested": [{
                    "sign": "fixture-16", "Signature": "fixture-17", "X-API-Key": "fixture-18",
                    "x_app_key": "fixture-19", "marketId": 1,
                }],
            }],
        }
        self.assertEqual(sanitize_gerpgo_evidence(value), {"records": [{"nested": [{"marketId": 1}]}]})

    def test_business_keys_values_and_strings_are_not_scrubbed(self):
        value = {"key": "business-key", "sku": "TOKEN-SKU", "shopId": 123, "tokenCount": 0,
                 "signatureRequired": False, "apiKeyCount": 2, "authTokenExpiresAt": "2026-10-13",
                 "currency": "USD", "date": "2026-10-12", "amount": -12.5, "missing": None,
                 "description": "token=business-text; Authorization and secret are product words",
                 "rows": [0, 12.5, "password text", None, True]}
        self.assertEqual(sanitize_gerpgo_evidence(value), {
            "key": "business-key", "sku": "TOKEN-SKU", "shopId": 123, "tokenCount": 0,
            "signatureRequired": False, "apiKeyCount": 2, "authTokenExpiresAt": "2026-10-13",
            "currency": "USD", "date": "2026-10-12", "amount": -12.5, "missing": None,
            "description": "token=business-text; Authorization and secret are product words",
            "rows": [0, 12.5, "password text", None, True],
        })

    def test_sanitizing_and_mutating_the_result_cannot_change_original_capture(self):
        original = {"sources": [{"token": "fixture-token", "records": [{"sku": "SKU-A", "quantity": 4}]}]}
        before = copy.deepcopy(original)
        cleaned = sanitize_gerpgo_evidence(original)
        self.assertEqual(cleaned, {"sources": [{"records": [{"sku": "SKU-A", "quantity": 4}]}]})
        self.assertEqual(original, before)
        cleaned["sources"][0]["records"][0]["quantity"] = 99
        self.assertEqual(original["sources"][0]["records"][0]["quantity"], 4)
        self.assertEqual(original["sources"][0]["token"], "fixture-token")


if __name__ == "__main__":
    unittest.main()
