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

## Integration (2026-07-08)

This pack is now the game's character roster. Ten curated characters from the
glb zip (this zip stays here as the full source of truth) are committed under
`assets/models/characters/` with friendly keys — `chip, dez, rio, kuro, beat`
(from `m_1,m_2,m_5,m_9,m_12`) and `rose, sunny, lily, jade, nova` (from
`f_2,f_5,f_7,f_11,f_12`) — and picked on the setup screen (`src/data/characters.ts`).

`src/slice3d/characterModels.ts` now instantiates a per-character rig
(`instantiateModelsToScene`), and `src/slice3d/golfer3d.ts`:

- loops the **Idle** clip for the stance, and plays **Win** / **Sad** for
  `react('celebrate' | 'deject')` (the earmarked reactions);
- drives the golf swing with a club rig in the golfer's own frame plus a body
  turn, since the pack ships no swing clip.

Character choice is purely cosmetic — decoupled from the gameplay **archetype**
(`src/data/archetypes.ts`), which supplies the stat profile. The old
hardcoded roster (Zac/Matt/… and the single-file `chibi_characters.glb`) is
retired.
