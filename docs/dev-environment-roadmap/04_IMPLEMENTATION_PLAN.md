# Development Environment Roadmap — Audit & Implementation Plan

**Status:** ACTIVE PLAN — approved by the owner 2026-07-20; the nine open
decisions are resolved in §6.
**Date:** 2026-07-19 (plan), 2026-07-20 (decisions). **Scope:** version2 /
dev only; production untouched.
**Companion docs:** `01_ENVIRONMENT_ROADMAP.md` (owner direction),
`02_COURSE_DESIGN_BIBLE.md` (course identities, expanded draft),
`03_GLOBAL_DESIGN_SKILL.md` (review rules).

---

## 1. Repository audit (concise)

### What already exists — this direction is an evolution, not a green field

- **A bounded playable world already ships in dev.** `boundedWorld` flag
  (`src/core/flags.ts`, prod:false/dev:true) derives a playable corridor per
  hole in `src/systems/PlayableBoundary.ts`: fairway centerlines re-offset by
  half-width + 44 px rough band + 40 px margin (≈ 20 yd), plus green+fringe,
  tee, AI landing zones, and adjoining bunkers — a polygon union, derived at
  load, never authored into JSON. Outside it: ground scatter is skipped
  (−82% instances across all six courses), a rolling ball stops and takes a
  +1 penalty via the existing OB pipeline, and the aerial camera is
  height-capped to the boundary bbox. Spec: `docs/technical/
  BOUNDED_PLAYABLE_WORLD.md`; handoff: `docs/technical/
  COURSE_AND_BOUNDED_WORLD_FIELD_GUIDE.md` (read both before touching this).
- **Terrain footprint** is per-hole: `hole.world {width,height}` (880–1640 px;
  2 px = 1 yd), one 140-subdivision ground mesh + 220 px texture pad,
  heightfield from authored `elevation[]` splats (`src/systems/HeightField.ts`,
  8 px cells, additive). Terrain outside play is the SAME authored mesh,
  undecorated, plus a 16000² fogged void-floor plane and per-theme backdrop
  (sea plane / layered red-rock dioramas + backstop / haze domes / conifer
  backdrop bands).
- **Each hole is an isolated coordinate space.** New Babylon scene, new
  heightfield, new physics per hole (`playHole()`, `src/slice3d/main.ts`).
  Physics clamps rest positions to `[10, world−10]`; bake, cameras, shadow
  rig, boundary all assume one hole rectangle. No course-level routing data
  exists.
- **Cameras:** one FreeCamera; modes are retargets (setup, putt, flight,
  descent, landing, aerial toggle, intro flyover at height 52–82 along the
  centerline, celebration). Setup/flight look downrange to the horizon —
  edge treatment must survive low-angle views, not just the aerial. The only
  spatial clamp is the aerial boundary cap. No minimap exists.
- **Physics** is a custom deterministic CPU integrator (no Babylon physics):
  heightfield ground, polygon hazards with AABB reject, tree-trunk cylinders
  (shared source for render/bake/collision in `src/systems/treeField.ts`),
  swept-cylinder rock caroms, steep-face bounce (`wallStepRise`), water/OB
  rewind-drop. OB = inside `ob` hazard OR outside boundary.
- **Performance:** scatter is classic InstancedMesh instancing (frozen
  matrices, no LOD/thin instances/freezeActiveMeshes anywhere). Wild Prairie
  carries ~25,300 meshes (next heaviest: Port Johnson 5,900) — scene-graph
  count, not draw calls, is the lever. Tree/scatter shadows are baked into
  the ground texture; only ~dozen meshes cast real-time shadows. Gates:
  Playwright perf/soak specs with committed baselines + dense unit terrain
  gates (`terrainPass`, `rockPass`, `boundary`, `newCourses` sim).
- **Tooling precedent for a Hole Builder:** dev-only root HTML pages
  (`grasspicker.html` — an asset gallery with pedestals + labels — and
  `palview.html`) are served by `vite dev` but excluded from the build
  because only index/slice3d/admin/marketing are rollup inputs
  (`vite.config.ts`). Screenshot harness (`?course&hole&cam&freeze&boundary`)
  and `window.__slice3d` hooks exist. Course JSON is deterministic and
  version-controlled; admin app + email allowlist + RTDB `adminDrafts`
  staging exist.

### Why the recent passes removed meaningful near-play assets

Three independent mechanisms — only one of them is the bounded world:

1. **Deliberate art-direction deletions** (playtest rounds 2–3):
   `4123067` set `bareRough: true` on Red Hollow (no rough grass/flowers at
   all); `b7c1f72` made Wild Prairie fully treeless (removed all three
   `trees` hazards + bush/scatter keys — the "Wild Horse look") and stripped
   Red Hollow's bushes. Later passes (`ed2150e`, `0741a92`, `9d85af9`)
   partially re-added rocks/scrub. These were intentional identity choices
   that overshot "playing in a natural landscape" in places.
2. **The boundary scatter clip** (`71df849`): everything beyond ~40 px of the
   corridor loses ALL ground scatter. The corridor itself is generous
   (fairway edge + ~42 yd), but bunkers only join the union if they near the
   core, `aiTargets` don't cover every real recovery area, and framing
   masses outside the union went bare.
3. **Pre-existing exclusions and perf thinning:** the scatter loop bares a
   110 px (≈ 55 yd) radius around every pin — the entire green surround; tree
   render density falls to 15% beyond 115 yd of a fairway (`7aa730c`,
   perf-motivated); the 44 px rough band + tee/garden/canopy exclusions trim
   further. Meanwhile `tallGrass`/waste-fescue fields are NOT boundary-
   clipped — an inconsistency (Wild Prairie stays lush while other rough
   goes bare).

**Conclusion:** the corridor system is sound; the losses came from theme
vocabulary deletions, the green-surround exclusion, corridor gaps around
recovery areas, and aggressive far-tree thinning. Restoration = tuning those
four, not rebuilding the boundary system.

### Which systems can be reused vs need refactoring

Reusable as-is: PlayableBoundary (add knobs), HeightField, PhysicsEngine,
courseLoader/JSON schema, natureModels prototype/instancing pipeline,
treeField, void floor + backdrop kits, capture harness, terrain/sim gates,
dev-page pattern, adminDrafts.

Needs refactoring (per phase below): scatter exclusion rules in
`course3d.ts` (green surround, tallGrass clip parity); corridor inputs
(authored recovery zones); edge-treatment selection (cliff-as-edge policy);
`course3d.ts` build path if neighboring-hole rendering lands (accept a
transform + detail tier); course JSON gains optional course-level `property`
layout data; a serializer module shared by generator + Hole Builder.

### Risks to currently successful course geometry

- h1/h3 fairway terrain on both dev courses is snapshot-locked in
  `terrainPass` (±0.6) — identity passes must move hazards/vegetation, not
  approved landforms, or consciously re-baseline.
- Bunker-anchor (≤230 px), split-lane, blowout-touch, puttability, footprint-
  grounding gates all trip on casual edits — every pass must run the gate
  suite; the field guide's landmine map is the checklist.
- The two dev course JSONs are generated — hand edits are overwritten by
  `scripts/gen-new-courses.mjs`. Any new authoring path must resolve who owns
  the JSON (see Decisions).
- Committed soak/perf baselines and the mesh variance band go stale with any
  density change; refresh commits must accompany reworks.
- Base-course JSON edits ship to production (courses are bundled; prod
  differs only by flags). Identity passes on the four base courses are
  therefore NOT dev-isolated — see Decisions.

---

## 2. Proposed architecture: bounded course environments

Four concentric zones per hole, all derived from data the hole already has:

1. **Core** — tee, fairway, green+fringe, bunkers, water. Full detail,
   collision, gameplay.
2. **Corridor** (exists today) — core + rough band + ~20 yd margin + landing
   zones + **authored recovery zones (new)**. Full visual detail: this is
   where "preserve every meaningful asset" applies. New optional
   `hole.recoveryZones: Polygon[]` joins the boundary union so designed
   recovery areas keep detail and stay in-bounds.
3. **Frame** (new, render-only band ~20–40 yd past the corridor) — the cheap
   intentional backdrop: authored landforms, low-density silhouette
   vegetation, neighboring-hole impostors (Phase 3). No collision, no
   scatter grid, no gameplay.
4. **Horizon** — per-theme edge kit (exists, becomes policy): sea plane /
   layered dioramas + backstop / haze domes / treeline bands + void floor +
   fog. **Cliff edges are a theme feature (Red Desert only), never a generic
   world-ender.**

Concrete changes:

- **Restore the corridor's detail contract:** shrink the pin scatter
  exclusion (110 px → green ellipse + fringe + ~20 px); clip
  `tallGrass`/waste fescue to corridor+frame (consistency + perf); raise
  in-corridor tree render floors so woods feel like woods where play
  happens; re-add theme vocabulary where the owner marks removals as
  incorrect (per-course list in the Bible).
- **Stop paying for outskirts:** clamp the ground mesh footprint to the
  boundary bbox + frame band (the field guide's open item — a raw vertex
  cut); keep `world` rectangles tight when authoring new holes.
- **Edge policy:** replace accidental drop-offs on non-desert courses with
  theme horizon kits; keep Red Desert's canyon (it is the theme); document
  per-course edge treatment in the Bible.
- **Camera safety:** add a boundary+frame framing check to the visual specs —
  tee/approach/aerial/flyover screenshots on all six courses must show no
  raw void, backstop seam, or mesh edge.

## 3. Shared course property — recommendation

**Recommend: keep per-hole simulation spaces; add a course-level property
layout + neighbor impostors. Do NOT merge holes into one physics/coordinate
space.**

Rationale: hole-local space is baked into the heightfield origin, physics
clamps, texture bake, fringe grid, boundary, shadow rig, aerial framing, and
per-hole scene lifecycle. A true shared world refactors all of that for a
visual payoff we can get scenographically, and it would blow the texture-bake
and instance budgets (one hole already costs a ≤2.5 s bake; three would not
fit).

Proposed mechanism (Phase 3): a per-course `property` block — for each hole,
an offset+rotation placing its local rectangle on one shared property plan.
The active hole builds exactly as today; its neighbors render as **impostor
tiles** in the frame zone: pre-baked ground texture on a low-res heightfield
patch + a handful of instanced landmark props (no scatter grid, no collision,
no physics, frozen, fog-affected). Deterministic, cheap (~1–2 draw calls +
tens of instances per neighbor), and it makes tee boxes/flags of the next
hole visible where the plan says they should be. Gameplay isolation is free:
neighbors are outside the boundary, so balls that reach them are already OB.

## 4. Phased roadmap

Each phase is independently shippable to version2 (dev-flagged where it
touches rendering), gated by the existing test suites + screenshot review.

### Phase 1 — Documentation and audit *(this deliverable, docs-only)*
1. This plan + the expanded Course Design Bible draft (done, pending review).
2. Reconciliation decisions for the owner (§6) — naming (Port Links vs Port
   Johnson; Red Desert vs Red Hollow), Wildwood's missing identity, the
   cliff policy, treeless-Prairie intent.
3. On approval: fold `01/03` principles into the governing docs set
   (`docs/README.md` precedence), mark `technical/BOUNDED_PLAYABLE_WORLD.md`
   + field guide as the implementation authority, mark superseded guidance.
   Recommended authority split: **vision docs → this roadmap's three docs →
   10_COURSE_DESIGN_BIBLE (craft) + 02 Bible here (identity) → technical
   records.**

### Phase 2 — Playable-corridor and world-boundary system
Small PRs, all behind `boundedWorld` (already dev-on):
1. `recoveryZones` authored field + boundary union inclusion + overlay.
2. Corridor detail restoration: pin-exclusion shrink, tallGrass clip parity,
   in-corridor tree floor, per-course vocabulary restorations (owner-marked).
3. Ground-mesh clamp to boundary bbox + frame band.
4. Edge-kit policy pass: audit all 18 holes' edges at gameplay cameras;
   replace non-thematic drop-offs; add the camera edge-safety visual spec.
5. Refresh soak/perf baselines with the flag on (field guide open item).

### Phase 3 — Shared course-property layout
1. `property` layout block (data only) + a top-down property-plan debug
   render to place the six/18 holes sensibly per course.
2. Neighbor impostor tiles (bake-lite path in `course3d.ts`), dev-flagged
   (`courseProperty`), one course first (Wild Prairie — treeless, cheapest
   impostors), then per-course.
3. Perf gate: impostors must not move the meter/soak bands on the heaviest
   course.

### Phase 4 — Course identity pass (data/theme, per course)
Apply the ten-field Bible per course: vegetation vocabulary, edge kit,
bunker/green language conformance, atmosphere pairing. Dev courses get
geometry freedom (within locked snapshots). Base courses are **blocked on the
per-environment course-variant mechanism (decision 5)** — that mechanism is
this phase's first work item; no base-course change ships to production
until variants make it dev-only. Port Johnson's full Scottish re-theme
(decision 6) is the largest base-course item and goes last in this phase.
Every course change lands as its own reviewable PR with before/after
screenshots.

### Phase 5 — Course rebuild order
1. **Red Desert (redhollow) = the template.** It already exercises every
   system this roadmap adds (authored cliffs as THEME, landforms, bare-rough
   identity, tiered greens, boundary edge cases) and its gates are the most
   mature. Prove corridor restoration + edge policy + identity here.
2. **Wild Prairie (wildvalley)** — perf flagship (25k instances): corridor
   restoration + mesh clamp must hold or improve soak numbers; first
   property/impostor course.
3. **Timberline** — first base course (vegetation-only pass): restore
   in-corridor woods feel; treeline horizon policy.
4. **Wildwood Glen** — parkland lushness + gardens; confirm identity (§6).
5. **Port Johnson Links** — links weather/heather direction per owner call.
6. **Sable Bay** — least change (sea edge already ideal); polish pass last.
Each course = 2–4 small PRs (corridor/edge → vegetation → hazards/identity →
baselines), never one uncontrolled pass.

### Phase 6 — Hole Builder (feasibility: **high**, see §5)

## 5. Hole Builder — feasibility and MVP plan

**Feasible now.** Everything hard already exists: deterministic JSON schema +
compiler, a self-contained `buildCourse(scene, hole, theme)` renderer,
heightfield + physics as pure TS (dispersion sims run in vitest today), the
boundary overlay, fixed camera poses, an asset-gallery precedent
(grasspicker), and a build system where a root `holebuilder.html` NOT added
to rollup inputs is automatically dev-only (same as grasspicker/palview —
zero production-bundle risk; optionally also gate the page on `ENV.isProd` +
admin email like `admin.html`).

**Data structures:** the editor's document IS the authoring JSON (schema v2)
— no parallel format. Editor state = `{ courseJson, selection, undo stack of
JSON snapshots, dirty flags }`. Export = `JSON.stringify(doc, null, 2)` with
the generator's 0.1 rounding — byte-stable, diffable, version-controlled.
Asset catalog = a generated manifest (`scripts/gen-asset-manifest.mjs` →
`assets/models/manifest.json`: key, path, repo path, bbox, category) so the
browser panel never hardcodes lists like grasspicker does.

**Build now (MVP, ~first increment):**
- Load any course JSON (file picker or bundled) + full-fidelity render via
  the existing pipeline; rebuild-on-edit (debounced full rebuild is fine).
- Asset browser: category tree from the manifest, pedestal live previews
  (grasspicker pattern), filename + repo-path labels; click-to-place props/
  landforms with `heightAt` grounding + footprint-flatness readout (the
  rockPass probe, live instead of throwaway tests).
- Tee/pin/aiTarget drag; elevation control-point list editing (x,y,h,r,
  shape,skirt) with immediate heightfield rebuild.
- Overlays: playable corridor (exists), surface classes, slope/gradient.
- Camera presets: tee/approach/green/aerial/flyover (exist).
- Export deterministic JSON; import round-trip test in CI.

**Needs refactoring first (second increment):**
- Incremental rebuild (terrain-only / scatter-only / texture-only) — full
  rebuild + 2.5 s bake is too slow for sculpt-drag; split `buildCourse`.
- Fairway ribbon editing (drag centerline points + per-point width) and
  bunker blob editing (drag polygon verts, or blob(cx,cy,rx,ry,seed) knobs).
- Terrain "sculpting" = editing elevation splats with a brush that inserts/
  adjusts control points (the heightfield is splat-based; freeform vertex
  sculpting is out of scope and would break the schema).
- Shot-distance/dispersion overlays: run `PhysicsEngine.simulate` Monte-Carlo
  in a web worker (pure TS already — the vitest recipes port directly);
  effectiveCarryYards rings immediately, rest-cloud heatmap next.
- Collision toggles per hazard/prop; green drawing (ellipse handles).

**Later phases:** neighboring-hole placement on the property plan (after
Phase 3), theme preview switcher, thumbnail cache, in-browser gate runner
(port key terrainPass/rockPass checks to shared functions so the builder
flags violations live — the tests import the same functions), draft
save/load to `adminDrafts` for cross-device work (git remains the source of
truth), character/animal preview placement.

**Major risks:** (1) ownership conflict with `gen-new-courses.mjs` — builder
edits to generated courses are overwritten; the generator must be retired
per-course once the builder becomes author of record (owner decision). (2)
Bake/rebuild latency shaping the UX — mitigated by incremental rebuild. (3)
Hand-authored geometry failing the gate wall — mitigated by the in-browser
gate runner. (4) Scope creep — the module list above is deliberately
sequenced; MVP ships without any geometry editing.

## 6. Owner decisions (resolved 2026-07-20)

1. **Doc authority: adopt the proposed precedence.** Vision docs → this
   folder's three docs (environment principles, identity Bible, global
   design skill) → `10_COURSE_DESIGN_BIBLE.md` (hole craft) → technical
   implementation records.
2. **Naming: keep current display names** — Port Johnson Links and Red
   Hollow (ids unchanged; the Bible's "Port Links"/"Red Desert" are theme
   descriptions, not display names). Wild Prairie confirmed.
3. **Wildwood Glen: keeps the flowering-parkland identity** as drafted.
4. **Restoration intent:** Wild Prairie **stays treeless** — restore fescue
   density/coverage, not trees. Red Hollow keeps bare red rough — restore
   **sparse wash scrub only** (dead scrub/dry grasses along washes and rock
   clusters).
5. **Base courses: build a per-environment course-variant mechanism first.**
   No base-course JSON/theme changes ship until dev-only variants exist;
   Phases 4–5 for the four base courses are blocked on that mechanism.
6. **Port Johnson: full Scottish turn** (overcast palette, rain/drizzle
   treatment, heather-dominant rough) — scoped as a real re-theme, executed
   only after decision 5's variant mechanism exists.
7. **`boundedWorld` promotion: after the course rework** (Phases 2–5
   validated on device + owner screenshot approval).
8. **Hole Builder becomes author of record** per course once it round-trips
   the JSON; `gen-new-courses.mjs` retires per course at that point. Builder
   page stays dev-only via build exclusion.
9. **Property plans: pilot Wild Prairie only**, then roll out per course.

## 7. Assumptions

- version2 remains the trunk; all work lands there behind dev flags; no
  force-pushes; production stays byte-identical until flags are promoted.
- "Development courses" = all six as seen in dev; geometry freedom only on
  redhollow/wildvalley; base courses need decision #5 before geometry moves.
- The ~20 yd corridor margin and the derived-boundary design are accepted;
  we tune inputs/exclusions rather than replace the system.
- 3-hole courses remain the format; property plans arrange 3 holes (+ future
  expansion room), not 18.
- Perf floors stay: 60 fps target / 30 floor, existing soak bands, Wild
  Prairie's ~25k instances is the ceiling, not a target to exceed.
- The Hole Builder is an internal tool for the admin/owner; no player-facing
  UGC in this roadmap.

## 8. Files likely to change

- **Phase 2:** `src/systems/PlayableBoundary.ts`, `src/core/types.ts`
  (`recoveryZones`, later `property`), `src/slice3d/course3d.ts` (scatter
  exclusions, tallGrass clip, mesh clamp, edge kits), `src/systems/
  treeField.ts` (in-corridor floors), `src/data/courses/*.json` +
  `scripts/gen-new-courses.mjs` (recovery zones, vocabulary restorations),
  `tests/unit/boundary.test.ts`, new `tests/visual/edges.spec.ts`,
  `tests/visual/__shots__/*baseline*.json`.
- **Phase 3:** `src/data/courses/*.json` (`property` block),
  `src/data/courseLoader.ts`, `src/slice3d/course3d.ts` (impostor tiles),
  `src/core/flags.ts` (`courseProperty`), soak/perf baselines.
- **Phase 4–5:** per-course JSON/generator + `tests/unit/terrainPass.test.ts`
  / `rockPass.test.ts` re-baselines, `docs/dev-environment-roadmap/*.
- **Phase 6:** new `holebuilder.html`, `src/holebuilder/*`, `scripts/
  gen-asset-manifest.mjs`; refactor seams in `src/slice3d/course3d.ts`
  (incremental rebuild) and shared gate functions under `src/systems/`.
- **Docs:** `docs/README.md` (register this folder), status banners on
  `10_COURSE_DESIGN_BIBLE.md` / `technical/BOUNDED_PLAYABLE_WORLD.md` /
  field guide after decision #1.
