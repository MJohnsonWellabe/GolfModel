#!/usr/bin/env python3
"""Render preview PNGs of the vase lid (top + isometric views) with matplotlib.

Run after vase_lid.py:  python3 render_preview.py
Writes preview_top.png and preview_iso.png.
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

import vase_lid as V


def mesh_polys(mesh):
    return mesh.vertices[mesh.faces]


def add_mesh(ax, mesh, color, alpha=1.0):
    polys = mesh_polys(mesh)
    pc = Poly3DCollection(polys, alpha=alpha)
    pc.set_facecolor(color)
    pc.set_edgecolor((0, 0, 0, 0.08))
    pc.set_linewidth(0.1)
    ax.add_collection3d(pc)


def set_equal(ax, meshes):
    pts = np.vstack([m.vertices for m in meshes])
    mins = pts.min(axis=0)
    maxs = pts.max(axis=0)
    c = (mins + maxs) / 2
    r = (maxs - mins).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r)
    ax.set_ylim(c[1] - r, c[1] + r)
    ax.set_zlim(c[2] - r, c[2] + r)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    base = V.build_base()
    slider = V.build_slider()
    TB, TS = V.assembly_transforms(0.5)        # mid-open
    b = base.copy(); b.apply_transform(TB)
    s = slider.copy(); s.apply_transform(TS)

    for view, elev, azim, fname in [
        ("Top view (mid-open)", 90, -90, "preview_top.png"),
        ("Isometric (mid-open)", 32, -60, "preview_iso.png"),
    ]:
        fig = plt.figure(figsize=(8, 7))
        ax = fig.add_subplot(111, projection="3d")
        add_mesh(ax, b, "#2b2b2b")
        add_mesh(ax, s, "#b87333")           # copper-ish like the original
        set_equal(ax, [b, s])
        ax.set_title(view + "  -  base (dark) + slider (copper)")
        ax.set_xlabel("X (slide axis, mm)")
        ax.set_ylabel("Y (mm)")
        ax.view_init(elev=elev, azim=azim)
        ax.set_box_aspect((1, 1, 0.35))
        fig.tight_layout()
        fig.savefig(os.path.join(here, fname), dpi=110)
        plt.close(fig)
        print("wrote", fname)


if __name__ == "__main__":
    main()
