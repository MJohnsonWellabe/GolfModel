# Forest Nature Pack (Unity FBX)

User-uploaded asset pack (delivered 2026-07, committed as four "Add files via
upload" commits) — a second, separate nature pack from the Fantastic Nature
pack: named tree species with LOD chains, forest-floor props, cloud meshes,
and Unity terrain grass textures. Originally uploaded into
`assets/models/nature/`; moved here **as delivered, unintegrated** because
this folder sits outside `assets/` (Vite's `publicDir`), so raw sources never
ship in the game build. Unity editor litter (`*.meta`, `*.terrainlayer`) and a
byte-identical duplicate of `asset-packs/fantastic-nature-pack/`'s zip were
deleted during the move.

## Contents

~67 FBX meshes in species folders. Tree/trunk files ship LOD chains
(`_LOD0`/`_LOD1`/`_LOD2` nodes baked into one file); ferns and clouds are
single LOD-less meshes.

- **Broadleaf trees** — `Aspen/`, `Birch/` (3 variants), `Maple/`, `Oak/`,
  `Poplar/` (regular + Chopped/Damaged versions of most).
- **Conifers** — `Spruce/`, `Big Hight Spruce/` (sic), `Pine/`.
- **Deadwood** — `Broken/` (broken tree), `Dried/` (dried wood),
  `Fallen/` (fallen tree), `Trunks/` (logs, stumps, bare trunks).
- **Bushes & ground plants** — `Bushe/` (sic): blackberry, currant,
  raspberry, wolfberry, juniper, 3 generic bushes, 3 ferns.
- **Clouds** — `Clouds/`: 9 stylized volumetric cloud meshes (unused — the
  game's sky is a gradient + fog + baked backdrop).
- **`Grass/`** — Unity terrain-layer source textures (~33 MB of large
  `Grass_Albedo*/Grass_Normal*` PNGs). Not usable as-is for the web game;
  candidates for downscaled tiling turf detail textures later.

No texture image files for the meshes — material slots only
(`MainMaterial` for trunks/wood, `*Leavse*`/leaf names for foliage), matching
the game's slot-recolor pipeline.

## Integration (2026-07-10)

A curated subset is converted FBX→glb by `scripts/convert-nature.mjs`
(`npm run convert:nature` — FBX2glTF from the `fbx2gltf` devDependency, then
@gltf-transform post-processing: keep `_LOD0`-only, weld, simplify, quantize)
and committed under `assets/models/nature/`:

- **Broadleaf** `tree_oak`, `tree_birch`, `tree_birch_b`, `tree_maple`,
  `tree_aspen`, `tree_poplar` — Wildwood Glen's woods mix.
- **Conifers** `tree_spruce`, `tree_spruce_tall`, `tree_pine` — Timberline's
  woods mix.
- **Forest floor** `stump_a`, `log_a`, `fern_a`, `bush_berry` — rough-only
  ground scatter.

`src/slice3d/natureModels.ts` recolors the new slot names into the per-course
theme palette exactly like the Fantastic Nature props. Species selection per
course comes from the course JSON `theme` block (`treeKeys` /
`accentTreeKeys` / `scatterKeys`).

Still available but unused: Chopped/Damaged tree variants, the remaining
bushes/berries, clouds, and the Grass textures.
