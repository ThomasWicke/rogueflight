"""Cut generated backdrop layers out of their magenta background and save them as one game sprite.

Usage: python key_layer.py out.webp in1.png [in2.png ...] [--height=N] [--tile] [--band=N] [--morph]
Run with a Python that has numpy and Pillow (e.g. the ComfyUI venv). Each input is a layer on flat #FF00FF with the land
at the bottom; it is cropped to the land strip, with soft edges and the pink fringe removed.
Several inputs are stitched left to right into one panorama (bottoms aligned). Every join, and with --tile also the
wrap from the end back to the start, overlaps the two ends by a band and cuts along the path through that band where they
differ least (dynamic programming, as in image quilting), feathered over a few pixels. Ask the generator for plain land
near both edges and the cut is invisible; a second panorama doubles the repeat so landmarks never show twice on screen.
--morph (for soft far layers whose horizons don't line up) bends both ends toward a shared horizon and cross-fades.
"""
import sys
import numpy as np
from PIL import Image

args = [x for x in sys.argv[1:] if not x.startswith('--')]
opts = dict(x[2:].split('=', 1) if '=' in x else (x[2:], '1') for x in sys.argv[1:] if x.startswith('--'))
dst, srcs = args[0], args[1:]
BAND, FEATHER = int(opts.get('band', 120)), 5


def key(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = np.clip(np.minimum(r, b) - g, 0, 1)                     # how magenta: red and blue high, green low
    alpha = 1 - np.clip((mag - 0.18) / (0.55 - 0.18), 0, 1)       # soft ramp between surely land and surely magenta
    spill = np.clip(np.minimum(r, b) - g, 0, None)                # despill: pull red and blue toward green on edges
    edge = alpha < 0.999
    r2 = np.where(edge, r - spill * 0.9, r); b2 = np.where(edge, b - spill * 0.9, b)
    out = np.dstack([np.clip(r2, 0, 1), g, np.clip(b2, 0, 1), alpha])
    rows = np.where((alpha > 0.5).mean(axis=1) > 0.002)[0]
    return out[max(0, rows[0] - 2):]


def cut(R, L):
    """Blend band R (continuing to the right) into band L along the least-different vertical path."""
    h, band = R.shape[:2]
    err = (np.abs(R[..., :3] - L[..., :3]).sum(axis=2) + 2 * np.abs(R[..., 3] - L[..., 3])) * np.maximum(R[..., 3], L[..., 3])
    cost = err.copy()
    for y in range(1, h):
        prev = cost[y - 1]
        cost[y] += np.minimum(prev, np.minimum(np.r_[np.inf, prev[:-1]], np.r_[prev[1:], np.inf]))
    path = np.zeros(h, int); path[-1] = int(np.argmin(cost[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]; lo, hi = max(0, x - 1), min(band, x + 2)
        path[y] = lo + int(np.argmin(cost[y, lo:hi]))
    w = np.clip((path[:, None] - np.arange(band)[None, :]) / FEATHER + 0.5, 0, 1)[..., None]
    return R * w + L * (1 - w)


def morph(R, L):
    """For soft, low-detail layers whose horizons don't meet: bend both bands toward a shared horizon that slides from R's
    to L's across the band, then cross-fade (premultiplied). Hill lines flow into each other instead of stepping."""
    h, band = R.shape[:2]
    def horizon(a):
        t = np.argmax(a[..., 3] > 0.5, axis=0).astype(float)
        return np.convolve(np.r_[[t[0]] * 12, t, [t[-1]] * 12], np.ones(25) / 25, 'valid')
    tR, tL = horizon(R), horizon(L)
    x = np.arange(band) / (band - 1); f = x * x * (3 - 2 * x)          # smoothstep
    hz = tR * (1 - f) + tL * f
    def shift(a, d):
        out = np.zeros_like(a); rows = np.arange(h)
        for c in range(band):
            k = int(round(d[c])); src = np.clip(rows - k, 0, h - 1)
            out[:, c] = a[src, c]; 
            if k > 0: out[:k, c] = 0
        return out
    Rw, Lw = shift(R, hz - tR), shift(L, hz - tL)
    pa = Rw[..., 3:] * (1 - f)[None, :, None] + Lw[..., 3:] * f[None, :, None]
    pc = Rw[..., :3] * Rw[..., 3:] * (1 - f)[None, :, None] + Lw[..., :3] * Lw[..., 3:] * f[None, :, None]
    return np.dstack([np.where(pa > 1e-4, pc / np.maximum(pa, 1e-4), 0), pa])


JOIN = morph if 'morph' in opts else cut


def pad_to(a, h):  # align bottoms: transparent rows on top
    return a if a.shape[0] == h else np.vstack([np.zeros((h - a.shape[0], a.shape[1], 4), np.float32), a])


strips = [key(s) for s in srcs]
H = max(s.shape[0] for s in strips)
strips = [pad_to(s, H) for s in strips]
pano = strips[0]
for s in strips[1:]:
    pano = np.hstack([pano[:, :-BAND], JOIN(pano[:, -BAND:], s[:, :BAND]), s[:, BAND:]])
if 'tile' in opts:
    w = pano.shape[1]
    t = pano[:, :w - BAND].copy(); t[:, :BAND] = JOIN(pano[:, w - BAND:], pano[:, :BAND]); pano = t
img = Image.fromarray((np.clip(pano, 0, 1) * 255).astype(np.uint8), 'RGBA')
mh = int(opts.get('height', 0))
if mh and img.height > mh:
    img = img.resize((round(img.width * mh / img.height), mh), Image.LANCZOS)
img.save(dst, 'WEBP', quality=82, method=6)
print(dst, img.size)
