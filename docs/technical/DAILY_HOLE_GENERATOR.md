# The Daily Hole Generator

**Status:** AUTHORITATIVE (reference) — read before changing `systems/DailyHole.ts`,
`systems/DailyHoleGate.ts`, `systems/DailyHoleService.ts` or `systems/holeShapes.ts`.
**Companion:** `COURSE_AND_BOUNDED_WORLD_FIELD_GUIDE.md` (units, terrain gates,
the landmine map). Everything it says about units and the heightfield applies
here — the daily hole is compiled by the same `loadCourse` and played by the
same physics as an authored one.

---

## 1. What it is

One generated hole per calendar day, the same for every player, with no server
involved. The date is hashed to a seed; the seed draws geometry; the geometry
is PLAYED a few hundred times by the headless simulator; a hole is served only
if the simulation lands in a band. Everything is pure and deterministic, so two
devices independently arrive at the same hole and the day's scores compare.

```
dateKey ──► seedForDate ──► archetypeForDate      (the KIND of hole)
                       └──► seed + attempt·φ ──► generateHole ──► loadCourse
                                                        │
                                                  gradeHole (140 sim rounds)
                                                        │
                                             in band? serve : next attempt
```

## 2. The 2026-07 rebuild — what was wrong

Owner report: dailies were **"too plain jane"**, and the fix was to make them
**"harder to score AND dramatic — more water or more sand or more elevation
change or more distance or more trees. Whatever just make them more intense."**

The generator was emitting, on every day of every month:

- no water, no waste sand, no rock, no out of bounds, **zero** elevation points;
- at most three bunkers, and trees only on doglegs;
- a world hard-coded to 1100 px wide regardless of the hole.

Two independent causes, and both had to go:

1. **Vocabulary.** `HoleAuthoringLite` is `CourseAuthoring['holes'][number]` —
   it always permitted every one of those. The generator simply had a private
   copy of `blob()` and no other shape.
2. **The gate.** One band (`maxMeanToPar 1.9`, `maxBlowupRate 0.12`) judged par
   3s and par 5s alike. Anything dramatic simulated as "too hard", was rejected,
   and the next seed tried — the generator was being censored into blandness by
   its own quality gate, silently, at a rate no test measured.

## 3. Shared primitives (`src/systems/holeShapes.ts`)

`blob`, `stream`, `rock`, `computedPins`, `pointInPoly`, `pathYards`,
`alongPath`, `rng`, `R`. **One** implementation, used by both generators:

- `scripts/courselib.mjs` imports and re-exports them, so every
  `scripts/courses/*.mjs` keeps importing from where it always did and the
  committed course JSON stays byte-identical;
- `systems/DailyHole.ts` imports them directly.

`courselib.mjs` imports the file **as TypeScript** (`../src/systems/holeShapes.ts`);
node strips the annotations itself (Node ≥ 22.18 / 23.6), so
`node scripts/gen-new-courses.mjs` needs no build step. That constrains the
file: **type-only TS syntax**, `import type` for every type import, and no
runtime dependencies. If it ever has to run on an older node, pre-compile it —
do not fork it.

`blob`'s random source may be a **seed** (what the build-time modules pass; a
missing seed still means seed 0, which several authored shapes rely on) or an
**rng function** (what the runtime generator threads through a whole hole).

## 4. Archetypes

A day draws one of seven kinds, deterministically from the date, held constant
across the day's rejected candidates so the day has an identity:

| id | name | signature |
|---|---|---|
| `island` | Island Green | green inside a water polygon on its own plateau; short |
| `canyon` | Canyon Carry | water gorge across the corridor + two ridge rims (`x2/y2`, `skirt` 0.84) + rock |
| `gauntlet` | The Gauntlet | tree walls both sides at `spacing` 20–26, fairway 22% tighter |
| `links` | Windswept Links | 9–15 dunes, 4 waste blowouts, pot bunkers, OB down one side, no trees |
| `creek` | Winding Creek | `stream()` running with the hole then across it, rising far bank, willows |
| `quarry` | The Quarry | mesa wall (`skirt` 0.88), 4–7 boulders, waste spill, OB over the rim |
| `alpine` | High Country | mesa tee or shelf green (h 12–19), saddle ridge, valley shoulders, tarn |

`DailyHoleService` locks the day's archetype for the first
`ARCHETYPE_LOCK_ATTEMPTS` (24) tries and then rotates, so an archetype that
happens to be unfindable on a bad seed run still yields *some* hole rather than
none. `MAX_ATTEMPTS` is 60.

Every hole, whatever its archetype, additionally gets: 1–3 greenside bunkers, a
fairway bunker on the ideal line (par ≥ 4), dogleg trees, and 3–6 gentle rolling
mounds (h 1.2–3, r 100–180) so the ground is never a table.

## 5. The band

`DAILY_BAND` is now only the **envelope** — the loosest value on every axis, the
"no daily is ever outside this" promise. Grading uses `bandForPar(par)`.

| par | mean to par | blow-up | par rate |
|---|---|---|---|
| 3 | +0.30 … +2.20 | ≤ 30% | 14% … 72% |
| 4 | +0.50 … +2.70 | ≤ 28% | 10% … 68% |
| 5 | +0.60 … +3.10 | ≤ 26% | 8% … 62% |

Both ends matter, and the **floor** is the half that answers the owner. Widening
the ceiling only stops the gate discarding drama; without a floor the generator
draws a soft hole, the gate accepts it on attempt one, and the day is a
formality. Calibration, from the same grader on the shipped roster:

```
par 3   Sable Bay h2  −0.15 / 92% par     Timberline h2  +0.29 / 76% par
par 4   Maple Vale h1 −0.14 / 89% par     Timberline h1  +0.53     Sable Bay h1 +0.91
par 5   Maple Vale h3 −0.64 / 93% par     Timberline h3  +1.71     Sable Bay h3 +1.79
```

A daily must therefore be at least as hard as the harder end of what ships for
its par, and at most about a stroke beyond the hardest thing that ships.

**Re-measure these numbers if the physics, the swing model or `uniformGolfer`
change.** They are a snapshot of the simulator, not a law.

## 6. Sand placement is automatic, and it has to be

`courseLoader.warnBunkerFairwayOverlap` is the authority: a regular bunker
straddling the fairway edge bites a notch out of the fairway, and **waste sand
loses the overlap outright**, so the part of a blowout on the fairway silently
is not there. A generator placing hazards from a random draw has no idea where
the corridor is, so `Ctx.sand()` pushes every trap clear of both the fairway
ribbon (using the ribbon's local half-width) and the green before drawing it.
The push measures the blob's reach with the ellipse support function
`hypot(rx·ux, ry·uy)` inflated by blob's worst-case jitter (×1.2) — `rx` alone
under-measures a wide blowout beside a dogleg, which is what the lint kept
catching. **A month of generated dailies now produces zero loader warnings.**

## 7. Water needs carved ground (`HeightField.TerrainCut`)

The heightfield is **additive** and water renders as a flat plane at
`hz.level ?? 0.35`. So any ground inside a water outline that stands at or above
that plane simply buries the water. This was a shipped defect, not a
hypothetical:

- **Maple Vale h3**: a creek at level 0.35 running under a `+8` dome at
  (510,1000) r300. Measured bed height inside the creek polygon: **+1.76 to
  +7.98** — eight units of hill on top of the water.
- **Sable Bay h2** (found while testing): its sea is tiled into seven polygons
  and five of them had bed heights of **+4 to +11.6** under the same 0.35 plane.

The fix lives in the terrain compiler, so every course and every generated hole
gets it. `buildHeightField` emits one `TerrainCut` per water hazard and the
`HeightField` constructor applies them **after** every dome and plateau has been
summed:

- you cannot express "at most this high" with a negative bump in an additive
  field — how much lower depends on whatever overlaps — so it is a `min` after
  the sum. Exact, idempotent, and it can never dig deeper than asked;
- a cut is **skipped entirely** unless some ground inside the outline reaches the
  water surface. Water already lying below its own plane is not buried, and
  re-bedding it would move shorelines on shipped courses for nothing;
- where it bites, the bed goes to `surface − WATER_BED_DEPTH` (1.6 units ≈ 2.4 ft)
  and fades back to natural ground over `WATER_SHORE_BLEND` (30 px) — a bank, not
  a wall, and well inside the ≤3-per-8px fairway continuity budget.

**Cost.** `buildHeightField` runs once per *simulated round*, and the daily gate
plays each candidate 140 times, so the cut is O(cells): a scanline fill marks the
interior, a two-pass chamfer distance transform grows the ramp. Rejected as too
slow: `distToPolygon` per cell (~40× the work, whole seconds on a daily search)
and per-cell point-in-polygon.

Gate: `tests/unit/waterCarve.test.ts` — the bed is under its surface, never
deeper than authored, terrain beyond the ramp is bit-identical, the cut never
raises ground, and a hole whose only terrain input is unburied water still
compiles to `null` (which is what keeps the pre-elevation flat-engine regression
suite meaningful).

## 8. Gates

| file | holds |
|---|---|
| `tests/simulation/dailyHole.test.ts` | determinism, the gate bites, a hole exists for all 28 days, **and "a daily hole has teeth"** |
| `tests/unit/waterCarve.test.ts` | the water bed (§7) |
| `tests/unit/terrainPass.test.ts`, `rockPass`, `boundary` | the authored courses, unchanged by any of this |

"A daily hole has teeth" is the assertion whose absence let this ship: every
other daily test checked the hole EXISTS, is DETERMINISTIC and is PLAYABLE, and
all of them stayed green while the generator shipped a bare corridor every day
for months. It now asserts, over a real month: elevation and sand on every day;
water on ≥6 days, trees ≥10, rock ≥2, OB ≥2, waste ≥2; ridge segments and
plateau skirts present; ≥4 distinct archetypes; ≥9 distinct world widths; a
yardage range over 250; and every day at or above its par's difficulty floor.

## 9. A month, for calibration

Measured over 2026-11 (two themes), after the rebuild:

```
Winding Creek   par4 385yd  1274×1327  elev 5   sand 5  water 1  trees 3
The Quarry      par4 360yd  1221×1273  elev 6   sand 3  rock 6   OB 1
The Gauntlet    par4 388yd  1155×1326  elev 10  sand 5  trees 7
Windswept Links par4 395yd  1368×1346  elev 16  sand 10 OB 1
High Country    par3 201yd  1010× 963  elev 11  sand 1  trees 1
Island Green    par3 123yd   863× 805  elev 5   sand 2  water 1
Canyon Carry    par5 660yd  1539×1878  elev 9   sand 2  water 1  rock 3
```

Across the month: yardages 120–660, worlds 799×860 to 1878×1539, 4–18 elevation
entries per hole, 2–10 bunkers, water on 14 of 28 days, mean-to-par +0.37 to
+1.52, par rates 14–61% (shipped par 4s: 43–89%). Search cost: 1–11 attempts per
day against a cap of 60.
