# Environment Asset Intake Plan

Status: **IN PROGRESS**  
Working branch: `assets/wild-valley-red-hollow`

## Purpose

Create a legally clean, mobile-ready environment kit that closes the specific visual gaps in Wild Valley and Red Hollow without replacing the existing HeightField-driven gameplay terrain.

## First-wave priorities

### 1. Audit what already exists

Before importing anything, inventory all current GLBs used by the two courses and record:

- file path and asset key
- triangle and material count
- texture dimensions and memory
- whether the asset is instanced or cloned
- current scale and tint behavior
- whether it can be reused as a larger authored formation
- whether existing Wild Valley fescue can be regraded/densified more effectively than a new import

Do not add duplicate rocks merely because a source pack is available.

### 2. Red Hollow kit

Produce a deliberately small kit:

- 3 optimized vertical cliff-face modules
- 3 large hero formations with different silhouettes
- 4 medium rock clusters
- 6–10 very cheap wash rocks
- 2 low-cost canyon-floor clusters

Course composition rules:

- Each hole receives a unique hero silhouette and backdrop arrangement.
- Cliff meshes sit beneath HeightField-authored playable shelves.
- The Wolf Run wash uses a terrain/surface corridor plus deliberately placed rock clusters; it is not one giant imported creek mesh.
- Repeated scatter uses instances.
- Hero formations are placed intentionally from course data rather than random rough scatter.

### 3. Wild Valley kit

Prioritize improvements to the existing system over imported terrain modules:

- Regrade current fescue to a consistent straw-gold palette.
- Add 1–2 stronger grass-card silhouettes if current variations are insufficient.
- Create density tiers for near, middle, and distant rough.
- Use HeightField extensions for rolling hills and bunker depth.
- Add only a small optional blowout-lip mesh kit if terrain-carved lips cannot produce the desired exposed faces.

Do not place prefabricated dune meshes over flat gameplay ground.

## Processing pipeline

For each selected source asset:

1. Preserve source URL and license.
2. Import into Blender.
3. Normalize scale, orientation, origin, and transforms.
4. Remove hidden/internal geometry.
5. Decimate based on screen role.
6. Rebuild or simplify materials.
7. Downscale textures to the smallest acceptable size.
8. Regrade to the current stylized course palettes.
9. Export GLB.
10. Validate in Babylon.js.
11. Record metrics in `assets/environment/manifest.json`.
12. Add a preview capture and license file.
13. Run mobile performance and repeated-course soak checks.

## Claude implementation brief

When executing this plan, Claude must:

- Read `assets/environment/README.md`, `SOURCES.md`, and `manifest.json` first.
- Audit existing assets before requesting or importing third-party files.
- Never infer that a source asset is approved merely because its site is listed.
- Avoid committing source-resolution photogrammetry.
- Keep all new course art behind the existing `newCourses` flag.
- Add explicit authored placement controls for hero rocks/cliffs instead of increasing random scatter density.
- Preserve unique backgrounds per Red Hollow hole.
- Treat Wild Valley's rolling terrain and deep bunkers as geometry/HeightField work first, vegetation work second.

## Current limitation

The initial repository pass establishes the intake system and vetted source list. Binary downloads still require acquisition, inspection, optimization, and conversion before they are safe to commit. The repository should not receive untouched source packs wholesale.
