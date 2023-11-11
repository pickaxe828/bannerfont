nanoemoji \
    --color_format glyf_colr_1 $(find out/ -name '*.svg') \
    --family BannerFont \
    --noclip_to_viewbox \
    --width 0 \
    --transform "translate(-20, 0)" \
    --config_file build/Font.toml \
    --fea_file build/Font.fea \
&&
cp build/Font.ttf public/font/BannerFont.ttf