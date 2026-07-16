import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { ftToPx, golferWith, NO_WIND, openHole, PERFECT_SWING, SWING_OF } from './simHelpers';
import portjohnson from '../../src/data/courses/portjohnson.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { AimControl } from '../../src/core/input/AimControl';

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
    // A 40-footer is far from a gimme even struck perfectly.
    expect(makeRate(40, 'perfect')).toBeLessThanOrEqual(60);
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


describe('putting — Port Johnson long uphill True Vision regression', () => {
  it('a perfect 78ft final-hole putt uses slope-aware pace instead of dying 20ft short', () => {
    const course = loadCourse(portjohnson as unknown as CourseAuthoring);
    const pj3 = course.holes[2];
    const engine = new PhysicsEngine(pj3, null, () => 0.5);
    const aim = new AimControl(pj3, engine);
    aim.setClubById('putter');
    aim.yaw = 0;
    aim.distPx = ftToPx(78);
    const origin = { x: pj3.pin.x - ftToPx(78), y: pj3.pin.y };
    const ctx = { ball: origin, lie: 'green' as const, golfer, fireBoost: 0, strokes: 2 };
    const power = aim.barToPhysicsPower(aim.barPowerTarget(ctx), ctx);
    const out = engine.simulate({
      origin,
      aimAngle: aim.yaw,
      swing: PERFECT_SWING(power),
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole: pj3
    });
    const traveledFt = Math.hypot(out.finalPos.x - origin.x, out.finalPos.y - origin.y) / PX_PER_YARD * 3;
    const remainingFt = Math.hypot(out.finalPos.x - pj3.pin.x, out.finalPos.y - pj3.pin.y) / PX_PER_YARD * 3;
    expect(traveledFt).toBeGreaterThan(65);
    expect(remainingFt).toBeLessThan(10);
  });
});
