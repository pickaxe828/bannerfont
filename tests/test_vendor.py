"""Seam: build_font.build(out_dir) -> font bytes. Run: uv run python -m unittest discover tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_missing_glyph import BASE_SVG, build_with  # noqa: E402

REPO_URL = "https://github.com/pickaxe828/bannerfont-web"
NAME_ID_VENDOR_URL = 11


class VendorIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font = build_with({"ue000": BASE_SVG})

    def test_vendor_id_is_bnfw(self):
        self.assertEqual(self.font["OS/2"].achVendID, "BNFW")

    def test_vendor_url_is_the_repo_url(self):
        record = self.font["name"].getName(NAME_ID_VENDOR_URL, 3, 1, 0x409)
        self.assertEqual(record.toUnicode(), REPO_URL)

    def test_unique_font_identifier_carries_the_vendor_id(self):
        record = self.font["name"].getName(3, 3, 1, 0x409)
        self.assertEqual(record.toUnicode(), "1.000;BNFW;BannerFont-Regular")


if __name__ == "__main__":
    unittest.main()
