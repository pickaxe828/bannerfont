"""Invariant 9: vendor ID and URL match the project name. The expectations live in
tests/vendor_identity.py, shared with tests/code/test_vendor.py (synthetic build)."""

import unittest

from fontcase import RealFontTestCase
from vendor_identity import NAME_ID_UNIQUE_ID, NAME_ID_VENDOR_URL, REPO_URL, VENDOR_ID, name_record


class VendorIdentityTest(RealFontTestCase):
    def test_vendor_id(self):
        self.assertEqual(self.font["OS/2"].achVendID, VENDOR_ID)

    def test_vendor_url_is_the_repo_url(self):
        self.assertEqual(name_record(self.font, NAME_ID_VENDOR_URL), REPO_URL)

    def test_unique_font_identifier_carries_the_vendor_id(self):
        self.assertIn(VENDOR_ID, name_record(self.font, NAME_ID_UNIQUE_ID))


if __name__ == "__main__":
    unittest.main()
