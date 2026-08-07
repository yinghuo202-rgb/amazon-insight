import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

import openpyxl

from store_ops.jobs.product_catalog import _cell_image_targets, _read_product_details
from store_ops.sku import SkuNormalizer


class ProductCatalogImageTests(unittest.TestCase):
    def test_maps_wps_cell_image_relationship_to_media_member(self):
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "xl/cellimages.xml",
                '<etc:cellImages xmlns:etc="urn:wps" xmlns:xdr="urn:drawing" '
                'xmlns:a="urn:art" xmlns:r="urn:rels"><etc:cellImage><xdr:pic>'
                '<xdr:nvPicPr><xdr:cNvPr name="ID_SAMPLE"/></xdr:nvPicPr>'
                '<xdr:blipFill><a:blip r:embed="rId7"/></xdr:blipFill>'
                '</xdr:pic></etc:cellImage></etc:cellImages>',
            )
            archive.writestr(
                "xl/_rels/cellimages.xml.rels",
                '<Relationships><Relationship Id="rId7" Target="media/image7.jpeg"/></Relationships>',
            )
            archive.writestr("xl/media/image7.jpeg", b"sample")
        buffer.seek(0)

        with zipfile.ZipFile(buffer) as archive:
            self.assertEqual(_cell_image_targets(archive), {"ID_SAMPLE": "xl/media/image7.jpeg"})

    def test_reads_current_product_detail_layout(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "details.xlsx"
            workbook = openpyxl.Workbook()
            sheet = workbook.active
            sheet.title = "一店"
            sheet.append(["序号", "图片", "中文品名", "品类", "包装方式", "MEASUREMAN", "装箱量", "净重kg", "毛重kg", "外箱尺寸cm", None, None, "体积m³", "产品重量(G)", "产品尺寸\n(cm)", "采购成本\n含税价\n（人民币）", "采购成本\n不含税价\n（人民币）", "成本\n（汇率7.2）", "汇率", "成本-一店\n（不含税、美金）"])
            sheet.append([1, None, "2.5寸压力表", "压力表", "白盒", "MA007", 50, 10.2, 10.35, 38, 20.5, 20, 0.01558, 201, "9.2x7.3x3.7", 17.5, 15.49, None, 6.8, 2.28])
            workbook.save(path)
            normalizer = SkuNormalizer(r"(?<![A-Z0-9])([A-Z]{2}\s*[-_]?\s*\d{3})(?!\d)", frozenset())

            item = _read_product_details(path, "一店", normalizer)["MA007"]

            self.assertEqual(item["category"], "压力表")
            self.assertEqual(item["cartonQty"], 50)
            self.assertEqual(item["cartonDimensionsCm"], {"length": 38.0, "width": 20.5, "height": 20.0})
            self.assertEqual(item["purchaseCostUsd"], 2.28)


if __name__ == "__main__":
    unittest.main()
