#!/bin/bash
# Build every town's painted backdrop layers from the generated images (see CLAUDE.md, "Making a layer").
# usage: tools/art/build_layers.sh <folder with the generated PNGs>   (needs PY = a Python with numpy + Pillow)
set -e
RUNS="$1"; PY="${PY:-$HOME/Github Repositories/local-image-gen/ComfyUI/venv/bin/python}"
cd "$(dirname "$0")/../.."; OUT=client/src/assets
# picked versions (2026-10-22): version 2 for meadow, river and canyon (v2a-/v2b- images), version 1 for the rest
for t in meadow river canyon; do
  "$PY" tools/art/key_layer.py $OUT/$t-far.webp "$RUNS/v2a-$t-far.png" "$RUNS/v2b-$t-far.png" --tile --morph --band=360
  "$PY" tools/art/key_layer.py $OUT/$t-near.webp "$RUNS/v2a-$t-near.png" "$RUNS/v2b-$t-near.png" --tile --height=400
done
for t in coast orchard mountains city night; do
  "$PY" tools/art/key_layer.py $OUT/$t-far.webp "$RUNS/plx-$t-far-a.png" "$RUNS/plx-$t-far-b.png" --tile --morph --band=360
  "$PY" tools/art/key_layer.py $OUT/$t-near.webp "$RUNS/plx-$t-near-a.png" "$RUNS/plx-$t-near-b.png" --tile --height=400
done
