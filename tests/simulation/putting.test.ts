import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { ftToPx, golferWith, NO_WIND, openHole, PERFECT_SWING, SWING_OF } from './simHelpers';
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

function putt(ft: number, quality: 'perfect' | 'good', rng: () => number): { holed: boolean; finishFt: number } {
  const distPx = ftToPx(ft);
  const origin = { x: hole.pin.x, y: hole.pin.y + distPx };
  const power = distPx / CARRY_PX;
  const swing = quality === 'perfect' ? PERFECT_SWING(power) : SWING_OF(power, 'good', 0.04);
  const out = new PhysicsEngine(hole, null, rng).simulate({
    origin,
    aimAngle: -Math.PI / 2,
    swing,
    club: putter,
    golfer,
    fireBoost: 0,
    lie: 'green',
    wind: NO_WIND,
    hole
  });
  return { holed: out.holed, finishFt: Math.abs((out.finalPos.y - hole.pin.y) / 2) * 3 };
}

function makeRate(ft: number, quality: 'perfect' | 'good', n = 1500): number {
  const rng = mulberry32(1234 + ft * 7 + (quality === 'good' ? 1 : 0));
  let holed = 0;
  for (let i = 0; i < n; i++) if (putt(ft, quality, rng).holed) holed++;
  return (100 * holed) / n;
}

/** Distance from the hole a putt finishes, at the given percentile (feet). */
function lagPercentile(ft: number, quality: 'perfect' | 'good', p: number, n = 800): number {
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
 * Uphill pace rule (visual pass 7): the ▲uphill readout is sized so "aim +6 ft
 * per 1 ft of shown rise" holes the putt (2 ft → +12 ft, 4 in → +2 ft). These
 * sims putt straight uphill with the authored green slope, aim exactly the
 * rule's extra distance, and assert the ball finishes at the hole — and that
 * WITHOUT the extra aim it comes up clearly short. Rise here is what the
 * readout shows: cupLenPx · (slopeAccel·strength/μ) · 1.5 / 6.
 */
describe('putting — uphill rule: +6 ft aim per 1 ft shown rise', () => {
  // Solve authored slope strength so the readout shows `riseFt` for a putt of
  // `cupFt`: rise = cupPx·(85·strength/150)·1.5/6 ⇒ strength = rise·900/(cup·85).
  const strengthFor = (cupFt: number, riseFt: number): number => (riseFt * 900) / (cupFt * 85);

  function uphillPutt(
    cupFt: number,
    riseFt: number,
    extraAimFt: number,
    rng: () => number
  ): { holed: boolean; finishFt: number } {
    // Downhill accel points +y (back at the golfer): putting toward -y is uphill.
    const upHole = openHole({ slope: { angle: Math.PI / 2, strength: strengthFor(cupFt, riseFt) } });
    const origin = { x: upHole.pin.x, y: upHole.pin.y + ftToPx(cupFt) };
    const distPx = ftToPx(cupFt + extraAimFt);
    const out = new PhysicsEngine(upHole, null, rng).simulate({
      origin,
      aimAngle: -Math.PI / 2,
      swing: PERFECT_SWING(distPx / CARRY_PX),
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole: upHole
    });
    return { holed: out.holed, finishFt: Math.abs((out.finalPos.y - upHole.pin.y) / 2) * 3 };
  }

  function medianFinish(cupFt: number, riseFt: number, extraAimFt: number, n = 400): number {
    const rng = mulberry32(777 + cupFt * 13 + Math.round(riseFt * 12));
    const errs: number[] = [];
    for (let i = 0; i < n; i++) errs.push(uphillPutt(cupFt, riseFt, extraAimFt, rng).finishFt);
    errs.sort((a, b) => a - b);
    return errs[Math.floor(n / 2)];
  }

  function uphillMakeRate(cupFt: number, riseFt: number, extraAimFt: number, n = 400): number {
    const rng = mulberry32(4242 + cupFt * 13 + Math.round(riseFt * 12));
    let holed = 0;
    for (let i = 0; i < n; i++) if (uphillPutt(cupFt, riseFt, extraAimFt, rng).holed) holed++;
    return (100 * holed) / n;
  }

  it('2 ft of rise holes with +12 ft of aim (30-ft putt)', () => {
    expect(medianFinish(30, 2, 12)).toBeLessThanOrEqual(2.5);
    expect(uphillMakeRate(30, 2, 12)).toBeGreaterThanOrEqual(40);
  });

  it('4 in of rise holes with +2 ft of aim (20-ft putt)', () => {
    expect(medianFinish(20, 1 / 3, 2)).toBeLessThanOrEqual(2);
    expect(uphillMakeRate(20, 1 / 3, 2)).toBeGreaterThanOrEqual(50);
  });

  it('1 ft of rise holes with +6 ft of aim (15-ft putt)', () => {
    expect(medianFinish(15, 1, 6)).toBeLessThanOrEqual(2);
    expect(uphillMakeRate(15, 1, 6)).toBeGreaterThanOrEqual(50);
  });

  it('without the extra aim, the same uphill putts come up clearly short', () => {
    // Flat-pace aim on a 2-ft rise finishes well short of the rule-aimed putt.
    expect(medianFinish(30, 2, 0)).toBeGreaterThanOrEqual(8);
    expect(uphillMakeRate(30, 2, 0)).toBeLessThanOrEqual(5);
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
