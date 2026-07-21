# Asset Audit — nature library vs. course usage (2026-07-21)

A per-course audit of the on-disk nature asset library against what each loaded
course actually renders, to find high-value assets we own but don't use — and to
record *why* the genuinely-unused ones are unused, so a future pass doesn't
re-litigate settled decisions.

## Method

`assets/models/nature/*.glb` (101 files) diffed against the union of asset keys
referenced by every **loaded** course JSON (the 7 that ship in dev):

- `src/data/courses/wildwood.json` (v1 original — parkland)
- `src/data/courses/v2/{timberline,timberlinewest,sablebay,portjohnson}.json`
- `src/data/courses/{redhollow,wildvalley}.json` (generated dev courses)

Keys come from both hazard/landform entries *and* the per-course `theme.*Keys`
palettes (`treeKeys`, `accentTreeKeys`, `scatterKeys`, `bushKeys`, `heatherKeys`,
`wasteRimKeys`, `shorelineKeys`, `sandPlantKeys`, `peakKeys`). Every candidate
below was **rendered through the game's own `loadNaturePrototypes` pipeline** and
eyeballed before any decision — an asset that "sounds" high-value but renders as
a grey box is not high-value.

## Headline result

**43 of 101 nature assets are in use; 58 are unused.** But the unused set is not
free money: this is a heavily *curated* library, and most of the compelling-
sounding unused assets were **deliberately rejected** in earlier passes for
documented reasons. The audit's real value is separating "genuinely available"
from "tried and cut."

## Per-course usage

| Course | Identity | Trees | Scatter / rim | Understory / ground |
|--------|----------|-------|---------------|---------------------|
| Timberline East | Golden-montane forest | birch/aspen/poplar/oak (+birch_b/maple accents), firs a/b/c in the conifer wall | granite a/b/c | heather + fescue + clustered tallGrass (bushKeys **[]** by design) |
| Timberline West | (shares East's theme) | same | granite a/b/c | same |
| Sable Bay | Pinehurst pines | pine_k1/k3 | stone a/b/d/e | grass g/h |
| Port Johnson | Scottish links (treeless) | — | — | heather purple + fescue a/c |
| Wildwood | Parkland-in-bloom | oak/maple/birch/aspen/poplar + blossom stands | stone_a | reed_cattail, ferns, coreopsis + flower f/g/h, kenney bushes, 20 garden beds |
| Red Hollow | Red-rock desert canyon | none (bush_b dry scrub only) | rocks_red cluster/bright/mid/dark + rock_desert a–d as talus | bare red by design (`bareRough`) |
| Wild Prairie | Sandhills blowout | none | — | heather_fescue_b (austere by design) |

## Unused assets — availability vs. deliberate rejection

**Deliberately rejected (do NOT re-add without an owner call — reasons on file):**

- **Card foliage — every forest `bush_*` + `fern_*` mesh.** Ships **without its
  alpha leaf-cutout texture** (the fbx references a missing local png), so it
  renders as a *solid box*. Timberline's `bushKeys: []` and the "no card-scatter
  bushes at all" note are this decision. The only foliage that reads as real 3D
  growth is the photo-textured, alpha-cut kind (heather / fescue). (`tree_sakura`
  reads as maroon, not soft pink, so Wildwood's canopy-tint `blossom` approach is
  preferred over the raw model.)
- **Deadwood — `tree_broken`, `tree_fallen`, `log_a`, `stump_a`.** Tried as rough
  scatter, cut: "read as broken litter" and, being visual-only, carried no
  collision. (The scatter height-keys for them survive in `course3d`, harmless.)
- **`tree_spruce` + the flat Kenney pines / low-poly conifers.** Explicitly
  "stay out" — the alpine conifer wall is the detailed CC0 firs only.
- **`mesa_a/b/c` (Red Hollow).** "NO boxy Kenney mesas" — they render as plain
  grey blocks; the horizon is the CC-BY range diorama only.

**Genuinely available (unused, no prior rejection, render clean):**

- **`rock_desert_e/f/g/h`** — same stylized low-poly rock family as the a–d
  already used as Red Hollow talus; verified visually identical in quality.
  **→ implemented (below).**
- `stone_c/f` (minor extra stone variety), `canyon_red_a/b` (large red-rock
  dioramas — near-duplicates of the already-used `mountain_range_red`; marginal),
  `ship` (no home course), the `cloud_*` set (sky, handled by `atmosphere`, not a
  course asset), and the solid-blob `grass_a–f/i` (lower quality than the g/h
  blades already used).

## Implemented this pass

**Red Hollow talus variety.** The canyon-floor debris and cliff-rim scree draw
"hundreds of instances" from `scatterKeys` / `wasteRimKeys`, but the rock shapes
came from only `rock_desert_a–d` — four boulders repeated across the whole floor.
Added the remaining same-family shapes so the repetition breaks up:

- `scatterKeys` += `rock_desert_e/f/g/h`
- `wasteRimKeys` += `rock_desert_e/g`

This is **pure shape variety at the same density** — zero new instances, no new
asset *style* (still stoneTint-darkened talus), so it can't regress performance
or the course's identity. Edited in `scripts/courses/redhollow.mjs`, regenerated
via `node scripts/gen-new-courses.mjs` (only `redhollow.json` changed).

## Verification

- **Gates:** full unit suite **863/863** green (includes the newCourses /
  rebuilds playability sims).
- **Render:** Red Hollow h1–h3 booted through the game (aerial + tee); the varied
  talus reads correctly as mixed dark-volcanic / sunlit-red boulders, no black
  blobs, no boxy artifacts, no console errors.
- **Performance** (tight `scene.render()` loop, headless software-GL — the same
  method as the perf gate; absolute numbers are container-relative, the point is
  the *ceiling* and *parity*):

  | Scene | ms/frame | meshes |
  |-------|---------:|-------:|
  | Red Hollow h1 aerial | 3.23 | 899 |
  | Red Hollow h2 aerial | 2.80 | 615 |
  | Red Hollow h3 aerial | 3.61 | 1068 |
  | Sable Bay h1 aerial (unchanged baseline) | 3.11 | 1126 |

  All far under the 60 ms/frame catastrophe ceiling; Red Hollow's mesh counts sit
  right alongside an unchanged course, confirming the variety change added no
  instances. Device-accurate FPS still lives in `docs/DEVICE_MATRIX.md`.
