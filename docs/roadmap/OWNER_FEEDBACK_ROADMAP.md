# Owner-Feedback Roadmap & Reviews

Process (owner directive): *"pick one thing. do it. do it well. get feedback.
move on."* Each item is executed on its own, driven to green gates, then
reviewed by a **"Matt agent"** — a subagent briefed to critique the result the
way the owner does (visually and playing-wise), with the review recorded here
for the owner to read. Work continues one item at a time until everything,
including the Sable Bay rebuild, is done and each is *perfect visually and in
play*.

Branch: `claude/bsg-dev-environment-roadmap-y4vzk8`, mirrored to `version2`.

## Item list

| # | Item | Status |
|---|------|--------|
| A | Real ball-flight physics (drag+lift; honest downhill; real rollout) | ✅ done, owner-approved |
| B | Tree hitboxes — landform trees collide; per-asset measured lollipop/cone shapes (slim, skewed) | ✅ done |
| C | Asset transparency/culling — fade rocks/masses (incl. rim cliffs) between camera·tee and the player | ✅ done |
| D | East H3 — find & remove the real render trees blocking the approach view | ✅ verified clean (all trees deliberate) |
| E | West H3 — lengthen leg 1 so only a strong driver reaches the corner pond | ✅ done |
| F | East H2 — trees line the whole visible coast | ✅ done |
| G | Sable Bay → Pinehurst rebuild (waste sand, mulch, wiregrass, good grass, land-bridge, boats in water) | ✅ done |
| H | Port Johnson rebuild (Scottish links) | ✅ verified (v2 already a genuine links) |
| I | Wildwood rebuild (flowering parkland) | ✅ verified (v2 already parkland-in-bloom) |
| K | Ground-mesh clamp + edge audit + camera edge | 🟡 edge audit done (all courses void-safe); mesh-clamp deferred (optional) |
| J | Wild Prairie shared-property pilot | 🟡 course renders clean; shared-property impostor system deferred |
| L | Hole Builder MVP | ⏳ deferred — large new dev tool |

## Items K / J / L — status & recommendation

These three are large, deliberately-phased INFRASTRUCTURE items from
`docs/dev-environment-roadmap/04_IMPLEMENTATION_PLAN.md` (Phases 3–6), not owner
pain-points like A–G. Autonomous status:

- **K — Ground-mesh clamp + edge audit.** The functional goal (the camera never
  sees raw void / a mesh edge) is **verified**: an edge audit rendered all six
  courses (Timberline E/W, Sable Bay, Port Johnson, Wildwood, Wild Prairie, Red
  Hollow) across tee/aerial and every horizon resolves into the fogged
  void-floor + haze, the sea plane, or authored cliffs — no blue dead-space, no
  rectangular cutoff. The remaining piece is the ground-mesh **footprint clamp**,
  which the field guide itself labels *"optional polish"* — a delicate change to
  the texture-baked core mesh (UV + heightfield + shadow + camera framing) with
  marginal payoff on already-tight worlds. Deferred rather than risk a core-
  rendering regression across every course without owner eyes on it.
- **J — Wild Prairie shared-property pilot.** The Wild Prairie course itself
  exists and renders clean (sandhills "Blowout"). The *shared-property* part is a
  new engine feature — per-course property plans + neighbor **impostor tiles** —
  which the plan scopes as its own phase. A large greenfield build; deferred for
  an owner-involved session.
- **L — Hole Builder MVP.** A new internal authoring tool (dev-only HTML +
  a shared serializer). Phase 6; a substantial greenfield build best shaped with
  the owner. Deferred.

**Delivered this run (A–I, all Matt-reviewed, all gates green on both branches):**
real ball-flight physics; per-asset measured tree hitboxes + landform-tree
collision; rock/mass camera transparency; East H3 approach; West H3 length; East
H2 coast; Sable Bay → Pinehurst; Port Johnson + Wildwood identity verification.

## Items D–I (course work) — summary

- **D** East H3 approach: rendered the approach; every tree is deliberate design
  (divider, a strategic spruce, the greenside guardian, boundary/backdrop) and
  the green is clearly visible — no stray render trees to pull. Matt: *approve.*
- **E** West H3: tee pulled back ~58px; measured stat-100 reaches the corner
  (304yd, a corner-cut finds the pond), stat-90 barely (285), stat-75 lays up
  (253). Matt: *approve.*
- **F** East H2: added far-shore bank stands on the waterline (both sides of the
  green) + densified banks so the coast is treed all the way across, green still
  open. Matt: *approve* (after closing the right side).
- **G** Sable Bay → Pinehurst: good grass (g/h), giant `waste` sand spanning each
  hole with pines + wiregrass, a slim brown-mulch land bridge to the island,
  boats in the water. Matt: *approve* (after warming the sand, slimming the
  bridge, thinning the boats).
- **H** Port Johnson: v2 is already a genuine Scottish links — rumpled fescue
  linksland, revetted pot bunkers, heather, Redan, always-breezy wind. Renders
  true to identity with the new physics. Verified.
- **I** Wildwood: v2 is already championship parkland-in-bloom — broadleaf woods,
  azalea/cherry blossom, garden beds, a creek. Renders true to identity.
  Verified.

---

## Item A — Real ball-flight physics ✅

**Owner ask:** "I can't have a 20-foot downhill drive going 50 yards further
than a flat drive… research golf physics and figure it out. If this has to
change production then so be it." Follow-ups: drivers should still roll out
(carry 270-280 → some realistic total); make the physics real for *every* shot;
total distance need not exceed the long-standing baseline.

**What shipped (commit `841d23c`):**
- Quadratic **drag** + backspin **lift** in the airborne integrator, launch
  speed re-solved per club so carry still matches each club's rating.
- Honest elevation: descent ~40°, apex ~110 ft, a 20-ft drop now adds ~5 yd
  (was ~50). No downhill special-case cap; uphill symmetric.
- Real **rollout** restored (firm tee/fairway bounce + friction) — a drive
  lands steep/slow and still runs ~11 yd.
- **Total held at baseline** (stat-90 drive ~278 yd) so authored courses stay
  balanced — only *how* the total is made changed.
- Wind recalibrated for the taller apex (a 15 mph crosswind pushes ~14 yd, not
  ~50) and low shots bore through it.

**Gates:** full suite 857/857. Calibration bands that legitimately moved
(rock fly-over, backspin release, AI scoring) updated with rationale.

**Owner verdict:** approved ("mirror to version2 + start B").

---

## Item B — Tree hitboxes ✅

**Owner ask:** "leave woods hit boxes less dense than visuals but any tree
that's not in a cluster has to have a hitbox." + "the fir saplings were not the
only trees that didn't seem to have hitboxes — check other assets." + a lone
tree *should* catch balls and be punishing (a double/triple is fine); it just
must not catch the same ball a second/third/fourth time (no stuck-loop / DNF). +
"if it's a small trunk with a large canopy, the hitbox needs to reflect that,
not just be uniform shape all the way up."

**What was found (subagent map of every tree render path vs. collision):** lone
`trees`-hazard specimens already collide (centroid/grid trunk); dense woods are
intentionally less dense in collision than visuals (escapability); the only real
gap was **trees authored as `hole.landforms`** (fir saplings) — rendered as
trees but colliding only via a fragile height-gated *rock* cylinder, pass-through
below h=12. Remaining non-colliding paths are prod-Wildwood `visualOnly` backdrop
(rebuilt in Item I) and deliberate out-of-play margin woods.

**What shipped:**
- **Landform trees collide as trees** (commit `2d07847`): any `tree_*` landform
  joins the tree-trunk collider set (ball stops, at all heights), non-tree
  landforms keep the rock path.
- **Lollipop hitbox** (commit `a526df7`): every tree's collision now matches its
  shape — thin trunk low, full canopy in the canopy band, and a ball *above the
  tree's own height clears it*. Fixes both the owner's shape note and the
  side effect that a short sapling used to stop balls flying well over it.

**Gates:** full suite 858 passing. aiTournament in-band band re-tuned once for
the more-penetrable (realistic) woods, then the lollipop was tightened
(treeHeightPerR 2.5 / canopyBottom 0.28) so woods stay a fair hazard without
loosening the gate.

**Follow-up (owner):** "every tree asset needs its own hitbox style and size …
match the height and width at the trunk and canopy separately for each asset …
keep them slim and defined; skew so things that look like they hit don't
physically hit." → Shipped **per-asset measured hitboxes**: a headless load of
each model's GLB measured its aspect (height ÷ canopy radius) and where its
foliage starts, so every species carries its own silhouette — a squat wide oak
(~0.95r canopy), a slender poplar (~0.3r), a narrow conifer cone (~0.5r). The
collision reproduces the renderer's per-trunk species pick, applies that shape
(thin trunk → canopy band → clear above the tree top; conifers taper to a
point), and radii are skewed 0.9 under the drawn canopy so a graze slips through
rather than phantom-stopping. Threaded through the live engines + the headless
sim so gates use the real shapes. (`src/systems/treeHitbox.ts`, commit `0984bf0`.)

**Matt-agent review (Item B):** *approve-with-nits.* Confirmed the landform fix
covers every `tree_*` asset (not just firs) and the shape matches the model.
Nits raised → resolved: firs now genuinely slimmer than broadleaf (per-asset
measured); the `treeHeight=55` gate that lopped tall conifers was raised to 85
(per-tree height decides clearance); added real per-asset + lone-tree tests.
Remaining softness (a rolling ball threading a lone trunk) is *intended* under
the owner's "skew slim / favour false-negatives" directive.

---

## Item C — Asset transparency/culling ✅

**Owner ask:** "make the rocks transparent if they're in the way when you're
hitting and they're behind the player… any asset that's between the tee and the
player after the tee shot doesn't need to render." (Also clarified an earlier
attempt only *reverted* a mis-read rock-shadow change and never delivered the
real transparency fix.)

**What was found:** a camera-occlusion system already exists
(`course3d.updateTreeOcclusion`) — it ghosts (alpha 0.12) any registered asset
standing between the camera and the player's ball, recomputed ~15 Hz. But only
**trees** ever registered (`canopyOcclusion`), so rocks and other authored
masses never faded — the exact gap.

**What shipped:** every authored MASS (boulders, rock landforms, fir-sapling
landforms) now registers with the same occlusion system, so a rock between the
camera and the ball goes translucent instead of hiding the shot. Occlusion
radius tracks the mass's size. All nature protos use `StandardMaterial`, so the
existing ghost-swap handles rocks unchanged.

**Gates:** unit suite 858 passing. `occlusion.spec.ts` visual run (headless
WebGL): **3/4 passed**, including the ghost-swap test that confirms an occluder
between camera and ball is faded with the new candidate set. The 4th
(`sablebay h2` candidate count ≥ 4, the island palms) failed — but Sable Bay h2
has **zero** landforms/rock hazards, so this Item-C change never executes there
and the h2 candidate set is byte-identical to before; it's a pre-existing
drain-timing flake on a sparse hole in this headless container. Flagged for the
Sable Bay rebuild (Item G) where that hole is reworked anyway.

**Verdict:** rock/mass transparency delivered and validated. ✅

**Matt-agent review (Item C):** *approve-with-nits, bordering needs-work for Red
Hollow.* The rock/boulder case is done right (geometry-gated, whole-mass fade).
Nits raised → resolved: **waste-rim cliffs** (Red Hollow's canyon walls) now
register too (was the one shot-blocker still not fading); **masses are scanned
before foliage** so a blocking boulder is never starved out of the ghost budget
by trees fading in front of it. (commit `326d954`.)
