# Course Authoring & Bounded World — Field Guide (Designer Handoff)

**Status:** AUTHORITATIVE (reference) — read before touching Red Hollow / Wild
Prairie geometry, the bounded-world renderer, or the terrain tests.
**Audience:** the next designer or agent working on the dev expansion courses.
**Owner doc for:** the `boundedWorld` system + the `gen-new-courses.mjs` course
pipeline + their validation gates.

This is the "what I wish I'd known before I started" guide. It is written to
keep you out of the traps this system sets. If you read nothing else, read §1
(mental model), §2 (units — the #1 mistake), and §8 (the gate landmine map).

---

## 1. Mental model (one paragraph)

The two dev courses **Red Hollow** ("Red Desert") and **Wild Prairie**
(course id `wildvalley`) are **generated**, not hand-edited. You edit
`scripts/gen-new-courses.mjs`, run `node scripts/gen-new-courses.mjs`, and it
emits `src/data/courses/redhollow.json` + `wildvalley.json`. The four base
courses (`sablebay`, `wildwood`, `timberline`, `portjohnson`) are hand-authored
JSON and are **production** — leave them alone unless asked. On top of all six,
a dev-only **bounded playable world** (`boundedWorld` flag) clips detail to a
~20-yard corridor and penalizes leaving it. A dense wall of **terrain tests**
(`terrainPass`, `rockPass`, `boundary`, `newCourses`) enforces the design
promises; almost every edit trips one, and the test message tells you which.

---

## 2. Units — get this right first

- **Horizontal:** `PX_PER_YARD = 2.0` (`src/config.ts`). Every `cx/cy/rx/ry/x/y/
  r/width/polygon/centerline` value is **world px**. **yards = px / 2.** A 40 px
  margin = 20 yd. A 26-px-radius bunker ≈ 26 yd wide.
- **Vertical is a DIFFERENT unit.** Elevation `h` is in "world units"
  (1 unit ≈ 1 ball diameter). **The game HUD and physics convert at 1 unit =
  1.5 ft** (`main.ts` elevation readout, `config.ts:163`) — so `h:3.8 ≈ 5.7 ft`.
  (An earlier version of this guide said 1.25 ft/unit from a stale test comment;
  the shipping conversion is **1.5**.) A "4 ft" green tier is **h ≈ 2.7 units**;
  a bold tier `h:3.8` reads ~5.7 ft. Do NOT apply `PX_PER_YARD` to the vertical
  channel — that's the horizontal unit only.
- **HeightField is ADDITIVE** (`grid[...] += p.h * t`, HeightField.ts): overlapping
  plateaus/domes SUM, they don't take a max. A small tier plateau inside a big
  mesa really does add its height (it is not swallowed).

---

## 3. Course authoring workflow

1. Edit the hole objects in `scripts/gen-new-courses.mjs` (`redhollow` /
   `wildvalley` const, `.holes[...]`).
2. `node scripts/gen-new-courses.mjs` — rewrites the two JSONs deterministically.
3. `npx vitest run tests/unit/terrainPass.test.ts tests/unit/rockPass.test.ts
   tests/unit/boundary.test.ts tests/simulation/newCourses.test.ts` — the gates.
4. Capture screenshots (§10) to eyeball it. `tsc --noEmit` + `npm run build` before pushing.

**Never hand-edit the two generated JSONs** — the next `node …` run overwrites
them. **Never hand-edit them to satisfy a test** either; fix the generator.

**Generator helpers** (top of the file): `blob(cx,cy,rx,ry,n,jitter,seed,rot)`
(organic bunker/rock polygon), `stream(points,w,seed)` (winding wash),
`rock(cx,cy,h,key)` (a collidable boulder — see §5), `computedPins`/
`computedAltTee`/`pathYards` (auto-derived, don't hand-author `pin`/`yardage`).

**Hole authoring shape:** `{ number, name, par, world:{width,height}, tee:[x,y],
teeBox, green:{cx,cy,rx,ry,rot}, green2?, slope, pins?, (centerline+width | fairways:[…]),
hazards:[…], aiTargets:[…], elevation:[…], landforms?, cliffWalls? }`. `emit()`
computes `pin/pins/tees/yardage/fairway` from these.

**Elevation entries:** `{x,y,h,r,shape?,skirt?}` (a bump) or ridge form
`{x,y,x2,y2,h,r,…}` (swept between two points — for ridges/walls/benches).
`shape:'plateau'` + `skirt` = flat-topped mesa/shelf; **higher `skirt` = MORE
flat top and a STEEPER, narrower transition** (skirt is the flat fraction of
`r`). Transition width ≈ `r*(1-skirt)`; a step per 8 px ≈ `h / (transition/8)`.

---

## 4. The bounded playable world (`boundedWorld` flag)

Full spec: `docs/technical/BOUNDED_PLAYABLE_WORLD.md`. Summary + the traps:

- **Flag:** `boundedWorld` (`src/core/flags.ts`), `prod:false / dev:true`. On the
  live site (a production hostname → `ENV.isProd`, `src/config/env.ts`) it is
  **OFF**, so production is byte-identical. Everywhere else (dev, localhost,
  `?ff.boundedWorld=on`) it is on.
- **Carrier:** `HoleData.boundary?: Polygon[]` — a **union** of playable regions
  ("in play" = inside ANY polygon). Populated only when the flag is on, via
  `withPlayableBoundary(hole, on)` (`src/systems/PlayableBoundary.ts`). Absent →
  every consumer falls back to classic full-world behavior.
- **Derived, not authored:** `computeBoundary` inflates the fairway corridors +
  green + tee + `aiTargets` + playable bunkers by the 20-yd margin. **This is why
  no course JSON needed a `boundary` field** — and why the system doesn't fight
  the course generator (two agents can work the same holes without boundary
  conflicts). Author `hole.boundary` by hand only for a true exception.
- **Off-course penalty:** outside the boundary = out of bounds, reusing the `ob`
  pipeline (`PhysicsEngine`: `outsideBoundary`, `inOutOfBounds`, `obDropPoint`,
  `ShotOutcome.obPenalty`). A rolling ball stops the instant it leaves the world.
- **Debug overlay:** `?boundary=1` on the capture harness, or
  `window.__slice3d.showBoundary()`. Use it to see exactly where the corridor is.

### 4a. THE VOID LESSON (do not repeat this mistake)

The first void implementation **dropped the ground mesh −58 units** outside the
boundary. Two things broke, both reported in playtest:
1. **Rocks sank.** Rocks/landforms/props ground through course3d's *local*
   `heightAt` (see §5), so they followed the drop into the trench.
2. **Blue "dead space."** The trench + the finite `w+440` ground mesh let the
   camera see the **sky dome's blue upper gradient** past the edge.

The fix (current design): **do not drop the mesh.** Keep authored terrain
everywhere; let cliffs/canyon be the natural edge; mask the far background with a
single **fogged void-floor plane** (`course3d.ts`, near the ground build —
`CreateGround('voidFloor', 16000²)`, `theme.haze`, `applyFog=true`, placed just
below the lowest terrain, skipped on `sea` courses). Scatter is still clipped to
the boundary (the perf win), and the aerial camera is still capped to the
boundary extent. **If you ever need "the world falls away," do it with authored
cliff geometry + the void floor, never by lowering the terrain mesh under
grounded assets.**

---

## 5. Rocks & landforms

- **Decorative rocks** → `hole.landforms: [{key,x,y,h}]`. `key` ∈
  `rocks_red_bright | rocks_red_mid | rocks_red_dark | rocks_red_cluster`
  (all alias to one glb, tinted). `h` is both height and (for collision rocks)
  radius. No collision.
- **Collidable boulders** → `rock(cx,cy,h,key)` in `hazards` → a `type:'rock'`
  hazard (swept-cylinder carom, `PhysicsEngine.rockContact`; `r = h`).
- **Grounding:** landforms + rocks + props render via course3d's **local
  `heightAt`** (`= engine.groundAt` now the void drop is gone). Golfers/balls
  ground via `engine.groundAt` (they're always inside the boundary).
  Atmosphere movers (birds) hover at fixed altitude, no terrain sampling.
- **Collision rocks MUST sit inside the boundary** — the visual mesh and the
  physics collider only agree where the ground isn't void-treated. A rock outside
  the boundary would look right but collide at the wrong height.
- **THE FOOTPRINT GATE** (`rockPass` "every large rock is grounded on one
  coherent level"): for every landform AND rock, sample the center + 8 points on
  a ring of radius `0.45·h`; the height span must be `≤ max(2.5, 0.22·h)` on the
  **undropped** HeightField. Translation: **rocks must sit on locally-flat
  ground** — plateau tops, the fairway shelf, flat rough pockets — **never on a
  cliff lip, mesa edge, or wall skirt.** This is the gate you will trip most when
  adding rocks.
- **How to place rocks without whack-a-mole:** don't guess flatness. Write a
  throwaway `tests/unit/_probe_tmp.test.ts` that builds the HeightField and
  prints the footprint span for a GRID of candidate `(x,y)` (see the git history
  of this session, or the snippet in §9). Place rocks only on cells it marks
  flat, then delete the probe.

---

## 6. Greens & tiers

- **Puttability gate** (`terrainPass` "every putting surface is smoothly
  puttable"): radial spokes center→rim, each 8-px step `≤ 1.2` (wildvalley) or
  `≤ 2.4` (redhollow — deliberately looser to allow Devil's Kitchen's tier ramp),
  and **total green relief `≤ 5`** for every green. Pins must sit on
  `gradientAt ≤ PIN_MAX_GRADIENT`.
- **Two-tier greens** (Red Hollow h2): a tier is a small `plateau` elevation
  entry on the back of the green. To raise the delta while staying legal, keep
  the ramp **narrow** (`r` small) so the down-slope is short — a *wide* gentle
  ramp paradoxically fails the "downhill putt reaches the lower tier" gate
  (`rockPass`) because the ball doesn't get down. This green tops out at
  **≈4.75 ft** (h 3.8) before a downhill putt runs off the front; more needs a
  bigger green. Raising the tier lifts the whole green (the ramp bleeds into the
  center), so **bump the tee mesa** to preserve the tee-over-green carry gate
  (≥8 units).

---

## 7. Bunkers & strategy

- **Landing zones aren't computed in the generator** — they were measured out of
  band (Monte-Carlo sim) and baked into comments + `aiTargets`. Recorded bands:
  RH h1 drives rest ~x380–410/y588–685 (mean 254 yd); WP h1 ~y534–653 (269 yd);
  WP h3 drives x521–560/y956–1057, second shots y450–606. To place a bunker in a
  drive zone by hand: walk `carryPx = effectiveCarryYards(85-stat driver)·2.0`
  down the centerline from the tee. To re-measure, use the sim recipe in §9.
- **Gates that constrain bunker moves:**
  - Every bunker centroid must be **≤ 230 px from an anchor** (`aiTargets` ∪
    green ∪ tee). Moving a bunker into a new zone? **Add an `aiTarget`.**
  - h1 **split bunker**: the *first* `!waste` bunker, centroid `cy ∈ [530,660]`,
    central width ≥ 38 px, **left lane ≥ 38, right lane ≥ 38**. Keep it first in
    the hazard list.
  - h1/h3 **flank blowouts must touch the fairway** (≤ 18 px). Waste bunkers may
    overlap the fairway (they read as sand spilling in) — that's how you tighten
    a drive.
  - h2 pins **back-right + puttable**; every h2 bunker **≤ 200 px** from green;
    the Kettle must **enclose** its green (rising ground on ≥3 of 4 sides).
  - **h1/h3 fairway ELEVATION is snapshot-locked** (`terrainPass` "the approved
    fairways are not reshaped", ±0.6). You may move hazards freely but **do not
    reshape h1/h3 fairway terrain.** h2 terrain is free.
- **Difficulty via strategy, not just hazards:** the strong pattern (used on WP
  h1) is an *aggressive line* (tight, flirts sand, rewarded with a better
  approach angle / a green-contour you putt along) vs a *safe line* (open off the
  tee, punished with a worse angle / a bunker to carry). Green-contour spines
  aligned to one lane do this cheaply.

---

## 8. The gate landmine map

Run these after every geometry change. Each test name tells you what broke.

- **`tests/unit/terrainPass.test.ts`** — course identity + shape. RH: canyon
  separation, cliff drops, **tee-over-green ≥8**, **two-tier back−front ≥2.6 +
  step ≤2.4**, mesa-face steepness, "long is dead", wash crossing. WP: amplitude
  6–20, blowout depth ≥2.5, **bunker ≤230 px from anchor**, **h1 split lanes
  ≥38**, **flank blowouts touch fairway ≤18**, h2 back-right pins + ≤200 px
  bunkers + Kettle encloses. Shared: **green puttability** (§6), **fairway
  snapshot lock** (h1/h3), fairway continuity (step ≤3), **grass "one approved
  asset" lock** (see §11).
- **`tests/unit/rockPass.test.ts`** — rock carom, no-tunnel, lane ≥32 (first
  rock), **footprint grounding** (all rocks/landforms, all holes — §5), h2 tier
  putts, plus the pass-9 gates (≥50 h1 side rocks; 3-rock carom + clean lanes).
- **`tests/unit/boundary.test.ts`** — the bounded world: boundary contains every
  play surface, ~20 yd margin, OB penalty + in-bounds drop, production-off
  regression, scatter-cull metrics.
- **`tests/simulation/newCourses.test.ts`** — **playability**: every hole
  finishes, mean-to-par ∈ (−3, 8), unfinished ≤ 4 of 180. Also runs a **bounded**
  variant (the AI pays the off-course penalty). This catches an unfair hole a
  shape gate can't see (a rock cluster that walls the fairway, an unescapable
  bunker).

---

## 9. Measuring landing zones / probing flatness (recipes)

**Drive/approach rest cloud** (place bunkers where balls actually land):
```
const engine = new PhysicsEngine(loadCourse(course).holes[i], buildHeightField(hole), mulberry32(seed));
const out = engine.simulate({ origin: tee, aimAngle, swing: SWING_OF(0.95,…),
  club: driver, golfer: golferWith(85), lie:'tee', wind, hole, … });
// out.finalPos is a rest point; loop 60 seeds, take x/y min–max.
```
Templates already in `tests/simulation/driver.test.ts` and `dispersion.test.ts`.
`effectiveCarryYards` (`PhysicsEngine`) predicts carry without simulating;
`carryPx = carry·PX_PER_YARD`.

**Rock flatness probe** (throwaway test; delete after):
```
function span(hf,x,y,h){ const r=0.45*h; let mn=hf.heightAt(x,y),mx=mn;
  for(let k=0;k<8;k++){const a=k/8*2*Math.PI; const v=hf.heightAt(x+Math.cos(a)*r,y+Math.sin(a)*r);
    mn=Math.min(mn,v);mx=Math.max(mx,v);} return mx-mn; }   // flat if span ≤ max(2.5,0.22h)
```
Print a grid of `(x,y) → span, groundH` and place rocks only on flat cells.

---

## 10. Screenshots & the capture harness

- **URL params** (`src/core/debugFlags.ts`): `/?hole=N&cam=tee|aerial|approach|
  green|club&course=<id>&freeze=1`. Add `&boundary=1` for the boundary overlay,
  `&ff.boundedWorld=on` to force the flag in any environment. Page sets
  `window.__shotReady` when the scene has settled.
- **Capture pattern:** a Playwright spec in `tests/visual/_something_tmp.spec.ts`
  that `goto`s the URL, waits for `__shotReady`, `page.screenshot(...)`, asserts
  no `pageerror`. Runs against the vite dev server (auto-started). **Delete temp
  specs when done.**
- **Vitest gotcha:** `console.log` in a vitest test is **swallowed**. To get
  numbers out (metrics, probe grids), `writeFileSync` to the scratchpad and read
  the file.
- **`grasspicker.html`** (repo root, dev-only like `palview.html`): renders every
  candidate prairie-grass card side by side under one light/scale with a legend —
  the "asset-selection display". `npm run dev` then open `/grasspicker.html`, or
  capture it. Vite dev serves any root `.html`; the build ignores it.

---

## 11. The grass lock

Wild Prairie uses **exactly one** grass card everywhere (field, fingers, bunker
lips, sand plants, tufts): currently **`heather_fescue_b`** (a gold photo card,
rendered unlit). This is enforced by `terrainPass` ("ONE approved grass asset"):
to swap it you must change **both** the generator theme
(`heatherKeys`/`grassKeys`/`sandPlantKeys`) **and** the `approved` constant in
`terrainPass.test.ts`. Candidates live in `assets/models/nature/` (see the
picker). Decision this session: **keep `heather_fescue_b`.**

---

## 12. Feature flags, dev vs prod, deploy & branch model

- **`version2` is the production trunk.** `deploy.yml` deploys the live GitHub
  Pages site on every push to `version2`. `deploy-dev.yml` is **dormant** (no dev
  host configured) — there is **no separate live dev site**. "Dev" = the same
  bundle run from a non-production hostname (localhost, `?ff…`, an admin
  override).
- **`ENV.isProd` is by hostname** (`src/config/env.ts`), not by build. One bundle
  behaves as prod on prod hostnames and dev everywhere else. That's why a
  dev-only flag (`prod:false`) keeps production byte-identical even though the
  code ships to the live site.
- **CI:** `visual.yml` (Playwright soak/perf/behavior) runs **only on version2
  pushes**. Pushing to a feature branch triggers no visual CI. **Heads-up:** the
  bounded-world scatter clip drops mesh/instance counts, so `soak-baseline.json`
  and `perf-baseline.json` will be **stale** once the flag is on in a
  version2/dev soak — refresh those baselines (with review) before trusting that
  CI.
- **Never force-push.** Safe merge to version2: `git fetch origin version2`; if
  it's an ancestor of your HEAD, fast-forward; if it advanced, real-merge and
  re-run all gates; on a rejected push, re-fetch and re-merge — don't force.

---

## 13. Working alongside another agent

Reality this session: two agents edited `gen-new-courses.mjs`, the course JSONs,
and the terrain tests **concurrently**. Practices that kept it sane:
- The bounded-world system **derives** boundaries so it never edits course JSON —
  that's a deliberate collision-avoidance design. Prefer additive, localized
  changes.
- Merges of the generator/JSON **will** conflict; keep both designs where
  possible, prefer the newest coherent hole geometry, and **re-run every gate
  after** — the tests are the arbiter of a good merge.
- Regenerate (`node scripts/gen-new-courses.mjs`) after any merge so the JSON
  matches the merged generator.

---

## 14. Key decisions (this session's log)

- `boundedWorld` ships **dev:true / prod:false** — live on dev, production
  untouched, pending screenshot/baseline review before any prod flip.
- Void = **fogged floor plane + authored cliffs**, never a terrain-mesh drop.
- Authored `landforms` are **kept** (not boundary-clipped) — they're the
  intentional framing masses.
- h2 two-tier capped at **≈4.75 ft** (green-size limited).
- Prairie grass = **keep `heather_fescue_b`**.
- Red Desert h1 carries **51 landform rocks + 3 collision rocks**; h3 bunkering
  left as the concurrent pass had already dispersion-corrected it.

## 15. Open items for the next designer

- Refresh `soak-baseline.json` / `perf-baseline.json` / visual `__shots__` with
  `boundedWorld` on before relying on `visual.yml`.
- Optional polish: a dedicated dark/graded void material instead of the flat haze
  plane; clamp the ground-mesh footprint to the boundary bbox for a raw vertex
  cut (today only instances/detail are reduced).
- If a *full* 5 ft h2 tier is wanted, enlarge that green first.
- Eventually flip `boundedWorld` `prod:true` (then remove the flag) after the
  bounded world is validated on device and approved.

## 16. File map

- Generator: `scripts/gen-new-courses.mjs` → `src/data/courses/{redhollow,wildvalley}.json`.
- Bounded world: `src/systems/PlayableBoundary.ts`, `src/core/flags.ts`
  (`boundedWorld`), `src/core/types.ts` (`HoleData.boundary`), physics in
  `src/systems/PhysicsEngine.ts`, rendering/void/scatter/camera in
  `src/slice3d/course3d.ts` + `src/slice3d/main.ts`, capture flags in
  `src/core/debugFlags.ts`.
- Terrain/height: `src/systems/HeightField.ts`. Env: `src/config/env.ts`,
  `src/config.ts` (`PX_PER_YARD`). Assets: `src/slice3d/natureModels.ts`,
  `assets/models/nature/`.
- Gates: `tests/unit/{terrainPass,rockPass,boundary}.test.ts`,
  `tests/simulation/newCourses.test.ts`.
- Dev tools: `grasspicker.html`, `palview.html`, the `?hole&cam&freeze` harness.
- Specs: `docs/technical/BOUNDED_PLAYABLE_WORLD.md`,
  `docs/technical/WILD_VALLEY_RED_HOLLOW_TERRAIN_PASS.md` (per-pass history).

## 17. Pass-10 engine & productization notes

**Collision & terrain physics (PhysicsEngine.ts):**
- **Large landforms deflect.** `this.rocks` now also ingests `hole.landforms`
  with `h ≥ PHYSICS.landformCollideMinH` (12) as carom colliders (r = h), reusing
  `rockContact`/`rockRebound`. Small decorative landforms stay pass-through. So a
  hole gets deflecting boulders WITHOUT adding `type:'rock'` hazards (the
  `rocks.length===3` hazard gate is unaffected). A cheap AABB reject guards the
  now-longer collider loop.
- **Steep faces bounce (no tunneling into void).** In the roll loop, if a ball
  would climb more than `PHYSICS.wallStepRise` (8) in one step it caroms off the
  face (`wallRestitution`) instead of riding over a cliff/mesa wall into the
  void. Only near-vertical faces trigger; normal fairway/green rolls climb far
  less. This is why authored cliffs no longer need collider rocks along them.
- **Slope creep.** A ball that runs out of pace on a real slope no longer freezes
  mid-face: at the roll-stop check, if the local downhill accel beats friction
  (the same threshold that keeps a moving ball moving) it's re-seeded downhill.
  Gentle greens (below the threshold) rest exactly as before.
- **Putt elevation readout is now honest.** The putt HUD shows the true net rise
  `(groundAt(pin) − groundAt(ball)) × 1.5 ft`, same as full shots — a tier reads
  its real height, not a diluted slope-average. (The old heuristic under-reported
  concentrated steps.)

**Productization:**
- **"Coming soon" courses.** The new courses stay OUT of `COURSES` in prod (the
  `flag('newCourses')` spread) so they can never be entered. `COURSE_ROSTER` holds
  all metadata; `COURSE_LIST` = loaded courses, `COMING_SOON_COURSES` = roster
  entries not loaded. `renderCourse()` appends the coming-soon set as locked
  `.courseCard.locked` cards with a `.lockBadge` — deliberately NOT `.modeCard`,
  so the click handler never binds them (non-selectable). Dev (newCourses on)
  shows them playable as before. **There is no per-environment course version** —
  prod is insulated only because it never loads the evolving JSON.
- **Promoted flags.** `delight, juice, atmosphere, audio, personality, layouts`
  are now `prod:true` (shipped). `devTools`, `newCourses`, `boundedWorld` stay
  dev-only. (Visual CI runs in dev where these were already on, so no baseline
  churn; production now gets the polish.)
