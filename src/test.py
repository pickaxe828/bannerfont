import os

from fontTools import ttLib
from fontTools.feaLib.builder import Builder

font = ttLib.TTFont("a.otf")

build = Builder(font, "a.fea")
build.build()