# Stage 2: compile ./out/*.svg into build/Font.ttf.
#
# This used to invoke nanoemoji, which is a ninja generator and spawns one picosvg
# plus one write_part_file process per SVG -- ~1640 Python interpreter startups for
# a full build, ~420s of CPU. src/build_font.py does the same job in one process with
# fontTools (which nanoemoji is itself built on), producing a font verified
# equivalent: identical cmap, identical advances, identical COLR paints and palette.
#
# It also never maps U+0020, so postprocess_font.py is no longer needed.
#
# Both paths are relative to the current directory, not to this script, so run it from
# the repo root: `sh generate_font.sh`.
python3 src/build_font.py out build/Font.ttf
