"""Seam: build_with(svgs) -> compiled TTFont (from test_missing_glyph). Run: uv run python -m unittest discover -s tests/code"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_missing_glyph import BASE_SVG, build_with  # noqa: E402

REPO_URL = "https://github.com/pickaxe828/bannerfont"
NAME_ID_UNIQUE_ID = 3
NAME_ID_VENDOR_URL = 11
VENDOR_ID = "BNFT"


def _name(font, name_id):
    return font["name"].getName(name_id, 3, 1, 0x409).toUnicode()


class VendorIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font = build_with({"ue000": BASE_SVG})

    def test_vendor_id_is_bnft(self):
        self.assertEqual(self.font["OS/2"].achVendID, VENDOR_ID)

    def test_vendor_url_is_the_repo_url(self):
        self.assertEqual(_name(self.font, NAME_ID_VENDOR_URL), REPO_URL)

    def test_unique_font_identifier_carries_the_vendor_id(self):
        self.assertIn(VENDOR_ID, _name(self.font, NAME_ID_UNIQUE_ID))


if __name__ == "__main__":
    unittest.main()
