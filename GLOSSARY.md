# bannerfont

bannerfont turns Minecraft banner textures into a color font (COLRv1, with COLRv0, OpenType-SVG and sbix fallbacks). A banner is written as ordinary text in the Unicode Private Use Area.

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

**Font variant**:
A rendition of bannerfont with a particular level of visual detail. Variants share the banner encoding and project version.

**Highres**:
The font variant that preserves the source banner textures' visual detail.

**Project version**:
The shared version of the bannerfont build tools and the fonts they produce. A change in visual detail alone distinguishes variants within that version.

**Ramp pattern**:
Pattern `13` or `14`: a gray texture under a vertical alpha ramp. It is drawn as a linear gradient, not as quantized colors.

**Flat twin**:
The quantized, gradient-free copy of a ramp glyph (`<glyph>.flat.svg`). COLRv0 uses it because COLRv0 has no gradients.
