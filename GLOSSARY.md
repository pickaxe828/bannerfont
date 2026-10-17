# UBEF

UBEF turns Minecraft banner textures into a COLRv1 color font. A banner is written as ordinary text in the Unicode Private Use Area.

## Language

**Banner**:
A base glyph followed by zero or more overlay glyphs that composite in place into one 20×40 picture.

**Pattern**:
One of the 43 shapes numbered `00`–`42`. Pattern `00` is the base. Every other pattern is an overlay.
_Avoid_: Layer (internal synonym only, for example the `layer_code` key in `mappings.json`)

**Layer color**:
The color that tints a pattern, written as one hex digit `0`–`f`. The digit order is fixed by the encoding.
_Avoid_: Banner colour, pattern color, dye (in user-facing docs)

**Glyph**:
The font shape for one pattern in one layer color. Its name is `ue` + layer color digit + pattern digits.
_Avoid_: Character, icon

**Oracle**:
The local set of 688 reference PNGs that the new texture source must reproduce. It is temporary and never distributed.
_Avoid_: Fixtures, golden files

**Space**:
An empty glyph that moves the pen by a whole number of banners.

**Control character**:
A reserved codepoint in the gaps of the banner range that no banner can land on. It is zero-width, except the SPACE control character, which is one banner wide.
_Avoid_: Reserved glyph, gap glyph

**Entry point**:
The single command, `bannerfont`, through which every build step and check is run.
_Avoid_: Script, runner

**Stage**:
One step of the build: extract, pixilate or font. Each turns the previous stage's output into the next one's input.
_Avoid_: Phase, step
