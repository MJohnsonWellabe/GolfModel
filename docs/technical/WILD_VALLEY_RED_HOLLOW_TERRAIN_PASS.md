# Wild Valley + Red Hollow — Terrain Identity Pass

**Status:** IMPLEMENTATION RECORD (playtest round 4, 2026-07-18).
**Target:** the terrain identity sheet supplied by Matt — Red Hollow as three
distinct Utah desert holes (shelves, cliffs, canyon depth, rocky wash), Wild
Valley as rolling Nebraska Sandhills (continuous dunes, dense golden native
grass, deep strategic blowouts). Dev-flagged (`newCourses`); prod untouched.

Units: 1 world unit ≈ 1 ball diameter (BALL_REST radius 0.5). Sheet budgets
used throughout: RH tee→fairway 6–15, shelf→canyon 15–40, mesa greens 6–15;
WV rolling 2–5, dune shoulders 4–8, green/tee benches 3–7, blowouts 2.5–5,
ridge→valley 7–14.

## 1. Audit of the pre-pass state (commit b7c1f72)

Shared systems (kept, per the sheet's "do not change unless needed"):
HeightField (radial dome/plateau splat grid, CELL=8, physics+mesh+cameras all
sample it), bunkerDepthScale/wasteDepthScale dishes, fairway ribbon schema
(multi-ribbon capable), waste-rim/scatter/sand-plant planting, layered
`mountain_range_red` backdrop + backstop, packed bunker lips, camera presets
(tee/aerial/approach/green/club), Monte-Carlo playability gates, soak.

Per-hole findings:

| Hole | Elevation reality | Problems vs sheet |
|---|---|---|
| RH1 Rimrock | mounds h1.4–3.8, edge drop −7 plateaus | Drop is at the WORLD EDGE, not against the fairway — no readable shelf; tee↔fairway ~flat; same backdrop as h2/h3; rocks are uniform scatter |
| RH2 Devil's Kitchen | green plateau h3.2, chasm FLAT waste | No empty-space carry — the "chasm" is painted flat sand; green +3 is not a mesa; identical backdrop |
| RH3 Wolf Run | mounds ≤3.2, edge drop −7/−8 | Wash doesn't cross the fairway (fairway ribbon overrides waste); one long smooth ribbon, no shelves; identical backdrop |
| WV1 Blowout | isolated domes h1.6–2.8 | Exactly the "isolated circular bumps" the sheet forbids; valley not readable; blowout lobes off the direct line |
| WV2 Kettle | shoulders h2.8–3.6 | Bowl doesn't enclose — three separate domes; green not in/beside a real kettle |
| WV3 Sandbox | domes h1.8–2.8 | Flat rough between narrow fairway and distant waste; no ridge/valley structure |

Both courses: every hole shares one identical 5-layer mountain composition;
rough grass on WV reads scattered-clumps over bare ground at distance.

## 2. Terrain-authoring extensions (minimal, additive)

The radial system cannot express long dune ridges, valley walls, canyon rims,
or near-vertical faces. Two additive fields on `ElevationPoint` (all existing
data unchanged; both default to prior behavior):

- **`x2`/`y2` (ridge segments):** distance is measured to the SEGMENT
  (x,y)→(x2,y2) instead of the point — one entry becomes a long ridge, wall,
  bench or valley rim. Splat bounds = segment bbox + r.
- **`skirt` (cliff steepness):** plateau flat-fraction override (default
  0.55). 0.85–0.92 gives a near-vertical face at CELL=8 — used for mesa
  sides, canyon walls, and blowout lips. (Applies to plateau shape.)

Also added: **`hole.landforms`** (authored major rock formations:
`{key, x, y, h}` placed from the nature prototype set) so red-rock masses
frame specific landing zones/shelf edges deliberately instead of only random
scatter, and **per-hole backdrop compositions** in course3d (seeded by hole
number — different silhouette arrangement each hole).

Out of bounds: the game has no stroke-and-distance OOB system; canyon floors
are deep WASTE (sand lie, huge recovery penalty by distance/depth). Noted as
a compromise below.

## 3. Per-hole plan (implemented)

### Red Hollow 1 — Rimrock (cliff-shelf hole)
Tee bench +9 → fairway shelf +4 running along a rim; the entire LEFT of the
shelf drops −16 via steep-skirt ridge walls to a red canyon floor (waste);
right side rises +6–8 rock benches with authored cluster landforms framing
both landing zones. Green on a distinct +8 bench. Backdrop: low wide range
right-weighted, far small echoes.

### Red Hollow 2 — Devil's Kitchen (signature mesa carry)
Tee on the HIGHEST bench (+14). Green mesa +10 with steep-skirt plateau
(near-vertical faces on the front/left/right)... between them a genuine
canyon: floor at −18 (waste), i.e. ~30 units of visible relief under the
carry. Shoulder mesas flank at +12–14 with cluster landforms stacked on top.
Backdrop: one dominant central massif + high haze echoes (unique to h2).

### Red Hollow 3 — Wolf Run (S-curve shelves + crossing wash)
Three fairway shelves stepping DOWN the S (+10 → +5 → +1) with ridge walls
between them; the dry wash (waste ribbon, rocky fill) now genuinely CROSSES
the fairway between shelf 1 and 2 — the fairway is authored as TWO ribbons
with a gap at the crossing, so the surface really is waste (physics + look),
lined with rock clusters and dead scrub. Green on a final +7 shelf. Right
edge keeps the mountainside drop (−14). Backdrop: flat-topped mesa line
(wide, low, mirrored pair) — reads as a different skyline from h1/h2.

### Wild Valley 1 — Blowout (high tee → valley run → green shelf)
Continuous dune RIDGES (segments, h4–7, r120–200) frame a real valley the
fairway occupies; tee on a +6 shoulder, green tucked on a +4 shelf between
two ridge ends. Blowouts sit where the strategy is: carry-line pot at the
inside of the dogleg pinching the aggressive line, valley-side blowout
catching the bailout, two greenside pots under the shelf. Rolling h2–3
cross-ridges everywhere between the big ones.

### Wild Valley 2 — The Kettle (the bowl earns the name)
One ENCLOSING horseshoe of ridge segments (h5–7) wraps the green — a real
kettle open only at the front-right; green bench +4 inside it. Deep blowout
in the kidney notch (kept) + a second pot cut into the kettle's inner face.
Short-side miss feeds off the cant into the notch bunker as before.

### Wild Valley 3 — Sandbox (offset ridges)
Alternating OFFSET diagonal ridges (h4–6) the fairway threads between —
each landing zone is a saddle between ridge ends; the second-shot ridge
partially screens the green (par-5 decision: lay back for a view or carry
the shoulder blind). Green complex raised +5 behind the last ridge with the
cross-pots at its base. Blowout lobes tightened onto the landing zones'
outside lines.

Grass: field fescue density up again (tallGrass density 24, tuft 2.6), and
the fescue planting band widened to cover ridge flanks — continuous prairie,
not clumps on bare ground. Perf guard: soak instance counts recorded below.

## 4. Validation

- `tests/unit/terrainPass.test.ts` (new): canyon separation on RH2 (green
  minus chasm floor ≥ 22), RH1 shelf-to-floor drop ≥ 14, RH3 wash actually
  crossing (waste surface between the two fairway ribbons on the centerline
  path), WV ridge-to-valley amplitude within 7–14, WV blowout depth ≥ 2.5
  below rim, every WV bunker within strategy radius of an aiTarget/green,
  and terrain continuity (no >3-unit step between adjacent 8px samples on
  fairways — catches accidental walls under the ball).
- Existing gates re-run: 661 unit, 17 sim (playability), soak (disposal +
  instance counts), production build.
- Screenshots: before/after from identical cameras (tee/aerial/approach/
  green × 6 holes) — see PR/chat. Flyover and ball-flight cameras are
  animated and were reviewed by eye in dev rather than captured.

## 5. Remaining compromises

- No true OOB: beyond cliff edges is deep waste floor, not stroke-and-
  distance. Needs a real OOB rule if wanted.
- Cliff faces are steep terrain (skirt 0.85–0.92 at CELL=8), not literal
  vertical rock-wall meshes; read as cliffs at gameplay cameras but soften
  near-orthogonal close-ups.
- The wash interacts with the ball as waste sand + uneven micro-terrain;
  individual rocks in it are visual (no per-rock collision).
- Backdrop variation reuses the one CC-BY range diorama in different
  compositions/mirrorings/scales per hole (no second range asset exists);
  silhouettes differ per hole but share rock DNA.

## 6. Identity pass 3 — landform-first rebuild (2026-07-19)

Follow-up direction: the pass above was "technically correct but
artistically missing" — rebuild composition until every hole is
recognizable from one screenshot, with a hero landform per hole.
Landform first, golf second; backgrounds must connect to play.

What changed (all six holes rebuilt around ONE enormous landform each):

- **RH1 — THE CLIFF WALL.** A 28-34-high wall runs the entire right side
  (two segments; the southern face crowds the drive corridor), wraps
  behind the green into an amphitheater spur, with a 15-deep ravine along
  the left edge. Rock stacks crown the wall crest.
- **RH2 — THE MESA.** The canyon floor IS the default ground; the tee
  (+27) and green (+22, skirt 0.92) mesas rise from it, and a mesa FIELD
  (h22-30 walls) runs past every world edge so the canyon reads endless.
- **RH3 — THE WINDING CANYON.** The hole plays on the canyon floor between
  18-24-high rim walls tracking the S-curve on both sides; shelf steps and
  the crossing wash live INSIDE the canyon; rim formations crown the tops.
- **WV1 — THE GREAT RIDGE.** One h15 wind-sculpted dune runs the whole
  right side with blowouts cut into its flank; the fairway flows down the
  valley at its foot; edge dunes continue the system past every side.
- **WV2 — THE AMPHITHEATER.** The kettle scaled to landform: h11-12.5
  enclosing walls (open front-right), rim shoulders running past both
  edges, green low on the bowl floor (tee +4.5 looks INTO the bowl).
- **WV3 — THE BLOWOUT WALL.** Two mega-ridges (h11-12) cross the hole; a
  three-bowl blowout complex is torn out of the second ridge's face on the
  aggressive line; the green rides high behind the last ridge's shoulder.

Backdrop compositions now end in full-width curtain layers per hole, and
the backstop wall spans -540..+60 (top LOW so its flat cream top never
shows above range saddles; bottom deep so elevated tees can't see sky
under the ranges). WV amplitude gate widened to 20 for the hero landforms.

Screenshot iteration rounds: 3 (wall visibility from tee FOV, amphitheater
amplification, curtain/backstop seam fixes). All 12 terrain gates, 17 sim
playability, 673 fast tests green after each round.

## 7. Pass 4 — Red Hollow routing + Wild Valley prairie/strategy (2026-07-19)

Red Hollow routing refinement (art direction unchanged):
- **h1 Rimrock** is now ONE continuous +10 sidehill shelf (tee, fairway and
  green all on it, gentle undulation). LEFT: the shelf simply ends — a
  steep −24 drop at the fairway edge; physics carries anything landing
  there down to the canyon-floor waste. RIGHT: the mountainside rises
  immediately — the lower slope's gradient kicks slight misses back to the
  fairway; the +8 upper terrace beyond is effectively out of bounds, and
  the great wall climbs from it.
- **h2 Devil's Kitchen** has NO fairway (fairways: []) — a pure tee-mesa to
  green-mesa carry. Both mesas got natural sandstone outlines: promontory
  lobes and erosion notches on the skirt ring, with the tee/putting
  surfaces kept smooth.
- **h3 Wolf Run** is now three EQUAL-height island platforms (+4) carved
  into the canyon below an elevated tee (+18): chosen carries platform to
  platform, island 1→3 is exactly driver range (a big hitter skips island
  2). The green sits INSIDE an open-front bowl one level below the islands
  — not on a pedestal.
- **Green design rule** (new gate, both courses): every putting surface
  must be smoothly puttable — ≤1.2-unit steps between adjacent samples and
  ≤5 total relief across the surface. Several dune/bowl/spur skirts that
  crossed greens were pulled off them to pass.

Wild Valley pass 2 (terrain/greens preserved; prairie + strategy):
- **Prairie clustering** (`theme.prairieClusters` + course3d): tall-grass
  density is modulated by smooth value noise — large continuous dense
  patches, natural transitions, double-planted cores — and native-grass
  fingers intrude past the fairway cut line where the noise peaks. Field
  density up again (27).
- **Blowout architecture**: much larger, ragged outlines (jitter 0.5+),
  browner exposed sand (#d9bd85/#b3945c), deeper bowls (wasteDepthScale 3,
  sandSculpt 1.0), still fescue-packed lips.
- **Strategy**: h1's widened drive zone is SPLIT by a deep mid-fairway
  bunker (left lane / right lane / carry); h3 gets the same decision at
  its second landing zone; h2's kettle keeps its green, with bigger
  blowouts torn from the bowl's outer faces.

Gates: 14 terrain tests, 17 sim, 675 fast — green; loader lint clean.

## 8. Pass 5 — Red Hollow gameplay & landscape refinement (2026-07-19)

A refinement pass, not a redesign — hole identities from passes 3–4 kept.

New mechanic — TRUE OUT OF BOUNDS (`hazards[].type: 'ob'`):
- An `ob` region is not a surface: rendering and lies keep the underlying
  look (the canyon floor still shows its waste-sand dressing). Only the
  REST position is checked — a ball finishing inside it takes a +1 stroke
  penalty and drops in the rough approximately where it crossed
  (PhysicsEngine.obDropPoint walks the flight line back to the last
  in-bounds point, then ~10 units farther back). Wired through the live
  round (main.ts, "OUT OF BOUNDS! +1 penalty") and the headless
  RoundSimulator, so the balancing AI pays the same penalties.
- `hazards[].depthMul` scales an ordinary bunker's dish depth per-bunker
  (HeightField), for erosion-bowl pots.

Per hole:
- **h1 Rimrock**: the whole canyon floor left of the shelf is OB — no
  recovery from down there; the boundary tracks the cliff base so the
  playable shelf and upper cliff face stay in bounds. The routing bends
  farther LEFT after the landing zone (fairway wraps the hillside,
  x382 at y690, cutting back right only at the green shelf). The right
  wall begins DIRECTLY beside the fairway (terrace spines at x575–620,
  no buffer) and runs nearly the whole hole, its final segment tapering
  (r170, endpoint pulled NE) so the skirt never crosses the putt.
  Aggressive outcrops: a cliff-edge rock line down the entire left rim,
  wall-crest rocks, landing-zone frames, green-complex rocks.
- **h2 Devil's Kitchen**: unchanged design; the two greenside pots are now
  DEEP erosion bowls (depthMul 2.2 — punishing but playable), a broad
  erosion shelf is bitten out of the mesa's back rim (long is dead:
  −20+ within ~70 of the back collar, the back collar itself stays
  puttable), and the green mesa's rim + skirt are studded with exposed
  sandstone (7 new rock landforms incl. the bowls' outer lips).
- **h3 Wolf Run**: green complex only — the horseshoe is RAISED
  (left 8→11, right 7.5→10.5; the back wall as TWO stacked spines, the
  near one kept at pass-4 h9 because any taller crosses green2's rear
  spokes, plus a farther +8 crest). Misses left/long/right funnel down
  the walls into collection areas with lofted recoveries; the front
  stays open. Rocks crown the raised walls.

Gates: 18 terrain tests (new: h1 OB region + drop-point behavior, h2
erosion-bowl depth ≥3.5 + back drop-off, h3 raised-wall heights),
114 sim, 696 fast — all green; loader lint clean; production build green.
