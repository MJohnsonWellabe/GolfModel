# 25 — Smoothness & First-Round Pass

**Status:** IMPLEMENTATION RECORD (dev-gated). Everything here ships behind
flags that default **prod:false / dev:true** — production behaviour is
unchanged until each is promoted on the device matrix
(`docs/DEVICE_MATRIX.md`).

Two questions drove this pass, both from the owner:

1. Where is the game spending frames it does not need to spend — without
   changing what the player sees, except where nothing is at stake (the
   unplayable area)?
2. What stops a new player from finishing their first round?

## Flags added

| Flag | Default (prod/dev) | What it does |
| --- | --- | --- |
| `natureBatching` | off / on | Draws all scatter as static thin-instance batches instead of one scene node per prop |
| `resumeRound` | off / on | Checkpoints a solo round at each hole boundary; the landing offers to finish it |
| `tutorialDepth` | off / on | Adds wind, club, lie and recovery lessons, a step counter, and a completion reward |
| `quickPlay` | off / on | Play Now tees off immediately; the mode/course wizard moves to its own entry |

---

## Part 1 — Performance: static scatter batching

### What was actually costing frames

Measured under software GL (SwiftShader) at the armed-address camera, after the
time-sliced planting drain had fully settled:

| Course | Scene nodes | Active meshes/frame | Active-mesh evaluation |
| --- | --- | --- | --- |
| Sable Bay | 339 | 239 | 0.37 ms |
| Wildwood Glen | 1,392 | 901 | 1.39 ms |
| Timberline | 1,892 | 912 | 1.71 ms |
| Port Johnson | 4,020 | 2,786 | 3.94 ms |

Two costs sit behind those numbers, and neither has anything to do with how the
course looks:

1. **Active-mesh evaluation.** Babylon walks every mesh each frame and
   frustum-tests it. On Port Johnson that is a quarter of the frame spent
   deciding what to draw.
2. **Per-frame instance-matrix upload.** Instancing already collapses draw
   calls, but the world matrix of every VISIBLE instance is rewritten into the
   instance buffer and re-uploaded each frame — roughly 200 KB/frame on Port
   Johnson — even though not one of those matrices ever changes. The existing
   `freezeWorldMatrix()` calls skip recomputing the matrix, not copying it.

The instance breakdown showed where the volume is, and it is not what the eye
reads: Port Johnson is ~1,660 grass tufts and 228 heather cards; Wildwood is
642 flower stem/bloom parts on top of its trees.

### What was NOT worth doing

The obvious lever — thin the vegetation — is already spent. The bounded-world
rule (`boundedWorld`, shipped) stops **all** ground scatter at the playable
boundary, so there is no off-course vegetation left to cut. Every remaining
tuft stands inside the playable corridor, where thinning would be a visible
change to the course. So this pass took the cost out of the RENDERING, not out
of the content.

### What was done

`src/slice3d/natureBatch.ts` plants the same props as **thin instances grouped
into ~240 yd spatial cells**. Geometry and material are shared exactly as
before; the transform buffer is uploaded once; each (prototype part × cell)
batch is a single scene node that frustum-culls as a unit. Cells rather than one
giant batch per species so coarse culling survives — one batch for the whole
hole would draw every tuft on the course while the camera looks the other way.

The canopy fade (a tree between the camera and the golfer goes translucent) now
runs against a small `PropHandle` interface that both planting backends
implement, so there is one fade code path rather than two.

Results, same measurement conditions:

| Course | Scene nodes | Active meshes/frame | Active-mesh evaluation |
| --- | --- | --- | --- |
| Sable Bay | 339 → **184** | 239 → **118** | 0.37 → **0.27 ms** |
| Wildwood Glen | 1,392 → **362** | 901 → **204** | 1.39 → **0.50 ms** |
| Timberline | 1,892 → **318** | 912 → **192** | 1.71 → **0.39 ms** |
| Port Johnson | 4,020 → **207** | 2,786 → **121** | 3.94 → **0.26 ms** |

Per-frame wall time is deliberately NOT quoted: under SwiftShader the water
mirror and shadow map swing the frame cost by an order of magnitude depending
on whether the camera is parked, which swamps the scene-graph cost this change
targets. Node and evaluation counts are deterministic and are the honest
measurement here; frame pacing is judged on the device matrix, as
`docs/technical/PERFORMANCE_AND_QUALITY_GATES.md` requires.

### How "no visual change" is proven

`tests/visual/natureBatching.spec.ts` renders the same hole, same seed, same
locked loadout, same camera, twice — flag off, then flag on — and pixel-compares
the two frames. Port Johnson h1, Wildwood h1 and Timberline h1 all land at
**0.21 %–0.34 %** differing pixels (alpha-edge noise on grass cards; the gate
allows 1 %). The spec also asserts the node collapse, so a version of the change
that stopped batching would fail rather than silently pass.

Two real bugs were caught by that gate during development and are worth
recording, because both are easy to reintroduce:

- **Shared geometry.** Babylon stores a thin-instance matrix buffer as
  instanced vertex buffers on the mesh's `Geometry`, and `clone()` shares
  geometry. Every batch of the same prototype part was overwriting the previous
  one's transforms. Each batch now owns its geometry (`makeGeometryUnique()`) —
  cheap, because these are low-poly props.
- **Upload order.** `thinInstanceBufferUpdated()` uploads exactly
  `thinInstanceCount` slots, so the count must be raised BEFORE the upload.
  With it after, each batch's most recently planted prop stayed on the CPU and
  never drew — which showed up as a single missing specimen oak on Wildwood #1.

### Also fixed

The water mirror's render list latches after a few stable frames (it cannot
scan the scene forever). A tree that planted after the latch never reflected.
The list is now rebuilt once when planting completes. This fix applies to both
planting paths.

---

## Part 2 — Finishing the first round

### Should the default course change?

**No — Sable Bay is the right default, and now there is evidence.** Beginner
scoring, 220 seeded Monte-Carlo rounds per course at the casual tier (stat 72),
via the same `RoundSimulator` the balance gates use:

| Course | Mean to par | Hole 1 to par | Hole 1 triple-or-worse |
| --- | --- | --- | --- |
| Sable Bay | +1.73 | +0.42 | **1 %** |
| Wildwood Glen | +2.37 | +0.61 | **10 %** |
| Timberline | +1.93 | +0.56 | **8 %** |
| Port Johnson | +1.88 | +0.74 | 2 % |
| Red Hollow | +1.20 | +0.30 | 0 % |
| Wild Prairie | +1.57 | +0.05 | 0 % |

Sable Bay is the lightest scene in the game (a fifth of Timberline's node count
before batching, a twelfth of Port Johnson's), it is the tutorial hole, and one
beginner in a hundred blows up its opening hole. Wildwood — the previous
default — does that to one in ten. Retiring it from the intro slot was correct
and the numbers back it.

If a softer landing is ever wanted, **Wild Prairie has the gentlest opening
hole in the game** (+0.05, no blow-ups). It is not recommended as the default
today: it is the newest generated course and Sable Bay's coastal opener is the
stronger first impression, but it is the course to reach for if first-hole
frustration ever shows up in the funnel data.

### Resume an unfinished round (`resumeRound`)

Closing the tab on hole 2 used to lose the round outright. That is the cheapest
abandonment in the funnel to recover, and it lands hardest on new players —
whose *first completed round* is the event that unlocks daily, weekly, Season
Pass and Store (progressive disclosure, Part 11 of the retention pass).

`src/systems/RoundCheckpoint.ts` writes a hole-boundary checkpoint (course,
seed, hole, scores). The landing then offers **"Finish the round — Sable Bay ·
hole 2 of 3 · +1"** above every other card, with "Start fresh" beside it.

Deliberate limits, all enforced by `isResumable` and unit-tested:

- The hole in progress **restarts from its tee**. Nothing mid-shot is stored,
  so nothing mid-shot can be restored wrongly.
- **Solo rounds only.** Versus rounds carry an opponent's state, AI tournaments
  span three courses, and weekly/tournament/challenge entries carry submission
  rules — reviving any of those from a partial record risks a mis-scored or
  double-submitted entry, which the player-trust rules say not to gamble with.
- Checkpoints **expire after 48 h**, and a record with no progress (hole 1,
  empty card) is never offered — it would just be a second Play button.
- A checkpoint whose course has left the roster is retired rather than shown.

### The tutorial (`tutorialDepth`)

The shipped lesson teaches the **controls**. It never mentions the two things
that actually decide where a new player's ball ends up — the wind blowing
across the hole and the club in their hands — both of which the HUD is already
showing them. A player who does not know wind pushes the ball reads their own
miss as randomness, which is exactly the "I do not know what happened" failure
`docs/vision/03_PLAYER_EXPERIENCE.md` names as the thing to avoid.

Added:

- a **wind** card and a **club** card on the first tee;
- a contextual **lie** card the first time the player addresses from rough,
  sand or fringe;
- a contextual **recovery** card after a water/OB penalty, reframing the worst
  moment of a first round as a normal golf problem rather than a swindle;
- a **step counter** ("Step 3 of 8"), so the lesson visibly has an end;
- a **closing card that names the next action** ("Two holes left in this round")
  instead of trailing off, plus a one-time **50-coin** completion reward;
- **completion is remembered** on the device: the lesson stays available but
  stops competing with Play once it has been taken.

`tests/simulation/tutorialContent.test.ts` locks both taught rules — the 6:1
putting pace rule and the wind copy — to what the code actually does, so a
reword cannot quietly ship a lie.

### One-tap Play (`quickPlay`)

Play Now opened a wizard asking for mode and course before a first-time player
had any basis for answering either, and charged every returning player two
extra taps to say "same as last time". Play Now now tees off immediately as a
solo round on the course this device last played (the default course on a first
launch), and the wizard moves to an explicit **"⛳ Course & mode"** entry
beneath it. The last-played course is remembered device-locally, so it is a
preference, not progress — guests get it too.

---

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` — **919 passed, 1 skipped** before
  this pass's additions, all green after (12 new checkpoint tests, 4 new wind
  lesson tests, 1 new flag-defaults test).
- `tests/visual/natureBatching.spec.ts` — three courses, flag-on vs flag-off
  pixel comparison, all pass.
- Existing perf gates, soak, results and occlusion specs unaffected: the
  batching path is off unless the flag resolves on, and the fade/mirror
  refactors keep the same behaviour on both paths.

## Known limitations

- Headless frame timings under software GL are not usable for the batching
  comparison (see Part 1). **The device matrix is the arbiter**, and none of
  these four flags should be promoted before a real-device pass.
- Batching duplicates prop geometry per (part × cell). These are low-poly props
  so the cost is small, but a future high-poly prop would want a larger cell or
  an exemption.
- The resume checkpoint restarts the in-progress hole; a player who quits
  standing over a putt loses that hole's strokes. That is a deliberate trade for
  correctness over completeness.

## Rollback

Each flag is an independent kill switch. Setting any of them off restores the
previous behaviour exactly — the batching path, the checkpoint read/write, the
extra tutorial cards and the one-tap Play entry are all skipped entirely, not
merely bypassed.

## Further opportunities (not built)

Recorded here so they are not lost, roughly in value order:

1. **Promote batching, then revisit the water mirror.** With scene-graph cost
   down, the planar reflection RTT is the dominant remaining per-frame GPU cost
   on the water holes. A depth-aware screen-space approximation, or dropping
   the mirror ratio further on low-end devices, is the next real win.
2. **A "first three rounds" difficulty ramp.** The simulator shows a 10 %
   first-hole blow-up rate on Wildwood. A soft opening — pin positions drawn
   from the gentler authored set for a device's first few rounds — would cost
   nothing visually and is measurable through the existing analytics.
3. **Funnel instrumentation for the abandon point.** `round_started` and
   `round_completed` exist; a `round_abandoned` event carrying the hole reached
   would tell us whether hole 1, 2 or 3 is where first rounds die, which is
   currently guesswork.
4. **Surface the resume card in the results loop too**, so a player who leaves
   from the results screen mid-Play-Next sequence gets the same recovery.
5. **Prototype-level LOD for tree canopies.** Batching removed the per-node
   cost; the vertex cost of a full forest at distance is untouched and is a
   pure-win target that never changes the near-field image.
