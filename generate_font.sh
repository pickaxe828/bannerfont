nanoemoji \
    --color_format glyf_colr_1 $(find out/ -name '*.svg') \
    --family BannerFont \
    --noclip_to_viewbox \
    --width 0 \
    --transform "translate(-20, 0)" \
    --config_file build/Font.toml \
    --fea_file build/Font.fea

# nanoemoji always maps U+0020 to a blank glyph; strip it so ASCII is fully uncovered.
python3 postprocess_font.py build/Font.ttf