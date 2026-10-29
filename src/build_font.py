"""Stage 2: compile ./out/*.svg into a COLRv1 font, in one process.

This replaces nanoemoji, which is a ninja generator: it shells out one `picosvg`
and one `write_part_file` process *per SVG*, so a full build spends ~420s of CPU
across ~1640 interpreter startups to do a few seconds of actual work. Everything
here happens in-process with fontTools, which nanoemoji is itself built on.

The output is intended to be equivalent to the nanoemoji build, so the conventions
below are copied from it rather than invented:

  advance   nanoemoji's `_advance_width` is max(--width, (asc - desc) * vb.w / vb.h).
            The old generate_font.sh passed `--width 0`, so with 950/-250 metrics and a
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

import argparse
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

try:
    from . import color_formats, web_fonts    # imported as `src.build_font` (the tests)
except ImportError:
    import color_formats, web_fonts           # run as `python src/build_font.py`

UPEM = 1024
ASCENDER = 950
DESCENDER = -250
CANVAS_HEIGHT = 40.0
SCALE = (ASCENDER - DESCENDER) / CANVAS_HEIGHT      # 30 font units per canvas unit
X_NUDGE = -20                                       # nanoemoji's --transform, in font units
CLIP_PAD_Y = 10          # nanoemoji pads the clip box in y only, not x

BANNER_WIDTH = 20        # canvas units; the base glyph's viewBox width
MISSING = ".missing"
MISSING_STROKE = 60      # border thickness of the .missing box, in font units
# Layer color digit x (0-f) and pattern yy (00-42). The filename is `ue` + x + yy with yy
# written as two *decimal* digits, which the codepoint reads as hex digits: pattern 42 is
# U+E042, not U+E02A. That is why U+E00A-E00F and U+E01A-E01F are never banners.
PATTERN_COUNT = 43      # patterns 00-42; equals PATTERN_TEXTURES.length in src/extract.ts
EXPECTED_BANNER_CODEPOINTS = [0xE000 + x * 0x100 + (yy // 10) * 0x10 + yy % 10
                              for x in range(16) for yy in range(PATTERN_COUNT)]

SVG_NS = "{http://www.w3.org/2000/svg}"

# The colour formats the font can carry. Each renderer picks the richest one it knows, so
# the default is all of them; see color_formats.py for who reads which. `sbix` also needs
# the source PNGs (the images_dir argument of build()) and is skipped without them.
FORMATS = ("colrv1", "colrv0", "svg", "sbix")

# Identity. Both macOS Font Book and the Windows font installer reject a font whose
# nameIDs 1-6 are not all present, so none of these is cosmetic. VERSION must agree
# with head.fontRevision, and PS_NAME must contain no spaces and none of `[](){}<>/%`.
FAMILY = "BannerFont"
STYLE = "Regular"
FULL_NAME = f"{FAMILY} {STYLE}"
PS_NAME = f"{FAMILY}-{STYLE}"
VERSION = 1.0
VENDOR_ID = "BNFT"                                  # OS/2 achVendID, exactly 4 chars
COPYRIGHT = ("Copyright (c) 2023 Pickaxe828. Code: MIT License. Glyphs are derived from "
             "Minecraft textures, copyright Mojang Studios and Microsoft Corporation.")
# nameID 13. The MIT License covers the code only; the textures and every derivative of
# them (this font) stay with Mojang Studios and Microsoft Corporation. tests/vendor_identity.py
# lists the phrases that the built font must keep.
LICENSE_DESCRIPTION = (
    "The glyphs in this font are derived from official Minecraft textures. The textures "
    "and all derivatives of them, including this font, remain the property of Mojang "
    "Studios and Microsoft Corporation. The MIT License applies to the source code only. "
    "This is a non-commercial derivative work and is not endorsed by, associated with, "
    "or approved by Mojang or Microsoft.")
VENDOR_URL = "https://github.com/pickaxe828/bannerfont"

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


def missing_glyph():
    """A box outline filling the banner cell: the same x range and ascender..descender band
    the banners paint into. TrueType fills with nonzero winding and wants outer contours
    clockwise, so the inner rectangle runs counter-clockwise to cut the hole."""
    x0, x1 = X_NUDGE - round(SCALE * BANNER_WIDTH), X_NUDGE     # -620 .. -20
    y0, y1 = DESCENDER, ASCENDER
    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0))
    pen.closePath()
    i = MISSING_STROKE
    pen.moveTo((x0 + i, y0 + i)); pen.lineTo((x1 - i, y0 + i))
    pen.lineTo((x1 - i, y1 - i)); pen.lineTo((x0 + i, y1 - i))
    pen.closePath()
    return pen.glyph()


def codepoint_of(stem: str) -> int:
    """`ue000` -> 0xE000, `ucfff7` -> 0xCFFF7. Filenames are the naming contract."""
    if not re.fullmatch(r"u[0-9a-fA-F]{4,6}", stem):
        raise ValueError(f"unexpected glyph filename: {stem}")
    return int(stem[1:], 16)


def read_gradients(root):
    """`<linearGradient>` defs of a stage 1 SVG, by id.

    Stage 1 writes only userSpaceOnUse gradients with stop-color/stop-opacity stops; anything
    else is rejected rather than guessed at."""
    gradients = {}
    for node in root.iter(f"{SVG_NS}linearGradient"):
        if node.get("gradientUnits") != "userSpaceOnUse":
            raise ValueError(f"gradient {node.get('id')!r} is not userSpaceOnUse")
        stops = [(float(stop.get("offset")), stop.get("stop-color"),
                  float(stop.get("stop-opacity", 1.0)))
                 for stop in node.iter(f"{SVG_NS}stop")]
        gradients[node.get("id")] = {
            "points": tuple(float(node.get(a)) for a in ("x1", "y1", "x2", "y2")),
            "stops": stops,
        }
    return gradients


def read_svg(path: Path):
    """Return (viewBox_width, [(fill, opacity, path_d, is_mask), ...]) for a stage 1 SVG.

    `fill` is a "#rrggbb" string, or a gradient dict from read_gradients for `fill="url(#id)"`.
    A group with data-mask="1" is an alpha mask layer, see the COLR assembly in build()."""
    root = ET.parse(path).getroot()
    vb = root.get("viewBox")
    width = float(vb.split(",")[2]) if vb else 0.0
    gradients = read_gradients(root)
    layers = []
    for group in root.iter(f"{SVG_NS}g"):
        fill = group.get("fill")
        if not fill or fill == "none":
            continue
        if fill.startswith("url(#"):
            fill = gradients[fill[len("url(#"):-1]]
        # Quantization can land on semi-transparent colours; paper.js writes those as
        # fill-opacity on the group. 672 of the 818 glyphs carry one, so ignoring it
        # silently washes out most of the font.
        opacity = float(group.get("fill-opacity", 1.0))
        for node in group.iter(f"{SVG_NS}path"):
            d = node.get("d")
            if d:
                layers.append((fill, opacity, d, group.get("data-mask") == "1"))
    return width, layers


def svg_inner(path: Path) -> str:
    """Everything between the root <svg> tag and </svg>: the markup the SVG table reuses as is."""
    text = path.read_text()
    return text.split(">", 1)[1].rsplit("</svg>", 1)[0]


def parse_colour(fill: str):
    fill = fill.strip()
    if not fill.startswith("#") or len(fill) != 7:
        raise ValueError(f"unsupported fill {fill!r}")
    return tuple(int(fill[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1.0,)


def gradient_paint(gradient, opacity, xform, palette_for):
    """A COLRv1 PaintLinearGradient from a read_gradients entry (canvas space -> font units).

    COLRv1 takes three points: the gradient runs from p0 to p1, and p2 only fixes the
    orientation of the colour lines, which are perpendicular to p0->p2. Stage 1 gradients
    are vertical, so p2 sits to the right of p0 and the lines come out horizontal."""
    x1, y1, x2, y2 = gradient["points"]
    p0, p1 = xform.transformPoint((x1, y1)), xform.transformPoint((x2, y2))
    p2 = (p0[0] + 100, p0[1])
    return {
        "Format": 4,                                   # PaintLinearGradient
        "ColorLine": {
            "Extend": "pad",
            "ColorStop": [{"StopOffset": offset,
                           "PaletteIndex": palette_for(parse_colour(colour)),
                           "Alpha": alpha * opacity}
                          for offset, colour, alpha in gradient["stops"]],
        },
        "x0": round(p0[0]), "y0": round(p0[1]),
        "x1": round(p1[0]), "y1": round(p1[1]),
        "x2": round(p2[0]), "y2": round(p2[1]),
    }


def build(out_dir: Path, images_dir: Path | None = None, formats=FORMATS) -> bytes:
    unknown = set(formats) - set(FORMATS)
    if unknown:
        raise SystemExit(f"unknown colour format(s) {sorted(unknown)}; choose from {list(FORMATS)}")
    # Collect the stage 1 output. Sorted, so the glyph order is reproducible.
    # `<glyph>.flat.svg` is not a glyph: it is the flat-colour twin of a gradient glyph, read
    # below as that glyph's COLRv0 layers.
    files = sorted(f for f in out_dir.glob("*.svg") if not f.name.endswith(".flat.svg"))
    if not files:
        raise SystemExit(f"no SVGs in {out_dir}")

    # Map canvas space onto the ascender..descender band. y flips, x gets the nudge.
    xform = Transform(SCALE, 0, 0, -SCALE, X_NUDGE, ASCENDER)

    # .notdef, then a blank glyph at gid1: nanoemoji keeps one because "Win 10 Chrome
    # likes a blank gid1". It is deliberately left out of cmap.
    glyph_order = [".notdef", ".blank"]
    glyphs = {n: TTGlyphPen(None).glyph() for n in glyph_order}
    advances = {n: 0 for n in glyph_order}

    # .missing: a visible box for banner codepoints with no SVG. It is a plain glyf glyph,
    # not in COLR, and one banner wide so it steps the pen like a real base glyph.
    glyph_order.append(MISSING)
    glyphs[MISSING] = missing_glyph()
    advances[MISSING] = round(SCALE * BANNER_WIDTH)

    # Accumulators for the whole font. Every table below is filled by the one loop.
    cmap: dict[int, str] = {}
    colour_glyphs: dict[str, dict] = {}
    clip_boxes: dict[str, tuple] = {}
    palette: list[tuple] = []
    palette_index: dict[tuple, int] = {}
    shape_index: dict[str, str] = {}      # transformed outline key -> shape glyph name
    flat_layers: dict[str, list] = {}     # COLRv0: base -> [(shape, palette index with alpha)]
    svg_markup: dict[str, str] = {}       # OpenType-SVG: base -> the stage 1 defs and groups
    overlays: set[str] = set()            # base glyphs with a zero advance

    def shape_for(d):
        """(shared outline glyph, its outline) for canvas path `d`, in font units; None if empty."""
        record = RecordingPen()
        parse_path(d, TransformPen(record, xform))
        if not record.value:
            return None
        key = repr(record.value)                       # identical outline -> one glyph
        shape = shape_index.get(key)
        if shape is None:
            shape = f"s{len(shape_index):05d}"
            pen = TTGlyphPen(None)
            record.replay(pen)
            glyphs[shape] = pen.glyph()
            glyph_order.append(shape)
            advances[shape] = 0
            shape_index[key] = shape
        return shape, record

    def palette_for(colour):
        """CPAL index of an RGBA colour, adding it on first use."""
        idx = palette_index.get(colour)
        if idx is None:
            idx = len(palette)
            palette.append(colour)
            palette_index[colour] = idx
        return idx

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
        mask_list = []

        for fill, opacity, d, is_mask in layers:
            found = shape_for(d)
            if found is None:
                continue
            shape, record = found
            record.replay(bounds)
            if isinstance(fill, dict):
                paint = gradient_paint(fill, opacity, xform, palette_for)
            else:
                # Colours go into the CPAL palette once each. Alpha stays per layer.
                paint = {"Format": 2, "PaletteIndex": palette_for(parse_colour(fill)), "Alpha": opacity}
            (mask_list if is_mask else layer_list).append({"Format": 10, "Glyph": shape, "Paint": paint})   # PaintGlyph

        # COLRv0 layers: the glyph's own flat layers, or its `.flat.svg` twin when it has gradients
        # or alpha masks (v0 has no gradients and no PaintComposite). v0 has no paint alpha either,
        # so the alpha is baked into its own palette entry.
        flat_path = path.with_name(stem + ".flat.svg")
        has_mask = any(is_mask for *_, is_mask in layers)
        flat_source = read_svg(flat_path)[1] if flat_path.exists() else layers
        flat = []
        for fill, opacity, d, is_mask in (flat_source if "colrv0" in formats else ()):
            if is_mask:
                continue                               # a twin never has masks; a lone glyph loses its alpha
            if isinstance(fill, dict):
                raise ValueError(f"{path.name} has a gradient and no {flat_path.name} fallback")
            found = shape_for(d)
            if found is not None:
                flat.append((found[0], palette_for(parse_colour(fill)[:3] + (opacity,))))
        # The SVG table cannot draw the mask groups either: it takes the plain twin of such a glyph.
        markup = svg_inner(flat_path if has_mask and flat_path.exists() else path)

        # Derive the clip box from the real ink bounds of every layer.
        if not layer_list or bounds.bounds is None:
            continue
        if mask_list:
            # Translucent artwork: the opaque colour layers keep it seam-free, and the
            # nested alpha masks are applied to the whole group (DEST_IN keeps the
            # backdrop only where, and as much as, the source covers it).
            colour_glyphs[base] = {
                "Format": 32,                          # PaintComposite
                "SourcePaint": {"Format": 1, "Layers": mask_list},
                "CompositeMode": "DEST_IN",
                "BackdropPaint": {"Format": 1, "Layers": layer_list},
            }
        else:
            colour_glyphs[base] = {"Format": 1, "Layers": layer_list}
        flat_layers[base] = flat
        svg_markup[base] = markup
        if width == 0:
            overlays.add(base)
        x0, y0, x1, y1 = bounds.bounds
        clip_boxes[base] = (
            round(x0), round(y0) - CLIP_PAD_Y,
            round(x1), round(y1) + CLIP_PAD_Y,
        )

    # Every banner codepoint no SVG produced shows the tofu box instead of nothing.
    missing = sorted(cp for cp in EXPECTED_BANNER_CODEPOINTS if cp not in cmap)
    for cp in missing:
        cmap[cp] = MISSING
    print(f"{len(missing)} expected banner codepoints mapped to {MISSING}")

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
        "licenseDescription": LICENSE_DESCRIPTION,     # 13
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
    if "colrv1" in formats or "colrv0" in formats:
        fb.setupCPAL([palette])
    if "colrv1" in formats:
        fb.setupCOLR(colour_glyphs, version=1, allowLayerReuse=True, clipBoxes=clip_boxes)
    if "colrv0" in formats:
        color_formats.add_colr_v0(fb.font, flat_layers)
    if "svg" in formats:
        color_formats.add_svg_table(fb.font, svg_markup)
    if "sbix" in formats:
        bitmaps, left = {}, {}
        for base in colour_glyphs:
            image = Path(images_dir or "") / f"{base[len('g_ue'):]}.png"
            if images_dir is not None and image.exists():
                bitmaps[base] = color_formats.png_cell(image.read_bytes())
                left[base] = -620 if base in overlays else -20
        if bitmaps:
            color_formats.add_sbix(fb.font, bitmaps, left_by_glyph=left)
        elif images_dir is not None:
            print(f"sbix skipped: no banner PNGs in {images_dir}", file=sys.stderr)

    # Serialize to memory. main() owns the write to disk.
    buf = io.BytesIO()
    fb.save(buf)
    print(f"{len(files)} svgs -> {len(colour_glyphs)} colour glyphs, "
          f"{len(shape_index)} distinct shapes, {len(palette)} palette entries, "
          f"{len(glyph_order)} glyphs total")
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile ./out/*.svg into a colour font.")
    parser.add_argument("out_dir", nargs="?", default="out", type=Path)
    parser.add_argument("dest", nargs="?", default="build/Font.ttf", type=Path)
    parser.add_argument("--images", type=Path, default=None,
                        help="directory of source PNGs; enables the sbix bitmap strike")
    parser.add_argument("--web", type=Path, default=None,
                        help="also write the split web fonts, a stylesheet and a check page to this directory")
    parser.add_argument("--formats", default=",".join(FORMATS),
                        help=f"comma list of colour formats to include (default: all of {','.join(FORMATS)})")
    args = parser.parse_args()
    out_dir, dest = args.out_dir, args.dest
    t0 = time.time()
    data = build(out_dir, args.images, tuple(f for f in args.formats.split(",") if f))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    print(f"wrote {dest} ({len(data)} bytes) in {time.time() - t0:.2f}s")
    if args.web:
        sizes = web_fonts.write(args.web, lambda formats: build(out_dir, None, formats))
        for name, size in sizes.items():
            print(f"wrote {args.web / name} ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
