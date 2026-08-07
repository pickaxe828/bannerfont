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

`src/main.ts` fans this out over the directory with `Promise.allSettled`, then writes one extra empty glyph (`ucfff7.svg`) via `exportEmptySVGs`.

**Stage 2 — `generate_font.sh`**: `nanoemoji --color_format glyf_colr_1` compiles the SVGs into `build/Font.ttf` (config/feature files land in `build/Font.toml`, `Font.fea`, `Font.glyphmap`). That is the final output — nothing is copied anywhere afterwards.

### Glyph naming and stacking — the two things that break easily

**Naming.** `getName_King` in `src/naming.ts` maps `xyy` → `ue` + `xyy`, i.e. filename `a21.png` → glyph `uea21` → **U+EA21**. So the whole set occupies **U+E000–U+EF42**, which is exactly the `unicode-range` in `BannerFont.theme.css`. Changing the naming scheme means changing that CSS too. `getName` (the older mnemonic scheme built from `mappings.json`) is deprecated and unused.

**Stacking / offsets.** A rendered banner is a *base* glyph followed by *overlay pattern* glyphs that composite in place, so every glyph is zero-advance and every glyph must land on the same x-range:

- Pattern `00` (base): Paper canvas `Size(20, 40)`, rectangles at `x + 0`.
- All other patterns: Paper canvas `Size(0, 40)`, rectangles at `x + X_OFFSET` where `X_OFFSET = -20`.
- `generate_font.sh` then applies `--width 0` and `--transform "translate(-20, 0)"` globally, plus `--noclip_to_viewbox` so the negatively-positioned overlay geometry survives.

Net effect: base and overlays both end up over the same −20…0 box with no advance. Touching `X_OFFSET`, the canvas sizes, or the nanoemoji `--width`/`--transform`/`--noclip_to_viewbox` flags without touching the others will silently misalign or clip glyphs.

### Per-pattern exceptions

- Patterns `13` (`gra`, gradient) and `14` (`gru`, gradient up) quantize to `detailedColorNumber` (hardcoded `10` at the `processImage` call site) instead of the default 3 — 3 colours destroys a gradient.
- Pattern `00` is the base and is the only one that gets a non-zero canvas width (see above).

Both exceptions key off `currentCode`, the `yy` slice of the filename — filename format is load-bearing logic, not just bookkeeping.

## Repo hygiene

`.gitignore` excludes `build/`, `*.svg`, and `images/**`, so build output and generated SVGs are not tracked. `images/` is partly tracked from before that rule was added — don't "fix" this by mass-adding or mass-removing. **No built `.ttf` is tracked** since `public/` was removed — consumers have to build it, or it has to be published some other way.

`setup.sh`/`shell.sh` are leftovers from the discontinued Deta Space hosting and still reference `deta.dev` / `/home/gitpod/.detaspace`. `BannerFont.theme.css` also still points its `src:` at the dead `ibef-1-i3169062.deta.app` URL, and the GitHub raw URL in its comment points at the now-deleted `public/BannerFont.ttf`. Both are unresolved.

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