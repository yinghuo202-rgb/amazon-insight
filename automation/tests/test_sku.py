import unittest

from store_ops.sku import SkuNormalizer


class SkuNormalizerTests(unittest.TestCase):
    def setUp(self):
        self.n = SkuNormalizer(r"(?<![A-Z0-9])([A-Z]{2}\s*[-_]?\s*\d{3})(?!\d)",frozenset({"","总计","SKU"}))

    def test_exact(self):
        self.assertEqual(self.n.extract("MA014").bases,("MA014",))

    def test_platform(self):
        match = self.n.extract("amzn.gr.MA014-Q0WhHZ5IObArburqPlGU8Fq-VG")
        self.assertEqual(match.bases,("MA014",))
        self.assertGreater(match.confidence,0.98)

    def test_suffix(self):
        self.assertEqual(self.n.extract("MA280(配件）").bases,("MA280",))

    def test_purchase_text(self):
        self.assertEqual(self.n.extract("我司型号：MD068").bases,("MD068",))

    def test_ignore_formula(self):
        self.assertIsNone(self.n.extract('=_xlfn.DISPIMG("ID_541F1D18F3F6450",1)'))


if __name__=="__main__":
    unittest.main()
