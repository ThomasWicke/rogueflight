#!/bin/bash
# Build every town's painted backdrop layers from the generated images (see CLAUDE.md, "Making a layer").
# usage: tools/art/build_layers.sh <folder with the generated PNGs>   (needs PY = a Python with numpy + Pillow)
set -e
RUNS="$1"; PY="${PY:-$HOME/Github Repositories/local-image-gen/ComfyUI/venv/bin/python}"
cd "$(dirname "$0")/../.."; OUT=client/src/assets
"$PY" tools/art/key_layer.py $OUT/meadow-far.webp "$RUNS/plx-meadow-far.png" "$RUNS/plx3-meadow-far-b.png" --tile --morph --band=360
"$PY" tools/art/key_layer.py $OUT/meadow-near.webp "$RUNS/plx2-meadow-near.png" "$RUNS/plx3-meadow-near-b.png" --tile --height=430
for t in river coast canyon orchard mountains city night; do
  "$PY" tools/art/key_layer.py $OUT/$t-far.webp "$RUNS/plx-$t-far-a.png" "$RUNS/plx-$t-far-b.png" --tile --morph --band=360
  "$PY" tools/art/key_layer.py $OUT/$t-near.webp "$RUNS/plx-$t-near-a.png" "$RUNS/plx-$t-near-b.png" --tile --height=400
done
