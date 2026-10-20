"""What the built font must contain, independent of how it was built. Shared by tests/code
(synthetic build) and tests/font (the real build/Font.ttf), so both suites pin the same
encoding and the same `.missing` glyph."""

COLORS = range(16)
PATTERNS = range(43)


def banner_cp(color: int, pattern: int) -> int:
    """The encoding: `ue` + colour hex digit + pattern as two decimal digits read as hex,
    so pattern 42 is U+E042 (not U+E02A) and the control gaps stay unmapped."""
    return 0xE000 + color * 0x100 + (pattern // 10) * 0x10 + pattern % 10


BANNER_CODEPOINTS = [banner_cp(x, yy) for x in COLORS for yy in PATTERNS]

# `.missing` is a box outline in the banner cell, as build_font.missing_glyph draws it.
MISSING_X_RANGE = (-620, -20)
MISSING_Y_RANGE = (-250, 950)
# .notdef, .blank, .missing: the order build_font.py appends them in.
MISSING_GID = 2
