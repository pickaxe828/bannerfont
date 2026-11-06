"""Fit translucent rectangles to one banner PNG and report the error.

    uv run --with numpy --with pillow python -I experiments/gradient/run_rectfit.py 013 40 0.2

Arguments: banner name (images/<name>.png), number of layers, largest alpha to allow."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np

import rectfit
from evaluate import error
from rectfit import fit, layers_for_eval, refine

name, layers, cap = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
png = f"images/{name}.png"
alphas = np.array([a for a in rectfit.ALPHAS if a <= cap])

started = time.time()
greedy = fit(png, layers, alphas=alphas)
print(f"greedy  {len(greedy)} layers, {time.time() - started:.1f}s: rmse %.2f max %.1f" % error(layers_for_eval(greedy), png))
started = time.time()
refined = refine(greedy, png, sweeps=2, alphas=alphas)
print(f"refined {len(refined)} layers, {time.time() - started:.1f}s: rmse %.2f max %.1f" % error(layers_for_eval(refined), png))
