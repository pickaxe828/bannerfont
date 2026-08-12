"""Stage 2: compile ./out/*.svg into a COLRv1 font, in one process.

This replaces nanoemoji, which is a ninja generator: it shells out one `picosvg`
and one `write_part_file` process *per SVG*, so a full build spends ~420s of CPU
across ~1640 interpreter startups to do a few seconds of actual work. Everything
here happens in-process with fontTools, which nanoemoji is itself built on.

The output is intended to be equivalent to the nanoemoji build, so the conventions
below are copied from it rather than invented:

  advance   nanoemoji's `_advance_width` is max(--width, (asc - desc) * vb.w / vb.h).
            generate_font.sh passed `--width 0`, so with 950/-250 metrics and a
            height-40 canvas that is exactly 30 * viewBox.w -- one banner (vb.w=20)
            is 600 units. See CLAUDE.md.
  transform nanoemoji applied `--transform "translate(-20, 0)"` in *font* units,
            after mapping the viewBox to the ascender..descender band.
  clip box  every colour glyph needs one. Without it HarfBuzz derives extents from
            the (empty) base outline and mispositions the layers.

U+0020 is never mapped, so ASCII resolves entirely to .notdef; that was
postprocess_font.py's job and is now inherent.

Nothing above makes the font *installable*, and both desktop platforms refuse a font
that only shapes correctly. FontBuilder leaves the identity and classification fields
at placeholder values, and every one of the setup* calls below writes only what it is
handed -- none of them derives anything. The build therefore has to fill in:

  name       nameIDs 1-6 are all required. Without nameID 4 macOS Font Book shows
             "<no font name>" and fails 'name' table usability *and* structure, and
             the Windows installer answers "does not appear to be a valid font",
             because both register a font by its name records.
  OS/2       achVendID defaults to '????', fsSelection to 0 (neither regular nor bold
             nor italic), panose to all-zero, and ulCodePageRange to 0 -- the last of
             which tells Windows GDI the font supports no code page at all.

See the setupNameTable and setupOS2 calls in build() for the specific values.
"""

import io
import re
import sys
import time
from pathlib import Path
from xml.etree import ElementTree as ET

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

UPEM = 1024
ASCENDER = 950
DESCENDER = -250
CANVAS_HEIGHT = 40.0
SCALE = (ASCENDER - DESCENDER) / CANVAS_HEIGHT      # 30 font units per canvas unit
X_NUDGE = -20                                       # nanoemoji's --transform, in font units
CLIP_PAD_Y = 10          # nanoemoji pads the clip box in y only, not x

SVG_NS = "{http://www.w3.org/2000/svg}"

# Identity. Both macOS Font Book and the Windows font installer reject a font whose
# nameIDs 1-6 are not all present, so none of these is cosmetic. VERSION must agree
# with head.fontRevision, and PS_NAME must contain no spaces and none of `[](){}<>/%`.
FAMILY = "BannerFont"
STYLE = "Regular"
FULL_NAME = f"{FAMILY} {STYLE}"
PS_NAME = f"{FAMILY}-{STYLE}"
VERSION = 1.0
VENDOR_ID = "UBEF"                                  # OS/2 achVendID, exactly 4 chars
COPYRIGHT = "Copyright (c) 2023 Pickaxe828. MIT License."
VENDOR_URL = "https://github.com/pickaxe828/UBEF-Font"

FS_SELECTION_REGULAR = 1 << 6                       # OS/2 fsSelection bit 6
# Windows GDI reads ulCodePageRange to decide which code pages a font serves. All-zero
# means "none", so bit 31, the Symbol Character Set, is the honest bit for a font that
# covers only the Private Use Area. It does not trigger GDI's symbol-font codepoint
# remapping -- that needs a (3,0) cmap subtable, and setupCharacterMap writes (3,1).
CODE_PAGE_SYMBOL = 1 << 31
# sstruct packs the panose block field by field, so every one of the ten must be
# present. bFamilyType 5 is "Latin Symbol"; the rest stay 0 ("any") because none of
# them describes a banner.
PANOSE = dict(bFamilyType=5, bSerifStyle=0, bWeight=0, bProportion=0, bContrast=0,
              bStrokeVariation=0, bArmStyle=0, bLetterForm=0, bMidline=0, bXHeight=0)
# FontBuilder leaves all of these at 0, which asks the renderer for a zero-thickness
# strikeout and a zero-size subscript. The ratios are the long-standing core-font ones
# (Times/Arial at 2048 upem), rescaled to UPEM. No glyph here is a letter, so they only
# ever matter to software that asks the table rather than looking at the outlines.
TYPO_DECORATION = dict(
    yStrikeoutSize=round(UPEM * 102 / 2048), yStrikeoutPosition=round(UPEM * 530 / 2048),
    ySubscriptXSize=round(UPEM * 1331 / 2048), ySubscriptYSize=round(UPEM * 1331 / 2048),
    ySubscriptXOffset=0, ySubscriptYOffset=round(UPEM * 286 / 2048),
    ySuperscriptXSize=round(UPEM * 1331 / 2048), ySuperscriptYSize=round(UPEM * 1331 / 2048),
    ySuperscriptXOffset=0, ySuperscriptYOffset=round(UPEM * 983 / 2048),
)


def codepoint_of(stem: str) -> int:
    """`ue000` -> 0xE000, `ucfff7` -> 0xCFFF7. Filenames are the naming contract."""
    if not re.fullmatch(r"u[0-9a-fA-F]{4,6}", stem):
        raise ValueError(f"unexpected glyph filename: {stem}")
    return int(stem[1:], 16)


def read_svg(path: Path):
    """Return (viewBox_width, [(fill, opacity, path_d), ...]) for a paper.js export."""
    root = ET.parse(path).getroot()
    vb = root.get("viewBox")
    width = float(vb.split(",")[2]) if vb else 0.0
    layers = []
    for group in root.iter(f"{SVG_NS}g"):
        fill = group.get("fill")
        if not fill or fill == "none":
            continue
        # Quantization can land on semi-transparent colours; paper.js writes those as
        # fill-opacity on the group. 672 of the 818 glyphs carry one, so ignoring it
        # silently washes out most of the font.
        opacity = float(group.get("fill-opacity", 1.0))
        for node in group.iter(f"{SVG_NS}path"):
            d = node.get("d")
            if d:
                layers.append((fill, opacity, d))
    return width, layers


def parse_colour(fill: str):
    fill = fill.strip()
    if not fill.startswith("#") or len(fill) != 7:
        raise ValueError(f"unsupported fill {fill!r}")
    return tuple(int(fill[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1.0,)


def build(out_dir: Path) -> bytes:
    # Collect the stage 1 output. Sorted, so the glyph order is reproducible.
    files = sorted(out_dir.glob("*.svg"))
    if not files:
        raise SystemExit(f"no SVGs in {out_dir}")

    # Map canvas space onto the ascender..descender band. y flips, x gets the nudge.
    xform = Transform(SCALE, 0, 0, -SCALE, X_NUDGE, ASCENDER)

    # .notdef, then a blank glyph at gid1: nanoemoji keeps one because "Win 10 Chrome
    # likes a blank gid1". It is deliberately left out of cmap.
    glyph_order = [".notdef", ".blank"]
    glyphs = {n: TTGlyphPen(None).glyph() for n in glyph_order}
    advances = {n: 0 for n in glyph_order}

    # Accumulators for the whole font. Every table below is filled by the one loop.
    cmap: dict[int, str] = {}
    colour_glyphs: dict[str, dict] = {}
    clip_boxes: dict[str, tuple] = {}
    palette: list[tuple] = []
    palette_index: dict[tuple, int] = {}
    shape_index: dict[str, str] = {}      # transformed outline key -> shape glyph name

    # One pass per SVG. Each file becomes exactly one cmapped colour glyph.
    for path in files:
        stem = path.stem
        cp = codepoint_of(stem)
        width, layers = read_svg(path)
        advance = round(SCALE * width)

        # The base glyph holds the advance and the cmap entry, never the outline.
        base = f"g_{stem}"
        glyph_order.append(base)
        glyphs[base] = TTGlyphPen(None).glyph()       # colour glyphs carry no outline
        advances[base] = advance
        cmap[cp] = base

        if not layers:
            continue                                   # space / negative-space glyph

        # One SVG group becomes one COLR layer. `bounds` tracks the ink of them all.
        bounds = BoundsPen(None)
        layer_list = []
        for fill, opacity, d in layers:
            # Replay the SVG path through the transform, into font units.
            record = RecordingPen()
            parse_path(d, TransformPen(record, xform))
            if not record.value:
                continue
            record.replay(bounds)

            # Deduplicate outlines. The 688 banners share very few distinct shapes.
            key = repr(record.value)                   # identical outline -> one glyph
            shape = shape_index.get(key)
            if shape is None:
                shape = f"s{len(shape_index):05d}"
                pen = TTGlyphPen(None)
                record.replay(pen)
                glyphs[shape] = pen.glyph()
                glyph_order.append(shape)
                advances[shape] = 0
                shape_index[key] = shape

            # Deduplicate colours into the CPAL palette. Alpha stays per layer.
            colour = parse_colour(fill)
            idx = palette_index.get(colour)
            if idx is None:
                idx = len(palette)
                palette.append(colour)
                palette_index[colour] = idx

            layer_list.append({
                "Format": 10,                          # PaintGlyph
                "Glyph": shape,
                "Paint": {"Format": 2, "PaletteIndex": idx, "Alpha": opacity},
            })

        # Derive the clip box from the real ink bounds of every layer.
        if not layer_list or bounds.bounds is None:
            continue
        colour_glyphs[base] = {"Format": 1, "Layers": layer_list}
        x0, y0, x1, y1 = bounds.bounds
        clip_boxes[base] = (
            round(x0), round(y0) - CLIP_PAD_Y,
            round(x1), round(y1) + CLIP_PAD_Y,
        )

    # Assemble the tables. glyf must exist before the metrics read xMin back.
    fb = FontBuilder(UPEM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    # lsb MUST equal the glyph's xMin. TrueType rasterizers shift an outline by
    # (lsb - xMin), so leaving lsb at 0 on the overlays -- whose xMin is -620 --
    # slides every one of them a full banner to the right, where the clip box then
    # discards them entirely. nanoemoji sets lsb == xMin for exactly this reason.
    compiled = fb.font["glyf"]
    fb.setupHorizontalMetrics({
        name: (advances[name],
               compiled[name].xMin if compiled[name].numberOfContours else 0)
        for name in glyph_order
    })
    fb.setupHorizontalHeader(ascent=ASCENDER, descent=DESCENDER)
    # setupNameTable writes *only* the records passed to it -- it derives nothing. With
    # just familyName and styleName the font has no nameID 4, so Font Book reports it as
    # "<no font name>" and Windows calls the file invalid. nameIDs 1-6 are all required.
    fb.setupNameTable({
        "copyright": COPYRIGHT,                        # 0
        "familyName": FAMILY,                          # 1
        "styleName": STYLE,                            # 2
        "uniqueFontIdentifier": f"{VERSION:.3f};{VENDOR_ID};{PS_NAME}",   # 3
        "fullName": FULL_NAME,                         # 4
        "version": f"Version {VERSION:.3f}",           # 5
        "psName": PS_NAME,                             # 6
        "vendorURL": VENDOR_URL,                       # 11
    })
    fb.font["head"].fontRevision = VERSION             # must match nameID 5
    fb.setupOS2(sTypoAscender=ASCENDER, sTypoDescender=DESCENDER,
                usWinAscent=ASCENDER, usWinDescent=-DESCENDER,
                achVendID=VENDOR_ID,
                # fsSelection 0 claims the font is neither regular nor italic nor bold.
                fsSelection=FS_SELECTION_REGULAR,
                ulCodePageRange1=CODE_PAGE_SYMBOL,
                panose=PANOSE, **TYPO_DECORATION)
    fb.setupPost(keepGlyphNames=False)
    # The colour tables come last: CPAL holds the palette, COLR the per-glyph layers.
    fb.setupCPAL([palette])
    fb.setupCOLR(colour_glyphs, version=1, allowLayerReuse=True, clipBoxes=clip_boxes)

    # Serialize to memory. main() owns the write to disk.
    buf = io.BytesIO()
    fb.save(buf)
    print(f"{len(files)} svgs -> {len(colour_glyphs)} colour glyphs, "
          f"{len(shape_index)} distinct shapes, {len(palette)} palette entries, "
          f"{len(glyph_order)} glyphs total")
    return buf.getvalue()


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "out")
    dest = Path(sys.argv[2] if len(sys.argv) > 2 else "build/Font.ttf")
    t0 = time.time()
    data = build(out_dir)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    print(f"wrote {dest} ({len(data)} bytes) in {time.time() - t0:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
