# Environment Asset Audit — Wild Valley and Red Hollow

Date: 2026-07-19
Branch audited: `version2`
Working branch: `assets/wild-valley-red-hollow`

## Executive conclusion

The repo already contains substantially more usable environment content than the current courses communicate. Red Hollow's biggest immediate problem is not a complete absence of rock assets; it is that the available desert models are narrowly represented in the loader and are being used mainly as horizon dressing or generic scatter instead of as authored foreground/midground geology. Wild Valley's biggest immediate problem is not a complete absence of grass; it is that the current grass/fescue pipeline is optimized around repeated instanced clumps and texture-driven rough, while the hole terrain and placement strategy do not yet create continuous golden prairie masses, rolling dune silhouettes, or strategically integrated blowouts.

The correct next step is therefore a hybrid pass:

1. Reuse and deliberately place the best existing assets.
2. Add a small number of missing modular assets that solve real gaps.
3. Keep each committed binary comfortably below the user's 30 MB transfer ceiling.
4. Do not import large raw source packs into the shipping tree.

## Existing runtime asset pipeline

The runtime loader expects environment GLBs at:

`assets/models/nature/<key>.glb`

The nature loader is already fault-tolerant, retries weak-network failures, merges imported source meshes by material, and instances the resulting prototypes. That is a good browser-game architecture and should be extended rather than replaced.

The current loader supports flat recolored props, photo-textured uploaded props, granite rocks, desert dioramas, clouds, grasses, flowers, trees, bushes, reeds, and palms. It can preserve imported textures for selected assets and create multiple material variants from one source GLB.

## Known existing environment inventory

The following inventory is derived from the authoritative key lists and loader wiring in `src/slice3d/natureModels.ts`.

### Generic trees

- `tree_a`
- `tree_b`
- `tree_c`
- `tree_d`

Status: retired from normal use because they are considered the lowest-quality tree assets.

Action: keep for compatibility only. Do not use for either target course.

### Broadleaf trees

- `tree_oak`
- `tree_birch`
- `tree_birch_b`
- `tree_maple`
- `tree_aspen`
- `tree_poplar`

Status: useful elsewhere, not relevant to Wild Valley or Red Hollow.

### Conifers

- `tree_spruce`
- `tree_pine_k1`
- `tree_pine_k3`

Status: useful elsewhere, not relevant to these two treeless/desert identities.

### Forest-floor props

- `stump_a`
- `log_a`
- `fern_a`
- `bush_berry`

Status: not relevant to these courses.

### Generic stones

- `stone_a`
- `stone_b`
- `stone_c`

Status: likely useful as small, cheap wash-bed scatter and bunker-rim accents after recoloring/scaling. These are not sufficient as hero sandstone formations.

Action: retain and test in Red Hollow's rocky wash as small embedded stones. Avoid uniform scatter.

### Generic bushes and shrubs

- `bush_a`
- `bush_b`
- `bush_juniper`
- `bush_c`
- `bush_currant`
- `bush_raspberry`

Status: `bush_juniper` may be useful in sparse Red Hollow rough. The others are mostly forest/lush-course assets.

Action: use juniper sparingly and deliberately. Do not use generic bushes to fake geology.

### Clouds

- `cloud_a` through `cloud_i`

Status: reusable. Not a terrain solution.

### Grass tuft pack

- `grass_c`
- `grass_d`
- `grass_e`
- `grass_f`

Source note: purchased Grass F pack, crossed unlit cards.

Status: already the correct general technical form for browser-friendly rough scatter. However, four tuft shapes alone can look repetitive when the density, scale range, clustering, and color variation are weak.

Action for Wild Valley:

- Keep.
- Increase clustering and continuous coverage in native rough.
- Use broader scale and rotation variation.
- Bias color toward sunlit straw gold rather than orange-brown.
- Ensure tufts visually overlap enough to hide bare ground without becoming an opaque wall.
- Add at least two lower, wider bunch-grass variants if the existing four are all tall/narrow.

### Flowers

- `flower_a`
- `flower_coreopsis`

Status: not central to either target course. Use very sparingly in Wild Valley, if at all.

### Palms and reeds

- `tree_palm`
- `tree_palm_b`
- `reed_cattail`

Status: not relevant.

### Granite boulders

- `stone_d`
- `stone_e`
- `stone_f`

Status: photo-textured granite. Potentially useful for other courses, but geologically wrong as the dominant Red Hollow sandstone language.

Action: do not use as primary Red Hollow rocks. At most, use tiny dark accent stones where the palette supports it.

### Red Hollow mountain assets

- `mountain_red`
- `mountain_range_red`

Status: existing photo-textured/normal-supported horizon assets. The loader specifically handles the mountain range's missing albedo by lighting a terracotta base through its normal map.

Finding: these are useful as distant skyline pieces but should not be the repeated background answer for every hole.

Action:

- Keep both.
- Author different transforms, partial occlusion, scale, and orientation per hole.
- Do not show the same centered range composition on all three holes.
- Add at least three more low-cost skyline silhouettes or derive variants from existing geometry if licensing and source geometry permit.

### Red Hollow desert set

- `rocks_red_cluster`
- `rocks_red_bright` (alias/material variant of the same GLB)
- `canyon_red_a`
- `canyon_red_b`

Source attribution already documented as CC-BY-4.0.

Status:

- `rocks_red_cluster` is currently the strongest existing foreground/midground desert rock asset.
- `rocks_red_bright` gives a second appearance without another binary.
- `canyon_red_a` and `canyon_red_b` were converted but intentionally not used as backdrops because one is an aerial terrain slab and one loses quality when its atlas is reduced.

Finding: Red Hollow is underusing the best available rock cluster. The same source can produce much more variety through authored scale, yaw, partial burial, material variant, mirroring where safe, and grouped composition.

Action:

- Use the cluster as composed formations, not random equal-sized scatter.
- Create foreground formations from 2–5 overlapping instances at intentionally different scales.
- Partially bury bases into the terrain.
- Use dark and bright variants together to create sun-facing and shadow-facing geology.
- Reserve the largest clusters as hole landmarks.
- Do not use the canyon slabs as-is until they are visually inspected and reprocessed.

## Source-pack and licensing audit

The Red Hollow desert set is documented as four CC-BY-4.0 Sketchfab sources:

- Stylized red rocks by SlagPerch 3D
- Red sand desert Canyon by loutremal
- Red Desert Mountains by Angry_Filin
- Red Canyon Landscape by Šimon Ustal

The raw sources total about 120 MB and are intentionally gitignored. Only converted GLBs and license files ship. This is the correct policy for the 30 MB constraint.

Required ongoing rule:

- Never commit a raw source archive merely because it is below GitHub's absolute file limit.
- Commit only optimized, game-ready GLBs and their license/attribution text.
- Hard target: under 8 MB per environment GLB.
- Soft warning: 8–15 MB.
- Rework required: over 15 MB.
- Absolute project rule: no single committed asset at or above 30 MB.

## Course-specific findings

### Red Hollow

What already exists:

- Two mountain/horizon keys.
- One useful rock-cluster binary with two material appearances.
- Two converted canyon slabs that are not currently suitable for direct use.
- Generic small stones and a juniper option.
- A loader capable of preserving imported textures and instancing assets efficiently.

What is actually missing:

1. Modular cliff-face strips that can follow generated canyon edges.
2. 3–5 distinct sandstone hero silhouettes: tower, butte, fin, shelf, broken wall.
3. A compact rocky dry-wash kit: gravel/stone bed, embedded boulder groups, eroded bank pieces.
4. Additional lightweight skyline silhouettes or processed variants so each hole has a distinct background.
5. Purpose-built placement data so rocks frame shots and landforms instead of reading as random decoration.

What does not need to be bought or rebuilt immediately:

- Small rocks.
- Basic desert scatter.
- The primary red-rock cluster.
- The first two horizon assets.

### Wild Valley

What already exists:

- Four browser-friendly grass tuft models.
- A photo-textured fescue/heather pathway referenced by the loader.
- Per-instance coloration support for lit grass.
- Terrain color and scatter systems.

What is actually missing:

1. Stronger low/wide golden bunch-grass variants, unless existing heather/fescue GLBs already cover this after visual inspection.
2. One or two wind-bent tall grass silhouette variants.
3. Optional bunker-lip grass strips for dense overhanging blowout edges.
4. Better terrain geometry and placement rules; this is more important than adding dozens of new vegetation binaries.

What does not need to be built as separate meshes:

- Whole rolling hills.
- Whole kettle bowls.
- Whole fairway valleys.

Those should remain HeightField-authored terrain so rendering, ball physics, cameras, and prop placement agree.

## Duplication and efficiency findings

The loader already demonstrates a strong optimization pattern with `rocks_red_bright`: one GLB, multiple material appearances. This should be expanded.

Recommended variants without additional binaries:

- Bright sandstone.
- Deep red sandstone.
- Dark weathered sandstone.
- Pale sun-bleached sandstone.
- Golden grass.
- Dry straw grass.
- Olive shadow grass.

Recommended geometric variation without additional binaries:

- Non-uniform scale within controlled limits.
- Rotation.
- Partial burial.
- Cluster composition.
- Limited negative scale/mirroring only after confirming normals and winding remain correct.

## Immediate keep/modify/replace decisions

| Asset group | Decision | Reason |
| --- | --- | --- |
| `rocks_red_cluster` | Keep and feature | Best existing Red Hollow foreground asset |
| `rocks_red_bright` | Keep and expand pattern | Free visual variant from one binary |
| `mountain_red` | Keep | Useful distinct horizon piece |
| `mountain_range_red` | Keep with limited reuse | Good skyline, currently too repetitive |
| `canyon_red_a` | Reprocess before use | Aerial slab is not a modular cliff |
| `canyon_red_b` | Reprocess or retire | Texture atlas collapses at current resolution |
| `stone_a-c` | Keep | Cheap small wash stones |
| `stone_d-f` | Keep outside main Red Hollow language | Granite is geologically mismatched |
| `bush_juniper` | Keep, sparse use | Appropriate desert accent |
| `grass_c-f` | Keep and improve placement | Correct runtime form, insufficient alone at current density |
| heather/fescue assets | Keep pending visual inspection | Existing loader has course-specific treatment |
| generic trees | Retire from target courses | Wrong identity |

## Required additions — smallest useful pack

The first committed expansion should be intentionally small:

### Red Hollow phase 1

- `cliff_red_straight_a.glb`
- `cliff_red_straight_b.glb`
- `cliff_red_inside_corner.glb`
- `cliff_red_outside_corner.glb`
- `cliff_red_broken_edge.glb`
- `rock_red_tower_a.glb`
- `rock_red_fin_a.glb`
- `rock_red_butte_a.glb`
- `wash_rock_cluster_a.glb`
- `wash_rock_cluster_b.glb`
- `wash_bank_erosion_a.glb`

### Wild Valley phase 1

- `grass_fescue_lowwide_a.glb`
- `grass_fescue_lowwide_b.glb`
- `grass_fescue_tall_a.glb`
- `grass_fescue_windbent_a.glb`
- `bunker_lip_fescue_a.glb`
- `bunker_lip_fescue_b.glb`

This 17-asset phase is more valuable than importing 150 generic assets.

## Binary size and web-delivery policy

Because the user cannot reliably transfer/load files larger than 30 MB, the repository must enforce stricter limits than GitHub itself.

Recommended checks:

- Every GLB: target below 8 MB.
- Hero formation GLB: maximum 15 MB after optimization.
- Grass/rock scatter GLB: target below 1 MB.
- Texture dimensions: generally 512 px; 1024 px only for hero assets.
- Prefer JPEG/WebP-like embedded color data where alpha is not needed.
- Keep alpha PNG only for card vegetation.
- Use shared materials and texture atlases where they genuinely reduce total bytes.
- Avoid one giant environment pack GLB; split by reusable asset so the browser downloads only the keys required by a course.

## Implementation priorities

1. Add a build-time asset budget script that fails on any file >=30 MB and warns above category thresholds.
2. Generate a machine-readable inventory from `assets/models/nature` with file bytes and SHA.
3. Add explicit key arrays for Red Hollow cliffs, Red Hollow wash, and Wild Valley native grass.
4. Visually catalog every existing relevant GLB from fixed preview angles.
5. Reprocess `canyon_red_a` and `canyon_red_b` into modular pieces only if their source geometry is useful.
6. Add the 17-item phase-1 gap pack.
7. Re-author all six target holes using strategic placement and terrain-aware transforms.

## Bottom line

The repo does not need a giant generic asset dump. It needs disciplined use of what is already present plus a compact, purpose-built set of cliffs, hero sandstone formations, wash pieces, and native-grass silhouettes. Red Hollow can improve dramatically by promoting its existing rock cluster from incidental rough scatter to authored geology. Wild Valley can improve dramatically by combining its existing grass assets with higher density, better gold coloration, stronger clustering, and genuinely rolling HeightField terrain.
