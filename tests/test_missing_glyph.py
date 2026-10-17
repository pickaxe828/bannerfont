"""Seam: build_font.build(out_dir) -> font bytes. Run: uv run python -m unittest discover tests"""

import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from fontTools.ttLib import TTFont  # noqa: E402

import build_font  # noqa: E402

BASE_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,20,40">'
            '<g fill="#ff0000"><path d="M0,0h20v40h-20z"/></g></svg>')
OVERLAY_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,0,40">'
               '<g fill="#00ff00"><path d="M-20,0h10v10h-10z"/></g></svg>')

# The pattern yy is written as two *decimal* digits but read as hex digits, so pattern 42
# is U+E042 (not U+E02A) and the control gaps U+E00A..E00F, U+E01A..E01F stay unmapped.
EXPECTED = {0xE000 + x * 0x100 + (yy // 10) * 0x10 + yy % 10
            for x in range(16) for yy in range(43)}


def build_with(stems_to_svg: dict[str, str]) -> TTFont:
    with tempfile.TemporaryDirectory() as tmp:
        for stem, svg in stems_to_svg.items():
            (Path(tmp) / f"{stem}.svg").write_text(svg)
        return TTFont(io.BytesIO(build_font.build(Path(tmp))))


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
        self.assertEqual(self.font.getGlyphID(self.name), 2)

    def test_advance_is_one_banner_and_lsb_equals_xmin(self):
        glyph = self.font["glyf"][self.name]
        advance, lsb = self.font["hmtx"][self.name]
        self.assertEqual(advance, 600)
        self.assertEqual(lsb, glyph.xMin)

    def test_it_is_a_box_with_a_hole_in_the_banner_cell(self):
        glyph = self.font["glyf"][self.name]
        self.assertEqual(glyph.numberOfContours, 2)
        self.assertEqual((glyph.xMin, glyph.xMax), (-620, -20))
        self.assertEqual((glyph.yMin, glyph.yMax), (-250, 950))

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
