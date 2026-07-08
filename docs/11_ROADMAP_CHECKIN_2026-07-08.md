# Johnson's Golf — Roadmap & Vision Check-In

**Date:** 2026-07-08 · **Branch reviewed:** `version2` @ `ce58d9d` · **Type:** full studio review (all roles)

This is a point-in-time audit: every design doc read, the code and course data verified line-by-line, roadmap status mapped, and a staged plan for the work that isn't meeting the vision — chiefly course graphics.

---

## 1. Executive summary (CEO)

The v2 pivot was the right call. In two days the project went from a 2D Phaser arcade game to a docs-driven 3D game with a coherent vision suite, a tested physics core, rigged purchased characters, and a live deploy. Three of four pillars are healthy:

- **Vision docs** — strong, consistent, usable as a real bar (Everybody's Golf × Tiger Woods 04–08, "premium console game in a browser", 70% realism / 30% stylization, "nothing should appear flat").
- **Gameplay core** — physics, clubs, meter, putting, wind: solid, unit-tested, feels intentional.
- **Characters** — the 10 rigged chibis are the best thing on screen. Player feedback agrees.
- **Course presentation** — ✖ the one pillar that clearly fails the bar. This check-in's main job is diagnosing why and planning the redo.

The good news: the course problem is *not* missing data or a bad engine choice. Every hole is fully specified; the failure is in shape authoring, palette, missing geometry, and zero texture assets. All fixable in stages without touching the physics feel.

On assets specifically: the game ships **zero texture image files** — every surface is procedurally painted color. Buying/downloading real turf and sand textures plus golf props is a genuine lever and should run as a parallel track — but assets alone won't fix rectangle fairways, the one-hue palette, or flat terrain. Those need the staged shape/geometry work in §5, which the new assets then feed.

---

## 2. Roadmap status (Producer)

Phases from `05_DEVELOPMENT_ROADMAP.md`; true status from the top (2026-07-08) layer of `ARCHITECTURE_REVIEW.md`, verified against code.

| Phase | Scope | Status |
|---|---|---|
| 1A Foundation | Architecture review, refactor, tests | ✅ Done |
| 1B Graphics & Presentation | Terrain, lighting, water, camera, HUD, audio | ⚠️ Shipped but **fails the vision bar** → this redo |
| 2 Gameplay balance | Meter bands, dispersion, wind, putting, greens | ⏳ Open — putting too easy, "good" band too forgiving, single-slope greens, wind ignores trajectory |
| 3 Golfer identity | Stats, archetypes, animation personality, AI tuning | 🟡 Partially done early — 5 archetypes + 10 characters landed; AI personalities missing |
| 4 Spin & shotmaking | Strike location, swipe spin, trajectory shaping | ❌ Not started (flight pacing already staged for it) |
| 5 Accounts & cloud saves | Firebase Auth, sync | ❌ Not started (REST leaderboard only) |
| 6 Progression | XP, levels, achievements, coins | ❌ Not started |
| 7 Store & customization | Cosmetics, club upgrades | ❌ Not started |
| 8 Online tournaments | Invites, persistent leaderboards | ❌ Not started |
| 9 Polish & RC | Perf, accessibility, device testing | ❌ Not started |

**Hidden win — built but unreachable.** AI opponents (`AIController`), 1v1, scramble, `TurnManager`, and the fire/streak system are implemented *and unit-tested* but cannot be reached: the setup wizard hardcodes solo mode and a single human player (`main.ts` startRound). Re-surfacing them is the cheapest large feature unlock in the codebase.

**Gaps vs the V1.0 bar** (`09_PRODUCT_REQUIREMENTS.md`): minimum two complete courses (we have one — Wildwood Glen; Amen Corner and Legends Links were removed with the 2D game); solo/1v1/scramble modes (solo-only today).

**Doc debt.** `README.md` and `04_TECHNICAL_ARCHITECTURE.md` still describe the Phaser stack, `classic.html`, and the two retired courses; the lower layers of `ARCHITECTURE_REVIEW.md` contradict its own top update. The vision docs (00–03B, 05, 07–10) remain accurate as *targets*.

---

## 3. Vision recap — the bar the course must hit (Game Director)

From `03_ART_DIRECTION.md` and `10_COURSE_DESIGN_BIBLE.md`, the specific promises the current course breaks:

- **Terrain:** "Nothing should appear flat" — texture, variation, shadow, light, elevation. Fairway: healthy green, mowing patterns, texture variation. Rough: longer grass, different lighting response. Fringe: *distinct transition*. Green: smooth, highly maintained, visually readable.
- **Water:** "one of the prettiest parts of every course" — reflection, depth coloring, shore blending; must feel dangerous.
- **Sand:** soft, rounded edges, ripples.
- **Hole design (the Bible):** every hole asks a question, with conservative / balanced / aggressive lines; distinct landing areas; hazards create decisions, never decorate; a 3-hole course = one welcoming hole, one strategic hole, one memorable finish; "recognize the course from a single screenshot."

---

## 4. Why the course looks bad (Art Director + Tech Lead, code-verified)

All three holes carry **complete, valid data** — tee, green ellipse, pin, hazards (`src/data/courses/wildwood.json`). The failure is rendering + authoring:

1. **One flat plane.** The ground is a single mesh whose interior height is hard-pinned to 0 (`course3d.ts:110-120`) so the 2D physics always matches the visuals. Zero relief anywhere playable — the single biggest reason it reads as flat geometry.
2. **Painted, not built.** Fairway/rough/green/tee/bunkers are colored regions in one baked canvas texture (`CourseTexture.ts`). No tee-box mesh, no green mesh, no bunker lips. The tee is an 84-pixel painted square; the fringe is a 20px collar that mips away at gameplay distance.
3. **One-hue palette.** Rough `#2c6030`, fairway `#5cb551`, green `#a6e895` — all the same green family a few shades apart. Under one flat light, the eye gets "all green, geometric."
4. **Rectangle fairways.** Hole 1's fairway is literally a single 4-point trapezoid running tee→green — the "one long rectangle with a flag" is authored exactly that way. Holes 2–3 are the same, just with more hazards nearby.
5. **Scale kills readability.** Hole 3 (560yd par 5) *has* a green and tee — at tee-cam distance they're tiny low-contrast patches on a huge single-hue plane, i.e. invisible. Hole 2 only reads better because a wide contrasting blue water band happens to frame its green.
6. **Zero texture assets.** No image textures exist in the project; all surface detail is procedural noise/stripes at one scale, which washes out at camera distance.

What's genuinely good and should be kept: the baked-albedo pipeline itself (per-texel classification shared with physics — a clean, fast mobile approach), the lighting/shadow/fog setup, the sky/backdrop system, the nature-pack prop instancing, and everything about the characters.

---

## 5. The redo plan (staged; one engineer + AI, short sessions)

### Stage 0 — Screenshot harness first (S)
Make every visual change measurable before touching art.
- Debug URL params `?hole=N&cam=tee|aerial|approach|green&freeze=1` in `src/slice3d/main.ts` (freeze pins the animation clock for deterministic captures).
- Playwright spec: 3 holes × 4 cameras → 12 PNGs via `npm run shots`; commit the "before" baseline; regenerate as a contact sheet every iteration.
- `docs/visual-refs/` — 3–5 annotated Everybody's Golf / TW04 reference framings; `docs/visual-bar.md` — checklist distilled from `03_ART_DIRECTION.md` (5 turf surfaces readable at tee-cam, green findable at 560yd, nothing flat, 60fps).

### Stage A — Readability & shape (L total; no physics feel changes) → ship after this
- **A1 — Course schema v2 + loader (M).** Fairways authored as **centerline + per-station width**, compiled at load (Catmull-Rom sample → normal offset) into the existing polygon `HoleData`, so `PhysicsEngine`, the texture bake, and all tests are untouched. New `src/data/courseLoader.ts`; spline helpers in `src/utils/Geometry.ts`; v1 JSON still loads.
- **A2 — Re-author all 3 holes (M).** Rectangles are unsalvageable per the Bible. H1: welcoming gentle dogleg with a real landing zone, bunkers guarding the aggressive line. H2: keep the water carry, angle/tilt the green, pinch the tucked-pin side. H3: memorable double-bend par 5 where water tempts a reach-in-two. Update `aiTargets` to the balanced lines.
- **A3 — Palette & contrast (S).** Hue-separate the families: rough desaturated toward olive, fairway mid emerald, green light yellow-green, fringe its own color; widen the fringe 20→~32px so it survives mipping. Acceptance: a *grayscale* aerial still shows four distinct turf values.
- **A4 — Tee/green/bunker geometry (M).** Raised beveled tee platform with markers (retire the painted square); green as a slightly-raised chamfered disk with its own material + high-res texture patch + visible fringe collar; dished bunkers with raised lips. Introduce a `visualHeightAt(x,y)` seam for ball/golfer placement — Stage B swaps in the real heightfield behind it.
- **A5 — Distance readability (S).** Flag scales with distance to a minimum screen size; optional green highlight ring in aim/aerial views. Acceptance: hole 3's green unambiguous from the tee on a phone.
- **A6 — Multi-scale surface detail (S).** Per-surface tiling detail textures on the now-separate meshes (uses the asset track below); don't raise the global bake resolution.

### Stage B — Elevation (L, HIGH risk; gate behind Stage A shipping)
- New `src/systems/HeightField.ts` compiled from authored control points (dome/plateau bumps) — hand-authorable and diffable.
- `PhysicsEngine` takes an optional heightfield (null = today's exact behavior, so the existing test suite is the regression gate); gradient-driven rollout and green break replace the single per-hole `slope`; ground mesh, cameras, and putt grid sample it.
- Author elevation for all 3 holes: plateau greens, elevated H2 tee over water, H3 downhill drive — the Bible's elevation requirements.

### Stage C — Material & lighting polish (M; independent tasks, each with before/after FPS from Stage 0)
- Turf shading: detail normal maps with sun-responsive mow stripes, subtle ramp.
- **Water shader** (scrolling normals, fresnel-to-sky, depth tint, shore fade) — the art doc's showpiece and the cheapest early "wow"; can jump the queue right after Stage A.
- Baked AO at surface transitions and bunker lips; sand ripple normals + ball depression.

**Sequence:** 0 → A1 → A2 → A3 → A4 → A5/A6 → **ship** → (C2 water optional early) → B → C.

---

## 6. Asset acquisition track (Art Director)

Runs alongside Stage A; stages A3/A4/A6/C consume the results. Style-match to the owned ithappy/CGTrader look.

1. **Tileable stylized turf textures + normal maps** (biggest win): fairway, rough, green, fringe variants. Free/CC0 first — FreeStylized (freestylized.com), 3dtextures.me "Stylized Grass", ambientCG, OpenGameArt; paid fallback Poliigon. Used as multi-scale detail maps over the baked albedo so turf has grain at gameplay distance.
2. **Sand texture with ripple normal map** (CC0: ambientCG / FreeStylized) — pairs with A4 bunker lips.
3. **Golf furniture prop pack** (CGTrader; prefer seller **ithappy** for consistency with the characters): flagstick/pin variants, tee markers, benches, ball washers, golf bags, cart, clubhouse. Fixes "no distinct tee" alongside the A4 platform and gives holes the Bible's "visible landmarks."
4. **Water normal map** (CC0, ambientCG) for the Stage C water shader.
5. **Skybox/cloud textures** (Poly Haven HDRI or stylized skybox) — lower priority; the procedural sky is passable.
6. **Sweat the packs we own.** Fantastic Nature has 211 meshes; only ~12 are integrated, and it ships **no textures** (flat recolored materials — part of the flat look). Obtain its companion texture set or hand-paint a small gradient atlas; integrate roots, stumps, and waterlilies for water edges.

Process: store raw packs under `asset-packs/<name>/` with the provenance README + verification convention already established; convert FBX→glb via the headless-Blender pipeline; commit only curated game-ready glbs to `assets/`.

**⚠️ Licensing flag (Ops).** Purchased CGTrader source zips are committed to the repo. If this repo is public (it deploys via GitHub Pages), that redistributes paid source assets — likely a license violation. Verify repo visibility; if public, move the raw zips to private storage and keep only converted game files in the repo.

---

## 7. Adjacent recommendations (next check-ins, not this redo)

1. **Re-surface 1v1 / scramble / AI opponents** — already built and tested; needs only menu + wiring. Biggest feature-per-effort in the codebase.
2. **Debt pass:** delete dead code (`Scoring` class, `opponents.ts` wiring, unused `GolferLook` fields), split the 1,219-line `main.ts` god module.
3. **Docs refresh:** README + `04_TECHNICAL_ARCHITECTURE.md` → Babylon reality; collapse `ARCHITECTURE_REVIEW.md` stale layers.
4. **Phase 2 balance** after the course redo (putting depth, dispersion bands, wind-by-trajectory, real green contours — Stage B's heightfield feeds this directly).
5. **Second course** to meet the V1.0 two-course bar — much cheaper once the schema-v2 authoring format exists.

---

## 8. QA notes

- Unit coverage is good on the pure core (physics, geometry, fire, history, archetypes) and nonexistent on everything visual/interactive — the Stage 0 screenshot harness is the first visual regression tool.
- `turnManager.test.ts` and `scoring.test.ts` currently test dead code; keep them (they gate the re-surfacing work in §7.1).
- Every Stage C task must land with a before/after FPS measurement on a mid-range phone profile (the 60fps bar is in three separate docs).
