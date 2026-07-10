# Meadow Pack (FBX)

Low-poly meadow/wetland foliage pack (grass tufts, wildflowers, reeds, water
lilies, mushrooms, wheat, moss) uploaded directly to GitHub via the web UI
into `assets/models/nature/` (Vite's `publicDir`, served to every player) —
moved here since raw source packs must stay out of the served tree (see the
project's existing `forest-nature-fbx`/`fantastic-nature-pack`/`grass-f`
folders for the established pattern).

## Contents

Binary FBX meshes, `SM_`-prefixed (Synty-style naming): `SM_Grass_01-03`,
`SM_Grass_Shorts`/`_001`/`_001A`/`_001B`, `SM_Grass_Simple`,
`SM_Grass_With_Flowers`, `SM_Wild_Flower_01-02`, `SM_Lavender`, `SM_Wheat`,
`SM_Honeydew`, `SM_Honeydew_On_The_Stump`, `SM_Lake_Reeds`, `SM_Reed_01-03`,
`SM_Reeds`, `SM_Sea_Reeds`, `SM_Leaves_On_Water_01-03`, `SM_Water_Lily_01-03`,
`SM_Moss_01-03`, `SM_Morel`, `SM_Russule`, `SM_Toadsrool`, `SM_Stick_01-05`,
`SM_Sunflower_LOD`. Unity `.meta` sidecar files (per-mesh import settings,
meaningless outside a Unity project) were stripped on import — same
convention this project already applies to every other pack.

The `SM_Grass_*`/`SM_Wild_Flower_*`/`SM_Lavender`/`SM_Wheat` files are the
most directly relevant to "more grass assets."

## Status

**Not yet converted or wired into the game.** No course/theme currently
references any of these — they need curating (which meshes, which
course/surface) and running through the FBX→glb conversion pipeline before
they can be used, same as every other asset pack in this directory.
