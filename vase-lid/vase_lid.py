#!/usr/bin/env python3
"""
Adjustable telescoping vase lid ("Stem Organizer").

A two-piece lid that slides open/closed to fit a range of vase mouths and
ratchets/locks at the chosen size. It works like a drawer slide:

  * BASE  (vase_lid_base.stl)   - a plate with two C-channel edge rails and a
                                  sprung snap-finger lock.
  * SLIDER(vase_lid_slider.stl) - a plate whose edges ride in the base's rails;
                                  a row of lock holes catches the finger nub.

Slide the slider out to fit a bigger vase; the finger nub clicks into the next
lock hole and holds the size. Push the finger (from underneath) to resize.

Each plate has a grid of square stem holes so a bouquet's stems come through in
an organised way; the centre region opens up as you expand for the main bundle.
Locating lips on the outer (sliding) ends drop just inside the vase mouth to
centre the lid, while the plates' outer shoulders rest on the rim.

Toolchain: trimesh + manifold3d (robust boolean) + shapely (2D profiles).
Outputs: stl/vase_lid_base.stl, stl/vase_lid_slider.stl,
         vase_lid_plate.3mf (both parts laid out flat for printing),
         vase_lid_assembled.3mf (preview of the two parts mated, mid-open).

All dimensions are millimetres. Tune the parameters below and re-run:
    python3 vase_lid.py
"""

import os
import numpy as np
import trimesh
from trimesh.creation import box
from trimesh.boolean import union, difference

# --------------------------------------------------------------------------
# PARAMETERS  (edit, then re-run)
# --------------------------------------------------------------------------
FIT_MIN   = 90.0    # smallest vase-mouth span the lid fits (closed)
FIT_MAX   = 150.0   # largest vase-mouth span the lid fits (fully open)
SHOULDER  = 12.0    # rest overhang outside the locating lip (per side)
Y_OUTER   = 150.0   # fixed depth of the lid (front-to-back)
MIN_ENGAGE = 28.0   # minimum rail overlap kept when fully open (safety)

T         = 3.0     # plate thickness
LIP_H     = 8.0     # locating-lip height (plugs into the mouth)
LIP_W     = 2.6     # locating-lip wall thickness
LIP_SPAN  = 0.62    # locating-lip length as fraction of Y_OUTER

SQUARE    = 11.0    # square stem-hole side
HOLE_GAP  = 4.5     # wall between holes
EDGE_MARGIN = 7.0   # hole-free border at front/back edges (clears rails)
END_MARGIN  = 5.0   # hole-free border at the lip / inner ends
RAIL_BAND   = 13.0  # solid base width at each edge (structure + rail)
BASE_WING   = 26.0  # solid base length near the lip (holes live here)

# C-channel edge rails (on top of the base, capture the slider edges)
WALL      = 2.2     # rail outer-wall thickness (Y)
LIP_CAP   = 2.2     # how far the rail top-lip overhangs the slider edge (Y)
CLR       = 0.30    # sliding / capture clearance (Bambu-friendly)
RAIL_H    = 2 * T + 0.3 + 1.8   # rail height above base top

# Snap-finger lock
FINGER_W   = 11.0   # cantilever finger width (Y)
FINGER_SLOT = 1.4   # gap that frees the finger
NUB_H      = 2.2    # how far the nub rises into the slider lock hole
NUB_LEN    = 4.5    # nub length along slide (X)
LOCK_PITCH = 6.0    # lock-hole spacing (size step)
LOCK_HOLE  = 5.0    # lock-hole side (Y and X), catches the nub
LOCK_STRIP = 16.0   # hole-free centre strip reserved for the lock

ENGINE = "manifold"

# --------------------------------------------------------------------------
# Derived
# --------------------------------------------------------------------------
HY        = Y_OUTER / 2.0
TRAVEL    = FIT_MAX - FIT_MIN                 # 60
# base + slider lengths so closed=FIT_MIN+2*SHOULDER, open=FIT_MAX+2*SHOULDER
W_CLOSED  = FIT_MIN + 2 * SHOULDER            # 114
W_OPEN    = FIT_MAX + 2 * SHOULDER            # 174
SUM_LEN   = W_OPEN + MIN_ENGAGE               # LB + LA  (overlap_open = MIN_ENGAGE)
# Size the slider so that, fully closed, its inner edge stops just short of the
# base's locating lip (the lip is the closed end-stop). Base takes the rest.
LA        = W_CLOSED - (SHOULDER + LIP_W + 0.3)   # slider length
LB        = SUM_LEN - LA                          # base length

RAIL_Y0   = HY - (WALL + LIP_CAP)             # inner edge of rail block
SLIDER_HY = RAIL_Y0 + LIP_CAP - CLR           # slider half-width (edge under lip)
Z_FLOOR   = T                                 # slider rides on base top
Z_LIP_BOT = 2 * T + CLR                       # underside of capture lip


def bx(x0, x1, y0, y1, z0, z1):
    return box(extents=[x1 - x0, y1 - y0, z1 - z0],
               transform=trimesh.transformations.translation_matrix(
                   [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]))


def square_hole_grid(length, half_y, x_lo, x_hi):
    """Square through-holes over the plate body, clear of edges/lock strip."""
    cutters = []
    pitch = SQUARE + HOLE_GAP
    nx = int((x_hi - x_lo) // pitch)
    ny = int((2 * (half_y - EDGE_MARGIN)) // pitch)
    x0 = x_lo + ((x_hi - x_lo) - nx * pitch + HOLE_GAP) / 2
    y0 = -(ny * pitch - HOLE_GAP) / 2
    for i in range(nx):
        for j in range(ny):
            xa = x0 + i * pitch
            ya = y0 + j * pitch
            if xa + SQUARE > x_hi or ya + SQUARE > half_y - EDGE_MARGIN:
                continue
            # skip the central lock strip
            if not (ya + SQUARE <= -LOCK_STRIP / 2 or ya >= LOCK_STRIP / 2):
                continue
            cutters.append(bx(xa, xa + SQUARE, ya, ya + SQUARE, -1, T + 1))
    return union(cutters, engine=ENGINE) if cutters else None


def edge_rails(length, x0):
    """Two C-channel rails along front & back, from x0..length (on base top)."""
    parts = []
    for s in (+1, -1):
        y_out = s * HY
        y_in = s * (HY - WALL)               # outer-wall inner face
        # outer wall (full height)
        parts.append(bx(x0, length, min(y_out, y_in), max(y_out, y_in),
                        T, T + RAIL_H))
        # top capture lip (overhangs inward by LIP_CAP)
        y_lipA = s * (HY - WALL)
        y_lipB = s * (HY - WALL - LIP_CAP)
        parts.append(bx(x0, length, min(y_lipA, y_lipB), max(y_lipA, y_lipB),
                        Z_LIP_BOT, T + RAIL_H))
    return union(parts, engine=ENGINE)


def build_base():
    # slab
    slab = bx(0, LB, -HY, HY, 0, T)
    # square holes
    holes = square_hole_grid(LB, HY, SHOULDER + LIP_W + END_MARGIN, LB - END_MARGIN)
    if holes is not None:
        slab = difference([slab, holes], engine=ENGINE)
    # locating lip at outer end (x small)
    lip = bx(SHOULDER, SHOULDER + LIP_W, -HY * LIP_SPAN, HY * LIP_SPAN, T, T + LIP_H)
    # edge rails over the inner portion (slider enters from inner end x=LB)
    rails = edge_rails(LB, SHOULDER + LIP_W)
    base = union([slab, lip, rails], engine=ENGINE)
    # snap-finger: U-slot frees a centre finger pointing toward the inner end,
    # anchored near mid-length, nub on top near the tip.
    tip = LB - 6.0
    root = LB - 6.0 - 34.0
    # side slots + end slot (full thickness)
    s_side = FINGER_SLOT
    cut = union([
        bx(root, tip + 1, FINGER_W / 2, FINGER_W / 2 + s_side, -1, T + 1),
        bx(root, tip + 1, -FINGER_W / 2 - s_side, -FINGER_W / 2, -1, T + 1),
        bx(root - s_side, root, -FINGER_W / 2 - s_side, FINGER_W / 2 + s_side, -1, T + 1),
    ], engine=ENGINE)
    base = difference([base, cut], engine=ENGINE)
    # nub on the finger tip (ramped on the open side for one-way-easy expand)
    nub = bx(tip - NUB_LEN, tip, -LOCK_HOLE * 0.45, LOCK_HOLE * 0.45, T, T + NUB_H)
    base = union([base, nub], engine=ENGINE)
    # open the centre: two windows flanking the lock strip so the slider's holes
    # are the only layer over the covered area (and form the bouquet gap when open)
    x_cut0 = SHOULDER + LIP_W + BASE_WING
    yc = HY - RAIL_BAND
    windows = union([
        bx(x_cut0, LB + 1, LOCK_STRIP / 2, yc, -1, T + 1),
        bx(x_cut0, LB + 1, -yc, -LOCK_STRIP / 2, -1, T + 1),
    ], engine=ENGINE)
    base = difference([base, windows], engine=ENGINE)
    return base


def build_slider():
    slab = bx(0, LA, -SLIDER_HY, SLIDER_HY, 0, T)
    holes = square_hole_grid(LA, SLIDER_HY, END_MARGIN, LA - SHOULDER - LIP_W - END_MARGIN)
    if holes is not None:
        slab = difference([slab, holes], engine=ENGINE)
    # locating lip at outer end (x large)
    x_lip = LA - SHOULDER - LIP_W
    lip = bx(x_lip, x_lip + LIP_W, -SLIDER_HY * LIP_SPAN, SLIDER_HY * LIP_SPAN,
             T, T + LIP_H)
    slab = union([slab, lip], engine=ENGINE)
    # row of lock holes along the centre line (catch the base nub)
    cutters = []
    x = END_MARGIN
    while x + LOCK_HOLE < LA - SHOULDER - LIP_W - END_MARGIN:
        cutters.append(bx(x, x + LOCK_HOLE, -LOCK_HOLE / 2, LOCK_HOLE / 2, -1, T + 1))
        x += LOCK_PITCH
    if cutters:
        slab = difference([slab, union(cutters, engine=ENGINE)], engine=ENGINE)
    return slab


def assembly_transforms(open_fraction):
    """Place base + slider as a mated assembly. 0=closed, 1=open."""
    overlap = (LB + LA - W_CLOSED) - TRAVEL * open_fraction
    # base outer end at global x=0, base spans [0, LB]; inner end at LB.
    TF_B = trimesh.transformations.translation_matrix([0, 0, 0])
    # slider sits on top (z=T), its inner end overlaps base inner end by `overlap`.
    # slider local x=0 is its inner end -> place at global x = LB - overlap.
    TF_S = trimesh.transformations.translation_matrix([LB - overlap, 0, T])
    return TF_B, TF_S


def footprint(base, slider, frac):
    TB, TS = assembly_transforms(frac)
    b = base.copy(); b.apply_transform(TB)
    s = slider.copy(); s.apply_transform(TS)
    m = trimesh.util.concatenate([b, s])
    return np.round(m.extents, 1)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    base = build_base()
    slider = build_slider()
    for name, m in [("base", base), ("slider", slider)]:
        print(f"{name:6s} watertight={m.is_watertight} vol>0={m.volume>0} "
              f"bbox={np.round(m.extents,1)}")

    base.export(os.path.join(here, "stl", "vase_lid_base.stl"))
    slider.export(os.path.join(here, "stl", "vase_lid_slider.stl"))

    # print layout: both parts flat, side by side in Y
    a = base.copy()
    b = slider.copy(); b.apply_translation([0, Y_OUTER + 14, 0])
    trimesh.Scene([a, b]).export(os.path.join(here, "vase_lid_plate.3mf"))

    # assembled preview (mid-open)
    TB, TS = assembly_transforms(0.5)
    ba = base.copy(); ba.apply_transform(TB)
    sa = slider.copy(); sa.apply_transform(TS)
    trimesh.Scene([ba, sa]).export(os.path.join(here, "vase_lid_assembled.3mf"))

    print("CLOSED footprint XxYxZ:", footprint(base, slider, 0.0))
    print("OPEN   footprint XxYxZ:", footprint(base, slider, 1.0))
    print("exports written to", here)


if __name__ == "__main__":
    main()
