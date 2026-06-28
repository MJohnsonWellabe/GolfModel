# Adjustable ROUND Vase Lid — "Stem Organizer"

A 3D-printable **round** lid for a flower vase that lets a bouquet's stems come
through in an organized way. Inspired by the *StemSlider*, reworked to be fully
3D-printable (no foam/velcro) and **adjustable**: a two-piece telescoping
drawer-slide opens/closes to fit a range of vase mouths and **ratchets/locks**.

![top view](preview_top.png)
![isometric](preview_iso.png)
*Base ring (dark) + slider disk (copper), shown part-open. Renders come from
`render_preview.py`.*

---

## Shape & range (please read)

The lid is built from **two overlapping disks**, so the outline is **round**:
- a **circle** at the closed size, stretching to a **smooth rounded oval** as you
  open it wider (a single-axis slide can't stay a perfect circle — but there are
  no sharp corners at any setting).
- The two guide rails are **inset** (inboard of the edge) so the round perimeter
  is unobstructed.

**Fit range ≈ 110–150 mm** vase-mouth span (inner). It is centred to sit nicely on
a **~115 mm** mouth (near-circular there) and ovals out for larger vases. The low
end is limited by the slider clearing the base's locating tab; change `FIT_MIN`/
`FIT_MAX`/`R` in `vase_lid.py` to retune. Lid width is fixed at **114 mm**; length
runs ~130 mm (closed) → ~170 mm (open).

---

## Files & what to print

```
vase-lid/
  vase_lid.py              parametric model (edit + run this)
  render_preview.py        makes preview_top.png / preview_iso.png
  build.sh                 runs both
  requirements.txt         python deps
  stl/
    vase_lid_full.stl      <-- BOTH parts in ONE file, laid out flat (240x114mm)
    vase_lid_base.stl      base only (print x1)
    vase_lid_slider.stl    slider only (print x1)
  vase_lid_plate.3mf       both parts as separate objects (Bambu Studio)
  vase_lid_assembled.3mf   preview of the two parts mated
```

- **`stl/vase_lid_full.stl`** is the single "full file" — it contains **both
  parts** already arranged flat and side-by-side (240 × 114 mm, fits a 256 mm
  plate). Open this one to print everything at once.
- Both parts print **flat on the bed, features pointing up, NO supports**.
- The slider sits on top of the base (a ~3 mm step) and is captured by the rail
  lips. In use you flip the assembled lid over so the lips/rails point down into
  the vase.

> **Bambu Handy / slicing:** if your Handy app version can open and slice an STL
> directly, use `vase_lid_full.stl`. If it can only start jobs that were sliced
> elsewhere, open the same STL (or `vase_lid_plate.3mf`) in **Bambu Studio**,
> slice, and *Send to printer* — it then appears in Handy to start/monitor.

### Suggested print settings
- Material **PETG** if it may meet water/humidity, else **PLA** (geometry is the
  same). Layer **0.2 mm**, **3 walls**, **15–20 % infill**, no brim, no supports.

---

## Assembly & use

1. Lay the **base** down (rails up). Set the **slider** on top so its two long
   **slots** drop over the base's two **rails**; slide until the lock finger clicks.
2. Pull the slider out until the lid's two locating tabs span your vase mouth; let
   the sprung finger click into the nearest lock hole to hold the size.
3. Flip the assembled lid so tabs/rails point **down**, drop it onto the vase
   (tabs just inside the mouth, the disk rim resting on the rim), and feed stems
   through the square holes. The open centre takes the main bundle.
4. To resize: push the lock finger (from underneath) to release, slide, re-lock.

Tip: a little soft foam tape on the locating tabs improves grip on smooth rims
(like the original StemSlider's foam).

---

## Regenerating / customizing

```bash
pip install -r requirements.txt
./build.sh          # = python3 vase_lid.py && python3 render_preview.py
```

Key parameters in `vase_lid.py`:

| Parameter | Default | Meaning |
|---|---|---|
| `R` | 57 | disk radius (lid width = 2R) |
| `FIT_MIN` / `FIT_MAX` | 110 / 150 | smallest / largest vase-mouth span |
| `SHOULDER` | 10 | rim rest overhang outside the locating tab |
| `T` | 3 | plate thickness |
| `RAIL_OFF` | 28 | rail/slot inset from centre (Y = ±) |
| `SQUARE` / `HOLE_GAP` | 11 / 4.5 | square stem-hole size / spacing |
| `LOCK_PITCH` | 6 | size step between lock detents |
| `CLR` | 0.30 | sliding/capture clearance (tune to your printer) |
| `NUB_H` / `FINGER_SLOT` | 2.2 / 1.4 | lock-nub height / finger flex slot |

Common tweaks after a test print:
- **Slides too tight / loose:** adjust `CLR` (±0.05 mm).
- **Lock won't hold / too stiff:** raise/lower `NUB_H`, widen `FINGER_SLOT`.
- **Rounder / bigger:** increase `R` (keep 2R + 12 ≤ bed for the combined STL).
- **Different range:** change `FIT_MIN`/`FIT_MAX`.

> This folder is self-contained and unrelated to the rest of the repository
> (a golf-analytics project); it just lives here on this branch.
