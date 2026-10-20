"""Invariants 6-7: ASCII stays uncovered, gid 1 is blank, no banner shows `.missing`."""

import re
import subprocess
import unittest

from fontcase import BANNER_CODEPOINTS, FONT_PATH, RealFontTestCase, require_tool

MISSING_BOX = ((-620, -20), (-250, 950))   # x range, y range, as build_font.missing_glyph draws it
MISSING_GID = 2            # .notdef, .blank, .missing: the order build_font.py appends them in


def shaped_gids(text: str) -> list[int]:
    """Glyph ids HarfBuzz picks for `text`. `--no-glyph-names` because the font keeps none."""
    out = subprocess.run([require_tool("hb-shape"), str(FONT_PATH), text, "--no-glyph-names"],
                         check=True, capture_output=True, text=True).stdout
    return [int(m.group(1)) for m in re.finditer(r"(?:^\[|\|)(\d+)=", out.strip())]


class AsciiTest(RealFontTestCase):
    def test_cmap_has_no_ascii(self):
        self.assertEqual([hex(cp) for cp in self.cmap if cp < 0x80], [])

    def test_hello_world_shapes_to_notdef_throughout(self):
        self.assertEqual(shaped_gids("Hello World"), [0] * len("Hello World"))

    def test_gid1_is_the_blank_glyph(self):
        name = self.font.getGlyphOrder()[1]
        self.assertEqual(self.font["glyf"][name].numberOfContours, 0)
        self.assertEqual(self.font["hmtx"][name][0], 0)
        self.assertNotIn(name, self.cmap.values(), "the blank glyph must stay unmapped")


class MissingGlyphTest(RealFontTestCase):
    def test_gid2_is_the_missing_box(self):
        # Names are not kept in the font, so .missing is found by position. Pin what it
        # looks like, so a reordered glyph table fails here instead of fooling the next test.
        glyph = self.font["glyf"][self.font.getGlyphOrder()[MISSING_GID]]
        self.assertEqual(glyph.numberOfContours, 2)
        self.assertEqual((glyph.xMin, glyph.xMax), MISSING_BOX[0])
        self.assertEqual((glyph.yMin, glyph.yMax), MISSING_BOX[1])

    def test_no_banner_codepoint_maps_to_missing(self):
        order = self.font.getGlyphOrder()
        bad = [hex(cp) for cp in BANNER_CODEPOINTS
               if cp in self.cmap and order.index(self.cmap[cp]) == MISSING_GID]
        self.assertEqual(bad, [])

    def test_banner_codepoints_are_not_mapped_to_notdef_or_blank(self):
        order = self.font.getGlyphOrder()
        self.assertEqual([hex(cp) for cp in BANNER_CODEPOINTS
                          if order.index(self.cmap[cp]) < MISSING_GID], [])


if __name__ == "__main__":
    unittest.main()
