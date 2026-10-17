# Full build: Mojang client jar -> images/*.png -> out/*.svg -> build/Font.ttf
# Any arguments go to `pnpm extract`, e.g. `sh generate_full.sh --mc-version 1.20.4`.
pnpm extract "$@" &&
pnpm pixilate images/ &&
sh ./generate_font.sh
