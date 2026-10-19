# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

bannerfont-web (see the README's Previous name section for the earlier name) turns Minecraft banner textures into a **COLRv1 colour font**, so web apps outside Minecraft (originally a BetterDiscord theme) can render ClongCraft banner writing as ordinary text in the Unicode Private Use Area.

There is no runtime app here — the repo is a one-shot asset pipeline plus the built `.ttf`.

## Commands

```sh
pnpm install                                    # Node deps
python -m pip install --upgrade fonttools       # font compiler (required, not in package.json)

sh generate_full.sh          # full build: jar -> PNGs -> SVGs -> build/Font.ttf
sh generate_full.sh --mc-version 1.20.4   # arguments are forwarded to pnpm extract
pnpm extract                 # stage 0 only: Mojang client jar -> 688 PNGs in ./images
pnpm pixilate images/        # stage 1 only: raster -> vector SVGs into ./out
sh generate_font.sh          # stage 2 only: ./out/*.svg -> font (assumes ./out is populated)

sh prune.sh                  # clear ./out

pnpm typecheck               # tsc --noEmit
pnpm test                    # node:test through tsx: src/**/*.test.ts
uv run python -m unittest discover tests    # font build tests (.missing glyph)
```

The `.sh` files have no shebang and no execute bit — invoke them as `sh <script>`, not `./<script>`.

`pnpm extract` flags (parsed in `src/extract.ts` via `arg`): `--mc-version <id>` (default `1.21.2`), `-o/--output` (default `./images`), `--cache` (default `./.cache`). `fflate` is a runtime dependency of it, for reading the zip.

`pnpm pixilate` flags (parsed in `src/main.ts` via `arg`): `-o/--output` (default `./out`), `-c/--colors|--colours` (default `3`, **including** the transparent layer). Accepts any mix of files and directories as positional args.

TypeScript runs through **tsx** (`pnpm pixilate` → `tsx src/main.ts`); nothing is compiled. `pnpm typecheck` runs `tsc` (`noEmit`) and checks the types; there is no linter. `pnpm test` runs `tsx --test "src/**/*.test.ts"` (`node:test`, no extra dependency) over the pure functions of the extract stage and the PNG codec. The font build has its own stdlib `unittest` suite in `tests/` (`tests/test_missing_glyph.py`; `tests/test_vendor.py` for the vendor ID `achVendID`, the vendor URL and the unique font identifier), run with `uv run python -m unittest discover tests`. `src/test.ts` and `src/test.py` are throwaway scratch files, not a suite.

**`canvas` is a native module and pnpm 10 blocks postinstall scripts by default.** `package.json` declares `pnpm.onlyBuiltDependencies: ["canvas", "esbuild"]` to permit it. If `pnpm install` ever prints `Ignored build scripts: canvas`, the binary is missing and *every* entry point dies with a confusing `ERR_INTERNAL_ASSERTION` from Node's CJS loader rather than a sensible "module not found" — pnpm won't re-run scripts for already-installed packages, so fix an existing tree with `pnpm rebuild canvas`. Since canvas 3 this installs a **prebuilt** binary (v2 used node-pre-gyp and compiled from source, needing Homebrew cairo/pango/pixman).

**`jsdom` is a hard runtime requirement of `paper` that `paper` does not declare.** `paper`'s Node shim (`dist/node/self.js`) does `try { require('jsdom') } catch {}` and, when the module is absent, **silently** falls back to a stub `self` with no `document`. Every `exportSVG()` then dies with `TypeError: Cannot read properties of undefined (reading 'createElementNS')` — and because `processDirectory` collects tasks with `Promise.allSettled`, that failure is swallowed and the run reports success with an empty `./out`. `jsdom` is therefore an explicit dependency in `package.json`; do not remove it because "nothing imports it".

`tsconfig.json` must keep `"types": ["node"]`. TypeScript 7 does not auto-discover `@types/node` through pnpm's symlinked layout, and without it every `fs`/`path` import fails with `TS2591` plus cascading implicit-`any` errors.

Do not reintroduce `ts-node` — its ESM loader is unmaintained and dies with `ERR_INTERNAL_ASSERTION` on Node ≥ 22, and it drags in an unpinned `typescript` peer it cannot drive. Note that tsx uses esbuild, which strips types **without checking them**, so a broken `pnpm typecheck` never fails the font build — and a green build never implies types are sound.

## Input contract

Source PNGs live in `images/`. They are **generated** by `pnpm extract` from the Mojang client jar (see stage 0) and are neither tracked nor distributed, because they are Mojang assets. Each is **20×40 px**, named `xyy.png`:

- `x` — layer color, hex `0`–`f`. The real order is white, light gray, gray, black, yellow, orange, red, brown, lime, green, light blue, cyan, blue, pink, magenta, purple. `mappings.json → color_code` lists a different (wiki) order and is stale.
  - The hex values in the Minecraft wiki "Pattern color" table (`#D87F33` for orange, and so on) are the game's `MapColor` values. They are **not** the banner tint.
  - The tint is `DyeColor`'s texture-diffuse value (`#F9801D` for orange). The 16 `DyeColor` values are identical in every client jar from 1.12.2 to 26.3.
  - The **oracle** is the 688 PNGs that were once tracked in `images/`. They now live in `oracle/`, which is local only and untracked. They equal `jar texture × DyeColor value` within 2/255.
  - `oracle/compare.ts` checks that an extracted `images/` matches the oracle within 2/255 per channel. It is local only and **not in the repo**, so it is not a `pnpm` script, and a fresh clone does not have it.
- `yy` — pattern, decimal `00`–`42`, indexes `mappings.json → layer_code`

688 files = 16 colours × 43 patterns. An older jar can yield fewer, see the missing-texture warning in stage 0.

## Pipeline architecture

**Stage 0 — `src/extract.ts`**, run as `pnpm extract [--mc-version <id>]`: builds `images/` from the official client jar, so no Mojang asset lives in the repo.

1. Read `version_manifest_v2.json` from `piston-meta.mojang.com`. Release versions only. The floor is **1.12.2**, compared by the manifest's `releaseTime`: an older version stops with an error that names the floor. Older jars have no `DyeColor` tint constants.
2. Fetch the version JSON, download `downloads.client` and verify its SHA-1, then cache it at `.cache/minecraft/<version>/client.jar`. A second run does not download again. A cached jar is used as is: it skips the manifest and the floor check. `.cache/` is gitignored.
3. Read only the needed zip entries, in memory (`fflate`): `assets/minecraft/textures/entity/banner/<name>.png` for the 43 patterns in the pattern map at the top of the file (pattern `00` is `base.png`).
4. Per pattern: crop the 20×40 front face (1,1)–(21,41) of the 64×64 texture, multiply each RGB channel by the layer color, copy alpha. The formula per channel is `floor(tex * dye / 255)`. The 16 tints are a **constant table in the source, in the oracle digit order**, identical for every version. Write `images/<x><yy>.png`, `x` being the hex digit.

PNGs are read and written with `src/png.ts`, not `node-canvas`: canvas premultiplies alpha, which would distort the color of every low-alpha pixel. The pure functions (`multiplyLayer`, `cropFront`, `compareVersions`, `parseManifest`, `jarHasDyeValues`) are unit tested in `src/extract.test.ts`.

**Dye notice.** After loading the jar, `jarHasDyeValues` searches its classes for the 16 tints as Java integer constants (tag `0x03` + big-endian int32). If they are not found it prints one notice line and continues, because the table is fixed and a new Minecraft version must never stop the build.

**Missing-texture warning.** If the jar lacks a pattern texture, extract prints one warning per pattern and writes no PNG for it. Texture counts per version: 1.12.2 and 1.13.2 have 39, 1.14 has 40, 1.16.5 and 1.20.4 have 41, and 1.20.5 onwards have all 43 (`flow` and `guster` first appear in 1.20.5), so 1.12.2 misses 4 patterns, 1.14 misses 3 and 1.16.5 misses 2. The font build maps every banner codepoint without a glyph to the `.missing` glyph (see below).

Timing: **~9 s** cold (download of the ~40 MB jar), **~0.9 s** with the jar cached. A full `sh generate_full.sh` with a cached jar and a clean `images/`, `out/` and `build/` takes ~2.4 s.

**Stage 1 — `src/pixilate.ts` (`processImage`)**, the only nontrivial code in the repo:

1. Load PNG into `node-canvas` and read its pixels with `ctx.getImageData`.
2. **Quantize** RGBA with `quanti` down to `colorNumber` colours.
3. Bucket the non-transparent pixels by packed RGBA. Insertion order is scan order, and that is the order the COLR layers get painted in.
4. **Contour-trace** each colour's pixels into one path (`traceOutline`). This is the polygon-count reduction — quantizing first is what keeps the output small.
5. Emit the SVG string by hand → `./out/<glyphname>.svg`.

`src/main.ts` fans this out over the directory with `Promise.allSettled`, then writes the geometry-free glyphs via `exportEmptySVGs`: `ucfff7.svg`, the 128 space glyphs of U+F000–U+F07F, and `ue00c.svg` (see below). Those are written one at a time, not concurrently — `paper.setup()` replaces the single global `paper.project`, so parallel exports would race.

### Why stage 1 does not use a boolean union

`processImage` used to emit one 1×1 `Path.Rectangle` per pixel and reduce them with Paper.js `unite`. That was **95% of the whole build**: a linear reduce over N rectangles costs O(N²) in path segments, and stage 1 unites ~200k of them across the 688 images.

No boolean geometry is needed. Every shape is an axis-aligned unit square on an integer grid, so the union is a **contour trace**, linear in pixel count. Each filled cell contributes the edges whose neighbour is empty, directed so the filled side is always on the same hand; outer boundaries then wind one way and holes the other, which is what `fill-rule="nonzero"` wants. Chaining those directed edges head-to-tail gives the loops.

Measured on the 688 images: linear unite **57.4 s**, balanced-tree unite 27.5 s, trace **1.07 s**. Stage 1 as a whole went **65.3 s → 0.54 s**, and the full build **67 s → 2.0 s**.

Verified equivalent, not just plausible. Running both unions over the *same* pixel buckets gave zero area difference across 1616 layers, and the two fonts rendered **pixel-identical** over all 688 banners (20.8M subpixels, zero deltas). 38 shape glyphs differ in *contour count* with identical bounding boxes — where two cells touch only at a corner the loop decomposition is ambiguous, and both choices fill the same area under `nonzero`.

**Do not "optimise" this back into a parallel unite.** This machine has 4 performance cores, so threads could win at best ~4×; the trace won 54×. Worker threads are now pointless — stage 1 is 0.54 s.

**Pixel reading changed with it.** The old code went through `paper.Raster.getImageData`, which draws into a scratch canvas and reads back, so every pixel with alpha < 255 took an extra premultiply/un-premultiply round trip and lost 1–2 levels per channel. Reading `ctx.getImageData` once fixes that. It is a **visible change**: 642 of 688 banners shift, worst channel delta **7/255**, 2.9% of subpixels. The new colours are the correct ones — the old output landed outside the range of colours actually present in the source PNG.

**Stage 2 — `src/build_font.py`**, invoked by `generate_font.sh`: compiles `./out/*.svg` into `build/Font.ttf` in **one process** with fontTools. `build/Font.ttf` is the final output — nothing is copied anywhere afterwards.

This used to be `nanoemoji --color_format glyf_colr_1`. nanoemoji is a *ninja generator*: it shells out one `picosvg` and one `write_part_file` process per SVG, so a full build spent **~420 s of CPU / 84 s wall across ~1640 Python interpreter startups** — measured, and ~85–95% of it was interpreter startup and imports, not font compilation. `src/build_font.py` does the same job with fontTools (which nanoemoji is itself built on) in **0.4 s**. nanoemoji and picosvg are no longer dependencies; only `fonttools` is.

The replacement was verified against a nanoemoji-built reference on the same SVGs: identical `cmap` (818 entries then, no differences; the font now has 829, see the `.missing` section), **zero advance mismatches**, identical COLR paint structure, palette values and alphas, and `hb-view` renders of all 688 banner glyphs agreeing to within 2/255 on ~0.04 % of pixels (antialiasing rounding).

### The encoding is frozen

**Do not change the encoding unless the user asks for it in so many words.** The encoding is the mapping from `xyy` to a codepoint (U+E000–U+EF42), the digit order of `x` (see Input contract), the pattern numbering of `yy`, the PUA allocation of the space block and the control gaps, and the glyph advance widths. Text that people already wrote depends on all of it, so a change silently recolours or scrambles existing text.

A task that sounds like a cleanup ("make `x` follow the wiki data values", "fix `mappings.json`", "renumber the patterns") is an encoding change. Stop and ask first. Source changes (new texture source, new palette source, speed) must keep every codepoint rendering the same banner.

### Glyph naming and stacking — the two things that break easily

**Naming.** `getName_King` in `src/naming.ts` maps `xyy` → `ue` + `xyy`, i.e. filename `a21.png` → glyph `uea21` → **U+EA21**. So the whole set occupies **U+E000–U+EF42**. `getName` (the older mnemonic scheme built from `mappings.json`) is deprecated and unused.

Any consumer that loads this font with `@font-face` must declare a `unicode-range` covering U+E000–EF42, the U+F000–F07F space block and U+CFFF7. A codepoint outside the declared range never uses the font at all, whatever the built `cmap` says — which is a silent failure, not an error.

**Stacking / offsets.** A rendered banner is a *base* glyph followed by *overlay pattern* glyphs that composite in place, so every overlay must land back on top of the base:

- Pattern `00` (base): Paper canvas `Size(20, 40)`, rectangles at `x + 0`.
- All other patterns: Paper canvas `Size(0, 40)`, rectangles at `x + X_OFFSET` where `X_OFFSET = -BANNER_WIDTH` = `-20`.
- `src/build_font.py` maps the viewBox onto the ascender…descender band (`SCALE = 30` font units per canvas unit) and applies `X_NUDGE = -20` **in font units** — this is what nanoemoji's `--transform "translate(-20, 0)"` did, and it is a small global nudge, *not* the banner-width offset. The alignment comes from `X_OFFSET` in canvas space.

**The advance width is not zero.** It is `30 × viewBox.w`, inherited from nanoemoji's `_advance_width` = `max(--width, (ascender − descender) × viewBox.w / viewBox.h)` with `--width 0` and 950 / −250 metrics. The base (`Size(20, 40)`) therefore advances **600 units = one banner**; overlays (`Size(0, 40)`) advance **0**. Verify with `hmtx` in the built font.

Net effect: within one banner cell base and overlays both paint over the same −620…−20 font-unit box, and the base's 600-unit advance is what steps the pen to the next cell. Touching `X_OFFSET`, the canvas sizes, or `SCALE`/`X_NUDGE` without touching the others will silently misalign glyphs.

**`lsb` must equal each glyph's `xMin`.** TrueType rasterizers shift an outline by `(lsb − xMin)`. The overlay shapes have `xMin = −620`, so leaving `lsb` at 0 slides every overlay a full banner to the right — and because the clip box is computed from the true ink bounds, the displaced geometry then falls outside it and **the overlays vanish entirely**. This produces a font that passes every structural check (identical advances, bounds, paints, palette) while rendering only the bases. `src/build_font.py` reads `xMin` back from the compiled `glyf` and sets `lsb` from it.

### The space block (U+F000–U+F07F) and U+E00C

Per the ClongCraft PUA allocation, `U+F040 + x` is a space of `x` banners, so the block runs U+F000 (−64) … U+F07F (+63); `U+E00C` is the `SPACE` control character, an alias for `U+F041` (one banner). These are emitted by `exportEmptySVGs(dir, name, banners)` — the same empty-project export that writes `ucfff7.svg`, but with a canvas of `Size(banners * 20, 40)`. Because of the advance formula above, an empty glyph `n` banners wide *is* a space of `n` banners; no geometry is involved. `banners = 0` reproduces the original zero-width `ucfff7` behaviour.

**Negative spaces do not work yet.** A viewBox cannot be negative and TrueType `advanceWidth` is unsigned, so `exportEmptySVGs` clamps negative `banners` to 0 and U+F000–U+F03F all compile to a 0 advance. They are still generated so the codepoints map to a real glyph instead of tofu. Making them actually step the pen backwards requires a GPOS single-positioning adjustment (negative `XAdvance`). Now that stage 2 is `src/build_font.py`, that belongs in the `FontBuilder` assembly (`setupGlyphOrder` … then a GPOS lookup) rather than a post-processing step.

### The control gaps (U+E00A–U+E00F, U+E01A–U+E01F)

A banner glyph is `ue` + colour hex + pattern **decimal**, so no banner ever lands on a codepoint whose last two digits are `0a`–`0f` or `1a`–`1f`. `exportControlSVGs` in `src/main.ts` fills those two ranges with zero-width empty glyphs, so each control codepoint maps to a real glyph instead of tofu. U+E00C is skipped there — `exportSpaceSVGs` already gives it one banner of advance.

Only colour `0`'s gaps are covered. The same gaps exist for every other colour (U+E10A–E10F, U+E11A–E11F, and so on) and are still unmapped.

### ASCII coverage / .notdef

The font must not cover ASCII at all, so that everything including the ASCII space resolves to `.notdef` (glyph id 0). `src/build_font.py` simply never puts U+0020 in `cmap`. Verify with `hb-shape build/Font.ttf "Hello World"` — every cluster should be `gid0`.

It still keeps a blank glyph at gid1 (`.blank`, uncmapped), because nanoemoji did: *"Win 10 Chrome likes a blank gid1"*.

Historical note: under nanoemoji this needed a separate `postprocess_font.py` stage, because nanoemoji unconditionally created that blank glyph **and mapped it to U+0020** — the font's only non-PUA cmap entry. That script is gone; the behaviour is now inherent.

Two things this does **not** do, and cannot:

- It removes *coverage*, which is not the same as forcing a visible tofu. A browser that cannot find a codepoint in this font falls back to the next font in the CSS stack, and draws `.notdef` only when nothing in the stack covers it.
- Mapping a codepoint to glyph id 0 in `cmap` is not a way around that — HarfBuzz treats a nominal glyph of 0 as "not covered", identically to an absent entry. Actually drawing a box for arbitrary text would mean mapping it to a real box-shaped glyph, which is not `.notdef`.

### The `.missing` glyph

`src/build_font.py` maps every expected banner codepoint that has no SVG to a visible `.missing` glyph. The expected set is U+E000 + `x`·0x100 + (`yy`//10)·0x10 + `yy`%10 for `x` 0–15 and `yy` 0–42 (the two decimal digits of `yy` are read as hex digits, so pattern 42 is U+E042). With a full jar none is missing and the build prints `0 expected banner codepoints mapped to .missing`.

`.missing` is a normal glyph, **not** gid 0: gid 0 stays `.notdef`, gid 1 stays the blank, `.missing` is gid 2. It advances 600 units (one banner), is a monochrome box outline in the banner cell, and has `lsb` equal to its `xMin` like every other glyph. This is the "real box-shaped glyph" the `.notdef` section says is needed, but only for banner codepoints. The ASCII behaviour does not change.

The built font has **829** `cmap` entries: 688 banners, the 128 space glyphs, U+E00C, the 11 other control gaps and `ucfff7`. The font tests are in `tests/test_missing_glyph.py`.

### Per-pattern exceptions

- Patterns `13` (`gra`, gradient) and `14` (`gru`, gradient up) quantize to `detailedColorNumber` (hardcoded `10` at the `processImage` call site) instead of the default 3 — 3 colours destroys a gradient.
- Pattern `00` is the base and is the only one that gets a non-zero canvas width (see above).

Both exceptions key off `currentCode`, the `yy` slice of the filename — filename format is load-bearing logic, not just bookkeeping.

## Repo hygiene

`.gitignore` excludes `build/`, `*.svg`, `images/**`, `oracle/` and `.cache/`, so build output, generated SVGs, the extracted PNGs, the oracle and the cached jar are not tracked. No PNG is in the index any more: `images/` is regenerated by `pnpm extract`, and the old tracked set moved to `oracle/` (local only). The earlier "partly tracked" state is gone, so do not add anything under `images/` or `oracle/`. **No built `.ttf` is tracked** since `public/` was removed — consumers have to build it, or it has to be published some other way.

The Deta Space hosting is gone: `public/`, `shell.sh`, and `setup.sh`'s Deta lines have all been removed. `setup.sh` now only bootstraps pnpm and fontTools, duplicating the README's prerequisites.

`BannerFont.theme.css` is gone. It was a BetterDiscord theme whose `src:` pointed at the dead `ibef-1-i3169062.deta.app` URL, with a comment referencing the deleted `public/BannerFont.ttf` — so it loaded nothing. Reviving it needs a hosting decision first, then a fresh `@font-face` block, not a repair of the old file.

**Still unresolved:** there is no hosted font and no tracked `.ttf`, so consumers have to build the font themselves.

## Commits

Use a **textual prefix** on every commit subject. Format: `<type>: <Imperative summary>`.

- `feat:` feature / new capability
- `fix:` bug fix
- `style:` styling / theme files
- `chore:` removals, deps, housekeeping
- `refactor:` restructuring with no behaviour change
- `docs:` documentation
- `test:` tests

History before this convention used gitmoji prefixes (`✨`, `💄`, `🔥`). Do not follow that — leave old commits alone and use textual prefixes going forward.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->