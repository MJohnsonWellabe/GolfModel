# Fantastic Nature Pack (FBX)

Purchased asset pack — static environment props (trees, stones, plants, roots,
stumps, trunks) delivered as individual FBX files, stored here **as
delivered, unintegrated**. This folder is outside `assets/` (Vite's
`publicDir`), so nothing here ships in the game build or is referenced by
any code yet.

## Contents

`Fantastic_Nature_pack_FBX.zip` — 211 FBX meshes under `3d/`, exported twice
for two different engine conventions:

- `3d/UE/` (78 files) — Unreal-oriented export. Trees, stones, and
  `SM_ENV_PLANT_*` (bud/bush/flower/grass/leaf/tendril/waterlily), each
  generally shipped as a single LOD0 mesh, plus a `TEMP/` subfolder (15
  files) holding LOD-chain versions (`_LOD0`/`_LOD1`/`_LOD2`) of the same
  stones.
- `3d/Unity/` (133 files) — Unity-oriented export, split into
  `trees/{trees,trunks,roots,stumps}`, `stones/`, `plants/` (+
  `plants/legacy/`), and `props/` (+ `props/legacy/`). Tree and stone meshes
  here generally ship as LOD chains (`_LOD0`/`_LOD1`/`_LOD2`) baked into one
  file; `trees/trees/collision/` holds separate `UCX_`-prefixed collision
  hulls; `legacy/` subfolders hold older/simpler versions of the same props
  (e.g. a 1-triangle grass card vs. the newer geometry).

No texture image files are bundled — meshes carry material slot names
(`M_stone`, `M_plants`, `M_wood_02`, `M_PLANT_grass`, ...) but no baked
textures, so texturing/shading is still open work whenever this gets
integrated.

## Verification (2026-07-08)

Sampled 8 files spanning every subfolder (headless Blender,
`import_scene.fbx`) — all loaded cleanly with valid mesh geometry, material
slots, and UVs:

| file | meshes | polys | materials |
|---|---|---|---|
| `UE/SM_ENV_TREE_v1_01.fbx` | LOD0/1/2 + `UCX_` collision | 655 | `M_plants`, `M_wood_02` |
| `UE/SM_ENV_stone_01.fbx` | single (no LOD chain) | 166 | `M_stone` |
| `UE/SM_ENV_PLANT_bush_v1_01.fbx` | single | 144 | `M_plants` |
| `UE/TEMP/SM_ENV_stone_01.fbx` | LOD0/1/2 | 225 | `M_stone` |
| `Unity/trees/trees/SM_ENV_TREE_v1_02.fbx` | LOD0/1/2 | 565 | `M_plants`, `M_wood_02` |
| `Unity/stones/SM_ENV_stone_01.fbx` | LOD0/1/2 | 225 | `M_stone` |
| `Unity/plants/legacy/SM_ENV_PLANT_grass_v1_01.fbx` | single | 3 | `M_PLANT_grass` |
| `Unity/trees/trunks/SM_ENV_TREE_trunk_v1_01.fbx` | single | 254 | `M_wood_02` |

All static meshes — no armatures, no animation clips, as expected for
environment props.

This pack is a strong candidate for replacing the course's current
primitive trees/rocks (see `docs/04_TECHNICAL_ARCHITECTURE.md` terrain
section) — that integration work, texturing, and picking which props to use
per course theme is intentionally **not done yet**.
