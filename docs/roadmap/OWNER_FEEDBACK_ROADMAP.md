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
| B | Tree hitboxes — every standalone/non-cluster tree collides; woods stay less dense in collision than visuals | 🔧 in progress |
| C | Asset transparency/culling — fade/hide assets between camera·tee and the player so they don't block the shot view | ⏳ |
| D | East H3 — find & remove the real render trees blocking the approach view | ⏳ |
| E | West H3 — lengthen leg 1 so only a strong driver reaches the corner pond | ⏳ |
| F | East H2 — trees line the whole visible coast | ⏳ |
| G | Sable Bay → Pinehurst rebuild (waste sand, pine straw/mulch, wiregrass, good grass, land-bridge causeway, boats in water) | ⏳ |
| H | Port Johnson rebuild | ⏳ |
| I | Wildwood rebuild | ⏳ |
| J | Wild Prairie shared-property pilot | ⏳ |
| K | Ground-mesh clamp + camera edge | ⏳ |
| L | Hole Builder MVP | ⏳ |

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

## Item B — Tree hitboxes 🔧 (code done, review pending)

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

*(Matt-agent review pending — will be appended.)*
