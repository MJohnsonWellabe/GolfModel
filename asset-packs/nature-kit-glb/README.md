# Nature Kit (glTF)

Low-poly nature pack (trees, bushes, ferns, flowers, grass tufts, mushrooms,
rocks, rock paths) uploaded directly to GitHub via the web UI into
`assets/models/nature/` (Vite's `publicDir`, served to every player) — moved
here since raw source packs must stay out of the served tree (see the
project's existing `forest-nature-fbx`/`fantastic-nature-pack`/`grass-f`
folders for the established pattern).

## Contents

Uninstanced `.gltf` + `.bin` pairs, one mesh set each: `CommonTree_1-5`,
`DeadTree_1-5`, `Pine_1-5`, `Bush_Common`, `Bush_Common_Flowers`, `Clover_1-2`,
`Fern_1`, `Flower_3_Group/Single`, `Flower_4_Group/Single`,
`Grass_Common_Short/Tall`, `Grass_Wispy_Short/Tall`, `Mushroom_Common`,
`Mushroom_Laetiporus`, `Pebble_Round_1-5`, `Pebble_Square_1-6`, `Petal_1-5`,
`Plant_1`/`Plant_1_Big`, `Plant_7`/`Plant_7_Big`, `RockPath_Round_*`,
`RockPath_Square_*`, `Rock_Medium_1-3`. Filenames match Quaternius's free
"Nature Kit" naming convention.

## Status

**Not yet converted or wired into the game.** No course/theme currently
references any of these — they need curating (which species, which
course/surface) and running through the existing FBX/glTF→glb conversion
pipeline (`scripts/convert-nature.mjs` or equivalent) before they can be
used, same as every other asset pack in this directory.
