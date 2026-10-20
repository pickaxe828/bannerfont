# bannerfont
Welcome to bannerfont (previously named UBEF/IBEF) <br>
This repo is a simple tool convert Minecraft banners into a special font to be used in web applications.

## Prerequisites
- [uv](https://docs.astral.sh/uv/) — it installs Python (>=3.11) and fontTools for you upon running this project
- Node JS (>=22)
  - PNPM
- Internet access on the first run, to download the Minecraft client jar (about 40 MB)

## How to use
0. Install dependencies
  - Run `pnpm install` in terminal
  - Run `uv sync` in terminal
1. Run `sh generate_full.sh` to generate the font
  - Built files are in `./build`, as `Font.ttf`
  - Extra: You can clear the intermediate SVGs in `./out` by running `sh prune.sh`

`generate_full.sh` runs three stages in order. Arguments are passed on to the first one, so `sh generate_full.sh --mc-version 1.20.4` builds from another version.

1. `pnpm extract` downloads the official Minecraft client jar and builds the banner PNGs into `./images`
2. `pnpm pixilate images/` traces the PNGs into SVGs in `./out`
3. `sh generate_font.sh` compiles the SVGs into `./build/Font.ttf`

## Where the banner images come from
The repository contains no Mojang assets. `pnpm extract` reads the banner textures from the client jar that Mojang publishes, tints each of the 43 patterns with each of the 16 layer colors, and writes the 688 PNGs (20×40 px, named `xyy.png`, from `000.png` to `f42.png`) to `./images`. The font is built locally from them, and `images/` is not tracked by git.

- `--mc-version <id>` selects the Minecraft version. The default is `1.21.2`. Only release versions work, and the oldest one is `1.12.2`: older jars do not carry the layer colors, so they are refused with an error
- The jar is cached at `.cache/minecraft/<version>/client.jar`, so only the first run downloads. The download is checked against the SHA-1 that Mojang publishes
- `-o/--output <dir>` changes where the PNGs go (default `./images`), `--cache <dir>` changes the cache folder (default `./.cache`)
- A jar that lacks a pattern texture gets one warning per pattern. Older versions have fewer patterns: 1.12.2 lacks 4 of them, 1.14 lacks 3 and 1.16.5 lacks 2. The font maps the codepoints of the missing banners to a visible box glyph. The `flow` and `guster` patterns exist from 1.20.5

The layer color digit `x` (`0`-`f`) and the pattern number `yy` (`00`-`42`) follow a fixed encoding that is documented in `CLAUDE.md`. The layer color order is not the Minecraft wiki order.

Run `pnpm test` for the unit tests of the extract stage.
