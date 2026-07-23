# Difficulty Tuning — Simulator Proposal (SUPERSEDED)

**Status (updated 2026-07):** SUPERSEDED. Option **C ("reconcile first")** below
was taken. The instrument was first RECALIBRATED to ground truth (Step 1), then a
re-tune landed in the OPPOSITE direction from the proposal in this doc (Step 2:
*smaller* perfect zone + *harsher* convex accuracy + ball-striking-carried spread,
not the bigger-zone/gentler-putting table below). The landed values live in
`src/config.ts`; do not apply the table in this doc. The historical proposal is
kept below for context.

### What actually landed
- **Step 1 — recalibration (why the sim ran harder & wider than reality).**
  Two sim-modeling errors, fixed WITHOUT touching shipped game balance:
  1. *Wind.* The instrument fell back to a uniform **2–20mph on every hole**
     (mean 11 — a constant stiff breeze) that cost the modeled expert ~1 full
     stroke and fattened the score tails. The sim now models a realistic light
     **1–8mph** typical round (`SkillSimulator` `RunOpts.windMin/windMax`,
     threaded through `simulateRound`; grid `CAL_WIND`).
  2. *σ tiers.* The old "Expert" σ.012 flushed only ~85% of strokes (a strong
     amateur, landing ≈ −1). Recalibrated ladder .045/.028/.016/.008 — the
     Expert (.008) is the owner: ~97% perfect strokes, and now shoots **−2/−3**
     with a good golfer, bad round ≈ even (unpunished), matching real play.
- **Step 2 — the landed re-tune** (`src/config.ts`):
  - `SWING.perfectBandMin` 0.008→**0.005**, `perfectBandMax` 0.026→**0.018**
    (perfect zone SMALLER).
  - `SWING.accuracyCurveExp` 1→**1.6**, `accuracyCurveGain` 1→**1.3** (convex AND
    harsher — gain ≥ 1, the OPPOSITE of the rejected 0.42), `powerShortExp`
    1→**1.5**.
  - `PHYSICS.dispersionQualityMult` 2.4/6→**3.6/7.5**, `carryNoiseQualityMult`
    2/3.2→**2.8/3.8**, `golferErrGain` 1.2→**1.5**, `golferErrBase` 0.4→**0.35**
    (extracted from inline literals in `PhysicsEngine.resolveLaunch`). These
    carry the spread in BALL-STRIKING: GIR now ranges ~44% (Novice+Bad) → ~86%
    (Expert+Good). Putting left at shipped (near tour, secondary contributor).
  - Full test suite green (904 passed); the meter/putting/dispersion/playability
    gates all hold.

---

**Status (original):** PROPOSAL. The constants below are **not** in the shipped config — they
were reverted pending an owner direction call (see "The catch"). The simulator,
the user-swing path, and the dashboard generator ARE committed and are a reusable
instrument.

## The instrument (committed, no behavior change)
- `src/systems/SkillSimulator.ts` — models a USER as a timing-error σ on the two
  meter cursors; a user×golfer grid with seeded median / p10 (good round) /
  p90 (bad round) aggregation + FIR/GIR/putts/one-putt/three-putt/blow-ups.
- `src/systems/RoundSimulator.ts` — opt-in `userModel` path: keeps the AI's
  club/aim/`powerTarget` but substitutes a modeled user swing through the exact
  live-meter math (`swingModel.resolveUserSwing`). Default `simulateHole`/
  `simulateRound` behavior is unchanged when `userModel` is absent.
- `tests/simulation/difficultyGrid.test.ts` (opt-in: `RUN_DIFFICULTY_GRID=1`) +
  `tests/simulation/difficultyDashboard.ts` — runs baseline vs tuned over all 6
  courses, 240 rounds/cell, writes the dashboard HTML + JSON.
- `PHYSICS.putterErrorDiv` and `PHYSICS.puttPaceQualityMult` were extracted from
  inline literals into named constants (at their original values — no change).

## The proposed constants (NOT applied)
| knob | shipped | proposed | why |
|---|---|---|---|
| `SWING.perfectBandMin` | 0.008 | 0.012 | more perfects → GIR |
| `SWING.perfectBandMax` | 0.026 | 0.040 | lifts the good end |
| `SWING.goodBandMin` | 0.055 | 0.09 | fewer low-skill misses |
| `SWING.goodBand` | 0.09 | 0.135 | same across skill |
| `SWING.accuracyCurveExp` | 1 | 1.7 | convex "gentle-near-perfect, steeper-out" shape |
| `SWING.accuracyCurveGain` | 1 | 0.42 | caps a full timing-miss's start-line offset (pulls the weak-player blow-up tail in) |
| `SWING.powerShortExp` | 1 | 1.6 | convex short-swing distance loss |
| `PHYSICS.putterErrorDiv` | 2.4 | 4.0 | straighter putts → one-putt ~40–50% |
| `PHYSICS.puttPaceNoise` | 0.055 | 0.04 | tighter perfect-putt pace → expert birdies |
| `PHYSICS.puttPaceQualityMult` | {1,3,6} | {1,2.8,3.5} | forgiving miss/good pace → fewer 3-putts |

## The tuned grid (240 rounds/cell — median `[good p10 / bad p90]`)
```
user\golfer   Bad             Mid             Good            Elite
Novice   +2 [ 0/+4]   +1 [-1/+3]   +1 [-2/+3]   0 [-2/+2]
Average  +1 [-1/+3]    0 [-1/+2]    0 [-2/+2]  -1 [-2/+1]
Good      0 [-1/+3]    0 [-2/+2]  -1 [-2/+1]  -1 [-2/ 0]
Expert    0 [-2/+1]    0 [-2/+1]  -1 [-3/+1]  -1 [-2/ 0]
```
- Novice+Bad bad-round (p90) = **+4** ✓ · Expert+Good good-round (p10) = **−3** ✓
- End-to-end span = **7** ✓ · monotonic on all three axes ✓
- Putts/hole: Good ~1.5–1.65, Expert ~1.47–1.52, Average ~1.71–1.79, Novice ~1.94.

## The catch — why this is HELD, not shipped
The grid targets are met, but the solution has three problems the owner must
adjudicate before it ships:

1. **It goes the OPPOSITE way from "perfect smaller / harsher."** It makes the
   perfect zone *bigger* and the accuracy penalty *gentler* (a full miss delivers
   0.42 of max offset, not 1.0). More forgiving, not harsher.
2. **The spread is putting-driven, not ball-striking.** In the tuned grid FIR≈69%
   and GIR≈70–79% for *every* tier including the novice — a modeled novice hits
   70% of greens, which isn't realistic and means "playing poorly" is punished
   mostly on the greens (novice 1.95 putts vs expert 1.47), not tee-to-green. The
   baseline actually differentiated ball-striking better (novice GIR 54 → expert
   78); the tuning flattened it.
3. **The sim baseline doesn't reproduce the real admin data.** Live stats showed
   ≈ −2/−3 for everyone; the sim baseline says skilled users are ≈ −1..0 and
   novices +3 (with +7 bad rounds), i.e. it runs harder and wider than reality.
   The model's absolute calibration is off (likely the modeled novice is harsher
   than a real novice, and/or the AI's aim/putting differs from real play), so
   tuning to it moved the knobs the "wrong" way.

## Options for the owner
- **A — trust instinct:** *smaller* perfect + genuinely *harsher* accuracy, and
  let ball-striking differentiate by skill (novices miss greens). Weak-player
  scores get worse than +3/+4; fine if the real concern is the game being too
  easy. Validate on real users after shipping.
- **B — trust the sim:** apply the table above; hits the numbers but feels more
  forgiving tee-to-green with a putting-carried spread.
- **C — reconcile first:** fix the model so its baseline reproduces the real
  −2/−3, then re-tune. Most rigorous.

## If the proposal (B) is ever applied, two tests need updating (currently they
## fail against the proposed values — NOT loosened here):
- `tests/meterCommitRegression.test.ts` — asserts a max accuracy miss delivers
  `accuracy: 1`; with gain 0.42 it delivers 0.42. Re-pin to the new magnitude or
  make it magnitude-agnostic.
- `tests/simulation/putting.test.ts` "make rate falls off with distance" — a
  perfect 40ft putt drops ~68% vs the ≤65% bound; bump the bound to ~70.
