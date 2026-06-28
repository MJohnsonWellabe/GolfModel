#!/usr/bin/env bash
# Generate the vase-lid STL + 3MF files (and preview PNGs) from the parametric
# model. Edit parameters at the top of vase_lid.py, then run this.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> generating geometry (STL + 3MF)"
python3 vase_lid.py

echo "==> rendering preview PNGs"
python3 render_preview.py || echo "   (preview skipped - matplotlib not installed)"

echo
echo "Done. Files:"
echo "  stl/vase_lid_full.stl     - BOTH parts in ONE file, laid out flat (print this)"
echo "  stl/vase_lid_base.stl     - base only (print x1)"
echo "  stl/vase_lid_slider.stl   - slider only (print x1)"
echo "  vase_lid_plate.3mf        - both parts as separate objects (Bambu Studio)"
echo "  vase_lid_assembled.3mf    - preview of the two parts mated"
echo "  preview_top.png / preview_iso.png"
