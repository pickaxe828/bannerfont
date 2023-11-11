nanoemoji \
    --color_format glyf_colr_1 $(find out/ -name '*.svg') \
    --family BannerFont \
    --noclip_to_viewbox \
    --width 1 \
    --transform "translate(0, 0)" \
    --config_file build/Font.toml \
    --fea_file build/Font.fea \
&&
mkdir public
cp build/Font.ttf public/BannerFont.ttf