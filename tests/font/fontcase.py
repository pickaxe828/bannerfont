"""Shared harness for the real-font suite: finds build/Font.ttf and loads it once.

Seam: the built font file, read with fontTools and exercised with HarfBuzz's
`hb-shape` / `hb-view`. Nothing here imports the build code.

A missing font skips every test with a message that names the build command. With
REQUIRE_REAL_FONT=1 (which `tests/font/run.py` sets) a missing font is a failure
instead, so a CI run can never go green by testing nothing.
"""

import logging
import os
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # tests/vendor_identity.py

from fontTools.ttLib import TTFont  # noqa: E402

# fontTools warns about every wide space glyph (advance > 32767 for n >= 55); that is
# intended here and would drown the test output.
logging.getLogger("fontTools").setLevel(logging.ERROR)

REPO_ROOT = Path(__file__).resolve().parents[2]
# BANNERFONT_TTF points the suite at another font file, e.g. to check that a test
# really fails on a deliberately broken copy. The default is the real build output.
FONT_PATH = Path(os.environ.get("BANNERFONT_TTF") or REPO_ROOT / "build" / "Font.ttf")
BUILD_HINT = "run `sh generate_full.sh` (or `sh generate_font.sh` if ./out is populated)"

BANNER_ADVANCE = 600                      # 30 font units * 20 canvas units
COLORS = range(16)
PATTERNS = range(43)


def banner_cp(color: int, pattern: int) -> int:
    """The encoding: `ue` + colour hex digit + pattern as two decimal digits read as hex."""
    return 0xE000 + color * 0x100 + (pattern // 10) * 0x10 + pattern % 10


BANNER_CODEPOINTS = [banner_cp(x, yy) for x in COLORS for yy in PATTERNS]
BASE_CODEPOINTS = [banner_cp(x, 0) for x in COLORS]
OVERLAY_CODEPOINTS = [banner_cp(x, yy) for x in COLORS for yy in PATTERNS if yy > 0]

_cache: dict[Path, TTFont] = {}


def require_font_message() -> str:
    return f"{FONT_PATH} does not exist: {BUILD_HINT}"


def require_tool(name: str) -> str:
    """Path of an external tool, or skip with a visible message when it is absent."""
    path = shutil.which(name)
    if path is None:
        raise unittest.SkipTest(f"`{name}` not found on PATH (install HarfBuzz utilities)")
    return path


def require_font_file() -> Path:
    if FONT_PATH.exists():
        return FONT_PATH
    if os.environ.get("REQUIRE_REAL_FONT") == "1":
        raise AssertionError(f"REQUIRE_REAL_FONT=1 and {require_font_message()}")
    # unittest only prints skip reasons with -v, so say it once on stderr as well.
    print(f"tests/font: SKIPPED, {require_font_message()}", file=sys.stderr)
    raise unittest.SkipTest(require_font_message())


class RealFontTestCase(unittest.TestCase):
    """Base class: `self.font` is the parsed built font, `self.cmap` its best cmap."""

    font: TTFont
    cmap: dict[int, str]

    @classmethod
    def setUpClass(cls):
        path = require_font_file()
        if path not in _cache:
            _cache[path] = TTFont(path)
        cls.font = _cache[path]
        cls.cmap = cls.font.getBestCmap()

    def advance(self, cp: int) -> int:
        return self.font["hmtx"][self.cmap[cp]][0]
