# Unity Terrain Textures

Raw terrain-painting textures (bark, leaves, desert ground/stones, dirt,
grass, rock diffuse maps) plus Unity `.terrainlayer` descriptors, uploaded
directly to GitHub via the web UI into `assets/models/nature/` (Vite's
`publicDir`, served to every player) — moved here since raw source packs
must stay out of the served tree.

## Contents

Flat `.png`/`.PNG` texture maps (some multi-megabyte, uncompressed) plus
`Layer_*.terrainlayer` files — the latter are Unity `ScriptableObject`
terrain-layer descriptors (texture + tiling/offset settings for Unity's
Terrain system) and have **no meaning or use outside a Unity project**; kept
here only for reference on what the textures were originally painted with,
not because they're usable by this project's Babylon.js renderer.

## Status

**Not used by the game.** This project's ground rendering is a baked 2D
canvas texture (`src/core/rendering/CourseTexture.ts`), not a Unity-style
terrain-layer system — these files would need to be re-purposed (e.g. as a
detail-map or grain source) rather than used as-is if ever needed.
