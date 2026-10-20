"""Seam: build_with(svgs) -> compiled TTFont. Run: uv run python -m unittest discover -s tests/code -t ."""

import unittest

from tests.code.support import BASE_SVG, build_with
from tests.vendor_identity import (
    NAME_ID_UNIQUE_ID, NAME_ID_VENDOR_URL, REPO_URL, VENDOR_ID, name_record)


class VendorIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font = build_with({"ue000": BASE_SVG})

    def test_vendor_id_is_bnft(self):
        self.assertEqual(self.font["OS/2"].achVendID, VENDOR_ID)

    def test_vendor_url_is_the_repo_url(self):
        self.assertEqual(name_record(self.font, NAME_ID_VENDOR_URL), REPO_URL)

    def test_unique_font_identifier_carries_the_vendor_id(self):
        self.assertIn(VENDOR_ID, name_record(self.font, NAME_ID_UNIQUE_ID))


if __name__ == "__main__":
    unittest.main()
