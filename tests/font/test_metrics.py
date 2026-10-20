"""Invariants 1-5: what is mapped, and how far each codepoint advances the pen."""

import unittest

from fontcase import (BANNER_ADVANCE, BANNER_CODEPOINTS, BASE_CODEPOINTS, OVERLAY_CODEPOINTS,
                      RealFontTestCase)

CONTROLS = [0xE00A, 0xE00B, 0xE00D, 0xE00E, 0xE00F] + list(range(0xE01A, 0xE020))
SPACE_ZERO = 0xF040                       # U+F040 + n is a space of n banners
UCFFF7 = 0xCFFF7


def wrong(font_case, codepoints, expected):
    """(codepoint, advance) for every codepoint whose advance differs from `expected`."""
    return [(hex(cp), font_case.advance(cp)) for cp in codepoints
            if font_case.advance(cp) != expected]


class CmapTest(RealFontTestCase):
    def test_cmap_has_exactly_829_entries(self):
        # 688 banners + 128 spaces + U+E00C + 11 other control gaps + ucfff7
        self.assertEqual(len(self.cmap), 829)

    def test_every_banner_codepoint_is_mapped(self):
        self.assertEqual([hex(cp) for cp in BANNER_CODEPOINTS if cp not in self.cmap], [])


class AdvanceTest(RealFontTestCase):
    def test_base_patterns_advance_one_banner(self):
        self.assertEqual(len(BASE_CODEPOINTS), 16)
        self.assertEqual(wrong(self, BASE_CODEPOINTS, BANNER_ADVANCE), [])

    def test_overlay_patterns_advance_nothing(self):
        self.assertEqual(len(OVERLAY_CODEPOINTS), 16 * 42)
        self.assertEqual(wrong(self, OVERLAY_CODEPOINTS, 0), [])

    def test_control_gaps_and_ucfff7_advance_nothing(self):
        self.assertEqual(wrong(self, CONTROLS + [UCFFF7], 0), [])

    def test_space_control_character_advances_one_banner(self):
        self.assertEqual(self.advance(0xE00C), BANNER_ADVANCE)

    def test_space_block_advances_600_per_banner(self):
        positive = range(SPACE_ZERO, SPACE_ZERO + 64)                  # U+F040 .. U+F07F
        bad = [(hex(cp), self.advance(cp)) for cp in positive
               if self.advance(cp) != BANNER_ADVANCE * (cp - SPACE_ZERO)]
        self.assertEqual(bad, [])

    def test_negative_spaces_are_clamped_to_zero_advance(self):
        # Pins today's behaviour (CLAUDE.md, "Negative spaces do not work yet"). When
        # negative spaces are implemented this fails, and is meant to: replace it then.
        self.assertEqual(wrong(self, range(SPACE_ZERO - 64, SPACE_ZERO), 0), [])


class LsbTest(RealFontTestCase):
    def test_lsb_equals_xmin_for_every_glyph(self):
        # A rasterizer shifts an outline by (lsb - xMin). With lsb 0 on the overlay
        # shapes (xMin -620) every overlay slides a banner right and vanishes.
        glyf, hmtx = self.font["glyf"], self.font["hmtx"]
        bad = []
        outlined = 0
        for name in self.font.getGlyphOrder():
            glyph = glyf[name]
            expected = glyph.xMin if glyph.numberOfContours else 0
            outlined += bool(glyph.numberOfContours)
            if hmtx[name][1] != expected:
                bad.append((name, hmtx[name][1], expected))
        self.assertGreater(outlined, 0, "no glyph has an outline: the check proved nothing")
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
