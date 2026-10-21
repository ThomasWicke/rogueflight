"""Cut a generated backdrop layer out of its magenta background and save it as a game sprite.

Usage: python key_layer.py in.png out.webp [max_height]
Run with a Python that has numpy and Pillow (e.g. the ComfyUI venv). The layer must sit on flat #FF00FF with the land
at the bottom; the result is cropped to the land strip, with soft edges and the pink fringe removed.
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
max_h = int(sys.argv[3]) if len(sys.argv) > 3 else 0
a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
r, g, b = a[..., 0], a[..., 1], a[..., 2]
# how magenta a pixel is: red and blue high, green low
mag = np.clip(np.minimum(r, b) - g, 0, 1)
alpha = 1 - np.clip((mag - 0.18) / (0.55 - 0.18), 0, 1)          # soft ramp between "surely land" and "surely magenta"
# despill: on edge pixels pull red and blue down toward green so no pink halo remains
spill = np.clip(np.minimum(r, b) - g, 0, None)
edge = (alpha < 0.999)
r2 = np.where(edge, r - spill * 0.9, r); b2 = np.where(edge, b - spill * 0.9, b)
out = np.dstack([np.clip(r2, 0, 1), g, np.clip(b2, 0, 1), alpha])
# crop to the rows that hold land (first row with a meaningful amount of opaque pixels)
rows = np.where((alpha > 0.5).mean(axis=1) > 0.002)[0]
top = max(0, rows[0] - 2)
img = Image.fromarray((out[top:] * 255).astype(np.uint8), 'RGBA')
if max_h and img.height > max_h:
    img = img.resize((round(img.width * max_h / img.height), max_h), Image.LANCZOS)
img.save(dst, 'WEBP', quality=82, method=6)
print(dst, img.size)
