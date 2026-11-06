"""The colour fallbacks (COLRv0, OpenType-SVG, sbix), the gradient fill and the web split, on
tiny hand-written input. The checks on the real build are in tests/font/test_compat.py."""

import io
import tempfile
import unittest
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image

from src import build_font, color_formats, web_fonts
from tests.code.support import BASE_SVG, OVERLAY_SVG, build_with

# A ramp glyph the way stage 1 writes it: one class painted with a vertical alpha gradient.
RAMP_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,0,40"><defs>'
            '<linearGradient id="r0" gradientUnits="userSpaceOnUse" x1="-20" y1="0.5" x2="-20" y2="39.5">'
            '<stop offset="0" stop-color="#808080" stop-opacity="1"/>'
            '<stop offset="1" stop-color="#808080" stop-opacity="0"/></linearGradient></defs>'
            '<g fill="url(#r0)" fill-rule="nonzero"><path d="M-20,0h20v40h-20z"/></g></svg>')
RAMP_FLAT_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,0,40">'
                 '<g fill="#808080" fill-opacity="0.5"><path d="M-20,0h20v20h-20z"/></g>'
                 '<g fill="#808080" fill-opacity="0.25"><path d="M-20,20h20v20h-20z"/></g></svg>')

FILES = {"ue000": BASE_SVG, "ue113": OVERLAY_SVG}


def write_dir(tmp: str, files: dict[str, str]) -> Path:
    for stem, svg in files.items():
        (Path(tmp) / f"{stem}.svg").write_text(svg)
    return Path(tmp)


def font_of(data: bytes) -> TTFont:
    return TTFont(io.BytesIO(data))


def glyph(font: TTFont, codepoint: int) -> str:
    """The glyph a code point maps to. The built font stores no glyph names (post format 3), so
    a reloaded font calls them uniE000 and so on, not the build's own g_ue000."""
    return font.getBestCmap()[codepoint]


class FormatsTest(unittest.TestCase):
    def test_default_build_has_colrv1_colrv0_and_svg_but_no_sbix_without_images(self):
        font = build_with(FILES)
        self.assertEqual(font["COLR"].version, 1)
        self.assertEqual({r.BaseGlyph for r in font["COLR"].table.BaseGlyphRecordArray.BaseGlyphRecord},
                         {glyph(font, 0xE000), glyph(font, 0xE113)})
        self.assertEqual(len(font["SVG "].docList), 2)
        self.assertNotIn("sbix", font)

    def test_a_glyph_is_in_both_the_v0_records_and_the_v1_paints(self):
        table = build_with(FILES)["COLR"].table
        v1 = {r.BaseGlyph for r in table.BaseGlyphList.BaseGlyphPaintRecord}
        v0 = {r.BaseGlyph for r in table.BaseGlyphRecordArray.BaseGlyphRecord}
        self.assertEqual(v1, v0)

    def test_v0_layers_bake_the_alpha_into_the_palette(self):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,20,40">'
               '<g fill="#ff0000" fill-opacity="0.5"><path d="M0,0h20v40h-20z"/></g></svg>')
        font = build_with({"ue000": svg})
        layer = font["COLR"].table.LayerRecordArray.LayerRecord[0]
        colour = font["CPAL"].palettes[0][layer.PaletteIndex]
        self.assertEqual((colour.red, colour.green, colour.blue), (255, 0, 0))
        self.assertAlmostEqual(colour.alpha / 255, 0.5, delta=0.01)

    def test_unknown_format_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit):
            build_font.build(write_dir(tmp, FILES), formats=("colrv2",))

    def test_colrv1_alone_has_neither_v0_records_nor_svg(self):
        with tempfile.TemporaryDirectory() as tmp:
            font = font_of(build_font.build(write_dir(tmp, FILES), formats=("colrv1",)))
        self.assertNotIn("SVG ", font)
        self.assertEqual(font["COLR"].table.BaseGlyphRecordCount, 0)

    def test_the_v0_and_svg_pair_has_no_colrv1_data(self):
        # WebKit draws a COLR table that carries v1 data wrongly when there is no SVG table to
        # prefer, so the web "compat" font must be a pure version 0 table.
        with tempfile.TemporaryDirectory() as tmp:
            font = font_of(build_font.build(write_dir(tmp, FILES), formats=("colrv0", "svg")))
        self.assertEqual(font["COLR"].version, 0)
        self.assertIn("SVG ", font)


class SvgTableTest(unittest.TestCase):
    def test_document_is_keyed_by_glyph_id_and_maps_canvas_to_font_units(self):
        font = build_with(FILES)
        doc = font["SVG "].docList[0]
        gid = font.getGlyphID(glyph(font, 0xE000))
        self.assertEqual((doc.startGlyphID, doc.endGlyphID), (gid, gid))
        self.assertIn(f'id="glyph{gid}"', doc.data)
        self.assertIn("matrix(30 0 0 30 -20 -950)", doc.data)
        self.assertIn('d="M0,0h20v40h-20z"', doc.data)

    def test_documents_are_in_glyph_id_order(self):
        docs = build_with(FILES)["SVG "].docList
        self.assertEqual([d.startGlyphID for d in docs], sorted(d.startGlyphID for d in docs))


class GradientTest(unittest.TestCase):
    def test_a_gradient_fill_becomes_a_linear_gradient_paint_with_stop_alphas(self):
        font = build_with({"ue000": BASE_SVG, "ue013": RAMP_SVG, "ue013.flat": RAMP_FLAT_SVG})
        record = next(r for r in font["COLR"].table.BaseGlyphList.BaseGlyphPaintRecord
                      if r.BaseGlyph == glyph(font, 0xE013))
        fill = record.Paint.Paint if record.Paint.Format == 10 else None
        self.assertEqual(fill.Format, 4)
        stops = fill.ColorLine.ColorStop
        self.assertEqual([s.Alpha for s in stops], [1.0, 0.0])
        self.assertEqual(stops[0].PaletteIndex, stops[1].PaletteIndex)
        self.assertEqual(fill.x0, fill.x1)
        # canvas y 0.5 / 39.5 -> font y 935 / -235 (ascender 950, 30 units per canvas unit)
        self.assertEqual((fill.y0, fill.y1), (935, -235))

    def test_the_v0_layers_come_from_the_flat_twin(self):
        font = build_with({"ue000": BASE_SVG, "ue013": RAMP_SVG, "ue013.flat": RAMP_FLAT_SVG})
        records = {r.BaseGlyph: r for r in font["COLR"].table.BaseGlyphRecordArray.BaseGlyphRecord}
        self.assertEqual(records[glyph(font, 0xE013)].NumLayers, 2)

    def test_the_flat_twin_is_not_a_glyph(self):
        # codepoint_of("ue013.flat") would raise if the twin were read as a glyph of its own.
        font = build_with({"ue000": BASE_SVG, "ue013": RAMP_SVG, "ue013.flat": RAMP_FLAT_SVG})
        self.assertEqual(sum(1 for name in font.getBestCmap().values() if font.getGlyphID(name) != 2), 2)

    def test_a_gradient_without_a_flat_twin_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "no ue013.flat.svg fallback"):
            build_with({"ue000": BASE_SVG, "ue013": RAMP_SVG})

    def test_svg_document_keeps_the_gradient(self):
        font = build_with({"ue000": BASE_SVG, "ue013": RAMP_SVG, "ue013.flat": RAMP_FLAT_SVG})
        doc = next(d for d in font["SVG "].docList if d.startGlyphID == font.getGlyphID(glyph(font, 0xE013)))
        self.assertIn("<linearGradient", doc.data)
        self.assertIn('fill="url(#r0)"', doc.data)


def banner_png(colour=(255, 0, 0, 255)) -> bytes:
    im = Image.new("RGBA", (20, 40), colour)
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


class SbixTest(unittest.TestCase):
    def test_png_cell_is_one_banner_cell_and_keeps_the_pixels(self):
        cell = Image.open(io.BytesIO(color_formats.png_cell(banner_png((10, 20, 30, 40))))).convert("RGBA")
        self.assertEqual(cell.size, (300, 600))
        self.assertEqual(cell.getpixel((0, 0)), (10, 20, 30, 40))
        self.assertEqual(cell.getpixel((299, 599)), (10, 20, 30, 40))

    def test_png_cell_keeps_more_than_256_colours_exactly(self):
        im = Image.new("RGBA", (20, 40))
        im.putdata([(x % 256, (x // 3) % 256, (x * 7) % 256, 255) for x in range(800)])
        out = io.BytesIO()
        im.save(out, "PNG")
        cell = Image.open(io.BytesIO(color_formats.png_cell(out.getvalue()))).convert("RGBA")
        self.assertEqual(cell.getpixel((15 * 7 + 3, 15 * 2 + 4)), im.getpixel((7, 2)))

    def test_png_cell_refuses_another_size(self):
        out = io.BytesIO()
        Image.new("RGBA", (10, 10)).save(out, "PNG")
        with self.assertRaises(ValueError):
            color_formats.png_cell(out.getvalue())

    def test_build_with_images_adds_a_strike_with_offsets_for_base_and_overlay(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as images:
            (Path(images) / "000.png").write_bytes(banner_png())
            (Path(images) / "113.png").write_bytes(banner_png())
            font = font_of(build_font.build(write_dir(tmp, FILES), Path(images)))
        strike = font["sbix"].strikes[512]
        base, overlay = strike.glyphs[glyph(font, 0xE000)], strike.glyphs[glyph(font, 0xE113)]
        self.assertEqual((base.originOffsetX, base.originOffsetY), (-10, -125))
        self.assertEqual((overlay.originOffsetX, overlay.originOffsetY), (-310, -125))

    def test_missing_images_skip_sbix_instead_of_writing_an_empty_table(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as images:
            font = font_of(build_font.build(write_dir(tmp, FILES), Path(images)))
        self.assertNotIn("sbix", font)


class WebFontsTest(unittest.TestCase):
    def test_write_makes_two_woff2_files_a_stylesheet_and_a_check_page(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as web:
            out = write_dir(tmp, FILES)
            sizes = web_fonts.write(Path(web), lambda formats: build_font.build(out, None, formats))
            self.assertEqual(set(sizes), {web_fonts.COLRV1_FILE, web_fonts.COMPAT_FILE})
            css = (Path(web) / "BannerFont.css").read_text()
            self.assertTrue((Path(web) / "index.html").exists())
            colrv1 = TTFont(Path(web) / web_fonts.COLRV1_FILE)
            compat = TTFont(Path(web) / web_fonts.COMPAT_FILE)
        self.assertEqual(colrv1.flavor, "woff2")
        self.assertNotIn("SVG ", colrv1)
        self.assertEqual(compat["COLR"].version, 0)
        self.assertIn("SVG ", compat)
        self.assertIn(f'url("{web_fonts.COLRV1_FILE}") format("woff2") tech(color-COLRv1)', css)
        self.assertIn("U+E000-EF42, U+F000-F07F, U+CFFF7", css)
        # The compat file is the last source and has no tech(): old browsers must reach it.
        self.assertTrue(css.index(web_fonts.COMPAT_FILE) > css.index(web_fonts.COLRV1_FILE))
        self.assertNotIn("tech(", css.split(web_fonts.COMPAT_FILE)[1])


if __name__ == "__main__":
    unittest.main()
