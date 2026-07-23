# Difficulty Calibration — Brainstorm

**Status:** BRAINSTORM ONLY — no implementation. This is the "how we'd do it"
the owner asked for before any code. Everything below is a proposal to react to,
not a decision.

---

## 1. The problem, in the game's own numbers

From the admin "average strokes by hole" panel (live data, n = 3–5 rounds each).
Holes are par 4 / par 3 / par 5:

| Course | H1 (par 4) | H2 (par 3) | H3 (par 5) | Round to par |
|---|---|---|---|---|
| Timberline East | 3.4 | 2.6 | 4.4 | **−1.6** |
| Wildwood Glen | 3.2 | 3.0 | 3.8 | **−2.0** |
| Port Johnson | 3.5 | 2.5 | 4.0 | **−2.0** |
| Wild Prairie | 2.75 | 2.25 | 4.0 | **−3.0** |
| Timberline West | 3.5 | 2.25 | 4.25 | **−2.0** |
| Red Hollow | 3.0 | 2.33 | 3.67 | **−3.0** |
| Sable Bay | 3.33 | 2.33 | 4.0 | **−2.33** |

Read the shape, not just the totals:
- **Par 4s go ~0.5–1.25 under par.** A par 4 averaging 2.75–3.5 means birdie is
  the *expected* score — GIR is landing, and the birdie putt drops far too often.
- **Par 3s go up to 0.75 under par.** A one-shotter averaging 2.25 means a huge
  share of tee shots finish inside makeable range and the putt falls.
- **Par 5s average 3.7–4.4 — routinely reached in two, often eagled.** This is
  the single biggest leak: a par 5 that averages 4.0 is playing as a driveable
  par 4.

**Conclusion:** the game is ~2–3 shots too easy per 3 holes across the board.
Every phase (tee, approach, putt) is contributing, but the par-5 second shot and
the birdie-putt conversion are the loudest.

---

## 2. Real-golf benchmarks (the yardstick)

PGA Tour, recent seasons (round numbers):

| Metric | PGA Tour | Mid-am (~10–15 hcp) |
|---|---|---|
| Fairways hit (FIR) | ~61% | ~45% |
| Greens in regulation (GIR) | ~66% | ~25–35% |
| Putts per hole | ~1.6–1.8 (1.77 per GIR) | ~1.9–2.05 |
| 3-putt avoidance | ~97% | ~85% |
| Scrambling (up-and-down) | ~59% | ~30% |
| Scoring vs par | ≈ −1 to E per round | +15 to +20 |

The owner's stated targets — **60–70% FIR, ~similar GIR, 1.5–1.8 putts/hole** —
are essentially *tour ball-striking with good-but-human putting*. That is the
right target for the **top of the skill range** (a near-perfect user swinging a
strong golfer). The whole point of the exercise is that this is the CEILING, and
weaker users / weaker golfers should fall off it in a measurable, fair way.

---

## 3. Target profile (what "calibrated" means here)

Difficulty in this game is a **2-D grid**: *user skill* (how often you hit the
swing bands) × *golfer skill* (the equipped golfer's stats). Calibration means
picking where each cell of that grid should land:

| | Weak golfer | Mid golfer | Elite golfer |
|---|---|---|---|
| **Novice user** (misses a lot) | bogey golf, +hi | ~bogey | ~bogey/par |
| **Good user** (mostly good, some perfect) | ~par | slightly under | under |
| **Perfect user** (near-all perfect) | under | well under | **the 60–70% FIR / 65% GIR / 1.6–1.8 putt ceiling** |

Design intents to agree on before tuning:
- **Only the top-right cell hits the owner's numbers.** Everyone else is worse,
  smoothly.
- **A perfect swing should still be rewarded** — perfection isn't punished, but a
  *good* (not perfect) swing should cost you the green often enough that GIR from
  good-only play is ~40–50%, not ~90%.
- **The par-5 "go for it in two" must be a real gamble**, not a free eagle look.

---

## 4. Why it's too easy — the lever list (hypotheses to test)

Ranked by suspected impact. The sim (§5) exists to confirm/rank these with
numbers before touching any of them.

1. **A "good" swing is nearly as good as perfect.** `SWING.goodBand` (0.09) and
   `goodBandMin` (0.055) are wide, and dispersion off a good click may be small.
   If good ≈ perfect, users bank GIR on every approach. *Suspected #1 GIR leak.*
2. **Greens hold everything.** Approaches that land on the green stay on the
   green — no firm bounce-through, no spin-back off the front. Real GIR is capped
   by greens rejecting slightly-off approaches. *Suspected #2 GIR leak.*
3. **Par-5 reachability.** Golfer carry + roll lets a stock second reach the par-5
   greens with a mid club and no penalty for a slightly-off strike. *The eagle
   leak.* (Ties into the Timberline East 3 tree finding — the guarding trees
   don't block the go-for-it line; see the TL-East-3 tree note.)
4. **Putting converts too well.** If make-% inside 8–15 ft is well above tour
   (~35–50% at 10 ft), birdie putts drop and par-4s go under. Need to check
   putts-per-hole and one-putt-% in the sim against §2.
5. **Dispersion doesn't fan out enough with distance or with a weak golfer.**
   `perfectDispersionDeg` is tiny (0.42–0.55°); the *quality multiplier* on
   good/missed clicks is what should widen shots. If that multiplier is gentle,
   even a novice sprays inside a fairway width. *Suspected #1 FIR leak.*
6. **Penalties rarely bite.** Water/OB/trees either aren't in the landing clouds
   or are too forgiving (e.g. the tree recovery multiplier halving hitboxes on
   every second shot). Hazards that never collect a ball don't add difficulty.
7. **Hole geometry vs real carry.** Bunkers/hazards may sit outside where balls
   actually land for the golfers people use — measure the landing clouds and move
   teeth into them (the field guide already documents this method).
8. **Fire streak compounding.** On-fire widens the perfect zone ×1.4 and boosts
   stats — a good user snowballs. May be fine as a reward, but it's a multiplier
   on an already-easy base.

---

## 5. The simulation methodology (the core of the ask)

The owner's framing exactly: *"run sims with golfers of different levels in
actual gameplay with dispersions of perfect/good/miss to simulate user skill vs
golfer skill."* Here is the harness.

### 5a. Model the USER as a swing-outcome distribution
A human turn is two clicks (power, accuracy), each landing in `perfect | good |
miss`. Model a user as a small profile:

```
UserSkill = {
  power:    { perfect: p1, good: p2, miss: p3 },   // sums to 1
  accuracy: { perfect: a1, good: a2, miss: a3 },
}
```
Seed a few canonical users to bracket the range:
- **Perfect** ≈ {perfect .9, good .1, miss 0}
- **Good** ≈ {perfect .45, good .45, miss .1}
- **Average** ≈ {perfect .2, good .5, miss .3}
- **Novice** ≈ {perfect .08, good .42, miss .5}

(Later these can be *derived* from real telemetry — the swing-quality histogram
the game already records — so the "Average user" is the actual player base, not a
guess.)

### 5b. Model the GOLFER as stats (already exists)
`GolferStats` → `statsForClub()` already yields `{distance, dispersion, zone}`
per club. Pick 3–4 golfers spanning the roster (weak / mid / elite). Reuse the
real seam so the sim and the game agree.

### 5c. Compose one shot
For each shot: sample the user's power & accuracy outcomes from 5a → convert to
the same power error / directional error the live swing meter produces for that
band (this is the ONE new mapping the harness needs, and it must match the real
`SwingMeter`→`PhysicsEngine` path, not a parallel guess) → scale by the golfer's
dispersion/zone → feed `PhysicsEngine.simulate`. Play the ball from rest, pick
the next club/aim with the same logic the AI/άuto-player uses, repeat until holed.
This is a *full-round* sim, not a single-shot dispersion test — that's what makes
FIR/GIR/putts emergent instead of assumed.

### 5d. Metrics to capture (per user×golfer cell, over N seeds/holes)
- **FIR%** (tee shots on par 4/5 finishing in fairway)
- **GIR%** (on the green in regulation strokes)
- **Putts per hole**, one-putt %, 3-putt %
- **Scrambling %** (up-and-down when GIR missed)
- **Penalty rate** (water/OB/tree strikes per round)
- **Scoring vs par**, and the **par-3 / par-4 / par-5 splits** (the table in §1
  is exactly the output to reproduce and then move)
- **Reach-in-two %** on par 5s

### 5e. Harness shape
- Extend the existing `tests/simulation/` rig (it already loads courses, builds
  height fields, runs `simulate`, and loops seeds). The new piece is the
  **user-skill sampler** and a **round driver** that records the §5d metrics to a
  JSON in the scratchpad (vitest swallows `console.log` — write files, per the
  field guide).
- Output a **grid report**: rows = users, cols = golfers, cells = the metric
  bundle. This is the dashboard we tune against.
- Run it against **all courses × holes** so per-hole outliers (the par-5s) show
  up, not just aggregates.

**Important honesty check:** the sim is only trustworthy if the user→shot mapping
is the *same math* as the live meter. Step one of any implementation is a
validation pass: reproduce the current §1 table from the sim using the *measured*
average-user profile. If the sim can't reproduce "too easy," it can't be trusted
to tune it. Only once it matches do we start moving levers.

---

## 6. The calibration loop

1. **Validate:** sim reproduces the live §1 numbers with the measured user mix.
2. **Set targets per grid cell** (§3), with the perfect×elite ceiling = owner's
   60–70 / ~65 / 1.6–1.8.
3. **One lever at a time:** move a single lever (§4/§7), re-run the grid, read the
   metric delta. Keep an audit trail (lever → metric shift) so effects are known,
   not guessed.
4. **Watch the whole grid, not one cell.** A change that fixes the perfect user
   must not make the novice unplayable. Fairness across the grid is the gate.
5. **Re-run the real gates** (`newCourses` playability, terrain/rock, perf) after
   any physics or course change — difficulty tuning must not break "every hole
   finishes" or the performance budget.
6. **Freeze + screenshot** the resulting hole behaviors for regression.

---

## 7. Levers, ranked by leverage (and blast radius)

| Lever | Where | Effect | Blast radius |
|---|---|---|---|
| Good-band width / good-swing dispersion | `SWING.goodBand`, quality mult in `PhysicsEngine` | GIR, FIR from good play | **Global** — every shot |
| Green firmness / hold (bounce-through, front spin-back) | `PhysicsEngine` landing on green | GIR cap | Global |
| Putt make-% curve | putting model + green contours | putts/hole, birdie rate | Global |
| Dispersion-vs-distance & vs weak golfer | `statsForClub`, quality mult | FIR, novice separation | Global |
| Par-5 length / second-shot teeth | course JSON (hazards, tee) | reach-in-two % | Per hole |
| Tree/hazard bite (e.g. recovery-mult scope) | `PhysicsEngine` tree logic | penalty rate | Global-ish |
| Fire perfect-mult / stat boost | `SWING.firePerfectMult`, `FIRE` | snowball | Global (reward) |

Prefer **global mechanic levers** for the systemic "too easy" (they move the
whole grid coherently), and **per-hole geometry** only for local outliers (a
specific par 5, a specific undefended green). Avoid fixing a global problem with
30 one-off hole edits.

---

## 8. Risks & guardrails

- **Don't just lengthen everything.** Making holes longer inflates scores without
  making them *interesting*; the field guide's "difficulty via strategy" note
  (aggressive vs safe line) is the better pattern.
- **Keep perfection rewarding.** The fix is to punish *good/miss*, not to nerf
  *perfect*. A perfect user should still shoot the ceiling numbers.
- **Fairness floor.** `newCourses` requires every hole to finish and mean-to-par
  in range; a novice cell must stay playable, not spiral.
- **Reduced-motion / accessibility** users still need a fair experience — skill
  expression, not twitch.
- **Telemetry drift.** Once live, re-pull the real user swing-quality histogram
  periodically; the "average user" moves as the player base changes.

---

## 9. Suggested phasing (when greenlit)

1. **Build + validate the grid sim** (no balance changes) — prove it reproduces
   the §1 table.
2. **Diagnose** — rank the real leaks with numbers (confirm/kill the §4 list).
3. **Tune globals** — good-band, green hold, putt curve, dispersion — to pull the
   perfect×elite cell onto the ceiling and the grid into shape.
4. **Tune par-5s and any undefended greens** — per-hole geometry for the residual
   outliers.
5. **Re-validate the whole grid + real gates**, screenshot-freeze, ship behind a
   review.

---

*Nothing here is implemented. Awaiting the owner's read on the target grid (§3)
and which levers (§7) to open first before any code.*
