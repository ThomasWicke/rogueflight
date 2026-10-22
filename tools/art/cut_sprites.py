"""Turn generated illustrations into game assets (run with a Python that has numpy and Pillow, e.g. the ComfyUI venv).

  python cut_sprites.py host out.webp sheet.png [--height=240]
      A three-expression sheet on flat #FF00FF (calm, delighted, worried, one per third): keyed out, each portrait
      cropped to the same box (centred on its own figure, bottoms aligned) and saved side by side as one sprite.
  python cut_sprites.py fit out.webp in.png --width=N [--quality=Q]
      Resize to N pixels wide (keeps the aspect), for card pictures, the tour map and backdrops.
"""
import sys
import numpy as np
from PIL import Image

args = [x for x in sys.argv[1:] if not x.startswith('--')]
opts = dict(x[2:].split('=', 1) if '=' in x else (x[2:], '1') for x in sys.argv[1:] if x.startswith('--'))
mode, dst, src = args[0], args[1], args[2]
Q = int(opts.get('quality', 82))


def key(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = np.clip(np.minimum(r, b) - g, 0, 1)                     # how magenta: red and blue high, green low
    alpha = 1 - np.clip((mag - 0.18) / (0.55 - 0.18), 0, 1)
    spill = np.clip(np.minimum(r, b) - g, 0, None)                # despill the pink fringe on soft edges
    edge = alpha < 0.999
    r2 = np.where(edge, r - spill * 0.9, r); b2 = np.where(edge, b - spill * 0.9, b)
    return np.dstack([np.clip(r2, 0, 1), g, np.clip(b2, 0, 1), alpha])


if mode == 'host':
    H = int(opts.get('height', 240))
    a = key(src); h, w = a.shape[:2]; third = w // 3
    boxes = []
    for i in range(3):
        m = a[:, i * third:(i + 1) * third, 3] > 0.5
        ys, xs = np.where(m)
        boxes.append((xs.min() + i * third, ys.min(), xs.max() + i * third, ys.max()))
    bw = max(x1 - x0 for x0, _, x1, _ in boxes) + 8
    bh = max(y1 - y0 for _, y0, _, y1 in boxes) + 8
    frames = []
    for x0, y0, x1, y1 in boxes:
        cx = (x0 + x1) // 2; left = cx - bw // 2; bottom = y1 + 4
        f = np.zeros((bh, bw, 4), np.float32)
        sx0, sx1, sy0, sy1 = max(0, left), min(w, left + bw), max(0, bottom - bh), min(h, bottom)
        f[sy0 - (bottom - bh):sy1 - (bottom - bh), sx0 - left:sx1 - left] = a[sy0:sy1, sx0:sx1]
        frames.append(f)
    sheet = np.concatenate(frames, axis=1)
    im = Image.fromarray((sheet * 255).astype(np.uint8), 'RGBA')
    im = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
    # three equal frames: pad so the width divides by 3
    fw = -(-im.width // 3); out = Image.new('RGBA', (fw * 3, H)); out.paste(im, (0, 0)); out.save(dst, 'WEBP', quality=Q, method=6)
    print(dst, out.size, 'frame', fw, 'x', H)
elif mode == 'fit':
    im = Image.open(src).convert('RGB'); W = int(opts['width'])
    im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS); im.save(dst, 'WEBP', quality=Q, method=6)
    print(dst, im.size)
