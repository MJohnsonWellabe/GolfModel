# Johnson's Golf
## Architecture Review — Phase 1A Deliverable

Status: current as of the Phase 1A foundation work on `version2`.
This document fulfils the Phase 1A deliverables in `05_DEVELOPMENT_ROADMAP.md`:
a full review of the codebase, its systems, its debt, and the recommendations
that feed Phase 1B and beyond.

---

# Update — 2026-07-08: Phase 9 — two new courses + tree collision

- **Tree collision** now stops a ball descending into a canopy inside a tree
  polygon: vertical carry killed, horizontal speed cut to a small capped
  fraction of impact (`PHYSICS.treeDamp`/`treeKillSpeed`). Kept descending-only
  so high shots still clear edge treelines and Wildwood's Appendix A balance is
  unchanged. `tests/simulation/trees.test.ts` proves a drive into a fairway
  tree finishes well short of the same shot on open ground.
- **Two new courses**, authored in schema v2 (`src/data/courses/`):
  **Sable Bay** (sea backdrop, water in play on all three holes, an island-green
  par 3 — the green ellipse reads as land before water in `surfaceAt`, giving a
  natural island with a fringe collar) and **Timberline** (forest, tight
  tree-lined corridors, a tree stand in the middle of the fairway on Pine Alley).
  Both registered in `COURSES`; a new **Course** wizard step (`COURSE_LIST`,
  `renderCourse`) picks among the three, and tournaments resolve their course by
  name (`courseIdByName`). The shot harness gained a `?course=` param.
  `tests/simulation/newCourses.test.ts` simulates 120 rounds on each to assert
  every hole holes out and scores land in a sane band; Playwright boots all
  three courses crash-free.

# Update — 2026-07-08: Phase 8 — async tournaments + ace challenge

Two online modes over the same open-rules RTDB as the leaderboard, no server
(`src/firebase/Tournaments.ts`, REST mirroring `History.ts`):

- **Async tournaments.** A creator PUTs `/tournaments/{code}` with a shared
  RNG **seed**; `windForHole` seeds off it (`mulberry32(seed*1000 + idx)`) so
  every entrant plays identical wind. The shareable code is `JG-XXXXXX` from an
  unambiguous alphabet; a `?t=CODE` link boots straight into the join screen.
  Rounds run solo under the tournament seed and submit one entry at the summary
  (`submitEntry`, first-write-wins), then render live standings (lowest total,
  earliest-submission tiebreak). Entries are sanity-checked client-side
  (`isPlausibleEntry`). Honest anti-tamper caveat: open rules make results
  friends-only until the Phase 5 auth rules land (documented in the file
  header + `docs/FIREBASE_SETUP.md`).
- **Ace challenge.** A new menu mode tees off Wildwood's par 3 on repeat; a
  `HoleScene` `onFirstShot` hook ends each attempt the instant the tee shot
  settles and reports whether it holed. Aces bump `stats.holeInOnes` and post
  to an all-time `/aces` board (`submitAces`/`fetchAces`, most aces first).

The UI degrades honestly when no RTDB is configured (an offline notice rather
than an error). 5 tournament unit tests + Playwright overlay/create/ace-boot
smokes. `RoundState` gained `seed?` + `tournament?` context.

# Update — 2026-07-08: Phase 7 — store & customization (gold only)

`src/data/storeCatalog.ts` + `src/systems/StoreEngine.ts` (pure buy/equip,
coins never negative, tier-ordered club upgrades). 28 purchasable items using
only owned assets: 6 unlockable characters (the existing rigged roster — four
are free, the rest cost coins), 8 procedural ball tints, 5 trail tints, and 8
club-upgrade tiers (+3/+6 per family via `applyClubUpgrades` in
`assembleGolfer`, capped at 100 — the only sanctioned gameplay effect). The
wizard shows only owned characters; the equipped ball/trail tints render in
game; the store overlay is reachable from the menu. Profiles carry the
cosmetics + upgrades and cloud-sync. 8 store tests.

# Update — 2026-07-08: Phase 6 — progression

XP, coins, levels, achievements, career stats and daily challenges, all from
`docs/08`. `src/data/progression.ts` holds the config tables (reward values,
quadratic level curve, 8 achievements, 7 daily challenges) and
`src/systems/ProgressionEngine.ts` is the pure `applyRound(profile, stats)` —
never imported by physics or the AI (XP must not affect gameplay). The live
game accumulates the human's shot stats during play (`accumulateShotStats`),
derives the score-based stats at the summary, and shows an XP/coins/level/
achievement reward strip; a profile overlay renders the level ring + career
stats + achievements, and the menu shows today's daily challenge and streak.
Progression persists in `PlayerProfile` and cloud-syncs (Phase 5). 10 tests.

# Update — 2026-07-08: Playtest feedback pass (FB1–FB8)

Matt's hands-on feedback, applied on top of Phases 0–5:
- **Shot shaping = SHAPE, not spin.** The strike dot is now a deterministic
  pre-shot draw/fade + launch height (`StrikeControl`); the LOW/NORM/HIGH
  toggle is gone. The aim dots curve to show the shape and run on a flat,
  windless preview engine, so the aim line never reveals wind or slope — you
  estimate hold-off. In-flight swipe is the (now uncapped) spin. Flight
  playback slowed ~2× so the swipe window is usable.
- **Putting** shifts difficulty off RNG onto slope/pace: the meter no longer
  auto-compensates slope (flat preview engine), a Tiger-style readout floats
  at the aim point (distance + up/down elevation in ft/in), tap-ins get a
  short-range gimme, fringe rolls ~2× (not 2.8×) green friction, lip-outs are
  rarer, and the ball crawls + the camera zooms as it nears the cup. Appendix
  A make-rate tests still pass.
- **Cameras:** aerial always frames the whole ball→green corridor (height
  scales with span, no cap); the intro flyover is a clean tee→green glide.
- **Feedback:** post-shot popup (drive carry / distance-to-hole), flaming
  meter bar while on fire, screen shake + slow-mo as a hole-out/ace nears the
  cup, and per-hole character reactions keyed to the hole score (happy at
  par-or-better, sad worse).
- **Difficulty:** the meter's perfect zone shrinks on bad lies and with
  longer clubs (except off the tee).
- **Setup UX:** the wizard's step body scrolls internally so the Next/Tee-off
  button is always visible.

---

# Update — 2026-07-08 (later): Graphics Stage 0 + Stage A — course readability overhaul

The course-presentation redo planned in `11_ROADMAP_CHECKIN_2026-07-08.md`
landed its first two stages (this supersedes the "flat painted course" parts
of everything below):

- **Screenshot harness (Stage 0):** `?hole=N&cam=tee|aerial|approach|green&freeze=1`
  debug boot + Playwright contact sheet (`npm run shots` → 3 holes × 4 cams
  into `tests/visual/__shots__/`), judged against `docs/visual-bar.md`.
- **Course schema v2 (`src/data/courseLoader.ts`):** fairways are authored as
  centerline+width ribbons and compiled at load (Catmull-Rom → normal offset)
  into the same runtime polygons physics/bake always used. v1 polygons still
  load. All three Wildwood holes re-authored per `10_COURSE_DESIGN_BIBLE.md`
  (H1 welcoming dogleg, H2 water-carry par 3, H3 double-bend par 5 with a
  reach-in-two water line).
- **Built geometry, not paint:** raised green-complex mesh with fringe skirt
  and a 6× high-res texture patch (`renderGreenPatch`); tee platform with
  markers; bunker lip tubes. `Course3D.groundHeightAt(x,y)` is the cosmetic
  height seam ball/golfer/aim visuals sit on — Stage B swaps a real
  heightfield in behind it. Physics still flat and untouched.
- **Palette split by hue** (olive rough / emerald fairway / own-color fringe /
  light green), fringe widened to 32px so it survives mipping; flag scales
  with camera distance (min screen size); pulsing green target ring in aim
  views.
- **Bug found by the harness:** the baked albedo uploaded to the ground was
  vertically FLIPPED — invisible on the old symmetric rectangles, glaring on
  organic holes. Fixed at the DynamicTexture upload.
- **Grass F pack integrated** (asset-packs/grass-f, converted with npm
  `fbx2gltf` — no Blender in this container): four unlit crossed-card tufts
  drive fairway/rough scatter; flowers unlit; blocky nature-pack grass slabs
  retired from scatter.

**Stage B (elevation) also landed:** `src/systems/HeightField.ts` compiles
authored per-hole `elevation` control points (domes/plateaus) into a sampled
grid; `PhysicsEngine` optionally takes it — terrain-aware landing, gradient
rollout everywhere, `slopeAccelAlong` putt pacing — with the null path
bit-identical to the flat engine (regression-gated by the original tests).
Ground mesh, green complex, tee platform, putt grid (now conforming),
cameras and placement all sample the same field. All three holes authored
with elevation (elevated H2 tee, H3 downhill drive + two-tier green).

**Stage C (materials) also landed:** depth-tinted vertex-color water with
scrolling procedural normal wavelets and shore fade; tiling turf-grain
normal maps on ground and green (subtler on the mown green); baked contact
AO seams around bunkers/ponds; raked sand ripples.

The graphics track (Stages 0–C) from the check-in doc is complete; further
course-visual work belongs to Phase 9 polish.

**Phase 2 (balance) landed:** seedable RNG + `RoundSimulator` headless round
player; the GDD Appendix A putting/dispersion tables are hit exactly (30
seeded Monte-Carlo tests in `tests/simulation/`); scoring tiers are
monotonic (+1.3/+0.5/−0.3/−0.8) with documented deviations where the GDD's
tables over-constrain each other (see the Appendix A calibration note in
`02_GAME_DESIGN_DOCUMENT.md`). Wind now scales with flight altitude; the
rolling integrator's systematic 1px putt shortfall was found and fixed.

**Phase 3 (identity + multiplayer) landed:** the formerly-unreachable
competitive layer is live — the wizard gained Mode and Rival/Partner steps
(solo / 1v1 / true scramble via `TurnManager`, replacing the inline turn
logic), the fire system now applies to the player (stat boost, wider
perfect band, orange trail, ON FIRE banner), and four AI opponents with
distinct personalities (`data/opponents.ts`: aggression/layup/pin-hunting
drive different lines through the same holes) at GDD difficulty tiers.
Eagles trigger the pack's Song Jump celebration. `opponents.ts`,
`TurnManager` and the `Scoring`-adjacent tests all guard live code now.

**Phase 4 (spin & shotmaking) landed:** `PhysicsEngine.simulate` split into
`resolveLaunch` (all randomness) + `integrateLaunch` (deterministic,
spin-aware, resumable from any step) — regression-neutral by construction.
`SpinState` (side/top) with per-club-family effectiveness and lie retention
(GDD tables); side spin curves flight, topspin runs out, backspin bites and
sucks back on greens; trajectory presets tilt the launch and ride the
altitude-scaled wind for free. Player input: a strike-position pad + LOW/
NORM/HIGH toggle pre-shot (`core/input/StrikeControl.ts`, edge strikes add
dispersion risk) and a mid-flight swipe that re-shapes the SAME resolved
launch from the current step (identical flown prefix, spliced tail).
Pin-hunting AIs rip wedges back. 10 new spin tests.

# Update — 2026-07-08: identity rework + purchased assets integrated

A ground-up front-end rework landed on top of the foundation below. The parts
of this document that describe the old roster, the two original courses, and
the 2D game are superseded by the following; the engine-agnostic core
(`PhysicsEngine`, `AimControl`, `AIController`, `FireSystem`, `Scoring`,
`Theme`, `CourseTexture`) is unchanged.

- **Golfer identity is now assembled, not hardcoded** (advances roadmap
  Phase 3). A runtime golfer = a typed **name** + a cosmetic **character**
  avatar (`src/data/characters.ts`) + a gameplay **archetype**
  (`src/data/archetypes.ts`), combined by `assembleGolfer()` in
  `src/data/golfers.ts`. `Golfer.stats` stays the sole seam physics reads, so
  no gameplay code branches on the choice. Five archetypes (Big Hitter,
  Sniper, Iron Maiden, Short-Game Maestro, Putt King), each elite in one stat
  and ~87 OVR, hit the Appendix-A 250→320yd power spread. Covered by
  `tests/archetypes.test.ts`.
- **Purchased asset packs are integrated** (previously stored inert in
  `asset-packs/`). Ten rigged chibi characters (Cute Characters 4) load per
  golfer via `src/slice3d/characterModels.ts` (Idle stance, Win/Sad
  reactions; swing driven by a club rig in the golfer frame). Nature-pack
  props (trees/stones/plants) load via `src/slice3d/natureModels.ts` and
  replace the procedural trees in `src/slice3d/course3d.ts`. Offline FBX→glb
  conversion uses headless Blender; recoloring is by material slot since the
  nature pack ships no textures.
- **New menu**: a 3-step name → character → archetype wizard (`index.html` +
  `src/slice3d/main.ts`), solo-only for now.
- **New course** `src/data/courses/wildwood.json` (Wildwood Glen, parkland
  theme); the original Amen Corner + Legends courses were removed.
- **The 2D "classic" front end was retired**: `classic.html`, `src/main.ts`,
  `src/scenes/*`, `src/ui/*`, the Phaser-only rendering/audio/meter modules and
  the `phaser` dependency are gone. The Babylon 3D game is the sole build entry.
- **Still deferred**: additional holes/courses, re-surfacing 1v1/scramble with
  archetype+character AI opponents, and Phase 4 spin/strike-location.

---

# Snapshot

| | |
| --- | --- |
| Stack | TypeScript, Phaser 3 (~3.80), Vite 5, vitest |
| Size | ~5,000 lines of TS + two course JSONs |
| Platforms | Mobile + desktop browsers (720×1280 canvas, `Phaser.Scale.FIT`) |
| Backend | Firebase Realtime Database over plain REST (shared leaderboard only) |
| Deploy | GitHub Actions → GitHub Pages (`.github/workflows/deploy.yml`, build in `dist/`) |
| Tests | vitest unit tests over the pure gameplay logic (`tests/`) |
| Audio | Synthesized WAVs, regenerable via `node scripts/generate-sfx.mjs` |

---

# Project structure

```
src/
  config.ts            All gameplay/graphics tuning constants (data-driven)
  main.ts              Phaser bootstrap + scene list
  core/
    types.ts           Shared type definitions (golfers, holes, shots, wind)
    GameState.ts       Cross-scene state singleton (selection, scoring, fire, wind)
    input/AimControl.ts    Club selection, aim state, drag input, shot preview,
                           putt meter scaling math
    rendering/
      Projection.ts        Ground-plane ("mode-7") perspective projection
      PerspectiveView.ts   Behind-the-player shot view (sky, ground, trees,
                           buildings, green grid, golfer, flag, balls, trails,
                           particles) with adaptive ground-repaint pacing
      CameraDirector.ts    Cinematic camera: eased setup framing, flight
                           chase cam, landing cam
      OverheadCourse.ts    Top-down course drawing (also the physics world)
      Theme.ts             Per-course palette/sun/haze (JSON `theme` block)
    audio/Sfx.ts       SFX playback, per-club impact mapping, ambience loop
  systems/
    PhysicsEngine.ts   Shot simulation: flight, wind, bounce, roll, hazards, cup
    SwingMeter.ts      3-click swing meter UI + band math
    TurnManager.ts     Turn order, stroke-cap pickups, scramble best-ball rules
    FireSystem.ts      "Catch fire" streak (2 all-perfect swings)
    AIController.ts    AI target/club selection, wind compensation, swing rolls
    Scoring.ts         Strokes per hole/player, to-par math, score names
  firebase/History.ts  Round history: localStorage + Firebase RTDB REST merge
  ui/
    Ui.ts              Buttons, titles, vector golfer avatars, shirt motifs
    GameHud.ts         In-round HUD, feedback pop-ins, banners, hole-complete
  scenes/              Title, GolferSelect, ModeSelect, CourseSelect, Game,
                       Results, Records — GameScene is a thin orchestrator
  data/                Golfers, AI opponents, clubs, course JSONs
tests/                 vitest unit tests (geometry, physics, scoring, turns,
                       fire, leaderboard ranking)
```

---

# How a shot works (gameplay pipeline)

1. **Turn selection** — `TurnManager.nextPlayer` picks the farthest ball
   (24px hysteresis); scramble mode instead cycles both teammates from the
   shared team ball and keeps the better result (`resolveScramble`).
2. **Setup** — `AimControl.autoSelectClub` + `resetAim` default the club and
   aim at the pin; the player drags to adjust (shot view: rotate/distance;
   overhead: aim follows the finger). Every aim change re-simulates a perfect
   shot (`computePreview`) for the dotted preview arc.
3. **Input** — `SwingMeter`: tap 1 starts the sweep, tap 2 locks power against
   a *moving* target line (the power needed to carry to the aim point), tap 3
   locks accuracy on the return sweep. Perfect power snaps carry exactly to
   the aim point; perfect accuracy zeroes the offset. Band widths scale with
   the golfer's governing stat and the fire multiplier.
4. **Simulation** — `PhysicsEngine.simulate`: ballistic flight integrated at
   60Hz with wind acceleration; tree/building canopy knockdowns; per-surface
   bounce and friction; green slope pushes rolling balls downhill; cup capture
   requires low speed (fast putts lip out); water triggers a penalty and a
   walk-back drop point.
5. **Presentation** — the same top-down world is rendered two ways:
   `OverheadCourse` (planning) and `PerspectiveView` (play). The scene
   animates the ball along `outcome.path`, `GameHud` shows feedback, and
   `TurnManager`/`Scoring` advance the round.

Putting note: the meter bar is rescaled so a full stroke rolls exactly to the
*aim spot*; the power target line is slope-aware
(`AimControl.barPowerTarget`). This is the subtlest math in the game — it has
a dedicated seam and should be preserved through Phase 2 rebalancing.

---

# Rendering pipeline

There is no 3D engine. `Projection` implements a ground-plane perspective
("mode-7") transform: world stays the 2D top-down space the physics runs in;
`PerspectiveView` projects polygons (with near-plane clipping), billboards
trees by depth, extrudes building footprints into boxes, and draws the
putting grid + break chevrons through the same projection. Everything is
procedural `Phaser.GameObjects.Graphics` — zero texture assets.

Phase 1B additions:

- **CameraDirector** animates `PerspCamera` per frame: eased setup framing
  between turns, a chase cam trailing the airborne ball (rising with its
  height), and a landing cam that watches the rollout. Putts keep the fixed
  intimate framing.
- **Adaptive ground repaint** (`PerspectiveView.applyCamera`): the projection
  updates every frame (balls/overlays never lag) while the ground repaints as
  often as its measured cost allows — every frame on GPUs, paced on weak
  software renderers. This is the key mobile-performance safety valve.
- **Theme system** (`core/rendering/Theme.ts`): course JSON may carry a
  `theme` block ("#rrggbb" strings) overriding the Augusta default — sky,
  sun position, turf/water/sand/tree palette, haze. Legends Links uses a
  cool links theme. One sun direction per course drives every shadow.
- **Living world**: drifting cloud layer, water glints, world-anchored mow
  stripes and grass flecks, tree species variety, detailed buildings,
  posed swing animation, and world-space debris particles.
- **Audio pipeline**: `scripts/generate-sfx.mjs` synthesizes all WAVs
  deterministically (the project owns its audio); `Sfx.ts` maps clubs to
  impact sounds and loops the ambience. Swap files in `assets/sfx/` to
  re-skin audio without code changes.
- `main.ts` exposes `window.__johnsonsGolf` for the Playwright verification
  scripts (state-driven drives that play real swings).

Graphics 2.0 (post-1B, after playtest feedback):

- **Baked course textures** (`core/rendering/CourseTexture.ts`): each hole
  bakes to a canvas texture at load — per-texel surface classification with
  grain noise, soft mow stripes along the hole axis, dithered organic edges,
  water ripple banding, and sun-consistent baked tree/building shadows.
- **Mesh ground** (`core/rendering/GroundMesh.ts`): the perspective ground is
  a frustum-shaped ortho Mesh whose vertices are placed by the game's own
  `Projection` every frame — textured terrain that never lags the camera and
  stays perfectly aligned with billboards/balls. The AERIAL view reuses the
  same texture as a course map.
- **Horizon scenery**: per-theme parallax backdrop layers (mountain ridges +
  snow-capped peak, or sea horizon + dunes) plus blossom trees via the
  theme's `blossomChance`.
- **Character 2.0**: outlined, cel-shaded chibi golfer (pose-driven swing
  retained), shaded club and glinting ball.
- **Shot pacing** (`FLIGHT` in config): flight plays at half speed, easing to
  ~0.28x while dropping onto a green — the input window for Phase 4 spin.

---

# Firebase usage (today)

One feature: the shared family leaderboard. `firebase/History.ts` PUTs each
finished round to `<LEADERBOARD_URL>/rounds/<id>.json` and GETs
`/rounds.json`, merging with a localStorage copy (cap 300) so offline play
still counts on-device. There is **no** Firebase SDK, no auth, no Firestore.
The database URL lives in `config.ts` (`LEADERBOARD_URL`); rules allow public
read + validated writes.

For Phase 5 (accounts) this will be replaced by the real Firebase SDK (Auth +
Firestore) — the REST leaderboard should keep working for guests throughout,
per `08_LIVE_SERVICE_AND_PROGRESSION.md` (guest mode is sacred).

---

# Strengths worth protecting

- **Course-as-data**: holes are pure JSON (polygons, hazards, pin, slope, AI
  layup targets). Adding a course requires no engine code — exactly what
  `04_TECHNICAL_ARCHITECTURE.md` calls for.
- **Data-driven tuning**: every gameplay constant lives in `config.ts`.
- **Physics/rendering separation**: `PhysicsEngine` never touches Phaser;
  rendering never affects outcomes. Deterministic given inputs (all
  randomness sampled before/outside the integrator except lie noise).
- **One physics path**: AI swings feed through the exact same engine as
  player swings (`AIController` produces a `SwingResult`).
- **Graceful offline**: leaderboard failures fall back silently to local.
- **Vector look system**: `GolferLook` (hats, hair, dresses, motifs, child
  proportions) is data — a natural foundation for Phase 7 cosmetics.

---

# Technical debt and limitations

1. **Uniform green slope** — one `{angle, strength}` per hole. Real green
   reading (Phase 2, per the GDD) needs contours/zones; the course schema and
   `PhysicsEngine` roll phase are where that lands.
2. **Single pin position** per hole; no pin sets (Course Design Bible wants
   easy/medium/hard/tournament placements).
3. **Wind ignores trajectory** — flight height doesn't modulate wind effect
   (GDD: low shots should cut through wind). One-line-ish change in the
   airborne integration, but it's a Phase 2 balance decision.
4. **No spin/strike-location systems yet** (Phase 4); `ClubSpec.spin` only
   dampens landing bounce.
5. **Silent SFX stubs** and no music — audio is a Phase 1B deliverable.
6. **`scene.restart()` between holes** rebuilds everything; fine at this
   scale, worth watching as art gets heavier.
7. **Phaser bundle ~1.5MB minified** (364KB gzip) — inside the 5s load
   target, but code-splitting or trimming is worth revisiting in Phase 9.
8. **AI is heuristic-only** — no personalities (aggressive/conservative) yet;
   `aiTargets` waypoints in course JSON are the hook for Phase 3.

---

# Balance gaps vs. `02_GAME_DESIGN_DOCUMENT.md` Appendix A (Phase 2 targets)

- **Power spread far too narrow**: `statMult = 0.9 + stat/100 × 0.2` gives a
  ~284→297yd driver spread across the roster; Appendix A wants 245→320.
  The fix is a steeper stat curve in `effectiveCarryYards` + per-golfer
  retuning (Phase 3 works with Phase 2 here).
- **"Good" band very forgiving**: ±11% of the bar (`SWING.goodBand`) vs. a
  perfect band of ~2.2% half-width. Dispersion targets in Appendix A imply a
  tighter good band and harsher miss consequences.
- **Putting too easy**: flat single-slope greens + generous cup capture
  (2.5yd radius). Appendix A's make-rate table (e.g. 68% from 10ft on a
  perfect read) is the tuning target.
- **Kid golfers out-rate the AI legends** (two 100-stats); doc target is
  adults ≈87 OVR, kids ≈88 with distinct shapes (Phase 3).

---

# Testing

`npm test` (vitest) covers the pure logic: geometry, scoring, fire streak
rules, physics surface priority (island greens), straight-carry accuracy,
water drops, cup capture/lip-outs, turn order + pickups, scramble best-ball
resolution, and leaderboard ranking. CI runs tests before every deploy.
Playwright drive scripts (session tooling) click through all three modes for
manual-equivalent smoke testing; consider committing a proper e2e harness
when UI churn slows down after Phase 1B.

---

# Recommendations feeding Phase 1B

1. **Camera first**: implement flight-follow/landing cameras by animating
   `PerspCamera` — biggest premium-feel win, and Phase 4's swipe-spin
   depends on the flight camera existing.
2. **Layered ground rendering**: introduce texture/noise detail behind a
   cached layer strategy before piling on per-frame drawing.
3. **Real audio**: replace silent stubs (distinct club impacts, ambience,
   hole-out) — `Sfx.ts` already isolates playback.
4. **Swing animation**: the procedural golfer in `PerspectiveView.drawGolfer`
   is a placeholder-quality figure; give it weight transfer + follow-through
   (event-driven, per `04_TECHNICAL_ARCHITECTURE.md`).
5. Keep every visual upgrade behind the existing seams: `PerspectiveView`
   internals may change freely; `Projection`'s interface and the course JSON
   schema should stay stable until Phase 2 extends them deliberately.

---

# 3D evaluation slice (decision gate)

`slice3d.html` (`src/slice3d/`) is a **Babylon.js vertical slice** built to
judge a true-3D presentation path: one hole (Amen Corner 11 — White Dogwood)
and one character (Zac), playable end-to-end on the live deploy at
`/slice3d.html`. It is an evaluation artifact, not shipped game UI — nothing
links to it from the 2D game.

The slice reuses the engine-agnostic core unchanged: `PhysicsEngine`,
`AimControl`, `FLIGHT` pacing, the course JSON, `Theme`, and the course
texture bake (`renderCourseCanvas`, extracted from the Phaser wrapper with
behavior identical for the 2D game). Terrain elevation is cosmetic-only and
confined to unplayable areas so the flat 2D physics always matches the
visible ground; backdrop tree bands are scenery-only and never placed on a
playable surface.

**Decision**: if the 3D look is approved, plan a scene-by-scene Babylon port
(game stays playable throughout); otherwise delete `src/slice3d/` +
`slice3d.html` and continue the 2D presentation track. Either way the
gameplay core is unaffected.

---

# 3D game promoted to primary (decision resolved)

The Babylon.js evaluation slice was approved and iterated into a full game,
then promoted to the primary experience:

- **`/` (index.html)** now serves the 3D game (`src/slice3d/`): a setup menu
  (course / mode / golfer), full solo and 1v1-vs-AI rounds over
  `RULES.holesPerRound` holes, EG-style hole intros, a broadcast scorecard,
  per-hole wind, an approach descent camera, a putting read grid with
  slope-driven break flow, and both courses (Amen Corner parkland, Legends
  Links with a sea backdrop).
- **`/classic.html`** keeps the original 2D Phaser game playable.
- **`/slice3d.html`** is now a redirect to `/` so the evaluation-era bookmark
  still works.

Architecture unchanged where it matters: both front-ends consume the same
engine-agnostic core (`PhysicsEngine`, `AimControl`, `AIController`,
`FireSystem`, `Scoring`, course JSON, `Theme`, `CourseTexture`). The 3D
front-end (`src/slice3d/`) is structured as a `HoleScene` per hole (own
Babylon scene, disposed between holes) orchestrated by a round controller in
`main.ts`. `04_TECHNICAL_ARCHITECTURE.md` documents the shared core; the 3D
front-end is an additive presentation layer over it.

Still open (tracked for later phases): scramble mode in 3D, a modeled glTF
character to reach full Hot Shots fidelity (the `@babylonjs/loaders` seam is
the intended path), and Phase 2 gameplay balance.

---

# First modeled glTF character (Zac, Matt)

The `@babylonjs/loaders` seam mentioned above is now used for real. Matt
supplied a downloaded chibi character pack (`assets/models/chibi_characters.glb`,
14MB, Blender → glTF). Inspection of the file found 5 candidate bodies but
only 2 fully assembled (body + face + hair + outfit all sharing one baked
transform): a **Knight** and a **Ninja** — the other 3 have hair/clothing
baked at mismatched positions (the export lost its rig) and aren't safely
reassemblable without the source `.blend` file.

- `src/slice3d/characterModels.ts` loads the pack **once** per session
  (`LoadAssetContainerAsync`, cached), then `cloneCharacterBody()` clones just
  the named nodes for a given body, recenters them (feet at y=0, X/Z
  centered) via `getHierarchyBoundingVectors`, and scales to the game's
  existing stylized character height.
- `Golfer.model3d?: 'knight' | 'ninja'` (in `core/types.ts`, engine-agnostic
  — the 2D game never reads it) opts a golfer into a model body. Set on
  **Zac → knight** and **Matt → ninja** in `data/golfers.ts`; every other
  golfer is untouched.
- `Golfer3D` branches in its constructor: model-backed golfers skip the
  procedural head/torso/leg primitives and parent the cloned body under the
  existing `torso` pivot instead. **Known limitation**: the pack has no
  skeleton/animations, so there's no per-limb swing articulation — the torso
  pivot's Y-rotation (already used for the procedural weight-transfer turn)
  is amplified for model-backed golfers into a whole-rigid-body twist, while
  the fully-procedural club/hand rig (unaffected, not part of the pack)
  keeps swinging normally underneath. The model's own baked arm pose stays
  wherever the source mesh was posed (not gripping the club).

Verified: both bodies render correctly (textures, shadows, grounded) and
play a full hole with zero page errors; an untouched procedural golfer
(Jeff) regression-checked unchanged.
