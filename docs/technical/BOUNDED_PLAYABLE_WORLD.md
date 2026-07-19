# Bounded Playable World & Off-Course Void

**Status:** IMPLEMENTATION RECORD (bounded-world pass, 2026-07-19).
**Scope:** all six courses **in the development environment** (`boundedWorld`
flag, `dev:true`). Production is **byte-identical** — the flag is `prod:false`,
so no boundary is derived and every code path falls back to the classic
full-world behavior. Dev-flagged, not yet promoted.

## Rule

Only build, detail, simulate, and render the portion of the world that supports
gameplay or required camera composition. The normal detailed-world boundary
extends ~20 yd (40 world px at `PX_PER_YARD = 2.0`) beyond the hole's playable
corridor. Everything beyond is non-playable **void**: no terrain detail,
vegetation, rocks, or collision scatter, and a ball that crosses it takes a
one-stroke off-course penalty dropped back in the rough.

## Boundary method

A single carrier field, `HoleData.boundary?: Polygon[]`, holds the **union of
playable regions** — "in play" means inside ANY polygon. It is populated only
when the rule is on, via `withPlayableBoundary(hole, on)`
(`src/systems/PlayableBoundary.ts`). Because physics, the 3D build, the camera,
and the debug overlay all read `hole.boundary`, when the field is absent
(production) they behave exactly as before.

### How the playable corridor is constructed (`computeBoundary`)

Derived from geometry each hole already carries — **no course JSON is authored
by hand** (this also kept the pass off the two new courses' files while they
were being edited in parallel):

1. **Fairway corridors** — each ribbon centerline (`fairwayCenterlines` +
   `fairwayCenterlineWidths`, now kept by `courseLoader`) is re-offset at
   `half-width + recovery rough (44 px) + margin (40 px)`, using the same
   Catmull-Rom + `offsetPolyline` path as `compileRibbon`, so the corridor
   tracks every dogleg and split fairway. v1 raw-polygon fairways are inflated
   from their centroid instead.
2. **Green complex** — both lobes grown by `FRINGE_MARGIN (32) + margin`.
3. **Tee** — a blob around the tee/teeBox + margin.
4. **Landing zones** — a blob around every `aiTargets` point (dispersion + margin).
5. **Playable bunkers/waste** — any `bunker` hazard whose polygon comes within a
   margin of the core is unioned in (grown by margin); far decorative waste that
   never nears play is left as void. Water / trees / `ob` regions are never added.

The result follows the hole rather than being a rectangle; islands and split
fairways naturally become separate connected regions.

### Local exceptions

The default margin is 40 px but not fixed — `computeBoundary(hole, margin)`
takes a per-hole override, and a course may author `hole.boundary` outright
(the authored polygons win) for a canyon wall beside the fairway, an island
green, a required camera sightline, or a recovery area designed into the hole.
None were needed for the first pass; the derived corridor covered all six
courses (see validation).

## Relief & penalty logic

Reuses the existing out-of-bounds pipeline (`PhysicsEngine`,
`ShotOutcome.obPenalty`) — no parallel system:

- `inOutOfBounds(x,y)` is true inside any `ob` hazard **or** outside the
  playable boundary (`outsideBoundary`, bbox-reject then point-in-union).
- A rolling ball that leaves the boundary **stops immediately** (a `break` in
  the roll loop beside the water check) — it never rolls on through unrendered
  void. Airborne carries over void (mesa-to-mesa) are unaffected.
- At rest outside the world → **+1 penalty**, and `obDropPoint` walks the flight
  line back to the last in-bounds point (nudged ~10 px back) so the ball drops
  in the rough near where it crossed. Falls back to the previous-shot location
  when no valid point exists.
- The stroke is counted at the existing sites (`main.ts`, `RoundSimulator`) that
  already read `obPenalty`; scramble (`TurnManager`) now counts it too (it
  previously only counted water). Toast: "OUT OF BOUNDS! +1 penalty".

## Playable world vs void (rendering)

- **`course3d.heightAt`** — inside the boundary the full authored terrain
  renders; outside it the ground drops away (`-58` units over a 26 px feather)
  into fog-hidden depth. Combined with the existing EXP2 `theme.haze` fog, the
  edge reads as deliberate nothingness ("edge geometry that drops away before
  the cutoff" + "atmospheric fog concealing the edge").
- **Ground scatter** (grass, bushes, flowers, rocks, forest litter) — a
  `pointInBoundary` gate at the top of the scatter loop skips every cell in the
  void. Trees are already bounded per-hazard-polygon; authored `landforms`
  (deliberate framing masses — cliff walls, mesa stacks) are kept by design.
- **Aerial camera** — height is capped to the boundary's extent (`× 0.9`) so it
  frames the corridor and only a thin fog-masked void ring, instead of zooming
  out over empty terrain.

## Debug overlay

`?boundary=1` on the capture harness (or `window.__slice3d.showBoundary()`)
draws the core playing surfaces (fairways green, green ellipse) and the
playable-world boundary (yellow) as floating line loops — the debug view that
distinguishes core surfaces, the expanded envelope, and the void. Normal
screenshots never show it.

## Rendered-area & asset reduction (before → after)

Ground-scatter instances placed across each hole with the rule off vs on
(rough/fairway cells, and the fraction of the world grid that is detailed).
Measured by `tests/unit/boundary.test.ts`:

| Hole | Scatter instances | Scatter cut | Rendered area cut |
|---|---|---|---|
| Sable Bay h1 | 78 → 49 | -37% | -79% |
| Sable Bay h2 | 14 → 4 | -71% | -91% |
| Sable Bay h3 | 151 → 90 | -40% | -79% |
| Wildwood h1 | 870 → 168 | -81% | -80% |
| Wildwood h2 | 809 → 94 | -88% | -88% |
| Wildwood h3 | 1267 → 269 | -79% | -80% |
| Timberline h1 | 773 → 115 | -85% | -80% |
| Timberline h2 | 1119 → 49 | -96% | -90% |
| Timberline h3 | 2026 → 209 | -90% | -82% |
| Port Johnson h1 | 1111 → 223 | -80% | -78% |
| Port Johnson h2 | 814 → 147 | -82% | -76% |
| Port Johnson h3 | 1756 → 347 | -80% | -77% |
| Red Hollow h1 | 697 → 203 | -71% | -60% |
| Red Hollow h2 | 399 → 94 | -76% | -51% |
| Red Hollow h3 | 1182 → 220 | -81% | -74% |
| Wild Prairie h1 | 2912 → 647 | -78% | -71% |
| Wild Prairie h2 | 1862 → 254 | -86% | -76% |
| Wild Prairie h3 | 4672 → 843 | -82% | -77% |
| **TOTAL** | **22512 → 4025** | **-82%** | **-78%** |

Fewer instances → fewer draw calls, less memory, and a smaller between-holes
bake. Collision scatter (rocks/props in the void) is likewise not generated.
The ground mesh's fixed subdivision is unchanged (a future refinement could
clamp its footprint to the boundary bbox for a raw vertex cut); the win here is
instances and detailed area. Live draw-call/heap deltas belong in the soak/perf
capture (`window.__golfSoak`, `perf-baseline.json`) with the flag on.

## Validation

`tests/unit/boundary.test.ts` (75 cases) — every hole on all six courses:
boundary is non-empty and contains tee, green(s), pin, landing zones, and every
fairway centerline point; a full greenside ring at the green radius + 20 yd
stays in play; a meaningful share of the world is void and ≥3 corners are
off-course; a shot into the void is flagged OOB and dropped back **inside** the
boundary; with the rule off the boundary is absent and nothing off the fairway
is OOB (production regression). `tests/simulation/newCourses.test.ts` — every
course still finishes and scores in band **under the off-course penalty**
(bounded Monte-Carlo). Full suite: 780 unit/sim tests green; `tsc --noEmit`
clean.

## Cameras requiring reframing

Only the overhead **aerial** view needed a change (height cap). Tee, ball-flight,
landing, approach, green, and putting framings were already tight to the hole
and require no change; verify per-course screenshots with the flag on.

## Holes needing more than the 20-yd margin

None in this pass — the derived corridor covered all six courses. Authored
`hole.boundary` overrides remain available if a future hole needs a wider
envelope for ball-flight clearance or a required camera.

## Known limitations / compromises

- **Void treatment is geometry + fog**, not a dedicated void material. It reads
  as depth falling into haze at gameplay cameras; a bespoke dark void shader is
  a future refinement.
- **Ground-mesh vertex count is unchanged** (fixed 140² subdivision). The
  measured reduction is instances and detailed area, not raw ground vertices.
- **Base courses (Sable Bay/Port Johnson/Timberline)** are water/coastline-heavy;
  the derived corridors validated in tests, but per-course visual screenshots
  should confirm no required composition (an island carry, a coastline vista) is
  clipped — author a `hole.boundary` override if one is. Production is untouched
  regardless (flag off).
- **Draw-call / heap live deltas** are not yet captured with the flag on (the
  soak/perf baselines are recorded flag-off); add a flag-on soak pass before
  promotion.

## Files

- New: `src/systems/PlayableBoundary.ts`, `tests/unit/boundary.test.ts`.
- Modified: `src/core/flags.ts` (`boundedWorld`), `src/core/types.ts`
  (`boundary`, `fairwayCenterlineWidths`), `src/data/courseLoader.ts` (carry
  widths), `src/systems/PhysicsEngine.ts` (boundary OOB + stop-on-cross),
  `src/systems/RoundSimulator.ts` (`bounded` opt), `src/systems/TurnManager.ts`
  (scramble OB tally), `src/slice3d/main.ts` (attach + aerial cap + debug
  overlay), `src/slice3d/course3d.ts` (void + scatter clip),
  `src/core/debugFlags.ts` (`?boundary=1`), `tests/simulation/newCourses.test.ts`.
- Deliberately untouched: `src/data/courses/*.json`,
  `scripts/gen-new-courses.mjs` (boundaries are derived, not authored).

## Rollback

Flip `boundedWorld` off (or delete the flag) → every consumer falls back to the
full-world behavior with no data migration. No production surface changes.
