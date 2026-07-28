import { describe, expect, it } from 'vitest';
import { PX_PER_YARD, PHYSICS, SWING } from '../../src/config';
import { bandFor, deliveredPower, goodHalf, perfectHalf, powerMissOf, targetBar } from '../../src/systems/swingModel';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { ftToPx, golferWith, NO_WIND, openHole, PERFECT_SWING } from './simHelpers';
import portjohnson from '../../src/data/courses/portjohnson.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { AimControl } from '../../src/core/input/AimControl';
import { buildHeightField } from '../../src/systems/HeightField';
import { HoleData } from '../../src/core/types';

/**
 * Putting feel (recalibrated on playtest FB9). The old model leaned on huge
 * pace noise to hit the GDD "perfect read + stroke" make-rate table (40ft ≈ 5%),
 * which made a *perfect* long putt finish 20ft+ short — the opposite of skillful.
 *
 * The new model: a PERFECT stroke lags tight (hitting the pace target reliably
 * finishes at the hole), so a genuinely perfect read+stroke drops often — as it
 * should on a flat green. Difficulty comes from actually striking the meter
 * (mishits scatter hard) and from reading the break yourself (the aim line is
 * flat/windless). These tests assert that intent: reliable + tight perfect
 * strokes, a curve that still falls off with distance, and clearly worse
 * mishits. The headline difficulty gate is `scoring.test.ts`.
 */

const hole = openHole();
const golfer = golferWith(85);
const putter = clubById('putter');
// Mirror the game's putt power derivation: power = aimDistPx / maxCarryPx, where
// maxCarryPx = effectiveCarryYards(putter) * PX_PER_YARD. Derive it from the
// putter's actual baseDistance (not a hardcoded copy) so it stays faithful — the
// putter's baseDistance only scales the aim ceiling and cancels out of putt pace.
const CARRY_PX = putter.baseDistance * (0.259 + (85 / 100) * 0.926) * 2;

/** The putt swing context the live game arms: the bar target for a putt is
 *  always `fullPowerMark` — the LENGTH lives in AimControl.meterScalePx — so a
 *  stroke is described by where the cursor stopped relative to that mark. */
const puttCtx = { stat: 85, powerTarget: SWING.fullPowerMark, isPutt: true };
const T = targetBar(puttCtx);
const PH = perfectHalf(puttCtx);
const GH = goodHalf(puttCtx);

/**
 * Cursor positions for named strokes, all SHORT of the target (the owner's
 * case: "I missed the power target just short").
 *
 * `nearMiss` is the one this file used to have no way to express and the one
 * the bug lived in: a stroke a whisker outside the perfect band, which used to
 * inherit the full good-band pace scatter.
 */
const CURSOR = {
  perfect: T,
  nearMiss: T - (PH + (GH - PH) * 0.08),
  good: T - (PH + GH) / 2,
  goodEdge: T - (GH - 0.002),
  miss: T - (GH + 0.03)
} as const;
type Stroke = keyof typeof CURSOR;

/**
 * One putt through the REAL chain — cursor → band → deliveredPower (bar units)
 * → AimControl.barToPhysicsPower → physics.
 *
 * This used to hand the physics a PERFECT power and merely label it 'good',
 * which meant every "mishit" test measured a stroke that cannot happen: full
 * pace, wrong label. The deterministic pace penalty — the half of the model
 * that makes a short stroke finish short — was never exercised at all.
 *
 * `signedFt` is + PAST the hole, − short. The old helper returned
 * `Math.abs(...)`, which is why a short stroke finishing 20ft LONG read
 * identically to one finishing 20ft short, and why this suite passed
 * throughout the bug it was supposed to catch.
 */
function puttFrom(ft: number, cursor: number, rng: () => number): { holed: boolean; signedFt: number } {
  const distPx = ftToPx(ft);
  const origin = { x: hole.pin.x, y: hole.pin.y + distPx };
  const band = bandFor(cursor, T, PH, GH);
  const bar = deliveredPower(puttCtx, cursor, band);
  const power = (bar * (distPx / SWING.fullPowerMark)) / CARRY_PX;
  const out = new PhysicsEngine(hole, null, rng).simulate({
    origin,
    aimAngle: -Math.PI / 2,
    swing: {
      power,
      powerQuality: band,
      accuracy: 0,
      accuracyQuality: 'perfect',
      powerMiss: powerMissOf(puttCtx, cursor)
    },
    club: putter,
    golfer,
    fireBoost: 0,
    lie: 'green',
    wind: NO_WIND,
    hole
  });
  return { holed: out.holed, signedFt: ((hole.pin.y - out.finalPos.y) / 2) * 3 };
}

function putt(ft: number, quality: Stroke, rng: () => number): { holed: boolean; finishFt: number } {
  const r = puttFrom(ft, CURSOR[quality], rng);
  return { holed: r.holed, finishFt: Math.abs(r.signedFt) };
}

function makeRate(ft: number, quality: Stroke, n = 1500): number {
  const rng = mulberry32(1234 + ft * 7 + (quality === 'good' ? 1 : 0));
  let holed = 0;
  for (let i = 0; i < n; i++) if (putt(ft, quality, rng).holed) holed++;
  return (100 * holed) / n;
}

/** Distance from the hole a putt finishes, at the given percentile (feet). */
function lagPercentile(ft: number, quality: Stroke, p: number, n = 800): number {
  const rng = mulberry32(55 + ft + (quality === 'good' ? 9 : 0));
  const errs: number[] = [];
  for (let i = 0; i < n; i++) errs.push(putt(ft, quality, rng).finishFt);
  errs.sort((a, b) => a - b);
  return errs[Math.min(n - 1, Math.floor(n * p))];
}

describe('putting — a perfect read + stroke is reliable', () => {
  it('short putts are near-automatic', () => {
    expect(makeRate(3, 'perfect')).toBeGreaterThanOrEqual(97);
    expect(makeRate(5, 'perfect')).toBeGreaterThanOrEqual(93);
    expect(makeRate(10, 'perfect')).toBeGreaterThanOrEqual(80);
  });

  it('the make rate still falls off with distance', () => {
    const rates = [3, 8, 15, 30, 40].map((ft) => makeRate(ft, 'perfect', 800));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], `${rates.join(', ')}`).toBeLessThan(rates[i - 1]);
    }
    // A 40-footer is far from a gimme even struck perfectly. (A perfect stroke
    // now starts dead on the read line, so it drops a touch more often than
    // before, but is still nowhere near the ~97% of a short putt.)
    expect(makeRate(40, 'perfect')).toBeLessThanOrEqual(65);
  });

  it('a perfect long-putt lag finishes close — no more 20ft-short putts (FB9)', () => {
    // The specific playtest failure: a 70ft putt struck on the pace target
    // should finish within a few feet, not 20ft+ short.
    expect(lagPercentile(70, 'perfect', 0.5)).toBeLessThanOrEqual(6);
    expect(lagPercentile(70, 'perfect', 0.9)).toBeLessThanOrEqual(12);
  });
});

/**
 * THE MISS YOU MADE IS THE DISTANCE YOU GET.
 *
 * Owner, twice: *"there's no small misses on distance. it's either perfect or
 * way off"*, and then *"a perfectly aimed putt even just short of the perfect
 * zone blasts past the hole way too far. on a 30 foot putt I got the hole and
 * went 20 feet by because I missed the power target just short."*
 *
 * The cause was pace NOISE scaled by the power BAND: one pixel outside perfect
 * tripled the random spread, and that spread is symmetric, so it did not care
 * which way you missed. Measured on this harness before the fix, for a stroke
 * missed SHORT:
 *
 *     30ft, a whisker outside perfect → finished PAST 16.4% of the time, p90 +6.4ft
 *     40ft, same stroke               → 26.8%, p90 +9.9ft
 *     70ft, same stroke               → 37.0%, p90 +19.9ft
 *
 * The old suite could not see any of it: its finish was `Math.abs`, and its
 * "good" stroke was a PERFECT power with a 'good' label, so the directional
 * half of the model was never exercised. Both are fixed above; these are the
 * assertions that hold the behaviour.
 */
describe('putting — a stroke missed short finishes short', () => {
  /** Signed finish stats for a stroke, as a share of putts that ended PAST the
   *  hole and how far past the tail runs. */
  function pastStats(ft: number, cursor: number, n = 2000): { pastPct: number; p95PastFt: number; median: number } {
    const rng = mulberry32(4242 + ft * 31);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(puttFrom(ft, cursor, rng).signedFt);
    xs.sort((a, b) => a - b);
    return {
      pastPct: (100 * xs.filter((x) => x > 0).length) / n,
      p95PastFt: Math.max(0, xs[Math.floor(n * 0.95)]),
      median: xs[Math.floor(n / 2)]
    };
  }

  const SHORT_STROKES: Stroke[] = ['nearMiss', 'good', 'goodEdge', 'miss'];

  it('a short stroke is never MORE likely to run past than a dead-on one', () => {
    // The invariant the bug violated outright: at 30ft a stroke missed short ran
    // past 16.4% of the time against a perfect stroke's 0.3%. Whatever the
    // absolute rates are at a given length, missing short cannot make running
    // long more likely — that is the whole complaint, stated as a law.
    for (const ft of [10, 20, 30, 40, 70]) {
      const dead = pastStats(ft, CURSOR.perfect).pastPct;
      for (const stroke of SHORT_STROKES) {
        const s = pastStats(ft, CURSOR[stroke]);
        expect(s.pastPct, `${ft}ft ${stroke}: past ${s.pastPct}% vs perfect ${dead}%`).toBeLessThanOrEqual(dead + 2);
      }
    }
  });

  it('and when it does run past, it is never far past', () => {
    // The owner's 20ft. The tail of a SHORT stroke must stay a small fraction
    // of the putt, at every length.
    for (const ft of [10, 20, 30, 40, 70]) {
      for (const stroke of SHORT_STROKES) {
        const s = pastStats(ft, CURSOR[stroke]);
        expect(s.p95PastFt, `${ft}ft ${stroke}: p95 ran ${s.p95PastFt.toFixed(1)}ft past`).toBeLessThanOrEqual(
          Math.max(1.5, ft * 0.12)
        );
      }
    }
  });

  it('there IS a middle: the worse the miss, the shorter the putt finishes', () => {
    // "It's either perfect or way off" — the gradient has to be visible in the
    // result, not just in the delivered power. Monotonic at every length.
    for (const ft of [20, 30, 40, 70]) {
      const medians = SHORT_STROKES.map((s) => pastStats(ft, CURSOR[s]).median);
      for (let i = 1; i < medians.length; i++) {
        expect(medians[i], `${ft}ft medians ${medians.map((m) => m.toFixed(1)).join(', ')}`).toBeLessThanOrEqual(
          medians[i - 1] + 0.01
        );
      }
      // …and the ends are meaningfully different, not three flavours of the same.
      expect(medians[0] - medians[medians.length - 1], `${ft}ft spread`).toBeGreaterThan(ft * 0.1);
    }
  });

  it('the mirror holds: a stroke missed LONG never comes up short', () => {
    // Stated as "never short" rather than "finishes long" because a putt struck
    // a little firm still DROPS — the cup captures up to `cupCaptureSpeed`, so
    // the median signed finish of a slightly-long 20-footer is exactly 0, which
    // is the ball in the hole rather than a failure of the model.
    for (const ft of [20, 30, 40]) {
      for (const stroke of ['good', 'goodEdge'] as const) {
        // Same miss size, other side of the target.
        const over = T + (T - CURSOR[stroke]);
        const s = pastStats(ft, over);
        expect(s.median, `${ft}ft ${stroke} long: median ${s.median.toFixed(1)}ft`).toBeGreaterThanOrEqual(0);
      }
    }
    // The firmest miss must actually run past, at a length where it cannot
    // simply drop: a 40-footer struck at the edge of the good band.
    const firm = T + (T - CURSOR.goodEdge);
    expect(pastStats(40, firm).median, '40ft firm miss should run past').toBeGreaterThan(0);
  });
});

/**
 * Uphill pace rule (owner law, 2026-07-21): "2 inches of uphill = 1 foot long"
 * — i.e. aim +6 ft of pace per 1 ft of TRUE rise, independent of the putt's
 * base length — and a PERFECT stroke that follows the rule must NOT go long
 * ("shouldn't go long on perfect perfect"). Two things make this hold:
 *   1. The aim readout shows the TRUE rise: slopeAccelAlong · dPx · 1.5 /
 *      slopeGradAccel (main.ts updateAimReadout), so the player reads the real
 *      climb and applies 6:1 to it.
 *   2. PHYSICS.puttSlopePaceBoost adds extra deceleration WHILE CLIMBING so the
 *      raw ~3:1 slope cost reaches the ~6:1 the rule expects. Break and downhill
 *      roll are untouched.
 * These sims putt straight uphill on the authored-slope green, size the slope so
 * the readout shows `riseFt`, aim the rule's +6·rise, and assert the ball holes
 * / dies AT the cup and errs SHORT — never long. Without the extra aim the dumb
 * flat pace comes up clearly short (the read is the player's job).
 */
describe('putting — uphill rule: 2in = 1ft, perfect stroke never long', () => {
  // Solve authored slope strength so the READOUT shows `riseFt` for a `cupFt`
  // putt. Readout = aUp·dPx·1.5/slopeGradAccel; straight uphill on a null-hf
  // green aUp = slopeAccel·strength, dPx = cupFt·PX_PER_YARD/3 ⇒
  // rise = slopeAccel·strength·cupFt/slopeGradAccel.
  const strengthFor = (cupFt: number, riseFt: number): number =>
    (riseFt * PHYSICS.slopeGradAccel) / (PHYSICS.slopeAccel * cupFt);

  // Signed finish: + = LONG (past the cup), - = short.
  function uphillPutt(cupFt: number, riseFt: number, extraAimFt: number, rng: () => number): { holed: boolean; signedFt: number } {
    const upHole = openHole({ slope: { angle: Math.PI / 2, strength: strengthFor(cupFt, riseFt) } });
    const origin = { x: upHole.pin.x, y: upHole.pin.y + ftToPx(cupFt) };
    const distPx = ftToPx(cupFt + extraAimFt);
    const out = new PhysicsEngine(upHole, null, rng).simulate({
      origin, aimAngle: -Math.PI / 2, swing: PERFECT_SWING(distPx / CARRY_PX),
      club: putter, golfer, fireBoost: 0, lie: 'green', wind: NO_WIND, hole: upHole
    });
    return { holed: out.holed, signedFt: ((upHole.pin.y - out.finalPos.y) / 2) * 3 };
  }

  function stats(cupFt: number, riseFt: number, extraAimFt: number, n = 400) {
    const rng = mulberry32(777 + cupFt * 13 + Math.round(riseFt * 12));
    const s: number[] = [];
    let holed = 0;
    for (let i = 0; i < n; i++) { const r = uphillPutt(cupFt, riseFt, extraAimFt, rng); if (r.holed) holed++; s.push(r.signedFt); }
    s.sort((a, b) => a - b);
    return { median: s[Math.floor(n / 2)], p90: s[Math.floor(n * 0.9)], makePct: (100 * holed) / n };
  }

  // Aiming the rule's +6·rise: holes out / dies at the cup, and even the long
  // tail does not run well past — the whole point is "never long on perfect".
  it('2 ft of rise, +12 ft aim (30-ft putt): holes and does not run long', () => {
    const r = stats(30, 2, 12);
    expect(r.makePct).toBeGreaterThanOrEqual(25);
    expect(r.median).toBeLessThanOrEqual(1.5); // not long
    expect(r.p90, `p90 ${r.p90.toFixed(1)}ft`).toBeLessThanOrEqual(3.5);
  });

  it('4 in of rise, +2 ft aim (20-ft putt): holes, not long', () => {
    const r = stats(20, 1 / 3, 2);
    expect(r.makePct).toBeGreaterThanOrEqual(45);
    expect(r.median).toBeLessThanOrEqual(1.5);
    expect(r.p90).toBeLessThanOrEqual(3);
  });

  it('1 ft of rise, +6 ft aim (15-ft putt): holes, not long', () => {
    const r = stats(15, 1, 6);
    expect(r.makePct).toBeGreaterThanOrEqual(45);
    expect(r.median).toBeLessThanOrEqual(1.5);
    expect(r.p90).toBeLessThanOrEqual(3);
  });

  it('the perfect stroke ERRS SHORT, not long, across rises (owner: never long on perfect)', () => {
    for (const [cup, rise] of [[12, 0.75], [18, 1.5], [24, 2], [30, 3]] as const) {
      const r = stats(cup, rise, 6 * rise);
      expect(r.median, `${cup}ft/${rise}ft median ${r.median.toFixed(1)}`).toBeLessThanOrEqual(1.5);
    }
  });

  it('without the extra aim, the same uphill putts come up clearly short', () => {
    const r = stats(30, 2, 0);
    expect(r.median).toBeLessThanOrEqual(-6); // finishes well short of the cup
    expect(r.makePct).toBeLessThanOrEqual(5);
  });
});

describe('putting — mishits are punished', () => {
  it('an average (good-band) stroke holes far less than a perfect one', () => {
    for (const ft of [10, 20, 30]) {
      expect(makeRate(ft, 'good'), `${ft}ft`).toBeLessThan(makeRate(ft, 'perfect'));
    }
  });

  it('a mishit long putt scatters much wider than a perfect one', () => {
    expect(lagPercentile(70, 'good', 0.9)).toBeGreaterThan(lagPercentile(70, 'perfect', 0.9) * 1.6);
  });
});


/**
 * Port Johnson h3 long UPHILL putt — the RESTORED aim / True-Vision separation
 * (P5). REVERSES the earlier "slope-aware putt pace" change. Design intent
 * (confirmed by the product owner): the normal aiming meter is a DUMB, FLAT
 * model — a perfect stroke sends the ball the AIMED distance on a flat-green
 * model, with NO hidden compensation for slope/elevation/break/fringe/green
 * speed. Both the aim LINE and the putt PACE run on the shipped FLAT, no-slope
 * preview engine, so a perfect PIN-aimed putt on a real uphill green comes up
 * SHORT — the player must read the break (or use True Vision) and aim PAST the
 * hole. True Vision is the tool that simulates the COMPLETE shot on the real
 * terrain+slope engine (engine2d) and accurately predicts that short endpoint.
 * Deterministic (preview:true) so it can't drift with pace-noise retuning.
 *
 * RATIONALE FOR THE CHANGED EXPECTATION: this describe block previously asserted
 * that a perfect pin-aimed uphill putt REACHES the hole via a slope-aware pace
 * meter. That secret compensation hid the read from the player and is reverted;
 * the block now pins the restored behavior — dumb aim comes up short, and True
 * Vision predicts exactly that.
 */
describe('putting — Port Johnson long uphill: dumb aim comes up short, True Vision predicts it', () => {
  const course = loadCourse(portjohnson as unknown as CourseAuthoring);
  const pj3 = course.holes[2];
  const origin = { x: pj3.pin.x - ftToPx(78), y: pj3.pin.y };
  const ctx = { ball: origin, lie: 'green' as const, golfer, fireBoost: 0, strokes: 2 };

  // FLAT aim/preview engine (no slope, no heightfield) — the shipped aim LINE
  // AND the shipped putt PACE (P5: the normal aim never reads the break).
  const previewEngine = new PhysicsEngine({ ...pj3, slope: { angle: 0, strength: 0 } }, null, () => 0.5);
  // Real terrain+slope shot engine — the shipped engine2d, and what True Vision
  // engine2d for the noise-free True Vision prediction (preview strips the
  // random pace noise, so rng is irrelevant here).
  const engine2d = new PhysicsEngine(pj3, buildHeightField(pj3), () => 0.5);
  const aim = new AimControl(pj3, previewEngine);
  aim.setClubById('putter');
  aim.yaw = 0;
  aim.distPx = ftToPx(78); // aim exactly AT the pin — a "dumb" pin-aimed putt
  const power = aim.barToPhysicsPower(aim.barPowerTarget(ctx), ctx);

  function shot(engine: PhysicsEngine, preview: boolean): { traveledFt: number; remainingFt: number } {
    const out = engine.simulate({
      origin, aimAngle: aim.yaw, swing: PERFECT_SWING(power), club: putter,
      golfer, fireBoost: 0, lie: 'green', wind: NO_WIND, hole: pj3, preview
    });
    return {
      traveledFt: Math.hypot(out.finalPos.x - origin.x, out.finalPos.y - origin.y) / PX_PER_YARD * 3,
      remainingFt: Math.hypot(out.finalPos.x - pj3.pin.x, out.finalPos.y - pj3.pin.y) / PX_PER_YARD * 3
    };
  }

  it('a perfect PIN-aimed uphill putt comes up clearly SHORT (dumb flat aim, no slope comp)', () => {
    // A stroke that hits the pace target exactly (the noise-free perfect stroke)
    // dies short of the ~78ft pin — exactly the separation the design wants: the
    // flat aim never compensates for the climb, so the player must aim past.
    const r = shot(engine2d, true);
    expect(r.remainingFt, `remaining ${r.remainingFt.toFixed(1)}ft`).toBeGreaterThan(15);
    expect(r.traveledFt, `traveled ${r.traveledFt.toFixed(1)}ft`).toBeLessThan(70);
  });

  it('True Vision predicts that short endpoint (its prediction tracks the real result)', () => {
    // True Vision is the noise-free prediction on the real engine.
    const trueVision = shot(engine2d, true);
    // The real live putt scatters around that prediction (pace noise). Its
    // EXPECTED (median) outcome is what True Vision honestly shows — no hidden
    // pace help that would make a dumb pin-aim reach an uphill pin.
    const reals: number[] = [];
    for (let i = 0; i < 300; i++) {
      reals.push(shot(new PhysicsEngine(pj3, buildHeightField(pj3), mulberry32(500 + i)), false).remainingFt);
    }
    reals.sort((a, b) => a - b);
    const medianReal = reals[Math.floor(reals.length / 2)];
    expect(
      Math.abs(trueVision.remainingFt - medianReal),
      `TV ${trueVision.remainingFt.toFixed(2)}ft vs median real ${medianReal.toFixed(2)}ft`
    ).toBeLessThan(4);
    // And True Vision itself shows the ball SHORT — it predicts the shortfall.
    expect(trueVision.remainingFt, `TV remaining ${trueVision.remainingFt.toFixed(1)}ft`).toBeGreaterThan(15);
  });
});

/**
 * Fringe-transition pace (ADJ-1 regression). A ball resting barely off the green
 * on ~1 inch of fringe must roll almost exactly like the same putt entirely on
 * the green — a hair of fringe must NOT be a ~20ft cliff. PROVEN root cause of
 * the old penalty: the launch-speed friction sampler (puttRollFriction) took 6
 * interior MIDPOINTS, so it missed a sub-(distance/6) fringe stretch at the
 * origin, while the forward-Euler roll brakes at the START-of-step surface for a
 * full ~1px step — a putt STARTING on fringe therefore paid fringe friction over
 * that whole first step with no launch budget for it, and came up short. It is
 * NOT that fringe friction (300) is too high (deep-fringe putts were fine); the
 * defect was the transition accounting. Trapezoidal origin-weighted sampling
 * fixes it. These sims are deterministic (preview:true) — the noise-free pace
 * model True Vision shows — so the loss they measure is the pure surface model.
 */
describe('putting — fringe-transition pace scales with fringe distance, not a cliff (ADJ-1)', () => {
  const fringeHole = (): HoleData => ({
    number: 1, par: 4, yardage: 400,
    world: { width: 3000, height: 3000 },
    tee: { x: 1500, y: 2800 },
    green: { cx: 1500, cy: 600, rx: 300, ry: 300 },
    slope: { angle: 0, strength: 0 },
    pin: { x: 1500, y: 600 },
    // Fairway kept far BELOW the green so the green keeps a real fringe collar
    // (a fairway overlapping the green margin suppresses 'fringe' in surfaceAt).
    fairway: [[[1200, 2900], [1800, 2900], [1800, 1400], [1200, 1400]]],
    hazards: [], aiTargets: []
  });

  // Locate the actual green→fringe edge along +y (the green boundary carries a
  // directional wobble, so it isn't exactly at ry).
  const probe = new PhysicsEngine(fringeHole(), null, () => 0.5);
  let greenEdgeY = 900;
  for (let y = 850; y < 1050; y += 0.1) {
    if (probe.surfaceAt(1500, y) === 'fringe' && probe.surfaceAt(1500, y - 0.1) === 'green') {
      greenEdgeY = y;
      break;
    }
  }

  /** Deterministic shortfall (ft) of a perfect putt started `fringeDepthPx` past
   *  the green edge (negative = inside the green), aimed `puttFt` up onto the
   *  green — armed exactly as the game arms a putt (flat aim engine). */
  function trial(fringeDepthPx: number, puttFt: number): { surf: string; short: number } {
    const puttLenPx = ftToPx(puttFt);
    const ball = { x: 1500, y: greenEdgeY + fringeDepthPx };
    const pin = { x: 1500, y: ball.y - puttLenPx };
    const hole = { ...fringeHole(), pin };
    const engine = new PhysicsEngine(hole, null, () => 0.5);
    const flatPreview = new PhysicsEngine({ ...hole, slope: { angle: 0, strength: 0 } }, null, () => 0.5);
    // Flat green (slope 0), so the aim's flat pace model is byte-identical to the
    // shipped derivation — this test isolates the fringe surface cost, not slope.
    const aim = new AimControl(hole, flatPreview);
    aim.setClubById('putter');
    aim.yaw = -Math.PI / 2;
    aim.distPx = puttLenPx;
    const lie = engine.surfaceAt(ball.x, ball.y);
    const c = { ball, lie, golfer, fireBoost: 0, strokes: 2 };
    const power = aim.barToPhysicsPower(aim.barPowerTarget(c), c);
    const out = engine.simulate({
      origin: ball, aimAngle: aim.yaw, swing: PERFECT_SWING(power), club: putter,
      golfer, fireBoost: 0, lie, wind: NO_WIND, hole, preview: true
    });
    const trav = Math.hypot(out.finalPos.x - ball.x, out.finalPos.y - ball.y) / PX_PER_YARD * 3;
    return { surf: String(lie), short: puttFt - trav };
  }

  const inch = (n: number) => ftToPx(n / 12);

  it('Case A — entirely on green: a perfect 20ft putt finishes on the hole', () => {
    const a = trial(-8, 20);
    expect(a.surf).toBe('green');
    expect(Math.abs(a.short), `A short=${a.short.toFixed(2)}ft`).toBeLessThan(0.5);
  });

  it('Case B — ~1 inch of fringe: within ~1ft of the on-green putt (a hair of fringe is NOT a ~20ft cliff)', () => {
    const a = trial(-8, 20);
    const b = trial(inch(1), 20);
    expect(b.surf).toBe('fringe');
    expect(Math.abs(b.short - a.short), `B=${b.short.toFixed(2)} A=${a.short.toFixed(2)}`).toBeLessThan(1);
    expect(b.short, `1in fringe cost ${b.short.toFixed(2)}ft`).toBeLessThan(3); // nowhere near 20ft
  });

  it('Case C — several feet into fringe: still recovers, loss stays small and bounded', () => {
    for (const depthFt of [3, 6]) {
      const c = trial(ftToPx(depthFt), 20);
      expect(c.surf).toBe('fringe');
      expect(Math.abs(c.short), `${depthFt}ft-into short=${c.short.toFixed(2)}ft`).toBeLessThan(3);
    }
  });

  it('the loss is CONTINUOUS across fringe depth — a smooth ramp, no step at the tiniest crossing', () => {
    const shorts = [0.05, 0.25, 0.5, 1, 2, 4, 8, 16].map((inches) => trial(inch(inches), 20).short);
    for (let i = 1; i < shorts.length; i++) {
      expect(
        Math.abs(shorts[i] - shorts[i - 1]),
        `adjacent jump too big; shorts=[${shorts.map((s) => s.toFixed(2)).join(', ')}]`
      ).toBeLessThan(1);
    }
    // And the deepest sampled crossing is still a small loss, never a cliff.
    expect(Math.max(...shorts.map(Math.abs))).toBeLessThan(3);
  });
});

/**
 * PUTT PACE HAS TO HAVE A MIDDLE.
 *
 * Owner: "why does every putt that is a miss on distance perfect zone go way
 * too far. there's no small misses on distance. it's either perfect or way off."
 *
 * They were right, and the cause was arithmetic rather than feel.
 * `deliveredPower` passed the raw cursor error through and clamped it at
 * `puttGoodErrorFrac · target`. On a short putt that cap is tiny in BAR units —
 * at a target of 0.10 it is 0.015, smaller than the perfect band's own
 * half-width — so the clamp was saturated the moment the cursor left perfect.
 * Measured before the fix, at putting stat 80 on a 0.10 target: one notch
 * outside the band delivered the FULL 15% overshoot, and so did every larger
 * miss. There was no value in between to hit.
 */
describe('a missed putt misses by how much you missed', () => {
  const ctxFor = (stat: number, target: number) =>
    ({ stat, powerTarget: target, isPutt: true }) as never;
  /** Delivered power as a signed fraction of the intended pace. */
  const errAt = (stat: number, target: number, offset: number): number => {
    const ctx = ctxFor(stat, target);
    const cursor = target + offset;
    const band = bandFor(cursor, targetBar(ctx), perfectHalf(ctx), goodHalf(ctx));
    return (deliveredPower(ctx, cursor, band) - target) / target;
  };

  it('leaves a gradient on a SHORT putt — the case that had none', () => {
    // The exact reported failure. A hair outside perfect must be a hair long,
    // not the full cap.
    const justOut = errAt(80, 0.1, perfectHalf(ctxFor(80, 0.1)) + 0.001);
    expect(justOut, 'a barely-missed short putt should be barely long').toBeLessThan(0.02);
    // …and missing it properly still punishes.
    expect(errAt(80, 0.1, 0.05)).toBeGreaterThan(0.05);
  });

  it('grows monotonically with the size of the miss, at every putt length', () => {
    for (const stat of [40, 70, 100]) {
      for (const target of [0.1, 0.25, 0.5, 0.85]) {
        let prev = -1;
        for (const off of [0.02, 0.03, 0.04, 0.06, 0.09]) {
          const e = errAt(stat, target, off);
          expect(e, `stat ${stat} target ${target} offset ${off}`).toBeGreaterThanOrEqual(prev);
          prev = e;
        }
      }
    }
  });

  it('is continuous at the edge of perfect — no step off the band', () => {
    for (const target of [0.1, 0.4, 0.85]) {
      const ctx = ctxFor(75, target);
      const edge = perfectHalf(ctx);
      // Inside the band is exact; a whisker outside must still be near-exact.
      expect(errAt(75, target, edge - 0.0005)).toBe(0);
      expect(errAt(75, target, edge + 0.0005), `target ${target}`).toBeLessThan(0.01);
    }
  });

  it('still honours the cap, and still misses SHORT as readily as long', () => {
    for (const target of [0.1, 0.5]) {
      expect(errAt(60, target, 0.3)).toBeCloseTo(SWING.puttGoodErrorFrac, 5);
      expect(errAt(60, target, -0.3)).toBeCloseTo(-SWING.puttGoodErrorFrac, 5);
    }
  });

  it('keeps a perfect stroke exact', () => {
    for (const target of [0.1, 0.5, 0.85]) expect(errAt(90, target, 0)).toBe(0);
  });
});
