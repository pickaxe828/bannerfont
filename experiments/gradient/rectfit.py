"""Greedy fit of translucent grid-aligned rectangles to a 20x40 RGBA image, in the manner of
https://github.com/fogleman/primitive, but exhaustive instead of random.

Every step tries all 172,200 integer rectangles and a fixed alpha set at once, using integral
images: for a rectangle R and alpha a the best layer colour has a closed form, and so has the
error it leaves. Works in premultiplied space so transparent pixels carry no weight. `refine`
then re-optimises one layer at a time with the rest fixed.

See experiments/gradient/README.md for what this found."""
import numpy as np
from PIL import Image
W, H = 20, 40
ALPHAS = np.array([255, 230, 204, 179, 153, 128, 102, 77, 51, 38, 26, 13]) / 255.0

X0, X1 = np.triu_indices(W + 1, 1)
Y0, Y1 = np.triu_indices(H + 1, 1)
RX0 = np.repeat(X0, len(Y0)); RX1 = np.repeat(X1, len(Y0))
RY0 = np.tile(Y0, len(X0)); RY1 = np.tile(Y1, len(X0))
AREA = ((RX1 - RX0) * (RY1 - RY0)).astype(np.float32)

def integral(img):  # (H,W,C) -> (H+1,W+1,C)
    out = np.zeros((H + 1, W + 1, img.shape[2]), dtype=np.float64)
    out[1:, 1:] = img.cumsum(0).cumsum(1)
    return out

def rect_sums(img):
    I = integral(img)
    return (I[RY1, RX1] - I[RY0, RX1] - I[RY1, RX0] + I[RY0, RX0]).astype(np.float32)

def load_premult(png):
    im = np.array(Image.open(png).convert("RGBA"), dtype=np.float64) / 255
    im[..., :3] *= im[..., 3:4]
    return im

def fit(png, steps, alphas=ALPHAS, verbose=False):
    Q = load_premult(png)
    P = np.zeros_like(Q)
    SQ = rect_sums(Q); SQ2 = rect_sums(Q * Q)
    a = alphas.astype(np.float32)[None, :, None]            # (1,nA,1)
    n = AREA[:, None, None]
    layers = []
    for step in range(steps):
        SP = rect_sums(P); SP2 = rect_sums(P * P); SQP = rect_sums(Q * P)
        old = (SQ2 - 2 * SQP + SP2).sum(1)                    # (nR,)
        q, p, q2, p2, qp = (t[:, None, :] for t in (SQ, SP, SQ2, SP2, SQP))
        k = 1 - a
        sumU = q - k * p
        sumU2 = q2 + k * k * p2 - 2 * k * qp
        c = np.clip(sumU / (n * a), 0, 1)
        c = np.round(c * 255) / 255
        c[..., 3] = 1.0
        err = sumU2 - 2 * a * c * sumU + n * a * a * c * c    # (nR,nA,4)
        delta = err.sum(2) - old[:, None]
        i, j = np.unravel_index(np.argmin(delta), delta.shape)
        if delta[i, j] >= -1e-9:
            break
        al = float(alphas[j]); col = c[i, j, :3]
        sl = (slice(RY0[i], RY1[i]), slice(RX0[i], RX1[i]))
        P[sl] = P[sl] * (1 - al)
        P[sl][..., :3] += al * col
        P[sl][..., 3] += al
        layers.append(((int(RX0[i]), int(RY0[i]), int(RX1[i]), int(RY1[i])),
                       tuple(int(round(v * 255)) for v in col), al))
        if verbose:
            print(step, layers[-1])
    return layers

def to_svg(layers, overlay):
    off = -20 if overlay else 0
    w = 0 if overlay else 20
    g = ""
    for (x0, y0, x1, y1), rgb, al in layers:
        op = "" if round(al * 255) == 255 else f' fill-opacity="{round(al, 5)}"'
        g += (f'<g fill="#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"{op} fill-rule="nonzero">'
              f'<path d="M{x0 + off},{y0}h{x1 - x0}v{y1 - y0}h{x0 - x1}z"/></g>')
    return (f'<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
            f' width="{w}" height="40" viewBox="0,0,{w},40">{g}</svg>')

def layers_for_eval(layers):
    """(rgb, alpha, mask) triples for evaluate.error."""
    out = []
    for (x0, y0, x1, y1), rgb, al in layers:
        m = np.zeros((H, W), bool); m[y0:y1, x0:x1] = True
        out.append((rgb, al, m))
    return out


# ---------------------------------------------------------------------------------------------
# Refinement: re-optimise one layer at a time with all the others fixed.

def render(layers):
    P = np.zeros((H, W, 4))
    for (x0, y0, x1, y1), rgb, al in layers:
        sl = (slice(y0, y1), slice(x0, x1))
        P[sl] *= (1 - al)
        P[sl][..., :3] += al * np.array(rgb) / 255
        P[sl][..., 3] += al
    return P

def sse(layers, Q):
    return float(((render(layers) - Q) ** 2).sum())

def refine(layers, png, sweeps=3, alphas=ALPHAS):
    Q = load_premult(png)
    layers = list(layers)
    a = alphas.astype(np.float32)[None, :, None]
    for sweep in range(sweeps):
        changed = 0
        for i in range(len(layers)):
            Pb = render(layers[:i])
            M = np.ones((H, W, 1)); T = np.zeros((H, W, 4))
            for (x0, y0, x1, y1), rgb, al in layers[i + 1:]:
                sl = (slice(y0, y1), slice(x0, x1))
                T[sl] *= (1 - al)
                T[sl][..., :3] += al * np.array(rgb) / 255
                T[sl][..., 3] += al
                M[sl] *= (1 - al)
            s = Pb * M + T - Q
            S1 = rect_sums(s * s); S2 = rect_sums(s * M); S3 = rect_sums(s * M * Pb)
            S4 = rect_sums(np.broadcast_to(M * M, s.shape).copy()); S5 = rect_sums(M * M * Pb); S6 = rect_sums(M * M * Pb * Pb)
            S1_, S2_, S3_, S4_, S5_, S6_ = (t[:, None, :] for t in (S1, S2, S3, S4, S5, S6))
            c = np.clip((S5_ - S2_ / a) / np.maximum(S4_, 1e-6), 0, 1)
            c = np.round(c * 255) / 255
            c[..., 3] = 1.0
            val = 2 * a * (c * S2_ - S3_) + a * a * (c * c * S4_ - 2 * c * S5_ + S6_)
            tot = val.sum(2)
            # current layer's value
            (cx0, cy0, cx1, cy1), crgb, cal = layers[i]
            cur_sse = sse(layers, Q)
            k_best = np.unravel_index(np.argmin(tot), tot.shape)
            ri, aj = k_best
            cand = ((int(RX0[ri]), int(RY0[ri]), int(RX1[ri]), int(RY1[ri])),
                    tuple(int(round(v * 255)) for v in c[ri, aj, :3]), float(alphas[aj]))
            trial = layers[:i] + [cand] + layers[i + 1:]
            if sse(trial, Q) < cur_sse - 1e-9:
                layers[i] = cand; changed += 1
        if not changed:
            break
    return layers
