# Vetted Environment Asset Sources

Only assets explicitly entered into `manifest.json` and accompanied by their license may be committed.

## Approved first-wave sources

### Kenney Nature Kit

- Source: https://kenney.nl/assets/nature-kit
- License: Creative Commons CC0
- Published contents: 330 modular 3D nature files, including rocks and foliage.
- Intended use: lightweight shared rock and vegetation prototypes; candidate source for dry-wash scatter and low-cost background dressing.
- Intake status: approved for download and inspection; individual files still require visual selection, conversion checks, and manifest entries.

### Kenney 3D Nature Pack

- Source: https://opengameart.org/content/3d-nature-pack
- License: CC0
- Intended use: lightweight modular plants, rocks, bushes, and grass.
- Intake status: approved candidate; select only assets that improve the current repository rather than duplicating existing models.

### Yughues Low-Poly Rocks — Sets 01 and 02

- Sources:
  - https://opengameart.org/content/free-lowpoly-rocks-set01
  - https://opengameart.org/content/free-lowpoly-rocks-set02
- License: CC0
- Intended use: very low-cost rock scatter, dry-wash stones, and silhouette clusters after conversion and material regrading.
- Intake status: approved candidate.

### OpenGameArt Vegetation Low Poly

- Source: https://opengameart.org/content/vegetation-low-poly
- License: CC0
- Intended use: grass prototype evaluation only. Existing Wild Valley fescue cards may remain superior.
- Intake status: approved candidate; do not import the full pack without inspection.

### Poly Haven Namaqualand Boulder Collection

- Sources:
  - https://polyhaven.com/a/namaqualand_boulder_02
  - https://polyhaven.com/a/namaqualand_boulder_03
  - https://polyhaven.com/a/namaqualand_boulder_05
- License: CC0
- Intended use: source geometry and texture reference for Red Hollow hero sandstone formations.
- Intake warning: source meshes are roughly 118k–184k triangles and textures may be 8K. They are not mobile-ready. Any use requires aggressive decimation, texture downscaling/atlasing, material reduction, and visual validation.

### Poly Haven Rock Face 02

- Source: https://polyhaven.com/a/rock_face_02
- License: CC0
- Intended use: candidate source for one or two optimized vertical cliff-face modules.
- Intake warning: optimize before committing; do not use full-resolution texture sets.

## Rejected or deferred categories

- Commercial marketplace packs without a purchased transferable project license.
- Sketchfab assets whose download or redistribution terms are unclear.
- Photogrammetry committed at source resolution.
- Assets requiring attribution unless the attribution and redistribution obligations are reviewed and intentionally accepted.
- Generic modular terrain tiles intended to sit over a flat physics plane.

## Intake procedure

1. Download from the recorded source.
2. Save the original license text in `assets/environment/licenses/`.
3. Inspect topology, materials, texture size, transforms, and embedded metadata.
4. Convert to GLB where necessary.
5. Decimate and regrade to match the game's stylized look.
6. Remove unused nodes, animations, lights, and cameras.
7. Test in Babylon.js at game scale.
8. Record the derived file, original source, license, modifications, triangle count, texture memory, and recommended use in `manifest.json`.
9. Run build, visual, performance, and soak checks before enabling it in course data.
