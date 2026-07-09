import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { ftToPx, golferWith, NO_WIND, openHole, PERFECT_SWING, SWING_OF } from './simHelpers';

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
const CARRY_PX = 40 * (0.259 + (85 / 100) * 0.926) * 2;

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
