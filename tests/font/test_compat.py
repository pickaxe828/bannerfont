"""Invariant 10: the colour fallbacks next to COLRv1. Every banner glyph has COLRv0 layers,
an OpenType-SVG document and an sbix bitmap, and the ramp patterns are real gradients.

Each fallback is only reached by renderers that cannot draw COLRv1, so a font that loses
one still passes every other test and still looks right in Chromium; these tests are what
notice."""

import io
import unittest
import xml.etree.ElementTree as ET

from tests.font.fontcase import RealFontTestCase
from tests.font.test_colr import PAINT_LINEAR_GRADIENT, PAINT_GLYPH
from tests.font_spec import BANNER_CODEPOINTS, COLORS, banner_cp

SBIX_PPEM = 512
CELL_PX = (300, 600)         # 600 x 1200 font units at ppem 512 / upem 1024
RAMP_PATTERNS = (13, 14)


class ColrV0Test(RealFontTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.colr = cls.font["COLR"].table
        cls.records = {r.BaseGlyph: r for r in cls.colr.BaseGlyphRecordArray.BaseGlyphRecord}

    def test_every_banner_glyph_has_v0_layers(self):
        missing = [hex(cp) for cp in BANNER_CODEPOINTS if self.cmap[cp] not in self.records]
        self.assertEqual(missing, [])

    def test_v0_layers_use_palette_entries_and_glyphs_that_exist(self):
        size = len(self.font["CPAL"].palettes[0])
        glyphs = set(self.font.getGlyphOrder())
        layers = self.colr.LayerRecordArray.LayerRecord
        self.assertEqual([i for i, l in enumerate(layers) if l.PaletteIndex >= size], [])
        self.assertEqual([i for i, l in enumerate(layers) if l.LayerGlyph not in glyphs], [])

    def test_v0_base_records_are_sorted_by_glyph_id(self):
        # Binary search over the records is how a v0 renderer finds a glyph.
        ids = [self.font.getGlyphID(r.BaseGlyph) for r in self.colr.BaseGlyphRecordArray.BaseGlyphRecord]
        self.assertEqual(ids, sorted(ids))


class RampGradientTest(RealFontTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        colr = cls.font["COLR"].table
        cls.colr = colr
        cls.paints = {r.BaseGlyph: r.Paint for r in colr.BaseGlyphList.BaseGlyphPaintRecord}

    def fills(self, paint):
        """The fills of a glyph's layers, whether or not fontTools folded them into PaintColrLayers."""
        if paint.Format == 1:     # PaintColrLayers
            layers = self.colr.LayerList.Paint[paint.FirstLayerIndex:paint.FirstLayerIndex + paint.NumLayers]
        else:
            layers = [paint]
        for layer in layers:
            self.assertEqual(layer.Format, PAINT_GLYPH)
            yield layer.Paint

    def test_ramp_patterns_are_linear_gradients_in_every_colour(self):
        bad = []
        for x in COLORS:
            for yy in RAMP_PATTERNS:
                fills = list(self.fills(self.paints[self.cmap[banner_cp(x, yy)]]))
                if not fills or any(f.Format != PAINT_LINEAR_GRADIENT for f in fills):
                    bad.append(hex(banner_cp(x, yy)))
        self.assertEqual(bad, [])

    def test_ramp_gradients_run_down_the_banner_and_fade(self):
        # 13 is opaque at the top and clear at the bottom, 14 the other way round. y points up
        # in font units, so the top of the banner is the larger y.
        for yy in RAMP_PATTERNS:
            fill = next(iter(self.fills(self.paints[self.cmap[banner_cp(0, yy)]])))
            self.assertEqual(fill.x0, fill.x1, "the gradient line is vertical")
            first, last = fill.ColorLine.ColorStop[0], fill.ColorLine.ColorStop[-1]
            starts_at_top = fill.y0 > fill.y1
            starts_opaque = first.Alpha > last.Alpha
            self.assertEqual(starts_at_top == starts_opaque, yy == 13, f"pattern {yy}")

    def test_ramp_patterns_have_one_gradient_but_v0_layers_are_flat(self):
        # The v0 twin of a gradient glyph is its quantized .flat.svg: more than one layer.
        records = {r.BaseGlyph: r for r in self.colr.BaseGlyphRecordArray.BaseGlyphRecord}
        for yy in RAMP_PATTERNS:
            self.assertGreater(records[self.cmap[banner_cp(0, yy)]].NumLayers, 1)


class SvgTableTest(RealFontTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.docs = {}
        for doc in cls.font["SVG "].docList:
            for gid in range(doc.startGlyphID, doc.endGlyphID + 1):
                cls.docs[gid] = doc.data

    def test_every_banner_glyph_has_an_svg_document_naming_it(self):
        bad = []
        for cp in BANNER_CODEPOINTS:
            gid = self.font.getGlyphID(self.cmap[cp])
            data = self.docs.get(gid)
            if data is None or f'id="glyph{gid}"' not in data:
                bad.append(hex(cp))
        self.assertEqual(bad, [])

    def test_documents_are_well_formed_svg(self):
        for gid in list(self.docs)[:50] + list(self.docs)[-50:]:
            root = ET.fromstring(self.docs[gid])
            self.assertTrue(root.tag.endswith("svg"))

    def test_ramp_documents_carry_their_gradient(self):
        for yy in RAMP_PATTERNS:
            gid = self.font.getGlyphID(self.cmap[banner_cp(0, yy)])
            self.assertIn("<linearGradient", self.docs[gid])


class SbixTest(RealFontTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.strike = cls.font["sbix"].strikes[SBIX_PPEM]

    def test_every_banner_glyph_has_a_png_of_one_banner_cell(self):
        from PIL import Image
        bad = []
        for cp in BANNER_CODEPOINTS:
            glyph = self.strike.glyphs.get(self.cmap[cp])
            if glyph is None or glyph.graphicType != "png ":
                bad.append(hex(cp))
                continue
            if Image.open(io.BytesIO(glyph.imageData)).size != CELL_PX:
                bad.append(hex(cp))
        self.assertEqual(bad, [])

    def test_bitmaps_sit_where_the_outlines_would(self):
        # A base's ink starts at -20 font units. An overlay is drawn after the base advanced the
        # pen, so its ink starts at -620. At ppem 512 and upem 1024 a font unit is half a pixel,
        # and the bitmap's bottom is the descender, -250 units.
        bad = []
        for cp in BANNER_CODEPOINTS:
            glyph = self.strike.glyphs[self.cmap[cp]]
            overlay = cp % 0x100 != 0
            if (glyph.originOffsetX, glyph.originOffsetY) != (-310 if overlay else -10, -125):
                bad.append((hex(cp), glyph.originOffsetX, glyph.originOffsetY))
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
