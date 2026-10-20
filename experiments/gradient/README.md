# Gradient experiments

How the ramp patterns (13 and 14, the gradients) should be drawn. The decision and the numbers
are summarised in `CLAUDE.md` under "Per-pattern exceptions"; this is the method and the dead end.

## The question

The shipped font traced each banner into a few flat RGBA colours (quantization) and unioned the
cells of one colour. A gradient pattern is 40 alpha steps over a noisy gray texture, so 10 colours
gave visible bands. Two ways out were asked about: more quantization slots, and a primitive-style
stack of translucent rectangles tied to the 20x40 grid.

## Method

Every number scores a candidate against the source PNG in `images/` (`evaluate.py`): composite the
candidate's layers over white and over black on the cell grid, compare with the source composited
the same way, report RMSE and the worst pixel, both 0-255. The geometry is all unit cells, so the
comparison is exact, with no antialiasing noise. The quantization sweep ran the old stage 1
(`processImage` with N colours for 13/14 at commit `507c5e8`) over the 32 ramp images and built the
whole font with those 32 glyphs changed, COLRv1 only.

## Result 1: more quantization slots

| colours | RMSE | worst | layers/glyph | whole font | font stage |
| --- | --- | --- | --- | --- | --- |
| 3 | 19.9 | 85 | 2 | 55 KB | 0.31 s |
| 10 (old default) | 5.1 | 24 | 9 | 70 KB | 0.31 s |
| 16 | 3.5 | 19 | 15 | 84 KB | 0.33 s |
| 32 | 2.2 | 14 | 31 | 120 KB | 0.50 s |
| 64 | 1.4 | 10 | 63 | 169 KB | 1.02 s |
| 128 | 0.78 | 5.2 | 127 | 245 KB | 2.22 s |
| 256 | 0.53 | 3.7 | 253 | 340 KB | 4.37 s |
| exact (~400) | 0.43 | 1.0 | 401 | 308 KB | 6.88 s |

Stage 1 itself stays under 0.11 s for all 32 images. The font grows about 1.2 KB per colour and the
font stage grows faster than linearly. The cost is the texture noise: it makes the outlines, not the ramp.

The same knob helps the other patterns too (`pnpm bannerfont pixilate images/ -c N`, mean RMSE over the 41
non-ramp patterns, whole font COLRv1-only): 3 colours 1.82 / 60 KB, 4 colours 1.16 / 101 KB,
6 colours 0.61 / 165 KB, 8 colours 0.47 / 217 KB. Patterns 37, 22 and 02 (soft edges) are the worst at 3 colours.

## Result 2: translucent rectangles (`rectfit.py`)

Greedy, exhaustive per step: all 172,200 integer rectangles times 12 alphas, scored with integral
images, best colour in closed form, in premultiplied space. `refine` then re-optimises each layer
with the others fixed. On `013`:

| layers | alpha cap | greedy RMSE | refined RMSE | time |
| --- | --- | --- | --- | --- |
| 9 | 1.0 | 28.2 | 14.6 | 7 s |
| 40 | 0.5 | 11.5 | 6.6 | 13 s |
| 40 | 0.2 | 6.2 | 3.7 | 11 s |

It cannot beat quantization at equal layer count. "Over" compositing only ever raises alpha, so a
greedy first layer that is too opaque at the faint end can never be undone, and a ramp needs about
one layer per visible step. The other 41 patterns are flat pixel art that quantization already
reproduces, so there is no second use for it.

## Result 3: what the ramp really is

The alpha is a straight line down the rows (1.0 at the first row's center, 0.02 at the last row's;
mirrored for 14), and the colour is a gray texture that does not depend on alpha. Lower bounds with
one flat colour: a linear alpha ramp scores RMSE 2.65 (013), 3.41 (014), 1.56 (an unrelated colour), so
the ramp itself is one paint. Adding a few opaque colour classes for the texture reaches the noise floor:

| colour classes | RMSE | worst | COLRv1-only font |
| --- | --- | --- | --- |
| 1 | 1.71 | 27 | 52 KB |
| 2 | 1.22 | 10 | 55 KB |
| 3 | 0.91 | 10 | 60 KB |
| **4** | **0.77** | 5 | **60 KB** |
| 6 | 0.71 | 4.7 | 74 KB |
| 8 | 0.66 | 4.0 | 77 KB |
| 12 | 0.62 | 4.0 | 90 KB |

Four classes is the knee, and it is what stage 1 now writes: each class traced as one path and painted
with a `linearGradient` of its own colour. COLRv1 (`PaintLinearGradient`) and OpenType-SVG draw it
natively; COLRv0 cannot, so it gets a 16-colour quantized twin.

## Reproducing

```sh
uv run --with numpy --with pillow python -I experiments/gradient/run_rectfit.py 013 40 0.2
```

Arguments: banner name, number of layers, largest alpha to allow. Run it from the repo root after
`pnpm bannerfont extract`. The quantization sweep needs the old stage 1; check out `507c5e8` for it.
