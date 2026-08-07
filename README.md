# UBEF
Welcome to Un-indexable Banner Encoding with Font <br>
This repo is a simple tool convert Minecraft banners into a special font to be used in web applications. <br>
Historically, this was used with UBEF-BD to make a BetterDiscord theme/ plugin that renders banners encodings (in the PUA range), which is to assist communication in the ClongCraft project.

## Prerequisites
- Python (>=3.8)
- Node JS (>=18)
  - PNPM

## How to use
0. Install dependencies
  - Run `pnpm install` in terminal
  - Run `python -m pip install --upgrade fonttools` in terminal
1. Put banner .png files in the `images` folder
  - The banner should be 20x40 pixels
  - The banner should be in the format of `xyy.png` (from `000.png` to `f42.png`, eg.: `422.png`, `c13.png`)
    - `x` is the [colour number](https://minecraft.fandom.com/wiki/Banner/DV) (0-f)
    - `yy` is the [pattern number](https://minecraft.fandom.com/wiki/Banner/Patterns) (0~42)
2. Run `sh generate_full.sh` to generate the font
  - Built files are in `./build`, as `Font.ttf`
  - Extra: You can clear the intermediate SVGs in `./out` by running `sh prune.sh`
