"""Colour-font fallbacks that sit next to the COLRv1 tables in the same font file.

COLRv1 is the best-looking format and the one every Chromium and current Firefox build
renders, but it is the narrowest: no Apple platform draws it, and Windows only draws it
from Windows 11. A font file may carry several colour formats at once, and each
renderer picks the richest one it understands, so the build adds:

  COLRv0  flat layers in the same COLR table. A glyph may have both a v0 record and a
          v1 paint; a v1-capable renderer uses the v1 paint and the rest use the v0
          layers. Reached by DirectWrite on older Windows (so Word and Office), and by
          older Chromium/Firefox/FreeType.
  SVG     the OpenType-SVG table. Reached by Safari, CoreText on macOS/iOS, Adobe apps,
          Firefox and Windows 10+ DirectWrite.
  sbix    one PNG per glyph. Reached by every Apple text stack and Safari. The PNGs come
          from the extracted banner textures, so this is the exact image, not a trace.

Each function here takes the finished font (or the pieces to build a table from) and
returns/attaches one table. Nothing here changes the glyph order, the metrics or the
encoding.
"""

import io
from fontTools.ttLib import newTable
from fontTools.ttLib.tables.S_V_G_ import SVGDocument
from fontTools.ttLib.tables.sbixGlyph import Glyph as SbixGlyph
from fontTools.ttLib.tables.sbixStrike import Strike as SbixStrike
from fontTools.colorLib.builder import buildCOLR, populateCOLRv0

# sbix places a bitmap by pixels at the strike's ppem, so for the bitmap to land exactly
# on the banner cell the cell must be a whole number of pixels. The cell is 600 x 1200
# font units; at ppem 512 and 1024 upem that is 300 x 600 px, i.e. 15 px per source
# pixel. ppem 512 is the smallest ppem for which that is an integer.
SBIX_PPEM = 512
SBIX_SCALE = 15
SBIX_SOURCE_SIZE = (20, 40)


def add_colr_v0(font, flat_layers):
    """Add v0 layer records to the font's COLR table.

    `flat_layers` maps a base glyph name to [(shape glyph name, CPAL index), ...] painted
    first to last. The table must already exist (version 1) or this creates a v0 table."""
    glyph_map = font.getReverseGlyphMap()
    if "COLR" not in font:
        font["COLR"] = buildCOLR(flat_layers, version=0, glyphMap=glyph_map)
        return
    populateCOLRv0(font["COLR"].table, flat_layers, glyph_map)


def svg_document(gid, layers_markup):
    """One OpenType-SVG document: y points down from the baseline, in font units.

    `layers_markup` is the canvas-space SVG of the glyph (20x40 cells, y down from the top
    of the canvas). The matrix is the same canvas->font map build_font applies to the
    outlines: x * 30 + X_NUDGE, and y * 30 - ASCENDER once y is flipped."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            f'<g id="glyph{gid}" transform="matrix(30 0 0 30 -20 -950)">{layers_markup}</g></svg>')


def add_svg_table(font, markup_by_glyph):
    """Attach an 'SVG ' table. `markup_by_glyph` maps glyph name -> canvas-space markup."""
    order = font.getReverseGlyphMap()
    docs = []
    for name in sorted(markup_by_glyph, key=order.__getitem__):
        gid = order[name]
        docs.append(SVGDocument(svg_document(gid, markup_by_glyph[name]), gid, gid, compressed=True))
    table = newTable("SVG ")
    table.docList = docs
    font["SVG "] = table


def png_cell(png_bytes):
    """Upscale a 20x40 source PNG by SBIX_SCALE (nearest neighbour) and encode it as PNG."""
    from PIL import Image
    source = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    if source.size != SBIX_SOURCE_SIZE:
        raise ValueError(f"expected a {SBIX_SOURCE_SIZE} banner image, got {source.size}")
    # Most banners have under 256 colours, and an indexed PNG is several times smaller. The
    # ramp patterns do not, and quantizing them would defeat the point of this exact fallback.
    # Indexing happens before the upscale: 800 pixels instead of 180,000.
    if source.getcolors(maxcolors=256) is not None:
        source = _indexed(source)
    big = source.resize((source.width * SBIX_SCALE, source.height * SBIX_SCALE), Image.NEAREST)
    out = io.BytesIO()
    big.save(out, "PNG", optimize=True)
    return out.getvalue()


def _indexed(im):
    """Lossless palette image for an RGBA image that has at most 256 distinct colours."""
    from PIL import Image
    colors = [c for _, c in im.getcolors(maxcolors=256)]
    index = {c: i for i, c in enumerate(colors)}
    pal = Image.new("P", im.size)
    pal.putdata([index[p] for p in im.get_flattened_data()])
    pal.putpalette([v for c in colors for v in c[:3]])
    pal.info["transparency"] = bytes(c[3] for c in colors)
    return pal


def add_sbix(font, bitmaps, *, ppem=SBIX_PPEM, left_by_glyph):
    """Attach an 'sbix' table with one strike. `bitmaps` maps glyph name -> PNG bytes and
    `left_by_glyph` maps glyph name -> the bitmap's left edge from the origin, in font units."""
    scale = ppem / font["head"].unitsPerEm
    strike = SbixStrike(ppem=ppem, resolution=72)
    descender = font["hhea"].descent
    for name, data in bitmaps.items():
        strike.glyphs[name] = SbixGlyph(
            glyphName=name, graphicType="png ", imageData=data,
            originOffsetX=round(left_by_glyph[name] * scale),
            originOffsetY=round(descender * scale))
    table = newTable("sbix")
    table.version = 1
    table.flags = 1                # bit 0 is always set; bit 1 (draw outlines) stays clear
    table.strikes = {ppem: strike}
    font["sbix"] = table
