# Johnson's Golf
## Architecture Review — Phase 1A Deliverable

Status: current as of the Phase 1A foundation work on `version2`.
This document fulfils the Phase 1A deliverables in `05_DEVELOPMENT_ROADMAP.md`:
a full review of the codebase, its systems, its debt, and the recommendations
that feed Phase 1B and beyond.

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
