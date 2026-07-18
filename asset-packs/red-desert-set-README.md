# Red desert asset set (Sketchfab, uploaded by Matt 2026-07-18)

All four packs are **CC-BY-4.0** — commercial use OK with attribution
(each pack's license.txt carries the full author credit):

- `stylized_red_rocks/` — "Stylized red rocks" by SlagPerch 3D
- `red_sand_desert_canyon/` — "Red sand desert Canyon" by loutremal
- `red_desert_mountains/` — "Red Desert Mountains" by Angry_Filin
- `red_canyon_landscape/` — "Red Canyon Landscape" by Šimon Ustal

Converted by `scripts/convert-red-desert.mjs` into assets/models/nature/
(mountain_range_red, rocks_red_cluster, canyon_red_a, canyon_red_b);
only converted outputs ship. Attribution also listed on the marketing page
credits alongside the Red Mountain pack.

The raw sources (scene.gltf/scene.bin/textures, ~120MB total) are
.gitignored — only each pack's `license.txt` and the converted glbs are
committed. Re-running the conversion needs the original Sketchfab zips.

In-game usage notes (2026-07 playtest iteration):
- `mountain_range_red` ships NO albedo (normal map only) — rendered as a
  lit terracotta base through its normal map (natureModels bump branch).
- `rocks_red_cluster` renders unlit at texture level 1.6 (albedos are baked
  dark; the volcanic Black-Desert look is intentional).
- `canyon_red_a` (aerial terrain slab) and `canyon_red_b` (atlas collapses
  at 512px) are converted but NOT placed as backdrops.
