# Difficulty Calibration — Brainstorm (v2, mechanics-only)

**Status:** BRAINSTORM ONLY — no implementation. Supersedes the v1 draft.

**Owner's constraints (this revision):**
- **No course changes at all.** Every lever here is in the swing mechanic /
  physics, never in a hole's geometry, hazards, or length.
- **Perfect should be smaller** (harder to hit).
- **Bigger drop-off after perfect, then after good** — but the penalty stays
  **smooth and continuous, just harsher**. No cliffs, no discrete steps; the
  curve simply gets steeper the further you are from perfect.
- **Reward playing well, punish playing poorly.**

**Owner's target outcomes (a round = the 3 holes of a course, par 12):**
| Who | Round vs par |
|---|---|
| Great user + highly-skilled golfer | **−3 to −4, consistently** |
| Good user, hot (lots of perfects) | near **−3 to −4** |
| Good user, cold (more good/miss) | **even to over par** |
| Novice user | **bogey golf** (≈ +3 over 3 holes) |

The through-line: **the same golfer should produce a wide spread of scores driven
by how well the USER swings.** Today it doesn't — everyone lands ≈ −2 to −3
regardless (see §1). Widening that spread is the whole job, and it must come from
the swing outcome, not from making holes harder.

---

## 1. Why the spread is missing today (all in the mechanic)

The current swing is **too forgiving**, which flattens the skill spread:

1. **A "good" swing ≈ a "perfect" swing.** The accuracy error is continuous from
   perfect→good→miss (meter3d.ts:317-333) — which is the right *shape* (owner
   wants smooth) — but its **slope is too gentle**: landing in "good" instead of
   "perfect" barely bends the start line, so a mediocre swing still finds the
   target. The smoothness is fine; the harshness is missing.
2. **The perfect band is generous.** `perfectBandMin/Max = 0.008–0.026` half-width,
   scaled by stat on a ^1.5 curve (meter3d.ts:187-194). At a strong golfer that's
   a wide dead-on zone — frequently hit.
3. **The good band is very wide** and near-costless: `goodBandMin/Max = 0.055–0.09`
   half-width (up to ~18% of the bar). A huge slice of swings land here for almost
   no penalty.
4. **Power loss is gentle.** Short-of-target scales linearly (`c / fullPowerMark`,
   meter3d.ts:308-310); a "miss" only multiplies power by a random 0.82–0.94
   (meter3d.ts:337). The distance you lose for a sloppy swing is small.
5. **The penalty curve is roughly linear.** `normalizedAccuracyOffset` grows about
   proportionally with the timing error, so a near-perfect miss and a bad miss are
   only linearly apart. There's no *acceleration* — no sense that it gets worse
   fast as you stray.

Net: the mechanic barely separates a great user from an average one, so *course*
difficulty was doing the work — and the owner has taken that lever off the table
(correctly: difficulty belongs in the swing).

---

## 2. The redesign: same smooth curve, harsher and steeper

Keep the **continuous** perfect→good→miss outcome (no cliffs — owner). Change its
**shape and steepness** so a small error costs little but the cost climbs fast:

- **Smaller perfect dead-zone.** Shrink `perfectBandMin/Max` so the "dead on-line,
  full distance" window is genuinely small — flushing it is an achievement and the
  reward anchor. Just inside it, outcome ≈ ideal; just outside it, the penalty
  begins immediately (smoothly).
- **Make the penalty curve convex (accelerating), not linear.** Let `e` be the
  timing error (0 at perfect). Instead of penalty ∝ `e`, use penalty ∝ `e^k` with
  `k > 1` (e.g. ~1.6–2.2), scaled up overall. Effect:
  - a *slightly* off swing is still nearly pure (stays satisfying, stays smooth),
  - but as `e` grows the penalty rises **faster and faster** — "a bigger drop-off
    after perfect, then a bigger one again past good" falls straight out of a
    convex curve, with **no step anywhere**. The good→miss region is simply the
    steep part of the same smooth curve.
- **Apply it to both clicks.** Accuracy: steepen `normalizedAccuracyOffset`
  (raise the exponent + lift the overall gain toward `maxErrorDeg`) so a mistimed
  accuracy tap bends the start line harder, faster. Power: replace the gentle
  linear short-fall with a convex loss so a swing that's well off the mark leaves
  a real distance gap, smoothly.
- **The old "very good" idea, resolved:** it isn't a discrete band — it's just the
  *near-perfect region of the smooth curve* where the penalty is still small. The
  convex shape gives that for free: the ring just outside perfect is gently
  penalized (a "very good" feel) and it steepens from there. So the labels
  perfect/good/miss stay only for **feedback** (band colors, the fire streak); the
  physics is one continuous, harsher curve.

Everything here is swing-side constants + the two curve functions. No hole changes.

---

## 3. The two axes and how they hit the target grid

**User skill = your timing-error distribution** (how close to perfect you stop the
cursor, shot after shot). **Golfer skill = how forgiving the curve is for that
golfer** — band widths already scale ^1.5 with stat, and per-error dispersion
should scale with the golfer's accuracy/touch stats.

How the harsher curve produces the owner's grid:
- **Great user + elite golfer (−3/−4):** tiny timing errors land in the flat
  near-perfect region; the elite golfer's wide zone + low dispersion keep even the
  occasional looser swing tidy. → the reward ceiling.
- **Great user + weak golfer:** same crisp timing, but a narrower zone and higher
  dispersion push more swings up the steep part of the curve → capped below the
  ceiling. (The golfer axis stays meaningful.)
- **Good user, hot vs cold:** their error distribution shifts round to round. A hot
  round (errors clustered near zero) rides the flat part → near −3/−4. A cold round
  (errors drifting out) climbs the convex part → even-or-over, *because the curve
  now bites there*. This "closer to both ends" swing is impossible today because
  the curve is flat-ish everywhere.
- **Novice (bogey golf):** large, frequent timing errors sit on the steep part →
  distance loss + spray compound into bogeys regardless of golfer.

Magnitude to solve for: today great and novice both sit ≈ −2/−3; the target
spreads them ~7 strokes over 3 holes (−4 vs +3). That spread is set by **how
steep the convex curve is and how small perfect is** — the numbers the sim (§5)
exists to find.

---

## 4. The mechanic levers (ranked), all no-course, all smooth

| Lever | Where | What it does |
|---|---|---|
| **Perfect band width** | `SWING.perfectBandMin/Max` | size of the flat "ideal" zone — shrink (owner) |
| **Accuracy curve exponent + gain** | `normalizedAccuracyOffset` shaping in `meter3d` | makes the accuracy penalty convex + harsher |
| **Power short/miss curve** | `meter3d.deliveredPower` (short-of-target branch, miss jitter) | convex distance loss instead of linear |
| **Per-error dispersion mult** | `PhysicsEngine` quality/dispersion multiplier | how much a given error sprays, scaled by the golfer (the golfer axis) |
| **Good band width** | `SWING.goodBand/goodBandMin` | where the curve is allowed to still be gentle — maybe tighten |
| **Band ^1.5 stat curve** | `meter3d.perfectHalf/goodHalf` | how much a strong golfer forgives — steepen so weak golfers pinch harder |
| **maxErrorDeg / perfectDispersionDeg** | `PHYSICS` | ceiling and floor of directional error |
| **overswingBonus / miss power jitter** | `SWING.overswingBonus`, meter3d:337 | the distribution tails |
| **Fire perfect-mult** | `SWING.firePerfectMult` | on-fire widening — a reward multiplier on a now-harsher base; re-check it isn't overpowered |

Deliberately **out of scope** (owner): hole length, hazards, green size/firmness,
tee positions — every course lever from the v1 draft is off.

Open question for the owner: **putting.** Putts use the same meter. Do you want the
harsher curve on putting too (a loose putt more often slides by), or keep putting
gentler and let tee/approach carry the difficulty? Birdie-putt conversion is part
of why par-4s go under, so it matters — flagging rather than assuming.

---

## 5. The simulation methodology (retargeted to the swing curve)

Same harness intent as v1, but it tunes swing constants + the two curve functions,
never holes.

1. **Model the user** as a **timing-error distribution** (σ of where they stop the
   cursor relative to perfect), per click. Canonical users by error σ:
   **Great** (tight σ, rarely far off), **Good** (moderate σ), **Average**,
   **Novice** (wide σ). Sampling error → the same band/curve math the live meter
   uses is what turns σ into an outcome. (Later: fit these σ from the real
   swing-quality telemetry the game already records, so "Average" is the real base.)
2. **Model the golfer** via the existing `statsForClub()` seam (weak→elite): band
   widths + per-error dispersion come from the same stats the live meter uses — the
   sim must call the *same* functions, not a parallel copy, or the numbers are
   fiction.
3. **Compose a shot:** sample the timing error → run it through the (proposed)
   curve → `PhysicsEngine.simulate`. Play full rounds via the existing auto-player
   to holed-out.
4. **Metrics per user×golfer cell** (many round-seeds): **round vs par** and its
   **variance** (the spread is itself a target), FIR%, GIR%, putts/hole, penalty
   rate, and a **curve-sensitivity readout** (how many strokes a given increase in
   timing-error σ costs — this tells us if the curve is steep enough).
5. **Output the grid** (rows = user σ, cols = golfer) vs the §target table. The
   knobs are §4's constants + the curve exponents only.

Validation first: reproduce today's flat ≈ −2/−3-for-everyone with the measured
user σ and the *current* constants. If the sim can't reproduce "too flat", it
can't be trusted to steepen it.

---

## 6. Calibration loop

1. Validate the sim against live behavior (flat spread, current constants).
2. Shrink perfect + set the accuracy/power curve exponents & gains to a first guess.
3. Turn **one knob at a time**, re-run the grid, read mean AND variance per cell;
   keep an audit trail (knob → grid shift).
4. Solve the top-right cell (great+elite) to −3/−4 first, then steepen the curve
   until the novice falls to bogey and the good-user variance spans −4→+.
5. **Feel check on device:** a sim can hit numbers with a curve that feels
   unfair. Confirm perfect stays *achievable and satisfying*, and that the
   harshness reads as "I stopped it late" — a fair, legible consequence — not
   randomness.
6. Re-run the real gates (`newCourses` playability, perf): a harsher curve must
   not make any hole unfinishable (the AI/auto-player must still complete every
   hole) or break the budget.

---

## 7. Risks & guardrails

- **Smooth, not stepped (owner).** The harshness is a steeper, convex *slope* — at
  no point a cliff. Near-perfect must stay gentle so a tiny miss is a tiny
  consequence; the bite comes as the error grows. If any boundary starts to read as
  a jump, the exponent/gain is wrong, not the shape.
- **Keep perfect rewarding, not random.** Smaller is good; too small feels like a
  coin-flip. Guard: the great-user cell must reach −3/−4 *consistently* in the sim
  — if it can't, perfect is too small or the curve too steep near zero.
- **Golfer axis must stay meaningful.** Per-error dispersion has to scale with the
  golfer, or a great user shoots −4 with any golfer and the roster stops mattering.
- **Watch the tails.** A convex curve plus miss power-jitter plus overswing can
  produce ugly outliers; check the worst-case distribution, not just the mean.
- **Accessibility / reduced-motion.** Difficulty should come from *precision*
  (curve steepness), not from a meter too fast to read. Keep sweep speed a separate
  knob from curve harshness.

---

## 8. Suggested phasing (when greenlit)

1. Build + validate the grid sim against current (flat) behavior — no changes yet.
2. Prototype in the sim only: shrink perfect, make the accuracy/power curves convex
   + harsher. Read the grid.
3. Tune the curve steepness + dispersion scaling until the grid matches the target
   table (mean *and* spread).
4. Wire the curves + constants into the live meter/physics; playtest the feel.
5. Re-validate the grid + real gates; screenshot/telemetry freeze; ship behind a
   review.

---

*Nothing here is implemented. This revision drops every course lever and centers
the calibration on a single, smooth-but-harsher swing curve plus a smaller perfect
zone. Awaiting the owner's read on: how steep to aim (§2/§3), whether putting joins
the harsher curve (§4), and the go-ahead to build the sim (§5).*
