"""Post-process the font nanoemoji just built.

nanoemoji unconditionally creates a blank glyph mapped to U+0020 and parks it at
glyph id 1 -- see write_font.py, "Must have .notdef and Win 10 Chrome likes a blank
gid1 so make gid1 space". That is the only non-PUA entry it puts in cmap, and it means
an ASCII space renders from this font as a real (zero-width, invisible) glyph instead
of resolving to .notdef like every other ASCII character already does.

UBEF wants no ASCII coverage at all, so this drops that cmap entry. The glyph itself is
deliberately left in place at gid1: removing it would renumber every following glyph
and throw away nanoemoji's Chrome workaround. Unmapping is enough -- coverage is what
cmap says, and nothing else references the glyph.

Note this makes ASCII *uncovered*, which is not quite the same as forcing a visible
tofu. A browser that cannot find a codepoint in this font falls back to the next font
in the CSS stack; it only draws .notdef when no font in the stack covers the character.
Mapping a codepoint to glyph id 0 does not change that -- HarfBuzz treats a nominal
glyph of 0 as "not covered", exactly like an absent entry. Drawing a box for arbitrary
text would require mapping it to a real box-shaped glyph, which is not .notdef.

Usage: python3 postprocess_font.py [path/to/Font.ttf]
"""

import sys

from fontTools.ttLib import TTFont

# Every codepoint nanoemoji maps that UBEF does not want covered.
UNMAP = {0x0020}


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "build/Font.ttf"

    # lazy=False so the file is fully read before we save back over it.
    font = TTFont(path, lazy=False)

    removed = 0
    for table in font["cmap"].tables:
        for codepoint in UNMAP:
            if codepoint in table.cmap:
                del table.cmap[codepoint]
                removed += 1

    if not removed:
        print(f"{path}: nothing to unmap")
        return 0

    font.save(path)
    print(f"{path}: unmapped {sorted(hex(c) for c in UNMAP)} from cmap ({removed} subtable entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
