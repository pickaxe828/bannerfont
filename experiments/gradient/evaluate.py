"""Scoring for the gradient experiments: composite flat layers over white and over black and compare
with the source PNG. All geometry in this repo is on the 20x40 cell grid, so a layer is a boolean
mask and the comparison is exact (no antialiasing)."""

import numpy as np
from PIL import Image

W, H = 20, 40


def composite(layers, background):
    """Paint (rgb, alpha, mask) layers first to last over a flat background colour."""
    image = np.empty((H, W, 3), dtype=np.float64)
    image[:] = background
    for rgb, alpha, mask in layers:
        image[mask] = image[mask] * (1 - alpha) + np.array(rgb) * alpha
    return image


def source_composite(png, background):
    pixels = np.array(Image.open(png).convert("RGBA"), dtype=np.float64)
    alpha = pixels[..., 3:4] / 255
    return pixels[..., :3] * alpha + np.array(background) * (1 - alpha)


def error(layers, png):
    """(RMSE, largest absolute error), 0-255, of the composite over white and over black."""
    squares, largest, count = 0.0, 0.0, 0
    for background in ((255, 255, 255), (0, 0, 0)):
        diff = composite(layers, background) - source_composite(png, background)
        squares += (diff ** 2).sum()
        count += diff.size
        largest = max(largest, np.abs(diff).max())
    return (squares / count) ** 0.5, largest
