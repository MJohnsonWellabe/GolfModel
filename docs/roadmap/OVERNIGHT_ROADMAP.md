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

## Morning summary (filled in as work completes)

_(pending)_
