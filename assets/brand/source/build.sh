#!/usr/bin/env bash
# Rebuild the Aether mark and every icon/logo from the measured geometry.
# Needs: Python 3 with numpy scipy scikit-image opencv-python-headless pillow fonttools uharfbuzz,
# google-chrome (headless rendering) and the Ubuntu Sans variable font.
#   uv venv venv && VIRTUAL_ENV=$PWD/venv uv pip install numpy scipy scikit-image opencv-python-headless pillow fonttools uharfbuzz
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-./venv/bin/python}
$PY skeleton.py                      # masks from study-c11.png (green.npy, dt.npy, skel.npy)
# fit.json holds the final, hand-checked geometry; re-run `$PY geom.py fit.json` only to re-fit.
SMOOTH=9 RADIAL=0.3 HI_W=0.12 HI_OP=0.9 BLOOM_OP=0.7 BLOOM_S=1.3 $PY build_svg.py
cp mark.svg mark-final.svg
$PY compare.py                       # prints the fidelity numbers against the study
$PY make_assets.py                   # writes out/{brand,desktop,web}
