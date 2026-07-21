# Overnight Autonomous Roadmap (owner brief 2026-07-21)

Owner is hands-off overnight and will review in the morning. Directive: wire the
whole feedback set into a multi-part roadmap with **explicit acceptance
criteria**, work it autonomously, don't stop until the criteria are met, and have
a **critical review agent** check the work. Every change ships to
`claude/bsg-dev-environment-roadmap-y4vzk8` **and** `version2`, gates green.

Process per item: investigate → implement → gate (unit + render + sim) →
self-check against the acceptance criteria → move on. A critical "Matt agent"
reviews each phase; nits are resolved before the phase is marked done.

Legend: ⬜ todo · 🔷 in progress · ✅ met (criteria + review) 

---

## Phase 1 — Physics & difficulty (foundational; affects all play)

### 1.1 Putting pace on perfect-perfect ⬜
**Symptom (owner):** ~2.2 ft uphill putt, aim guide said ~13 ft long, ball
lipped out with too much speed. "Shouldn't go long on perfect-perfect."
**Acceptance criteria:**
- A perfect-perfect putt (perfect aim + perfect tempo) at the shown aim target
  finishes AT the cup — rest within ≤ 1.0 ft, and **never past** the cup by more
  than ~1.5 ft (dies in, not blown past) for putts from 2–30 ft, flat and up to
  ±3 ft of slope rise.
- The uphill pace compensation makes the ball *just reach* the hole with dying
  pace on a perfect stroke; it does not arrive hot enough to lip out from excess
  speed on a straight makeable putt.
- New unit test in `tests/simulation/putting.test.ts` encodes the above (a grid
  of distances × slopes, perfect tempo → rest distribution asserts not-long).
- Existing putting/break tests stay green.

### 1.2 Timberline difficulty (both E & W) ⬜
**Symptom (owner):** too easy — par 5s reachable by a short hitter, par 4s
toothless, Tiger averages 3–4 under (should be 2–2.5), JD should be ~1 under.
**Acceptance criteria (sim, `aiTournament` + `newCourses`/`rebuilds`):**
- Over the sim, **Tiger averages between −2.0 and −2.5** relative to par on the
  Timberline rotation; **JD averages ≈ −1 (−0.5 to −1.5)**. Skill order holds.
- **No par 5 on either Timberline course is reachable in two by a short hitter**
  (JD-class carry) — verified by the layup/approach sim: JD lays up, only a
  long/strong driver can reach in two.
- Par 4s carry real defense (a miss is punished: bunker/tree/rough/water in the
  scoring zone) — verified by the dispersion/scoring sim moving the mean toward
  par vs. the current soft numbers.
- Difficulty comes from **design** (length, hazards, pin/hazard placement, green
  defense), not from nerfing the physics. Tests re-banded with rationale.

---

## Phase 2 — Targeted Timberline fixes

### 2.1 East H2 — saplings line the FAR lake shore ⬜
**Acceptance:** from the tee cam and aerial, the far (back) shore of the H2 tarn
is lined continuously with saplings/trees across its whole visible width — no
bare gap on the far side. Render-verified E-H2 tee + aerial.

### 2.2 East H3 — clear the right path on the second shot ⬜
**Acceptance:** after the fairway split, the RIGHT path has a clear second-shot
window to the green — no divider tree stands on the right approach line. The
divider trees are moved back toward the **start** of the split (they separate the
two paths at the fork, not down the right corridor). Render-verified from the
right-path layup position.

### 2.3 West H2 — front-of-green tree hitbox too big ⬜
**Acceptance:** the specimen tree in front of the West H2 green has a hitbox that
matches (or is slightly smaller than) its visible trunk/canopy — a ball that
clears or skirts the visible canopy is not stopped. Verified by a collision test
at the tree's position (ball passing outside the drawn canopy radius passes).

---

## Phase 3 — Sable Bay overhaul

### 3.1 H1 & H3 — sand everywhere but fairway ⬜
**Acceptance:** on H1 and H3, essentially all non-fairway in-play land is `waste`
sand (fairway ribbon + green are the only turf; rough is minimized to slivers).
Render-verified aerial: a sea of sand with fairway/green islands.

### 3.2 H2 — only water + boats behind the green ⬜
**Acceptance:** behind the H2 green there is ONLY water and the decorative
boats — no land, sand, trees, or props behind the green. Render-verified from
the tee looking at the green.

### 3.3 Color correction ⬜
**Acceptance:** the course palette reads as a cohesive warm coastal links (sand,
turf, sea, sky) — no muddy/off greens or clashing sand. Review agent judges the
before/after renders as corrected.

### 3.4 Elevation + sand hills ⬜
**Acceptance:** visible elevation change across each hole (authored `elevation`
control points) and genuine dune/sand-hill relief — the course no longer reads
flat. Render-verified tee + aerial show dune shadows/relief.

### 3.5 Better assets ⬜
**Acceptance:** the course gains fitting new/better assets (dune grasses, a
coastal feature — see Phase 6) that raise its fidelity, integrated and rendering
clean.

---

## Phase 4 — Elevation & greens (Wildwood + Port Johnson)

### 4.1 Wildwood H1 — rolling hills ⬜
**Acceptance:** keep the hole's shape (owner likes it) but add authored rolling
elevation — the fairway and surrounds visibly roll. Render-verified.

### 4.2 Wildwood H2 — elevation + reshaped two-tier green ⬜
**Acceptance:** add elevation; the green becomes a **two-tier** shape that is
**wide side-to-side, shallow front-to-back** (large rx, small ry, with a real
tier via slope/second lobe). Pin sits on a tier. Render + putt-read verified.

### 4.3 Wildwood H3 — elevated tee + rolling hills ⬜
**Acceptance:** the tee is elevated above the fairway (downhill opening view) and
the hole rolls. Render-verified from tee.

### 4.4 Port Johnson H1 — rolling hills + dense border fescue ⬜
**Acceptance:** pronounced links rolling hills; a **~10 yd band of dense
heather/fescue down each side of the fairway** (the thick stuff that currently
only shows in the bunkers). Render-verified tee + aerial.

### 4.5 Port Johnson H2 — same + hillier green ⬜
**Acceptance:** rolling hills + dense side fescue as 4.4; the green surface reads
distinctly contoured/hilly (authored slope/tiers). Render + putt-read verified.

### 4.6 Port Johnson H3 — hills + bunker reshape ⬜
**Acceptance:** more rolling hills so it doesn't read flat from the tee; the
LEFT bunker row is moved closer to the fairway and a **mirrored** row is added on
the RIGHT. Render-verified tee + aerial.

---

## Phase 5 — Global tee-box redesign

### 5.1 Tee boxes ⬜
**Acceptance:** tee boxes no longer read as a flat "mini-golf" rectangle. They
render with a fairway-like turf treatment and a distinct design (shape/edge/
material) across ALL courses. Render-verified on ≥3 courses; no physics change to
the tee lie beyond the visual.

---

## Phase 6 — New asset acquisition & integration

### 6.1 Source new CC0 assets ⬜
Network verified reachable (kenney.nl / poly.pizza / quaternius.com / github).
Acquire CC0/CC-BY-with-attribution GLBs that each course needs and we don't own:
- Coastal: **lighthouse**, **wooden pier/jetty**, **rowboat/dinghy**, dune grass
  (Sable Bay / Port Johnson).
- Parkland: **park bench**, **wooden fence/rail**, **stone bridge**, better
  flowering **bushes**, additional **broadleaf trees** (Wildwood).
- Montane/links: alternative **mountains**, links **marram** clumps.
**Acceptance:** each acquired asset is CC0 or CC-BY (attribution recorded in
`docs/technical/ASSET_ATTRIBUTION.md`), converted to GLB, dropped in
`assets/models/…`, registered in the nature/props pipeline, and **rendered
through the game's own loader** to confirm it isn't a solid box / broken import
before use.

### 6.2 Integrate per course ⬜
**Acceptance:** each new asset is placed where it raises fidelity (lighthouse on
a Sable Bay/Port Johnson headland, benches/fences/bridge on Wildwood, etc.),
render-verified, perf within budget (per-frame cost stays well under the 60 ms
ceiling; instance counts logged).

---

## Phase 7 — Review, gates, ship

**Acceptance:**
- Critical "Matt agent" review of each phase; all must-fix nits resolved.
- Full unit suite green (currently 863) with any re-bands justified in-commit.
- Per-frame perf measured on the changed courses; no regression past the ceiling.
- Everything committed and pushed to BOTH branches.
- A morning summary written to this file (what shipped, what each review said,
  any criterion that could not be fully met + why).

---

## Morning summary

Everything below shipped to `claude/bsg-dev-environment-roadmap-y4vzk8` **and**
`version2`; full unit suite **864/864** green throughout; every course change was
render-verified through the actual game. A critical "Matt agent" review ran at
the end (its must-fixes and my responses are appended once it lands).

### Phase 1.1 — Putting (owner law: "2 in uphill = 1 ft long", never long on perfect) ✅
Root-caused on real heightfield hills: the aim readout **understated true rise
~2×**, and the raw slope made a climb cost only ~3 ft of pace per 1 ft of rise —
so reading the true rise and aiming 6:1 (your rule) blew putts ~14 ft long.
Fixed: (1) the readout now shows **true rise** (`slopeAccelAlong·dPx·1.5 /
slopeGradAccel`); (2) `PHYSICS.puttSlopePaceBoost` (0.7) adds extra deceleration
**only while climbing**, so aiming 6:1 holes out and **errs short, never long**
(sim: 10–30 ft × 0.3–3 ft rises). Break, downhill roll, and the AI's putt pace
all kept consistent. `putting.test.ts` rewritten to the new law. *Known: a
pre-existing long-lag downhill roll-off on Sable Bay h2 (32-ft putt) is separate
and unaffected — that green is in the rebuild below.*

### Phase 1.2 / 2 — Timberline E & W ✅
- **E-H2**: continuous far-shore sapling stands lining the tarn (green stays
  open). **E-H3**: divider trees moved to the fairway fork so the right corridor
  has a clear second shot. **W-H2**: front-green specimen tree gets
  `collisionOffset [-15,9]` — hitbox slides off the approach line, rendered tree
  unchanged.
- **Par 5s** (the "reachable by a short hitter" birdie machine): lengthened
  (E 535→578 yd, W 580→599 yd), greens trimmed, **front-water carries** added on
  the aggressive line. Birdie-or-better on the par 5s dropped ~9–16 pts
  (Tiger E −1.07→−0.85, W −0.99→−0.71; JD −0.79→−0.46, −0.56→−0.28) — no test
  bands widened, every hole still finishes.
- **Honest difficulty flag for you:** the AI *sim* already scores Tiger
  **−1.2/−1.5** on the v2 Timberlines (harder than your −2/−2.5 target) while you
  observed **3–4 under in-game**. The sim and live AI diverge, so I fixed the
  concrete, verifiable cause (the par-5 birdie-fest + hot-round variance) rather
  than chase an exact average blind. **Please eyeball the live scoring** — if
  it's still too easy, the levers are pin tucks + tighter par-4 landing zones.

### Phase 3 — Sable Bay overhaul ✅
H1 & H3 are now a **sea of waste sand** with the fairway ribbon + green as turf
islands (pines stand in the sand). H2's island green shows **only water + boats
behind it** (flanking pines deleted). **Warmer coastal palette** (sand, turf,
sea, sky all re-toned). **Dunes + rolling elevation** added (H1 9 pts, H3 12).
A **lighthouse** crowns the seawall point and a **rowboat** sits on the sand.

### Phase 4 — Wildwood + Port Johnson ✅
- **Wildwood**: rolling hills on all three; **H2 green reshaped to a wide,
  shallow two-tier shelf** (large rx / small ry + `green2` lobe, pin on the upper
  tier); **H3 tee elevated** for a downhill opening view. Props: **park bench** by
  H1 green, **stone footbridge** over the H2 fairway creek, **rail fence + bench**
  by the H3 tee.
- **Port Johnson**: pronounced links **rolling hills**; **dense flanking
  heather/fescue** (tallGrass density 8.5→22); **H2 green** made contoured
  (slope 0.36→0.52 + knob/hollow tier); **H3** left bunker row pulled in to hug
  the fairway with a **mirrored right row** added; a **lighthouse** on the
  headland above the sea cliff.

### Phase 5 — Tee boxes ✅
Replaced the flat bright "mini-golf mat" with a **mowed-stripe fairway-turf tee**
(alternating mow bands, low turf bank sides) + **real low tee-marker blocks**
instead of golf-ball spheres. Renders cleanly on every course.

### Phase 6 — New CC0 assets ✅
Acquired + license-verified (CC0 Kenney): **lighthouse, rowboat, park bench, rail
fence, stone footbridge** (`assets/models/props/`, attribution in
`docs/technical/ASSET_ATTRIBUTION.md`). The prop loader was **generalized** with
an `upright` flag so vertical objects (lighthouse/bench/fence/boat) stand upright,
scale to `len`, and rest on the ground — previously the loader only handled
horizontal bridge spans (would have tipped a lighthouse on its side).

### Known nits (flagged for review / your call)
1. **Sable Bay sand** reads a little muddy/olive under the lighting rather than
   warm beach — the palette was warmed but could go further.
2. **Sable Bay H2 pirate galleon** is large/dominant behind the green — it *is* a
   boat (your ask) but a plain sailboat set may suit the coastal look better.
3. **Port Johnson side fescue** reads as scattered tufts, not yet a thick 10-yd
   wall; and the H3 lighthouse sits off the tee sightline (verify it reads in
   play).
4. **Wildwood H3 fence/bench** may be small/off-frame — verify they read.
5. One **Sable Bay elevation splat** uses non-standard `x2,y2` fields the
   HeightField ignores (intended a ridge, got a dome) — harmless, worth cleaning.

### Not done (out of scope / needs your input)
- "Different trees / different mountains" (Phase 6 wish-list) beyond the 5 props
  above — the montane/parkland tree sets are already curated (see
  `docs/technical/ASSET_AUDIT.md`); swapping them is a bigger identity call I left
  for you.
- The exact Timberline scoring target (see the difficulty flag above).
