# Johnson's Golf
## Architecture Review — Phase 1A Deliverable

Status: current as of the Phase 1A foundation work on `version2`.
This document fulfils the Phase 1A deliverables in `05_DEVELOPMENT_ROADMAP.md`:
a full review of the codebase, its systems, its debt, and the recommendations
that feed Phase 1B and beyond.

---

# Update — 2026-07-10 (latest+10): playtest batch 2 — spin/bunker physics, bunker outlines, Timberline holes 2/3

- **Spin acts on the ground, not the air.** Side spin no longer curves the ball
  mid-flight (`PhysicsEngine.integrateLaunch` in-air side block removed); a
  fade/draw flies straight and breaks sideways only when it bites the
  green/fringe (`sideSpinKick` landing kick beside the backspin check).
- **Bunkers plug dead.** A ball landing in sand stops where it lands; one
  rolling in from outside stops the instant it reaches sand (checked before
  slope accel). Bunker visuals stripped to plain sand: removed the baked dark
  AO ring (bunkers only; ponds keep it) and the raised tube-lip geometry.
- **Timberline holes 2 & 3 re-cut for tight corridors.** Flanking woods pulled
  to ~6yd off the fairway via a centerline-offset generator
  (`scratchpad/genhole`/`buildh3`), so both holes read as tree-lined. Hole 3
  redesigned: green relocated up-right to extend leg 2 (now a genuine long
  approach after the dogleg; ~542yd total), a generous corner landing bowl, a
  tighter front crescent bunker (no longer a full ring — fixes the "odd green
  from aerial"), a fairway tree in each leg with a playable gap, and the inside
  of the dogleg SET BACK (you cut over it; hugging it made the corner
  unnavigable). Outside lines stay tight, inside opens — tuned with a 120×3
  Monte-Carlo shot tracer so every hole still holes out within the stroke cap
  (playability gate green, mean still &lt; 6). Tree HITBOXES left unchanged per
  Matt ("they're good now").

# Update — 2026-07-10 (latest+9): playtest fixes — green rendering, hole builds ~3× faster, dogleg flyover, honest tree hitbox

- **The "odd green from aerial" was two real bugs, both fixed.** (1) The green
  complex's patch texture was VERTICALLY MIRRORED (a stale `1 - v` in its UVs)
  — invisible while greens were radially symmetric, glaring once greenside
  bunker sand landed in the patch: sand painted opposite its lip. (2) The
  plateau skirt used geometric normals, so its sun-facing side blew out into a
  bright cream ring circling every green and the skirt rings showed as facet
  bands; the complex now lights with straight-up normals like the flat ground
  it sits in (silhouette still 3D, colors continuous with the course).
- **Hole-build freeze cut ~3×** (the "lag between holes" / laggy first meter):
  the ground bake's classification pass no longer point-tests polygons per
  cell — `rasterizeClassGrid` paints surfaces with native canvas fills
  (precedence-ordered, per-layer alpha threshold so AA can't bleed class ids)
  and `renderGreenPatch` reuses it instead of per-texel `surfaceAt`. The edge
  wobble's four per-texel `Math.sin`s now bilinear-sample an 8px lattice.
  Hole 3: bake 7.8s → 3.2s, green patch 2.1s → 0.3s (Chromium, container).
- **Flyover follows the fairway**: intro waypoints are now the authored
  fairway ribbons' centroids (tee-nearest first) with the camera looking down
  each leg — hole 3's dogleg flies leg 1, turns, flies leg 2; single-ribbon
  holes keep the classic sweep and timings.
- **Tree hitbox honest at 1.0** (playtest ping-pong: 1.15 grabby → 0.85
  sailed through the woods → 1.0 canopy-shadow-as-hitbox). Recovery relief
  (`treeRecoveryMult`) unchanged; hole-3's corner-stand west lobe eased to
  keep the Monte-Carlo playability gate green at the tighter canopy.

# Update — 2026-07-10 (latest+8): Timberline props variety + layered sky

- **Two more berry bushes and six more cloud shapes** converted from the
  forest pack (`bush_currant`, `bush_raspberry`, `cloud_d`–`cloud_i`;
  deterministic pipeline — re-running convert:nature left every existing glb
  byte-identical). Berry-type bushes share the light foliage material.
- **Timberline theme** now mixes all six bushes, scatters `stone_a/b/c`
  through the rough (keyed low height so they read as rocks, not boulders),
  and runs all nine cloud shapes.
- **Sky**: new optional `theme.horizonTint` — an extra zenith stop plus a warm
  band low on the dome before the haze (default gradient untouched elsewhere).
  Mesh clouds scale with shape variety (up to 10), split across two
  altitude/depth bands with per-band drift speeds for cheap parallax.

# Update — 2026-07-10 (latest+7): real bunker sand + Timberline layout feedback

- **Bunker sand is a real ripple texture.** `scripts/convert-sand-texture.mjs`
  lifts the one stone-free window of the terrain pack's `Desert_stones.PNG`
  (the pack ships no plain sand map), high-passes it around mid-grey (kills the
  soft gradient that made naive tiling read as a kaleidoscope) and torus-blends
  the borders → seamless `assets/textures/sand_ripple.jpg`. New theme knobs
  `sandGrainKey`/`sandGrainTile` sample it through the existing
  `grassTexture.ts` preload/sampler in BOTH ground bakes (`renderCourseCanvas`
  + `renderGreenPatch`, world-coordinate math kept identical — the documented
  green-skirt seam trap); the coded rake sines remain the fallback and other
  courses are bit-identical. Sculpted courses also get a slimmer, sandDark
  bunker lip, and `bunkerStones` scatters a few stone props on the rough just
  outside each trap (never fringe/fairway/sand).
- **Screenshot harness now waits for grain decode** —
  `grainPreloadsSettled()` (grassTexture.ts) before `playHole()` in
  `startShotCapture`: direct `?hole=` boots used to bake before any texture
  decoded, so captures showed the procedural fallback players never see.
- **Timberline layout (playtest feedback):** hole-3's front bunker is now a
  full crescent hugging the green's shape across the entire approach face
  (generated from the green ellipse, 12..38 units out); a thinking-tree sits
  in EACH hole-3 fairway leg (placed off the AI's routing/descent lines);
  flanking woods pulled in hard on holes 2 and 3 (hole-2 inner edges ride the
  fringe buffer). Guardrail learned the hard way: the corner-stand west lobe +
  fairway trees can compound into punch-out grind-outs that blow the 8-stroke
  sim cap — the Monte-Carlo `newCourses` suite plus a per-seed shot tracer
  drove the final tree/AI-target positions (aiTarget 4 moved out of the new
  crescent; 120×3 rounds now always hole out).

# Update — 2026-07-10 (latest+6): Pals — companion pets (Foxy & Ember)

- **Pals ship as a new cosmetic kind.** Two uploaded pets (a chibi fox and a
  pink baby dragon) convert via `scripts/convert-pals.mjs` (GLB→GLB:
  dedup/weld/simplify/prune + 1024px jpeg textureCompress + quantize; the
  200k-tri dragon decimates to 26k, normal maps dropped) into
  `assets/models/pals/*.glb` — 309KB + 840KB from 14.3MB raw. Raw sources are
  committed under `asset-packs/pals/`; `palview.html` is a dev-only stage for
  eyeballing future conversions.
- **Plumbing reuses the cosmetics rails end-to-end**: `'pal'` added to
  `StoreKind`/`EQUIPPABLE_KINDS`/`CosmeticKind`, `pal_fox`/`pal_dragon` are
  price-0 default-owned catalog items (nothing equipped by default), so
  StoreEngine buy/equip, profile migrate/merge, and cloud sync all work
  unchanged. `src/data/pals.ts` mirrors `characters.ts`.
- **`Pal3D` (`src/slice3d/pal3d.ts`)** loads with the standard
  timeout+retry+cache pattern and normalizes like `characterModels`; motion is
  fully procedural (models ship no clips): exponential 2D chase toward a perch
  5.5 units off the ball on the golfer's far side, faces travel then the ball,
  soft bob on a child pivot. Human player only (participant 0), deliberately
  excluded from `bodiesReady`, and a failed fetch just means no pal — it can
  never block a shot. Retargeted from `beginTurn` + the aim-drag re-address;
  mirrors the putting-view `setSizeMult` shrink.
- **UI**: 🐾 Pals menu overlay (pick No Pal / Foxy / Ember, persists via the
  store sync path) + an empty priced-pals "coming soon" store section ready
  for future catalog entries.

# Update — 2026-07-10 (latest+5): load hardening, Pine Alley dense woods, grid-locked dots

- **Model loading is fault-tolerant and ~half the size.** A playtest "nothing
  rendered" report exposed that `natureModels` rejected the ENTIRE prototype
  map if any one of ~26 glbs failed (silently — callers had no catch), and a
  stalled character fetch left a bodiless golfer holding a club. Now: per-key
  skip+warn (the map never rejects); `loadNaturePrototypes(scene, palette,
  keys)` downloads only the props the course theme places; character loads
  retry once and race a 20s timeout into the procedural-body fallback
  (rejected loads also evict from the per-scene cache). convert-nature gained
  per-entry `ratio` overrides (leaf-card-soup meshes need lockBorder off to
  decimate) + KHR_mesh_quantization on all props — nature payload 5.6→3.8MB.
  New verification standard: `vite preview` production-bundle runtime check +
  fault-injection (abort a nature glb / the character glb) before shipping.
- **Pine Alley is a real alley.** Flank woods polygons track the fairway edge
  at ~38 units (spacing 36, 100+ trunks/side, physics-real), the three pinch
  clusters are gone (the original overhanging centre pine is the only
  fairway tree), a spacing-34 forest polygon walls the back of the green,
  backdrop step 46→38, aspen accents, and converted fallen-trunk/broken-snag
  deadwood in the rough scatter (keyed heights). Monte Carlo band holds.
- **Break dots ride the grid.** Each dot sits on a putt-grid line (4-unit
  lattice, green's rotated frame) and slides along it at the local
  `breakAccel` projection onto its axis — break-right runs the x-lines,
  uphill runs the y-lines toward the golfer, aligned lines glow brighter,
  flat greens rest. breakDots.ts exports pure `lineLattice`/`localBreak`
  helpers under test.

# Update — 2026-07-10 (latest+4): break-dot flow field + Pine Alley environment pass

- **The putting aid now shows the real read.** `src/slice3d/breakDots.ts`
  replaces the uniform scrolling-texture drift with a SolidParticleSystem of
  ~150-350 world-space dots, each moving along `engine.breakAccel` at its own
  position (the same field the roll integrator uses) at a speed ∝ break
  magnitude. Downhill-away recedes, uphill approaches, break drifts sideways,
  flat greens sit still. Deterministic seeding + freeze priming keep `?freeze=1`
  captures stable; `alwaysSelectAsActiveMesh` avoids the stale-SPS-bounds cull.
- **Pine Alley (Timberline h1) one-pass environment upgrade**, all scoped via
  theme knobs / course data so other courses render identically:
  - *Trees*: conifer trunks recolor bark via mesh-name (`SM_` node) gated to
    CONIFER_KEYS; conifer heights jitter 2.3–3.0× for a ragged skyline; three
    pinch-pine hazards straddle the fairway edge; flank spacing 38.
  - *Grass/bushes*: theme `tuftDensity` (grid 34/√d), `roughTuftHeight`
    (capped 3.4 — "never read as walls"), 55-unit tee clear radius,
    `bushKeys` with keyed heights (juniper sprawler plants knee-high);
    converted `bush_juniper`/`bush_c`.
  - *Sand*: greenside trap moved out from under the green ellipse (it was 86%
    swallowed → rendered as a lip full of green), heightfield dish (−0.7×r30)
    at the sand centre — physics/aid/lip all read the same field; theme
    `sandSculpt` adds crossing rake ripples + radial depth in both the main
    bake and the green patch (seam-free).
  - *Sky*: `hazeStrength` finally consumed (`fogDensity = 0.00042·(h/0.5)`;
    wildwood/sablebay re-anchored to 0.5 — field was dead, zero visual
    change); `cloudKeys` swaps painted billboards for cloned forest-pack
    cloud meshes (clones honor `applyFog=false`).
- **Next iteration knobs** (per-layer tuning with Matt): course JSON theme
  values (`tuftDensity`, `roughTuftHeight`, `sandSculpt`, `backdropTreeStep`,
  key mixes), hazard `spacing`, elevation dishes, `dotSpeed` mapping in
  breakDots.ts.

# Update — 2026-07-10 (latest+3): forest pack integrated, store confirm, all-course records

- **Second nature pack integrated.** The raw Unity FBX upload (named species
  trees, deadwood, bushes, clouds, terrain grass textures) moved out of the
  served `assets/` tree into `asset-packs/forest-nature-fbx/` (provenance
  README; Unity `.meta`/`.terrainlayer` litter and a byte-dup of the
  fantastic-nature zip deleted). `scripts/convert-nature.mjs`
  (`npm run convert:nature`; FBX2glTF + @gltf-transform LOD0-only/weld/
  simplify/prune) emits 13 committed glbs: 6 broadleaf trees, 3 conifers,
  stump/log/fern/berry. Cloud meshes deferred (they'd fight the gradient-sky
  + baked-backdrop system). `natureModels.pickMat` maps the pack's slots
  (`*Leavse*`/`Leaves_For_*` → foliage; `MainMaterial`/`Tree`/`AspenTexture`
  → bark; floor props by key).
- **Species are per-course art; density is course data.** CourseTheme grew
  optional `treeKeys`/`accentTreeKeys`/`scatterKeys`/`backdropTreeStep`;
  Timberline is now a conifer forest (birch accents, fern/stump/log floor,
  denser backdrop), Wildwood a broadleaf parkland (fern/berry floor), Sable
  Bay unchanged. Woods density moved to the trees hazard itself —
  `Hazard.spacing` (default 52) read by `collectTreeBlobs`, so physics,
  baked shadows and props stay in lockstep; Timberline's six flanking woods
  author 42 (never the driving line — Course Bible fairness rule +
  `tests/treeField.test.ts`). Conifers plant at 2.6× canopy radius so the
  tall-narrow silhouettes read right. All 14 course baselines regenerated.
- **Store purchases confirm first.** Tapping an unowned, affordable item
  arms a "Spend X 🪙 now?" panel (`pendingBuy` in `renderStore`); Buy runs
  the existing StoreEngine + persist + quiet cloud-sync path, Cancel spends
  nothing, leaving the store disarms. Equip stays one-tap. Spec drives
  guarded/cancel/confirm via a new `__grantCoins` test hook.
- **Records shows every course.** `renderRecords` was pinned to
  `round.course` (defaults Wildwood; only changes when a round starts). Now
  a tab per course re-filters one `fetchAllRounds()` result; tabs are live
  while the fetch is in flight. New `records.spec.ts`.
- **Restored two regressions from the recent upload commits:** the Phase 9
  Reset Records control (two-step confirm — helpers had survived, the UI
  and CSS hadn't) and the stale `Link Google` label assertion in
  `profile.spec.ts` (button reads "Sign in with Google" signed-out).
- **Still open / deferred:** cloud meshes, Chopped/Damaged tree variants and
  remaining bushes (all in the pack, unconverted); downscaling the pack's
  ~33MB grass albedo/normal PNGs into tiling turf detail textures (art doc's
  multi-scale-detail item); `main.ts` split remains the top debt item.

# Update — 2026-07-09 (latest+2): cap topspin (drives ran to 440+)

- **Topspin is now capped.** `applySwipeSpin` (`main.ts`) was explicitly UNCAPPED,
  so a hard downward swipe set `spin.top` to 3-6+; that maxed the bounce-retention
  ceiling (`spinKeep`), and a low/flat strike then ran the drive off the rough
  onto the low-friction green → 440+ yd. Clamp the swipe: `top` ±1.5, `side` ±2.5
  (draw/fade + backspin-check preserved). Lowered `spinKeep` ceiling 2→1.5 as a
  backstop. New `tests/simulation/driver.test.ts`: worst case (low strike + max
  topspin + 20mph tail) ≤ 370 yd on every hole (was 434). Carry unchanged (320).

# Update — 2026-07-09 (latest+1): putting rebuild, driver aim-dot, flyover skip

- **Putting is skill-based now — green break is LIVE.** Root cause of the "RNG"
  feel: production greens are flat plateaus in the heightfield, so
  `breakAccel` returned ≈0 on the green and the authored `hole.slope` was ignored
  whenever a heightfield existed — yet the ▲/▼ readout used `hole.slope`. Now
  `breakAccel` ADDS the authored `hole.slope` on green/fringe on top of the
  heightfield contour, and the roll step always uses `breakAccel` (removed the
  dead `else if`). So putts curve/gain/lose pace with the slope the readout
  shows. `slopeAccel` 55→85 for a readable break; new `break.test.ts` proves a
  straight putt on a sloped green misses and a flat green holes.
- **Aim any distance.** The putt aim floor was 14px≈21ft in `moveDrag`/`placeAim`
  (couldn't aim a short putt); now `isPutting ? 1 : 14` px everywhere.
- **Driver reads as carry.** Carry is on-spec (320 at power 100); the aim
  dot/ring/readout now mark the CARRY-landing (`updateAimVisuals` uses the first
  z≤0 sample) instead of the post-rollout resting spot, so it reads ~320 and the
  ball rolls out past it. Added `rollGradFairwayMult` (0.55) to dampen off-green
  downhill roll so a drive can't run out absurdly (couldn't reproduce the 439 in
  sim — max ~353 in extreme wind/strike/spin — this is insurance). Player aim
  aids still ignore wind/slope (unchanged); the ▲/▼ + wind readouts stay as info.
- **Flyover:** added an on-screen `#skipBtn` (shown in `playIntro`, hidden in
  `beginTurn`/`dispose`, wired to `skipIntro`); opening frame now sits low right
  behind the tee looking down the line (was high/aimed at mid-hole → read as an
  overview at the honest scale).

# Update — 2026-07-09 (latest): deploy-visibility, putt slope skill, cup pop-up

- **Cloud-save now reports a status.** `cloudSyncProfile` returns
  `{ profile, status: 'saved'|'denied'|'offline'|'skipped' }`
  (`FirebaseClient.ts`); `main.ts` shows it (`showCloudStatus`) — a "✓ Saved",
  an offline notice, or a loud "⚠ Cloud save failed — publish the DB rules"
  (also on the account status line). This makes the invisible "coins vanished"
  failure (RTDB rules not published) obvious. Sign-out/sign-in now also
  re-render the setup wizard (`refreshWizardIfVisible`) so the on-screen NAME
  clears/loads, not just the account button. NOTE: the account fix only takes
  effect once merged to `version2` (Pages deploy branch) — the live site ran the
  old build until then.
- **Putting no longer auto-compensates for slope (gameplay change).**
  `AimControl.meterScalePx` dropped its `slopeFactor`; a perfect strike is now
  sized to the FLAT pace for the aim distance, so uphill putts come up short and
  downhill run long — the player must read the break and aim further (the
  "▲ uphill" chip is the cue). The AI is unaffected (it reads greens via its own
  `AIController.rollSwing` slope math), and the sims bypass `meterScalePx`, so
  `putting.test`/`scoring.test` stay green.
- **Ball pops off the lip on a hard skip.** A putt crossing the cup at
  `speed >= cupLipSpeed` injects a short cosmetic `z` hop into the path
  (`PhysicsEngine` rolling loop) + a small pace scrub (`cupSkipPopPx`,
  `cupSkipPaceScrub`), so a ball blown over the hole visibly catches the lip.
  `z` never affects x/y/`holed`, so make-rates are unchanged.

# Update — 2026-07-09 (later still): account-gated progression + honest-cup green rework

- **Accounts are now gated on a real (Google) sign-in.** Removed the anonymous
  auto-sign-in (`FirebaseClient.ensureFirebase`/`signOutAccount`); `linkGoogle*`
  became `signInWithGoogle` (plain popup, no anon to "link"); added `isSignedIn`.
  `main.ts` boots from an **empty** `defaultProfile()` and only adopts the cloud
  account when signed in (`adoptCloudAccount`); all local persistence is gated
  behind `persistProfile()` (a no-op when signed out); sign-out
  (`doSignOut`/`clearLocalProfile`/`clearLocalHistory`) resets the live profile
  to empty so a signed-out browser shows a clean slate. First sign-in on a device
  folds any local progress up once via `mergeProfiles`. `cloudSyncProfile` now
  logs permission-denied instead of swallowing it. Sign-in nudges added to the
  store + round summary. Fixes: "coins show logged-out", "new device resets to 0".
  Docs 04/08/FIREBASE_SETUP updated.
- **Honest-cup green rework** (`config.ts`, `PhysicsEngine`, `main.ts`,
  `course3d.ts`): the drawn cup == the physics capture zone, shrunk `cupRadius`
  0.95→0.70 (≈2.1ft) and the ball to a proportional `PUTT_VIEW.ballScale` 0.56 so
  the green reads at consistent real-world scale (~6ft golfer, small ball, ~2ft
  cup). The "rolls over the hole" miss is fixed by widening the drop window —
  `cupCaptureSpeed` 22→27 (Δ≈3.6ft overrun) and `cupLipSpeed` 25→31 — so a
  normally-paced putt drops and only a way-too-fast one skips; `puttPaceNoise`
  0.045→0.055 holds the make-rate curve (`putting.test`/`scoring.test` green).
  New putt camera is low + gently telephoto (`PUTT_VIEW.fov` 0.72, lerped) so the
  roll reads long; ball shadow + `camera.minZ` track the smaller ball.

# Update — 2026-07-09 (later): Playtest FB9 — putting, cameras, trees, roster, apparel

Second `2026-07-09` session (full detail in `docs/13_PLAYTEST_FB9_2026-07-09.md`).
Note: this work happens on `claude/golf-playtest-feedback-0jjea8`, re-based onto
`version2` (the branch had been cut from the unrelated betting-model repo).

- **Putting** (`PhysicsEngine.integrateLaunch`, `config.ts`, `main.ts`,
  `course3d.ts`): putter launch speed now uses a path-averaged roll friction
  (`puttRollFriction`) so off-green putts reach their target while on-green pace
  (and the Appendix-A make rates) stay bit-identical; a 3-ft auto-gimme
  (`tryGimme`) in `main.ts`; the flagstick is pulled while putting
  (`setPinPulled`); the visual cup/ring were shrunk to the physics capture
  radius (no capture change); the putt camera sits higher/back to stop distance
  foreshortening.
- **Cameras / aim / shape** (`main.ts`, `StrikeControl`, `config.ts`): aim
  readout clamps to the screen edge instead of hiding; `moveStrike` recomputes
  the aim preview and side-spin is stronger (`sideSpinAccel` 30→46, wood
  `spinEffectiveness` 0.22→0.32); the intro flyover is a staged tee→green travel;
  the ball-follow camera looks at the ball and defers the green-framing swap.
- **Trees** (`src/systems/treeField.ts` NEW — shared, pulled out of
  `CourseTexture` to avoid a physics→rendering cycle): `PhysicsEngine` collides
  against individual tree canopies (`nearTree`), not the whole polygon, and stops
  rising balls too (dropped the `vz<0` gate; added `treeLaunchGrace`). Buildings
  stay whole-polygon. `AIController.punchOutTarget` escapes trees toward open
  ground (needs the engine's `surfaceAt`, already passed as the terrain reader).
  Pine Alley re-authored so the centre tree guards one line, not the only line.
- **Courses** (`sablebay.json`): smaller island green, par-4 left ocean + green
  creek, par-5 forced carry. Both course sims gained a 20s timeout (heavier now).
- **Roster** (`characters.ts`, `storeCatalog.ts`, `main.ts`): all 25 pack chibis
  wired; select shows the full roster with lock/price badges routing to the
  Store; 5 free / 20 unlockable. `portrait.html` + `src/portrait.ts` +
  `scripts/gen-portraits.mjs` (`npm run portraits`) render all portraits.
- **Modes / accounts** (`main.ts`, `types.ts`, `FirebaseClient.ts`): Ace
  Challenge is the 4th wizard mode (its Course step picks any course's par 3);
  `googleLinked()` + a main-menu "Link Google" entry point; the menu-bar ace link
  is gone.
- **Apparel + tournament history** (`golfer3d.ts`, `StoreEngine`, `Profile`):
  outfit colorway (albedo multiply on the single `characters` material — the
  chibi has no separable garments) + procedural club-skin tint, equippable like
  ball/trail; `PlayerProfile.tournaments[]` history + a "My Tournaments" list.

# Update — 2026-07-09: Phase 9 — polish, accessibility, docs, RC

- **Reset Records** (profile): a two-step confirm clears career stats,
  achievements, XP/level and local history (`resetProfileRecords`,
  `clearLocalHistory`) while keeping coins and cosmetics.
- **Accessibility:** the profile's `sound`/`ambience` settings now drive real
  volume (SFX scale by `sound`; the ambience loop follows `ambience` live), the
  reduced-motion toggle suppresses the hole-out camera rumble, and the meter's
  perfect band carries a bright inset outline as a colorblind-safe cue. Settings
  rows are 48px touch targets.
- **Dead code:** removed the unused `Scoring` class + `formatToPar`.
- **Perf gate:** `tests/visual/perf.spec.ts` times a `scene.render()` loop
  (headless rAF is throttled, so `getFps()` is meaningless) and records a
  per-frame baseline; `docs/DEVICE_MATRIX.md` is the on-device checklist.
- **Docs:** README rewritten to the shipped game (Babylon 3D, the three real
  courses, current controls/modes/progression).

**Deferred to post-RC (deliberate):**
- **`src/slice3d/main.ts` split.** It remains the ~2.2k-line composition root
  and `HoleScene` host. Splitting it cleanly means untangling heavy shared
  mutable state (`round`, `current`, `profile`, `sel`, the engine + DOM
  singletons); doing that at RC would risk the stable, fully-tested build for a
  purely internal gain. Tracked as the top tech-debt item — do it first in the
  next cycle, behind the Playwright net, before adding more to the module.
- **A fourth "links" course.** V1.0 needs ≥2 courses and ships with three
  (Wildwood, Sable Bay, Timberline); a firm-and-fast links course is a nice
  content add, not a release blocker.

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

Putting note: the putt meter is FIXED-length — the power target line always
sits at the same spot on the bar (`SWING.fullPowerMark`) so a 4-ft and a 40-ft
putt look identical, and a perfect strike there rolls the ball exactly to the
*aim spot*. The aim distance and slope are baked into the bar's scale
(`AimControl.meterScalePx`: `aimDist·(μ − a_parallel)/μ / fullPowerMark`) rather
than into the target position. This is the subtlest math in the game — it has a
dedicated seam and mirrors the AI's putt-power calc in `AIController`.

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
  Fairway/rough mow bands are squared (a tanh-flattened plateau with a soft
  edge) so they read as two distinct mown tones, not a smooth undulation; the
  green keeps the gentle sine. Real-photo courses only partly damp the coded
  stripes (0.7, not 0.4) and run a gentler fairway grain (realAmp 0.5 vs the
  rough's 1.25) so the photo texture can't shred the bands. `theme.stripeStrength`
  (default 1) scales the fairway/rough swing per course, while the green stays
  subtle. `theme.mowPattern: 'checker'` (with `mowTile`) swaps the fairway's
  single-direction diagonal stripe for a hard-edged two-tone checkerboard (rows
  AND columns) via the shared `mowPattern.ts` helper — and the 3D fairway grass
  carpet (`course3d.ts`) samples the SAME helper so the tufts reinforce the
  cells instead of speckling random brightness over them (the earlier reason
  the pattern wouldn't read). The grid is rotated `CHECKER_ROTATION` (45°) off
  the raw tee→pin axis so it reads as a diamond pattern rather than squares
  aligned straight along/across the fairway; both call sites add the same
  exported constant so the ground bake and grass tufts rotate identically.
  Timberline enables it; its turf palette is brightened/saturated toward the
  reference look while keeping rough clearly darker than fairway (the aerial
  grayscale-separation bar).
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
