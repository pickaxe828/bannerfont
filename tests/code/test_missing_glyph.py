"""Seam: build_with(svgs) -> compiled TTFont. Run: uv run python -m unittest discover -s tests/code -t ."""

import unittest

from tests.code.support import BASE_SVG, OVERLAY_SVG, build_with
from tests.font_spec import BANNER_CODEPOINTS, MISSING_GID, MISSING_X_RANGE, MISSING_Y_RANGE

EXPECTED = set(BANNER_CODEPOINTS)


class MissingGlyphTest(unittest.TestCase):
    """Glyph names are not kept in the built font (post format 3), so .missing is found
    through the cmap: it is whatever glyph the unproduced banner codepoints share."""

    @classmethod
    def setUpClass(cls):
        cls.font = build_with({"ue000": BASE_SVG, "ue001": OVERLAY_SVG})
        cls.cmap = cls.font.getBestCmap()
        cls.name = cls.cmap[0xE002]                      # no SVG produced this one

    def test_unproduced_banner_codepoints_share_one_glyph(self):
        for cp in EXPECTED - {0xE000, 0xE001}:
            self.assertEqual(self.cmap[cp], self.name, hex(cp))

    def test_produced_codepoints_do_not_get_it(self):
        self.assertNotEqual(self.cmap[0xE000], self.name)
        self.assertNotEqual(self.cmap[0xE001], self.name)

    def test_only_banner_codepoints_map_to_it(self):
        mapped = {cp for cp, g in self.cmap.items() if g == self.name}
        self.assertEqual(mapped, EXPECTED - {0xE000, 0xE001})

    def test_encoding_is_decimal_digits_read_as_hex(self):
        self.assertEqual(len(EXPECTED), 688)
        self.assertEqual(self.cmap[0xE042], self.name)
        self.assertEqual(self.cmap[0xEF42], self.name)
        for cp in (0xE00A, 0xE01F, 0xE043, 0xE050):
            self.assertNotEqual(self.cmap.get(cp), self.name, hex(cp))

    def test_it_is_gid2_after_notdef_and_blank(self):
        self.assertEqual(self.font.getGlyphID(self.name), MISSING_GID)

    def test_advance_is_one_banner_and_lsb_equals_xmin(self):
        glyph = self.font["glyf"][self.name]
        advance, lsb = self.font["hmtx"][self.name]
        self.assertEqual(advance, 600)
        self.assertEqual(lsb, glyph.xMin)

    def test_it_is_a_box_with_a_hole_in_the_banner_cell(self):
        glyph = self.font["glyf"][self.name]
        self.assertEqual(glyph.numberOfContours, 2)
        self.assertEqual((glyph.xMin, glyph.xMax), MISSING_X_RANGE)
        self.assertEqual((glyph.yMin, glyph.yMax), MISSING_Y_RANGE)

    def test_it_is_monochrome(self):
        records = self.font["COLR"].table.BaseGlyphList.BaseGlyphPaintRecord
        self.assertNotIn(self.name, {r.BaseGlyph for r in records})

    def test_notdef_and_blank_are_unchanged(self):
        for gid in (0, 1):
            name = self.font.getGlyphOrder()[gid]
            self.assertEqual(self.font["glyf"][name].numberOfContours, 0)
            self.assertEqual(self.font["hmtx"][name][0], 0)

    def test_ascii_still_unmapped(self):
        self.assertNotIn(0x20, self.cmap)
        self.assertNotIn(ord("H"), self.cmap)


if __name__ == "__main__":
    unittest.main()
