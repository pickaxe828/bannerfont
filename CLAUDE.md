# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

UBEF (Un-indexable Banner Encoding with Font) turns Minecraft banner textures into a **COLRv1 colour font**, so web apps outside Minecraft (originally a BetterDiscord theme, UBEF-BD) can render ClongCraft banner writing as ordinary text in the Unicode Private Use Area.

There is no runtime app here — the repo is a one-shot asset pipeline plus the built `.ttf`.

## Commands

```sh
pnpm install                                    # Node deps
python -m pip install --upgrade nanoemoji       # font compiler (required, not in package.json)

sh generate_full.sh          # full build: PNGs -> SVGs -> build/Font.ttf
pnpm pixilate images/        # stage 1 only: raster -> vector SVGs into ./out
sh generate_font.sh          # stage 2 only: ./out/*.svg -> font (assumes ./out is populated)

sh prune.sh                  # clear ./out

pnpm typecheck               # tsc --noEmit
```

The `.sh` files have no shebang and no execute bit — invoke them as `sh <script>`, not `./<script>`.

`pnpm pixilate` flags (parsed in `src/main.ts` via `arg`): `-o/--output` (default `./out`), `-c/--colors|--colours` (default `3`, **including** the transparent layer). Accepts any mix of files and directories as positional args.

TypeScript runs through **tsx** (`pnpm pixilate` → `tsx src/main.ts`); nothing is compiled. `pnpm typecheck` runs `tsc` (`noEmit`) and is the only check that exists — there is no test runner or linter. `src/test.ts` and `src/test.py` are throwaway scratch files, not a suite.

**`canvas` is a native module and pnpm 10 blocks postinstall scripts by default.** `package.json` declares `pnpm.onlyBuiltDependencies: ["canvas", "esbuild"]` to permit it. If `pnpm install` ever prints `Ignored build scripts: canvas`, the binary is missing and *every* entry point dies with a confusing `ERR_INTERNAL_ASSERTION` from Node's CJS loader rather than a sensible "module not found" — pnpm won't re-run scripts for already-installed packages, so fix an existing tree with `pnpm rebuild canvas`. Since canvas 3 this installs a **prebuilt** binary (v2 used node-pre-gyp and compiled from source, needing Homebrew cairo/pango/pixman).

**`jsdom` is a hard runtime requirement of `paper` that `paper` does not declare.** `paper`'s Node shim (`dist/node/self.js`) does `try { require('jsdom') } catch {}` and, when the module is absent, **silently** falls back to a stub `self` with no `document`. Every `exportSVG()` then dies with `TypeError: Cannot read properties of undefined (reading 'createElementNS')` — and because `processDirectory` collects tasks with `Promise.allSettled`, that failure is swallowed and the run reports success with an empty `./out`. `jsdom` is therefore an explicit dependency in `package.json`; do not remove it because "nothing imports it".

`tsconfig.json` must keep `"types": ["node"]`. TypeScript 7 does not auto-discover `@types/node` through pnpm's symlinked layout, and without it every `fs`/`path` import fails with `TS2591` plus cascading implicit-`any` errors.

Do not reintroduce `ts-node` — its ESM loader is unmaintained and dies with `ERR_INTERNAL_ASSERTION` on Node ≥ 22, and it drags in an unpinned `typescript` peer it cannot drive. Note that tsx uses esbuild, which strips types **without checking them**, so a broken `pnpm typecheck` never fails the font build — and a green build never implies types are sound.

## Input contract

Source PNGs live in `images/` (the README says `banners/` — it is stale; `generate_full.sh` uses `images/`). Each is **20×40 px**, named `xyy.png`:

- `x` — banner colour, hex `0`–`f`, indexes `mappings.json → color_code`
- `yy` — pattern, decimal `00`–`42`, indexes `mappings.json → layer_code`

688 files = 16 colours × 43 patterns.

## Pipeline architecture

**Stage 1 — `src/pixilate.ts` (`processImage`)**, the only nontrivial code in the repo:

1. Load PNG into `node-canvas`, hand it to Paper.js as a `Raster`.
2. **Quantize** RGBA with `quanti` down to `colorNumber` colours.
3. Emit one 1×1 `Path.Rectangle` per non-transparent pixel, bucketed into a Paper.js `Layer` keyed by colour string.
4. **Boolean-unite** each colour's rectangles into a single path. This is the polygon-count reduction — quantizing first is what makes the unite cheap and the output small.
5. `exportSVG` → `./out/<glyphname>.svg`.

`src/main.ts` fans this out over the directory with `Promise.allSettled`, then writes the geometry-free glyphs via `exportEmptySVGs`: `ucfff7.svg`, the 128 space glyphs of U+F000–U+F07F, and `ue00c.svg` (see below). Those are written one at a time, not concurrently — `paper.setup()` replaces the single global `paper.project`, so parallel exports would race.

**Stage 2 — `generate_font.sh`**: `nanoemoji --color_format glyf_colr_1` compiles the SVGs into `build/Font.ttf` (config/feature files land in `build/Font.toml`, `Font.fea`, `Font.glyphmap`).

**Stage 3 — `postprocess_font.py`**, run by `generate_font.sh` straight after nanoemoji: strips U+0020 from `cmap` (see "ASCII coverage" below). `build/Font.ttf` is the final output — nothing is copied anywhere afterwards.

### Glyph naming and stacking — the two things that break easily

**Naming.** `getName_King` in `src/naming.ts` maps `xyy` → `ue` + `xyy`, i.e. filename `a21.png` → glyph `uea21` → **U+EA21**. So the whole set occupies **U+E000–U+EF42**. Changing the naming scheme means changing `BannerFont.theme.css` too — and note its `unicode-range` is currently `U+E000-EF40`, which is **already too narrow**: it misses `uEF41`/`uEF42` (purple's two Minecraft 1.21 patterns), the whole U+F000–U+F07F space block, and U+CFFF7. Codepoints outside the declared range never use this font at all, whatever the built `cmap` says. `getName` (the older mnemonic scheme built from `mappings.json`) is deprecated and unused.

**Stacking / offsets.** A rendered banner is a *base* glyph followed by *overlay pattern* glyphs that composite in place, so every overlay must land back on top of the base:

- Pattern `00` (base): Paper canvas `Size(20, 40)`, rectangles at `x + 0`.
- All other patterns: Paper canvas `Size(0, 40)`, rectangles at `x + X_OFFSET` where `X_OFFSET = -BANNER_WIDTH` = `-20`.
- `generate_font.sh` then applies `--width 0` and `--transform "translate(-20, 0)"` globally, plus `--noclip_to_viewbox` so the negatively-positioned overlay geometry survives.

**The advance width is not zero, and it is not set by `--width`.** nanoemoji's `_advance_width` is

```
max(--width, (ascender - descender) * viewBox.w / viewBox.h)
```

so with `--width 0` and the default 950 / −250 metrics, a canvas of height 40 gives **advance = 30 × viewBox.w**. The base (`Size(20, 40)`) therefore advances **600 units = one banner**; overlays (`Size(0, 40)`) advance **0**. Verify with `hmtx` in the built font, not by reading the flags.

Net effect: within one banner cell base and overlays both paint over the same −600…0 font-unit box, and the base's 600-unit advance is what steps the pen to the next cell. Touching `X_OFFSET`, the canvas sizes, or the nanoemoji `--width`/`--transform`/`--noclip_to_viewbox` flags without touching the others will silently misalign or clip glyphs.

### The space block (U+F000–U+F07F) and U+E00C

Per the ClongCraft PUA allocation, `U+F040 + x` is a space of `x` banners, so the block runs U+F000 (−64) … U+F07F (+63); `U+E00C` is the `SPACE` control character, an alias for `U+F041` (one banner). These are emitted by `exportEmptySVGs(dir, name, banners)` — the same empty-project export that writes `ucfff7.svg`, but with a canvas of `Size(banners * 20, 40)`. Because of the advance formula above, an empty glyph `n` banners wide *is* a space of `n` banners; no geometry is involved. `banners = 0` reproduces the original zero-width `ucfff7` behaviour.

**Negative spaces do not work yet.** A viewBox cannot be negative and TrueType `advanceWidth` is unsigned, so `exportEmptySVGs` clamps negative `banners` to 0 and U+F000–U+F03F all compile to a 0 advance. They are still generated so the codepoints map to a real glyph instead of tofu. Making them actually step the pen backwards requires a GPOS single-positioning adjustment (negative `XAdvance`) added after nanoemoji runs — nanoemoji regenerates `build/Font.fea` itself, so it has to be a post-processing step on `build/Font.ttf`.

### ASCII coverage / .notdef

The font must not cover ASCII at all. Almost none of it needs doing — nothing maps A–Z, digits or punctuation, so those already resolve to `.notdef` (glyph id 0). **U+0020 is the single exception**: nanoemoji unconditionally creates a blank glyph, maps it to U+0020 and parks it at gid1 ("Win 10 Chrome likes a blank gid1"), so an ASCII space would render from this font as a real invisible glyph. `postprocess_font.py` deletes that one cmap entry after every build. Verify with `hb-shape build/Font.ttf "Hello World"` — every cluster should be `gid0`.

The glyph is only *unmapped*, not deleted; removing it would renumber every following glyph and discard nanoemoji's Chrome workaround.

Two things this does **not** do, and cannot:

- It removes *coverage*, which is not the same as forcing a visible tofu. A browser that cannot find a codepoint in this font falls back to the next font in the CSS stack, and draws `.notdef` only when nothing in the stack covers it.
- Mapping a codepoint to glyph id 0 in `cmap` is not a way around that — HarfBuzz treats a nominal glyph of 0 as "not covered", identically to an absent entry. Actually drawing a box for arbitrary text would mean mapping it to a real box-shaped glyph, which is not `.notdef`.

### Per-pattern exceptions

- Patterns `13` (`gra`, gradient) and `14` (`gru`, gradient up) quantize to `detailedColorNumber` (hardcoded `10` at the `processImage` call site) instead of the default 3 — 3 colours destroys a gradient.
- Pattern `00` is the base and is the only one that gets a non-zero canvas width (see above).

Both exceptions key off `currentCode`, the `yy` slice of the filename — filename format is load-bearing logic, not just bookkeeping.

## Repo hygiene

`.gitignore` excludes `build/`, `*.svg`, and `images/**`, so build output and generated SVGs are not tracked. `images/` is partly tracked from before that rule was added — don't "fix" this by mass-adding or mass-removing. **No built `.ttf` is tracked** since `public/` was removed — consumers have to build it, or it has to be published some other way.

The Deta Space hosting is gone: `public/`, `shell.sh`, and `setup.sh`'s Deta lines have all been removed. `setup.sh` now only bootstraps pnpm and nanoemoji, duplicating the README's prerequisites.

**Still unresolved:** `BannerFont.theme.css` points its `src:` at the dead `ibef-1-i3169062.deta.app` URL, and the GitHub raw URL in its comment points at the deleted `public/BannerFont.ttf`. There is no hosted font and no tracked `.ttf`, so the theme currently loads nothing — that needs a hosting decision, not a code change.

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