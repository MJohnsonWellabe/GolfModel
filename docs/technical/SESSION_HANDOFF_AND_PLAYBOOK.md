# Session Handoff & Polish Playbook

**Last updated:** 2026-07-23 · **Branch:** `claude/bsg-dev-environment-roadmap-y4vzk8` (mirrors `version2`)

This is the working handoff for the ongoing owner-driven polish/playtest cycle. It
captures (a) the **playbook** — hard-won techniques and traps for shipping and for
touching assets/rendering — and (b) the **outstanding roadmap**. Read this before
picking up the batch so you don't re-learn the same gotchas.

---

## 1. Deployment & environment — how to ship

- **Production is `https://bsgolf.fun`** — GitHub Pages + custom `CNAME`, published by
  `.github/workflows/deploy.yml` **on every push to `version2`**. `version2` is the
  trunk and the *only* branch that deploys. CI runs `npm test` + `npm run build` before
  publishing, so a broken push fails the deploy rather than shipping.
- **There is no separate live dev site.** `deploy-dev.yml` is dormant (triggers only on a
  nonexistent `develop` branch, publishes nowhere). The admin-only dev host is a deferred
  roadmap item (`DEVELOPMENT_ENVIRONMENT_AND_RELEASES.md`). What looked like a "hidden dev
  site" was just `bsgolf.fun/index.html?env=dev` — the **same** site with dev feature-flags
  on (see §2).
- **Standard ship loop:** develop on the Claude branch → `tsc --noEmit` clean → `npx vitest
  run` (902 tests) → `npm run build` clean → commit → **push to BOTH** the Claude branch and
  `version2` (`git push origin HEAD:version2`). The push auto-triggers the deploy.
- **Confirm a deploy:** compare the live JS bundle before/after —
  `curl -s https://bsgolf.fun/ | grep -oE 'assets/main-[^"]*\.js'`. The hash *changing* is
  the proof the CDN rolled. (Local vs CI bundle hashes differ because CI bakes prod Firebase
  config — don't compare local build to live, compare live-before to live-after.)
- **Commit `Claude <noreply@anthropic.com>`.** Never put the model id in any pushed artifact.
- **Firebase data ops cannot be done from the container.** No console/admin-SDK access, and
  the `/rounds` DB rules forbid client deletes (`.write: newData.exists()`). A true stats
  *wipe* is an owner action in the Firebase console; from here you can only do code-level
  resets (see §3).

## 2. Feature flags & release state (`src/core/flags.ts`)

Flags have per-environment defaults (`prod`/`dev`); `?env=dev` uses the `dev` column.
As of the release commit, these are **prod-on** (the rebuilt/new courses are LIVE for
everyone): `newCourses`, `courseRebuilds`, `boundedWorld`, plus the always-on polish flags
(`delight`, `juice`, `layouts`, `audio`, `personality`, `atmosphere`).

- **`devTools` stays `prod:false` on purpose** — it's the admin cheat panel (grant coins,
  reset mastery, seed leaderboards) and is hard-gated to non-prod anyway. Do not flip it.
- The flags are kept as kill-switches. The documented end state is to fold the v2 JSONs over
  the originals and delete `courseRebuilds`/`newCourses` (see each flag's `removeWhen`).

## 3. Stats / rounds recording (`src/admin/main.ts`, `src/firebase/History.ts`)

- **Rounds always record.** `saveRound()` is called unconditionally in `showSummary()` on
  every round finish; Replay & Play Next both restart via `startRound(0)`, which re-wires
  the finish→`showSummary`→`saveRound` path. `makeRoundId()` is unique. So "rounds not
  recording" is essentially never a write bug.
- **The trap:** the admin dashboard's `ACTIVE_COURSES` filter must list the **live course
  display names**. Releasing the rebuilds renamed courses ("Timberline" → "Timberline East",
  plus new Timberline West / Red Hollow / Wild Prairie), so rounds recorded under the new
  names were silently filtered out of the stats. `ACTIVE_COURSES` is now built from the live
  roster JSONs. **If you rename or add a course, update `ACTIVE_COURSES`.**
- **Dashboard stats reset** = `STATS_EPOCH` (ms) in `src/admin/main.ts`. The dashboard counts
  only rounds with `r.d >= STATS_EPOCH`. Non-destructive (raw rounds stay in `/rounds`). Bump
  it to reset again after a course change.

## 4. Asset acquisition & integration playbook

**Sourcing (poly.pizza):**
- Search page `https://poly.pizza/search/<query>`; model page `https://poly.pizza/m/<id>`.
- The GLB URL isn't in the WebFetch'd markdown — `curl` the model page and grep:
  `curl -s https://poly.pizza/m/<id> | grep -oE 'https://static\.poly\.pizza/[a-z0-9-]+\.glb'`.
- **Quaternius & Kenney = CC0.** Poly-by-Google = usually CC-BY (attribution). **Record every
  new asset in `ASSET_ATTRIBUTION.md` before use.**
- **Inspect a GLB headlessly** by reading the JSON chunk (12-byte header, `readUInt32LE(12)`
  = json length, JSON starts at byte 20). Dump node/mesh/material names + triangle counts to
  vet a model before wiring it. (Scratch scripts `/tmp/cc.mjs`, `/tmp/cc2.mjs`, `/tmp/measure.mjs`.)

**Building assets (castle/clubhouse) — the KIT trap:**
- A search hit named "Castle"/"Manor" may be a **kit sampler**: e.g. the first `castle.glb`
  was the whole Kenney Castle Kit — 159 meshes laid out flat incl. siege engines and knight
  figures. It renders as scattered junk. **Want a single assembled building.** Verified good
  picks: Quaternius "Wonder" fortresses (assembled castle), Poly "Palace" (grand estate).
  Vet by mesh count + material names before committing.

**Trees (nature scatter) — `src/slice3d/natureModels.ts` + `src/systems/treeHitbox.ts`:**
- A tree key `tree_X` loads `assets/models/nature/tree_X.glb`. Membership in `CONIFER_KEYS`
  routes it through the conifer branch of `pickMat`.
- **`pickMat` reads the MATERIAL name**, not the mesh name. Conifers with `Bark_NormalTree` /
  `Leaves_Pine` slots route correctly (bark→brown trunk, needles→green). Pines whose materials
  are `Wood`/`Green`/`Snow` route WRONG (the trunk turns green). Pick assets with bark/leaf
  material names, or extend `pickMat`.
- **CRITICAL — tree collision is species-shaped.** `treeHitbox.ts::TREE_HITBOX` has a per-key
  profile (`prof(heightMul, aspect, canopyBottomFrac, cone)`). A new tree key with **no**
  entry falls to `DEFAULT_HITBOX` — a *wide rounded broadleaf* — which fattens the trunk
  hitbox, tightens forest corridors, and **fails the Timberline East playability gate**
  (`tests/simulation/rebuilds.test.ts`), and `tests/unit/treeHitbox.test.ts` asserts every key
  has an entry. **Always add a `TREE_HITBOX` entry for a new tree.** For conifers use
  `cone: true` and a slim `aspect` (~4.2–4.9, near the firs) so corridors stay playable while
  the stand still carries a real hitbox.
- Firs (`tree_fir_a/b/c`) do NOT `keepTexture` — they route through the game's flat foliage
  palette (their GLBs bake dark AO). New pines route the same way (flat foliage), so "better
  conifer" is about the **silhouette**, not the atlas.

## 5. Rendering internals cheat-sheet (the traps that bit us)

- **Course albedo bake** = `src/core/rendering/CourseTexture.ts` (`renderCourseCanvas`): a
  layered painter, **last layer wins**. Precedence must track `PhysicsEngine.surfaceAt`.
  Water is painted **after** the fringe collar so translucent shallows lapping a green don't
  reveal a grass-green bed (the "green tint on water" fix).
- **The green is a built mesh**, not just paint: a raised plateau (`greenLift`, always
  `+GREEN_RAISE` inside the green) wearing a high-res `renderGreenPatch` texture. **The patch
  colors each texel by `engine.surfaceAt` → `theme.<surface>` colors** (green = `theme.greenLight`).
  ⚠️ `surfaceAt` returns `'sand'` for a **scoring bunker BEFORE** it checks the green — so a
  bunker/waste overlapping a green makes the patch bake sand-tan (**this is the likely Red
  Hollow #3 all-brown-green cause** — see §7).
- **`surfaceAt` precedence** (`PhysicsEngine.ts`): green > scoring-bunker > fringe > water >
  trees > fairway > waste/beach > rough. A genuine water polygon now beats the fringe *margin*
  (the PJ-links #3 "water plays as land" fix) — the bake mirrors this.
- **Vegetation scatter** (`course3d.ts` ~2160+): grass/bushes/rocks are boundary-clipped
  (`pointInBoundary`). The identity fescue/waste/sand-plant "frame band" is now `FRAME_BAND = 0`
  so **no vegetation spills past the playable boundary** (owner rule). `nearPinClassic`,
  `inGarden`, `inTeePad` carve keep-outs.
- **Decorative boats** rejection-sample water boxes with a **green keep-out** so a large ship
  never anchors on/adjacent to a green (Sable Bay #2 fix). Classify boat parts by MATERIAL
  name for correct sails/hull (PBR materials use `albedoColor`, not `diffuseColor`).
- **Aerial view must FREEZE.** `renderPacing.overhead` (set in `toggleAerial`) parks the water
  mirror + shadow map to a single capture. Without it the shadow map regenerated every other
  frame and the greens visibly "danced." `meterActive`/`cameraParked` are the other freeze
  triggers.
- **Horizon** = a `voidFloor` ground (16000²) beyond the boundary, colored `theme.haze` +
  `applyFog`; fog is `FOGMODE_EXP2`, `fogColor = theme.haze`. The **playable ground still
  carries the hole's tint out to the world edge** — that colored band before the haze fade is
  the "horizon tint bleed" (see §7).
- **Render harness** `_render.mjs` (gitignored): `node _render.mjs course:hole:cam ...`
  (cams: `tee`/`approach`/`green`/`aerial`), `freeze=1`. Serves `dist/` — **rebuild before
  rendering.** Shows PLACEHOLDER boats/props; aerial grants True Vision. **Static frame** — it
  cannot show temporal bugs (aerial dancing, shimmer); those need an in-game eyeball.

## 6. Course generation & gates

- Generated: `scripts/courses/*_v2.mjs` + `redhollow.mjs` + `wildvalley.mjs` →
  `node scripts/gen-new-courses.mjs` → `src/data/courses/v2/*.json` (and
  `src/data/courses/redhollow.json` / `wildvalley.json`). **Never hand-edit generated JSON.**
- **Hand-authored:** `src/data/courses/wildwood.json` (edit directly).
- **Gates (all must pass):** `npx tsc --noEmit`; `npx vitest run` (**902** tests) — notably
  `pinFlatness` (|grad| ≤ 0.11 over a 4 ft disc), `rebuilds` (puttable gradient + playability
  finish-rate), `newCourses`, `terrainPass`, `boundary`, `treeHitbox` (key coverage).
- Vertical unit ≈ **1.25 ft** (not yards); horizontal `PX_PER_YARD = 2` (50 world px = 25 yд).
- **Commit frequently** — a mid-session container rollback cost uncommitted work once.

## 7. Outstanding roadmap

### Bugs (do first)
1. **Red Hollow #3 green renders all-brown.** `theme.greenLight` is correct, so it's a
   `surfaceAt` classification: a scoring-bunker/waste in the sunken crater almost certainly
   overlaps the green footprint, and `surfaceAt` returns `'sand'` for a scoring bunker before
   the green check → `renderGreenPatch` bakes tan. **Fix:** probe `surfaceAt(300,480)` for
   hole 3, find the overlapping hazard, and either pull it off the green footprint (edit
   `redhollow.mjs`, regen) or force green over its own ellipse in the patch bake.
2. **Horizon tint bleed (global) / "redo all water".** The playable ground's tint reaches the
   world edge before the EXP2 fog dissolves it, leaving a colored band at the skyline
   (Red Hollow red, Wild Prairie tan, water horizons). **Fix direction:** fade the ground
   albedo toward `theme.haze` near the world edge, and/or raise fog density approaching the
   horizon, so the tint dissolves into haze before the sky. Re-review all water horizons after.
3. **Timberline West — mastery stars not working.** Investigate the mastery/`starCount` path
   for `timberlinewest` (likely a course-id mismatch in the mastery record keyed on the new
   course id, mirroring the `ACTIVE_COURSES` rename trap in §3).
4. **Wildwood #2 back-garden flowers not rendering.** Flowers authored but not drawn —
   check the GardenBed `flowerKeys`/`bloomChance` and whether the bed is inside the boundary
   after the `FRAME_BAND = 0` change.
5. **TL East #3 trees hit through** (carried from a prior batch). Single end tree gets a
   collision trunk, so suspect the left-woods band (render denser than collision by design) or
   fly-over band height. Needs an in-game repro of *which* trees.

### Performance
6. **Timberline West** and **Port Johnson** perform badly. Levers: consolidate stacked
   collidable rocks into fewer collision volumes (TL East H1 has 13); cut off-corridor scatter
   on the biggest holes (the `FRAME_BAND = 0` change already helps); keep new tree assets
   low-tri (the alpine pines are ~1.6k/3.4k on purpose).

### Course edits (owner-approved from the suggestion pass)
7. **Wildwood #2:** move the green forward to the water and shift everything with it (shorter
   but harder).
8. **Sable Bay #2:** replace the 36 collidable flint-cobble causeway landforms with
   non-collidable decor ("can't even see the cobbles now anyway").
9. **Red Hollow #3:** loosen the sunken-green crater to give a real apron/collar.
10. Per-hole edits greenlit as "make your suggested edit": **Timberline West 1/2/3**,
    **Port Johnson 1/2/3**, **Wild Prairie 1/3**. Details in §8.

### Needs owner eyeball (shipped, unverifiable in static renders)
- Aerial "greens dancing" fix (RTT freeze) and the cup-marker-on-green fix — confirm in-game.

## 8. Per-hole suggestion backlog (from the multi-agent review)

Single most-impactful change per hole; the owner has greenlit the ones marked **[approved]**.

**Wildwood Glen** — 1: shorten the 442-yд par 4 (tee up ~385 or re-par to 5). 2: pull the
cross-water band north to the green's front apron **[approved: move green to water instead]**.
3: swap the long split-rail fence for shoreline reeds/cattails.

**Sable Bay** — 1: thin the left treeline through the landing so a pull reaches the bay.
2: **[approved]** non-collidable cobbles. 3: move the specimen pine off the safe lay-up target.

**Timberline East** — 1: collapse the 13 stacked collidable granite rocks to ~4–5 volumes
(perf). 2: add a right-side grass bailout on the forced carry. 3: firs→conifers **[done —
alpine pines]**.

**Timberline West [all approved]** — 1: move the lone fairway tree onto the dogleg cut line
(~415,610). 2: tuck ≥1 pin behind a bunker (all three are dead-center). 3: carve a short-grass
bailout shelf long-left of the walled green.

**Port Johnson Links [all approved]** — 1: bring the harbour water into play (shift fairway
right or push the shore in). 2: move the primary tee to the forward pad (~210 yд) so the Redan
ground game is reachable. 3: cull off-corridor scatter on the course's biggest hole (perf).

**Red Hollow** — 1: add a rough shoulder between fairway and the OB line. 2: enlarge the green
(≈rx 62→72, ry 50→60). 3: **[approved]** loosen the sunken-green crater for an apron.

**Wild Prairie** — 1: **[approved]** push the central split bunker up-fairway (~y540) so it
guards the aggressive carry. 2: clubhouse replaced **[done — Palace estate]**. 3: **[approved]**
pull the Wild Horse bunker into the actual drive-rest band.

## 9. Shipped this session (changelog)

- Real assembled **castle** (Quaternius Wonder) replacing the Kenney kit sampler.
- **No vegetation outside the playable area** (`FRAME_BAND = 0`).
- **Wildwood fence** stops at the water instead of crossing it.
- **Green tint on water** fixed (bake water-over-fringe).
- **Aerial greens dancing** fixed (`renderPacing.overhead` RTT freeze).
- **Rounds/stats recording** fixed (`ACTIVE_COURSES` mirrors live names) + `STATS_EPOCH` reset.
- Released rebuilt courses to prod (flags flipped) — `bsgolf.fun` shows all 7 courses.
- **Better conifer** (Quaternius alpine pines + collision profiles) for Timberline.
- **Grand estate** (Poly "Palace") for Wild Prairie #2.
- Sable Bay #2 **boat off the green**; PJ #3 water-plays-as-water; cup-marker-on-green;
  single aerial OB perimeter line.
