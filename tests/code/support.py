"""Helpers for the synthetic suite: tiny hand-written SVGs and a build over them.

Seam: build_font.build(out_dir) -> font bytes."""

import io
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont

from src import build_font

BASE_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,20,40">'
            '<g fill="#ff0000"><path d="M0,0h20v40h-20z"/></g></svg>')
OVERLAY_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,0,40">'
               '<g fill="#00ff00"><path d="M-20,0h10v10h-10z"/></g></svg>')


def build_with(stems_to_svg: dict[str, str]) -> TTFont:
    with tempfile.TemporaryDirectory() as tmp:
        for stem, svg in stems_to_svg.items():
            (Path(tmp) / f"{stem}.svg").write_text(svg)
        return TTFont(io.BytesIO(build_font.build(Path(tmp))))
