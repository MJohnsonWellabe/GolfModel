# Bite-Sized Golf Environment Asset Library

This directory is the controlled intake point for reusable environment art used by Wild Valley, Red Hollow, and future courses.

## Goals

- Keep every imported asset legally traceable.
- Favor CC0 and original work.
- Optimize for Babylon.js, mobile browsers, instancing, and deterministic placement.
- Separate hero landforms from lightweight scatter.
- Prevent Claude from treating random rock placement as course design.

## Structure

```text
assets/environment/
  manifest.json
  SOURCES.md
  red_hollow/
    cliffs/
    mesas/
    rocks/
    washes/
    backgrounds/
  wild_valley/
    grass/
    bunker_lips/
    dunes/
    rough/
  shared/
    rocks/
    vegetation/
  licenses/
  previews/
```

Folders appear when their first approved binary is committed. Do not commit a third-party file without adding its source, license, modification record, and manifest entry.

## Runtime requirements

- Preferred format: binary glTF (`.glb`).
- Use embedded or nearby WebP/PNG textures.
- Remove unused animation, cameras, lights, and duplicate materials.
- Hero asset target: normally under 20k triangles after optimization.
- Scatter asset target: normally under 2k triangles; under 500 is preferred.
- Supply one material wherever practical.
- Use mesh instancing for repeated rocks and vegetation.
- Distant backgrounds must not have collision.
- Course gameplay terrain remains driven by the shared HeightField; imported meshes enhance cliffs, rock silhouettes, washes, bunker lips, and vegetation rather than replacing gameplay physics.

## Course rules

### Red Hollow

Use geology deliberately: cliff faces under playable shelves, unique skyline groups by hole, large foreground formations, rock-lined dry washes, and sparse small scatter. Each hole must use a different arrangement and silhouette.

### Wild Valley

The dominant asset need is dense golden native grass. Dunes and bunker excavation remain terrain-driven. Meshes are for grass cards/clumps, selected blowout lips, and distant low-cost sandhill silhouettes—not modular artificial hill tiles placed over flat land.
