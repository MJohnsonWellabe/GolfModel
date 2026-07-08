# Grass F Pack (FBX)

Purchased asset pack (CGTrader upload id `3765721`) — four static grass-clump
meshes (`grass_F_01`–`grass_F_04`), stored here **as delivered**. This folder
is outside `assets/` (Vite's `publicDir`), so the raw zip never ships in the
game build.

## Contents

`grass_F_FBX.zip` — 4 binary FBX 7.4 files, one grass tuft/clump mesh each
(~20KB). Material slot `grassM` only, **no textures bundled** — same
convention as the Fantastic Nature pack, so the game recolors the slot into a
flat stylized material (`src/slice3d/natureModels.ts`).

## Verification (2026-07-08)

All four FBX files parsed as valid binary FBX 7.4 with a single mesh and one
material slot (`grassM`); converted to glb and loaded headlessly via Babylon
without errors.

## Integration (2026-07-08)

Converted FBX→glb with the npm `fbx2gltf` package (`FBX2glTF --binary`) —
NOTE: this container has no Blender, so the conversion pipeline for this pack
is Node-based rather than the headless-Blender route the earlier packs used;
either tool produces an equivalent glb.

Committed as `assets/models/nature/grass_c.glb` … `grass_f.glb` and added to
`GRASS_KEYS` in `src/slice3d/natureModels.ts`, so fairway/rough ground scatter
now draws from six tuft variants (two nature-pack + four from this pack) with
per-surface height/density.
