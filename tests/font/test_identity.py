"""Invariant 9: vendor ID and URL match the project name, and the copyright and license
records carry the Mojang / Microsoft notice. The expectations live in
tests/vendor_identity.py, shared with tests/code/test_vendor.py (synthetic build)."""

import unittest

from tests.font.fontcase import RealFontTestCase
from tests.vendor_identity import (
    COPYRIGHT_PHRASES, LICENSE_PHRASES, NAME_ID_COPYRIGHT, NAME_ID_LICENSE_DESCRIPTION,
    NAME_ID_UNIQUE_ID, NAME_ID_VENDOR_URL, REPO_URL, VENDOR_ID, name_record)


class VendorIdentityTest(RealFontTestCase):
    def test_vendor_id(self):
        self.assertEqual(self.font["OS/2"].achVendID, VENDOR_ID)

    def test_vendor_url_is_the_repo_url(self):
        self.assertEqual(name_record(self.font, NAME_ID_VENDOR_URL), REPO_URL)

    def test_unique_font_identifier_carries_the_vendor_id(self):
        self.assertIn(VENDOR_ID, name_record(self.font, NAME_ID_UNIQUE_ID))

    def test_copyright_names_the_code_license_and_the_texture_owners(self):
        text = name_record(self.font, NAME_ID_COPYRIGHT)
        for phrase in COPYRIGHT_PHRASES:
            self.assertIn(phrase, text)

    def test_license_description_covers_the_textures_and_the_font(self):
        text = name_record(self.font, NAME_ID_LICENSE_DESCRIPTION)
        for phrase in LICENSE_PHRASES:
            self.assertIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
