"""Seam: build_with(svgs) -> compiled TTFont. A group with data-mask="1" is an alpha mask
layer; the colour layers under it must be composited through it (PaintComposite, DEST_IN).
Run: uv run python -m unittest discover -s tests/code -t ."""

import unittest

from fontTools.ttLib.tables import otTables as ot

from tests.code.support import BASE_SVG, build_with

MASKED_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,20,40">'
              '<g fill="#ff0000"><path d="M0,0h20v40h-20z"/></g>'
              '<g data-mask="1" fill="#000000" fill-opacity="0.5"><path d="M0,0h20v40h-20z"/></g>'
              '<g data-mask="1" fill="#000000" fill-opacity="0.5"><path d="M0,0h10v40h-10z"/></g></svg>')


def glyph_paints(font, paint):
    """Number of PaintGlyph leaves under a paint. fontTools folds a one-layer list into the
    layer itself and may share layers, so the shape of the list is not the thing to assert."""
    if paint.Format == ot.PaintFormat.PaintGlyph:
        return 1
    layers = font["COLR"].table.LayerList.Paint
    return sum(glyph_paints(font, layers[i])
               for i in range(paint.FirstLayerIndex, paint.FirstLayerIndex + paint.NumLayers))


def paint_of(font, codepoint):
    colr = font["COLR"].table
    name = font.getBestCmap()[codepoint]
    return next(r.Paint for r in colr.BaseGlyphList.BaseGlyphPaintRecord if r.BaseGlyph == name)


class MaskTest(unittest.TestCase):
    def test_masked_glyph_is_a_dest_in_composite_of_colours_and_mask(self):
        font = build_with({"ue000": MASKED_SVG})
        paint = paint_of(font, 0xE000)
        self.assertEqual(paint.Format, ot.PaintFormat.PaintComposite)
        self.assertEqual(paint.CompositeMode, ot.CompositeMode.DEST_IN)
        self.assertEqual(glyph_paints(font, paint.BackdropPaint), 1)        # the red colour layer
        self.assertEqual(glyph_paints(font, paint.SourcePaint), 2)          # the two mask levels

    def test_glyph_without_mask_stays_a_plain_layer_list(self):
        paint = paint_of(build_with({"ue000": BASE_SVG}), 0xE000)
        self.assertNotEqual(paint.Format, ot.PaintFormat.PaintComposite)
