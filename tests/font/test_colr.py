"""Invariant 8: COLRv1 and CPAL are present, every banner is painted, and every overlay
stays inside the base's cell (so it composites on top of the base, not beside it)."""

import unittest

from tests.font.fontcase import BANNER_ADVANCE, RealFontTestCase
from tests.font_spec import BANNER_CODEPOINTS, COLORS, PATTERNS, banner_cp

PAINT_COLR_LAYERS = 1
PAINT_GLYPH = 10


def shape_glyphs(colr, paint):
    """Names of every glyph a paint tree fills, following PaintColrLayers slices."""
    if paint.Format == PAINT_COLR_LAYERS:
        first = paint.FirstLayerIndex
        for layer in colr.LayerList.Paint[first:first + paint.NumLayers]:
            yield from shape_glyphs(colr, layer)
    elif paint.Format == PAINT_GLYPH:
        yield paint.Glyph
    else:
        raise AssertionError(f"unexpected paint format {paint.Format}")


class ColrTest(RealFontTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.colr = cls.font["COLR"].table
        cls.paints = {r.BaseGlyph: r.Paint for r in cls.colr.BaseGlyphList.BaseGlyphPaintRecord}

    def ink(self, cp):
        """(xMin, yMin, xMax, yMax) over every shape the banner glyph paints."""
        glyf = self.font["glyf"]
        boxes = [(g.xMin, g.yMin, g.xMax, g.yMax)
                 for g in (glyf[n] for n in shape_glyphs(self.colr, self.paints[self.cmap[cp]]))
                 if g.numberOfContours]
        self.assertTrue(boxes, f"{hex(cp)} paints no outline")
        return (min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes))

    def test_colr_is_version_1_and_cpal_is_present(self):
        self.assertEqual(self.colr.Version, 1)
        self.assertIn("CPAL", self.font)
        self.assertGreater(len(self.font["CPAL"].palettes[0]), 0)

    def test_every_banner_glyph_has_a_paint(self):
        self.assertEqual([hex(cp) for cp in BANNER_CODEPOINTS if self.cmap[cp] not in self.paints], [])

    def test_every_paint_uses_a_palette_entry_that_exists(self):
        size = len(self.font["CPAL"].palettes[0])
        bad = [i for i, p in enumerate(self.colr.LayerList.Paint)
               if p.Format == PAINT_GLYPH and p.Paint.PaletteIndex >= size]
        self.assertEqual(bad, [])

    def test_every_base_is_one_banner_wide(self):
        bad = []
        for x in COLORS:
            x0, _, x1, _ = self.ink(banner_cp(x, 0))
            if x1 - x0 != BANNER_ADVANCE:
                bad.append((f"{x:x}", x1 - x0))
        self.assertEqual(bad, [])

    def test_every_overlay_lands_inside_its_base(self):
        # The pen has stepped one banner past the base when an overlay is drawn, so the
        # overlay's ink, moved back by that advance, has to sit in the base's ink box.
        bad = []
        for x in COLORS:
            bx0, by0, bx1, by1 = self.ink(banner_cp(x, 0))
            for yy in PATTERNS:
                if yy == 0:
                    continue
                a, b, c, d = self.ink(banner_cp(x, yy))
                a, c = a + BANNER_ADVANCE, c + BANNER_ADVANCE
                if not (bx0 <= a and c <= bx1 and by0 <= b and d <= by1):
                    bad.append((hex(banner_cp(x, yy)), (a, b, c, d)))
        self.assertEqual(bad, [])

    def test_every_clip_box_contains_its_ink(self):
        # The clip box is what discards a displaced overlay, so it has to agree with the ink.
        clips = {}
        for clip in self.colr.ClipList.clips.items():
            clips[clip[0]] = clip[1]
        bad = []
        for cp in BANNER_CODEPOINTS:
            box = clips[self.cmap[cp]]
            a, b, c, d = self.ink(cp)
            if not (box.xMin <= a and box.yMin <= b and c <= box.xMax and d <= box.yMax):
                bad.append(hex(cp))
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
