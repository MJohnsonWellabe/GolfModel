# Cute Characters 4 (ithappy, CGTrader)

Purchased asset pack — 25 rigged, animated chibi characters (`f_1`–`f_12`,
`m_1`–`m_13`), stored here **as delivered, unintegrated**. This folder is
outside `assets/` (Vite's `publicDir`), so nothing here ships in the game
build or is referenced by any code yet.

## Contents

- `Cute_Characters_4_glb.zip` — each character pre-exported to glTF by the
  seller. May let us skip a Blender conversion step for these characters.
- `Cute_Characters_4_fbx_animation.zip` — each character in FBX with its
  animations baked in.
- `Cute_Characters_4_fbx_for_Mixamo.zip` — each character in FBX, rig only
  (no animations), pre-formatted for Mixamo's auto-rigger.

Still pending (too large for a mobile upload): `Cute_Characters_4.blend`,
the native Blender source file.

## Verification (2026-07-08)

Sampled 3 characters from the glb zip (headless Babylon, `LoadAssetContainerAsync`)
and 2 from the FBX zips (headless Blender `import_scene.fbx`) — all loaded
cleanly and matched across formats:

- 1 mesh + 1 skinned skeleton per character, **64 bones**
- 2 materials (`characters`, `scin`)
- `fbx_animation` / `glb` both carry the same **7 animation clips**:
  `A-pose`, `Idle`, `Run`, `Sad`, `Song Jump`, `Walk`, `Win`
  (the listing's "Dance" appears to be `Song Jump`)
- `fbx_for_Mixamo` correctly ships with the rig only, zero baked actions

`Win` and `Sad` are strong candidates to drive the existing
`Golfer3D.react('celebrate' | 'deject')` reactions once this pack is wired
in — that integration work, plus picking which characters map to which
golfers, is intentionally **not done yet**.
