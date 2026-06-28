#!/usr/bin/env python3
"""
Adjustable ROUND telescoping vase lid ("Stem Organizer") - revision 2.

A two-piece lid that slides open/closed to fit a range of vase mouths and
ratchets/locks at the chosen size. Reworked to be ROUND:

  * Each part is a DISK (so the perimeter is a smooth curve, not a rectangle).
  * The two guide rails are moved INBOARD (inset from the edge), which frees the
    whole perimeter to be round.
  * Two overlapping disks read as a circle near the closed size and a smooth
    rounded oval as you open wider (a single-axis slide can't stay a perfect
    circle - it ovals as it extends; there are no sharp corners either way).

  BASE  (vase_lid_base.stl)   - a ring with two inset rails + a sprung lock finger
  SLIDER(vase_lid_slider.stl) - a disk plate with the square stem holes, two slots
                                that ride on the base rails, and a row of lock holes

Both parts print FLAT, features up, NO supports. In use you flip the assembled
lid so the lips/rails point down into the vase.

Toolchain: trimesh + manifold3d + shapely.
Outputs: stl/vase_lid_base.stl, stl/vase_lid_slider.stl,
         stl/vase_lid_full.stl       (BOTH parts in ONE STL, laid out flat),
         vase_lid_plate.3mf, vase_lid_assembled.3mf
All dimensions are millimetres.
"""

import os
import numpy as np
import trimesh
from trimesh.creation import box, cylinder
from trimesh.boolean import union, difference, intersection

# --------------------------------------------------------------------------
# PARAMETERS
# --------------------------------------------------------------------------
R         = 57.0     # disk radius (lid width = 114 mm; fits 256 mm bed x2)
T         = 3.0      # plate thickness
SHOULDER  = 10.0     # rest overhang outside the locating tab (radial)

# Adjustment: the lid is a circle when closed and ovals out as it opens.
# Usable fit range is bounded at the low end by the slider clearing the base
# tab; see VERIFY output. Centred to cover a ~115 mm vase.
FIT_MIN   = 110.0    # smallest vase-mouth span (closed-ish, near-circular)
FIT_MAX   = 150.0    # largest vase-mouth span (open, oval)

RIM       = 15.0     # base ring width (structure around the open centre)
RAIL_OFF  = 28.0     # rail / slot inset from centre (Y = +/- this)

LIP_H     = 8.0      # locating-tab height (plugs into the mouth)
LIP_W     = 2.6      # locating-tab wall thickness (radial)
TAB_SPAN  = 70.0     # locating-tab arc width (chord, mm)

SQUARE    = 11.0     # square stem-hole side
HOLE_GAP  = 4.5      # wall between holes
HOLE_EDGE = 8.0      # keep holes this far inside the disk edge
LOCK_STRIP = 16.0    # hole-free centre strip for the lock

# Inset T-slot rail cross-section (Y)
WS        = 9.0      # rail stem width (slot rides on this)
WC        = 12.4     # rail cap width (overhangs to capture the slider)
RAIL_H    = 2 * T + 0.3 + 1.8   # rail height above plate top
CLR       = 0.30     # sliding / capture clearance

# Snap-finger lock
FINGER_W   = 11.0
FINGER_SLOT = 1.4
NUB_H      = 2.2
NUB_LEN    = 4.5
LOCK_PITCH = 6.0
LOCK_HOLE  = 5.0

SECTIONS  = 160      # disk smoothness
ENGINE    = "manifold"

# --------------------------------------------------------------------------
# Derived
# --------------------------------------------------------------------------
CX        = R                      # disk centre x (disk spans x in [0, 2R])
# fit = offset + 2R - 2*SHOULDER  ->  offset = fit - 2R + 2*SHOULDER
OFF_MIN   = FIT_MIN - 2 * R + 2 * SHOULDER
OFF_MAX   = FIT_MAX - 2 * R + 2 * SHOULDER
Z_FLOOR   = T
Z_LIP_BOT = 2 * T + CLR


def bx(x0, x1, y0, y1, z0, z1):
    return box(extents=[x1 - x0, y1 - y0, z1 - z0],
               transform=trimesh.transformations.translation_matrix(
                   [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]))


def disk(cx, r, z0, z1):
    c = cylinder(radius=r, height=(z1 - z0), sections=SECTIONS,
                 transform=trimesh.transformations.translation_matrix(
                     [cx, 0, (z0 + z1) / 2]))
    return c


def clip_to_disk(mesh, cx):
    return intersection([mesh, disk(cx, R, -LIP_H - 2, T + RAIL_H + 2)],
                        engine=ENGINE)


def hole_grid(cx, x_lo, x_hi, r_keep):
    """Square through-holes inside the disk, clear of rails / lock strip."""
    cutters = []
    pitch = SQUARE + HOLE_GAP
    y_lim = R - HOLE_EDGE
    nx = int((x_hi - x_lo) // pitch) + 1
    ny = int((2 * y_lim) // pitch) + 1
    x0 = x_lo + (((x_hi - x_lo) - (nx - 1) * pitch - SQUARE) / 2 if nx else 0)
    y0 = -((ny - 1) * pitch + SQUARE) / 2
    for i in range(nx):
        for j in range(ny):
            xa = x0 + i * pitch
            ya = y0 + j * pitch
            xc, yc = xa + SQUARE / 2, ya + SQUARE / 2
            # inside disk (with margin)
            if (xc - cx) ** 2 + yc ** 2 > r_keep ** 2:
                continue
            # not over a rail slot
            if abs(abs(yc) - RAIL_OFF) < (WC / 2 + 2):
                continue
            # not over the lock strip
            if abs(yc) < LOCK_STRIP / 2:
                continue
            cutters.append(bx(xa, xa + SQUARE, ya, ya + SQUARE, -1, T + 1))
    return union(cutters, engine=ENGINE) if cutters else None


def rail(cx_inner_dir):
    """Two inset rails (front & back) as solid slab bars + raised stem + cap."""
    parts = []
    x0, x1 = CX - R + 3, CX + R - 3        # clipped to disk later
    for s in (+1, -1):
        yc = s * RAIL_OFF
        parts.append(bx(x0, x1, yc - WS / 2, yc + WS / 2, 0, T))            # slab bar
        parts.append(bx(x0, x1, yc - WS / 2, yc + WS / 2, T, Z_LIP_BOT))    # stem
        parts.append(bx(x0, x1, yc - WC / 2, yc + WC / 2, Z_LIP_BOT, T + RAIL_H))  # cap
    return union(parts, engine=ENGINE)


def locating_tab(cx, outer_sign):
    """Small tab near the disk's outer edge (outer_sign=-1 left, +1 right)."""
    xe = cx + outer_sign * (R - SHOULDER)          # tab inner face
    x0, x1 = sorted([xe, xe - outer_sign * LIP_W])
    return bx(x0, x1, -TAB_SPAN / 2, TAB_SPAN / 2, T, T + LIP_H)


def build_base():
    slab = disk(CX, R, 0, T)
    ring = difference([slab, disk(CX, R - RIM, -1, T + 1)], engine=ENGINE)
    rails = rail(+1)
    # lock finger along the centre: anchored in the +x rim (root), cantilevers
    # toward the centre (free tip carries the nub).
    root = CX + R - 4.0                    # inside the right rim -> stays attached
    tip = CX - 2.0                         # free end near the centre
    finger_bar = bx(tip, root, -FINGER_W / 2, FINGER_W / 2, 0, T)
    nub = bx(tip, tip + NUB_LEN, -LOCK_HOLE * 0.45, LOCK_HOLE * 0.45, T, T + NUB_H)
    base = union([ring, rails, finger_bar, nub,
                  locating_tab(CX, -1)], engine=ENGINE)
    # free the finger with a U-slot (sides stop short of the root + a tip slot)
    cut = union([
        bx(tip - FINGER_SLOT, root - 4, FINGER_W / 2, FINGER_W / 2 + FINGER_SLOT, -1, T + 1),
        bx(tip - FINGER_SLOT, root - 4, -FINGER_W / 2 - FINGER_SLOT, -FINGER_W / 2, -1, T + 1),
        bx(tip - FINGER_SLOT, tip, -FINGER_W / 2 - FINGER_SLOT, FINGER_W / 2 + FINGER_SLOT, -1, T + 1),
    ], engine=ENGINE)
    base = difference([base, cut], engine=ENGINE)
    return clip_to_disk(base, CX)


def build_slider():
    slab = disk(CX, R, 0, T)
    holes = hole_grid(CX, HOLE_EDGE, 2 * R - HOLE_EDGE, R - HOLE_EDGE)
    if holes is not None:
        slab = difference([slab, holes], engine=ENGINE)
    # two slots for the base rails (run along x, allow slide travel)
    slots = []
    x0, x1 = CX - R + 3, CX + R - 3
    for s in (+1, -1):
        yc = s * RAIL_OFF
        slots.append(bx(x0, x1, yc - (WS / 2 + CLR), yc + (WS / 2 + CLR), -1, T + 1))
    slab = difference([slab, union(slots, engine=ENGINE)], engine=ENGINE)
    # row of lock holes along the centre line, spanning the nub's engagement
    # range across the full travel (nub sits at base x~CX; relative position
    # nub - offset runs from ~CX-OFF_MAX to ~CX-OFF_MIN).
    cutters = []
    x = CX - R + 2
    x_end = CX + 10
    while x + LOCK_HOLE < x_end:
        cutters.append(bx(x, x + LOCK_HOLE, -LOCK_HOLE / 2, LOCK_HOLE / 2, -1, T + 1))
        x += LOCK_PITCH
    slab = difference([slab, union(cutters, engine=ENGINE)], engine=ENGINE)
    # locating tab on the slider's outer (right) edge
    slab = union([slab, locating_tab(CX, +1)], engine=ENGINE)
    return clip_to_disk(slab, CX)


def assembly_transforms(open_fraction):
    """Base fixed; slider rides on top (z=T) shifted right by `offset`."""
    offset = OFF_MIN + (OFF_MAX - OFF_MIN) * open_fraction
    TF_B = trimesh.transformations.translation_matrix([0, 0, 0])
    TF_S = trimesh.transformations.translation_matrix([offset, 0, T])
    return TF_B, TF_S


def footprint(base, slider, frac):
    TB, TS = assembly_transforms(frac)
    b = base.copy(); b.apply_transform(TB)
    s = slider.copy(); s.apply_transform(TS)
    return np.round(trimesh.util.concatenate([b, s]).extents, 1)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    base = build_base()
    slider = build_slider()
    for name, m in [("base", base), ("slider", slider)]:
        print(f"{name:6s} watertight={m.is_watertight} vol>0={m.volume>0} "
              f"bbox={np.round(m.extents,1)}")
    print("fit range covered: %.0f .. %.0f mm  (offset %.0f .. %.0f)"
          % (FIT_MIN, FIT_MAX, OFF_MIN, OFF_MAX))

    base.export(os.path.join(here, "stl", "vase_lid_base.stl"))
    slider.export(os.path.join(here, "stl", "vase_lid_slider.stl"))

    # combined single STL: both parts flat, side by side, not overlapping
    a = base.copy()
    b = slider.copy(); b.apply_translation([2 * R + 12, 0, 0])
    full = trimesh.util.concatenate([a, b])
    full.export(os.path.join(here, "stl", "vase_lid_full.stl"))

    # 3MF print layout (separate objects) + assembled preview
    trimesh.Scene([base.copy(), b.copy()]).export(
        os.path.join(here, "vase_lid_plate.3mf"))
    TB, TS = assembly_transforms(0.25)
    ba = base.copy(); ba.apply_transform(TB)
    sa = slider.copy(); sa.apply_transform(TS)
    trimesh.Scene([ba, sa]).export(os.path.join(here, "vase_lid_assembled.3mf"))

    print("CLOSED footprint XxYxZ:", footprint(base, slider, 0.0))
    print("OPEN   footprint XxYxZ:", footprint(base, slider, 1.0))
    print("exports written to", here)


if __name__ == "__main__":
    main()
