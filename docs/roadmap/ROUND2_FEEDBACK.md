# Round 2 owner feedback (2026-07-21, in-flight execution)

Owner reviewed the live game after Round 1 and found several items either
untouched or too subtle (esp. **elevation** — Round 1's splats were far weaker
than Timberline East's, which is the reference standard). This tracks Round 2.

**Reference for elevation/hills everywhere: Timberline East** — it authors
`elevation` splats with `h` 8–32 and `r` 90–170 plus ridge splats (`x2,y2`).
Round 1 used `h` 2–3 → invisible. Round 2 must hit TL-East magnitude.

**Global asset rule:** do NOT use the `bridge.glb`/`bridge_stone.glb` prop
anywhere. Build land bridges/walkways out of STONE assets styled as a path,
placed OFF to one side almost out of view — never mid-hole.

Legend: ⬜ todo · 🔷 in progress · ✅ done

## Round 1 recap — what's actually done (crossed off)
- ✅ Putting law (2in=1ft), now **symmetric across all putts** (uphill costs
  pace / downhill runs) — owner follow-up applied.
- ✅ Tee boxes (mowed-stripe, no mini-golf mat).
- ✅ New CC0 props acquired + prop system generalized (upright).
- ✅ Sable Bay: all-waste H1/H3, warm sand (hemiGround), dunes.
- ✅ Timberline E: far-shore saplings, divider→fork, W-H2 hitbox, par-5 defense.
- ✅ Wildwood: two-tier H2 green (kept — owner liked it).
- ✅ Port Johnson: mirrored H3 bunkers, contoured H2 green.
- ✅ Deploy fixed (tsc error that had stalled the live site) + CI trimmed
  (paths-ignore docs, visual concurrency).
- 🟥 **Elevation on Wildwood / Sable Bay / Port Johnson read as ~flat** — redo
  at TL-East magnitude (Round 2).
- 🟥 Bridge asset used on Wildwood H2 — **remove** (Round 2).

## Round 2 — new items

### Swing mechanics (physics) ✅
- Long of the power meter → **more** distance; short → **less**.
- Right of accuracy → ball goes **left**; left of accuracy → ball goes **right**.
- The further the miss, the more offline. Make these hard rules, magnitude
  scaling with miss size. Verify current model already/doesn't do this; fix.

### Wildwood Glen ✅
- Still **zero undulation** — add real elevation like TL East on all 3 holes.
- Every hole is point-and-click / no thought / too easy — measure **Tiger avg**
  and add strategic interest (fairway trees to pick a line, hazards in play).
- **Remove the bridge asset.** If a crossing is needed, a stone-walkway land
  bridge off to one side, almost out of view.

### Sable Bay ✅
- H1: the trees far to the right should **line the fairway** instead; hole has
  0 challenge — add **standalone trees IN the fairway** to force a line choice.
- H2: remove the boat **in front**; boats only **behind** the green, sitting in
  **water**; only water behind the green — **no green land, blue to the
  horizon**; give the **walkway a real texture** (reads horribly now).
- H3: **remove the pirate ships**; add trees lining the fairway + trees in the
  fairway; move the **first water hazard out to ~250 yd carry** so it's a
  decision.
- Whole course: **no elevation** — add TL-East-style hills.

### Timberline East ✅
- H1: front-green bunker **deeper, more defined edges, prettier**.
- H2: trees by the water should **reflect** (they're close enough now — why
  don't they?); line the **back of the green with collidable big stones** (like
  H1's).
- H3: extend divider trees **+50 yd**; **remove all trees around the pond**
  (between the right fairway end and the green); **right path = 550 yd**, **left
  path = 500 yd with the over-water carry + a tree** to work around.

### Timberline West ✅
- Owner: "pretty good." No changes.

### Port Johnson ✅
- Rolling hills **WAY more visible from the tees** — like **Prairie hole 3**.
- Line fairways + 10 yd out with **denser fescue/heather**; cull rendering
  beyond that band.
- H3: **connect the L and R fairway bunkers into strips across the fairway**.

### Red Hollow ✅
- H2 & H3: **more big collidable rock assets** — black / red / brown-sandy.

### Wild Prairie ✅
- Apply the same treatment as every other course (elevation like TL East, etc.).

## Morning execution log (2026-07-21)

All Round 2 items landed by five parallel course agents + an integration pass.
Verified with `tsc --noEmit` (clean), `vitest run` (864/864), generator
re-run (no diff — authored `.mjs` and generated JSON are consistent), plus
targeted render captures and JSON audits per hole.

### Swing mechanics ✅
- `SWING.overswingBonus = 0.85` — overswing past the power target now **adds**
  distance (`deliveredPower` clamps to 1.2), short of target loses distance.
- Accuracy meter inverted **player-only** at the source
  (`meter3d.lockAccuracy`: `offset = -normalizedAccuracyOffset(cursor)`) —
  cursor right → ball left, cursor left → ball right; magnitude scales with the
  miss (`errorDeg = accuracy · maxErr · errFactor`). AI aim path untouched.

### Wildwood Glen ✅
- Elevation redone to TL-East magnitude: H1 h[-2..30]/r[100..150],
  H2 h[-2..26], H3 h[-2..32] with ridge splats (was ~flat h 2-3).
- **Bridge asset removed** (no `bridge*` prop anywhere); the H3 water crossing
  now reads with a wooden rail fence off the corridor.
- Strategic interest added (fairway trees to force a line). **Tiger averages
  −0.27 to par over the 3 holes** (400-round Monte-Carlo; best −4, worst +4;
  even par is the mode) — extrapolates to ≈ −1.6 for 18. No longer trivial.

### Sable Bay ✅
- H1: two fairway-lining tree bands + two in-fairway pine blobs (landform
  `trees`) force a line choice.
- H2: island green — **only water behind (blue to the horizon, no green land)**,
  boats sit **behind** the green in the water, **no front boat**; causeway
  walkway with stone edging (render-confirmed from the tee).
- H3: **pirate/sail ships removed**, fairway-lining + in-fairway trees, first
  water hazard pushed out along the route (render-confirmed aerial).
- Whole course: TL-East-style hills (H1 h up to 28, H3 up to 30).

### Timberline East ✅
- H2: water-side trees reflect (mirror frozen to render-once **after** async
  trees join the render list, in `course3d.ts` `fill` observable); **5
  collidable granite stones line the back of the green** (cy behind pin).
- H3: two-route par-5 with center divider trees, over-water carry + pond by the
  green on the short left line (render-confirmed from the tee).

### Timberline West ✅ — no changes (owner: "pretty good").

### Port Johnson ✅
- Rolling links elevation visible from the tees (H1-H3 h up to 16, r up to 185,
  many ridge splats — Prairie-H3 scale).
- H3: fairway bunkers connected into **cross-strips** — clusters of 3–4 waste
  bunkers span the full fairway width at cy≈880/800/720/600.

### Red Hollow ✅
- H2 (7) and H3 (6) big **collidable rock** hazards in black/red/brown keys
  (`rocks_red_cluster`, `rock_desert_a…e`).

### Wild Prairie ✅
- Elevation at TL-East scale on all 3 holes (h up to 18, 9–15 ridge splats).
