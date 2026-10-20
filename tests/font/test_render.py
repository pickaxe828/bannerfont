"""Render test: draw a base, then the same base plus one overlay, with hb-view, and check
the overlay changes pixels, and only inside the banner cell. Structural checks cannot see an overlay that is present in the
tables but never painted (the lsb != xMin bug passed all of them)."""

import struct
import subprocess
import tempfile
import unittest
import zlib
from pathlib import Path

from tests.font.fontcase import FONT_PATH, RealFontTestCase, require_tool
from tests.font_spec import banner_cp

BASE = banner_cp(0x3, 0)           # black base
OVERLAY = banner_cp(0x0, 1)        # white pattern 01 on top of it
BACKGROUND = "ffffffff"
EDGE_PX = 1        # antialiasing bleeds the overlay's edge one pixel past the base's ink box


def decode_png(data: bytes):
    """(width, height, rows of bytes) for the 8-bit, non-interlaced PNG cairo writes."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, header = 8, b"", None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    width, height, depth, color, _, _, interlace = header
    channels = {2: 3, 6: 4}[color]
    assert depth == 8 and interlace == 0, f"unsupported PNG: depth {depth}, interlace {interlace}"
    stride, raw, rows, prev = width * channels, zlib.decompress(idat), [], bytes(width * channels)
    for y in range(height):
        kind, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = bytes(line)
    return width, height, rows


def pixels(image):
    """(x, y, rgb) for every pixel of a decoded PNG."""
    width, _, rows = image
    step = len(rows[0]) // width
    for y, row in enumerate(rows):
        for x in range(width):
            yield x, y, row[x * step:x * step + 3]


def bounding_box(points):
    """(x0, y0, x1, y1) over (x, y) points, or None when there are none."""
    xs, ys = zip(*points) if points else ((), ())
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


class RenderTest(RealFontTestCase):
    def render(self, hb_view: str, tmp: Path, name: str, codepoints):
        out = tmp / f"{name}.png"
        subprocess.run([hb_view, str(FONT_PATH),
                        "--unicodes=" + ",".join(f"U+{cp:04X}" for cp in codepoints),
                        "--output-format=png", f"--output-file={out}", "--font-size=100",
                        f"--background={BACKGROUND}", "--foreground=000000ff"],
                       check=True, capture_output=True)
        return decode_png(out.read_bytes())

    def test_an_overlay_changes_pixels_only_inside_the_banner_cell(self):
        hb_view = require_tool("hb-view")
        with tempfile.TemporaryDirectory() as tmp:
            base = self.render(hb_view, Path(tmp), "base", [BASE])
            both = self.render(hb_view, Path(tmp), "both", [BASE, OVERLAY])
        self.assertEqual(base[:2], both[:2], "an overlay must not change the image size")
        background = bytes.fromhex(BACKGROUND)[:3]
        # The base is a full banner cell, so its ink box is the cell; the rest is margin.
        cell = bounding_box([(x, y) for x, y, rgb in pixels(base) if rgb != background])
        self.assertIsNotNone(cell, "the base alone drew nothing")
        changed = [(x, y) for (x, y, a), (_, _, b) in zip(pixels(base), pixels(both)) if a != b]
        self.assertTrue(changed, "the overlay drew nothing on top of the base")
        x0, y0, x1, y1 = (v + d * EDGE_PX for v, d in zip(cell, (-1, -1, 1, 1)))
        outside = [(x, y) for x, y in changed if not (x0 <= x <= x1 and y0 <= y <= y1)]
        self.assertEqual(outside[:5], [], f"overlay pixels outside the banner cell {cell}")


if __name__ == "__main__":
    unittest.main()
