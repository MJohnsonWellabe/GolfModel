import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { ftToPx, golferWith, NO_WIND, openHole, PERFECT_SWING, SWING_OF } from './simHelpers';

/**
 * GDD Appendix A putting make-rates, perfect read + perfect stroke:
 *   3ft 99% · 5ft 94% · 8ft 82% · 10ft 68% · 15ft 45% · 20ft 28% · 30ft 12% · 40ft 5%
 * "Average read" (good-band stroke): 5ft 88% · 10ft 50% · 15ft 25% · 20ft 12% · 30ft 3%
 *
 * The curve emerges from pace noise + the tight cup/lip model; tolerances
 * are statistical (N=1500 seeded putts per distance).
 */

const hole = openHole();
const golfer = golferWith(85);
const putter = clubById('putter');

function makeRate(ft: number, quality: 'perfect' | 'good', n = 1500): number {
  const rng = mulberry32(1234 + ft * 7 + (quality === 'good' ? 1 : 0));
  const engine = new PhysicsEngine(hole, null, rng);
  const distPx = ftToPx(ft);
  const origin = { x: hole.pin.x, y: hole.pin.y + distPx };
  // Perfect pace read: power that rolls exactly to the cup
  const carryPx = 40 * (0.259 + (85 / 100) * 0.926) * 2;
  const power = distPx / carryPx;
  let holed = 0;
  for (let i = 0; i < n; i++) {
    const swing = quality === 'perfect' ? PERFECT_SWING(power) : SWING_OF(power, 'good', 0.04);
    const out = engine.simulate({
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
    if (out.holed) holed++;
  }
  return (100 * holed) / n;
}

describe('Appendix A putting table — perfect read + stroke', () => {
  const targets: Array<[ft: number, pct: number, tol: number]> = [
    [3, 99, 4],
    [5, 94, 6],
    [8, 82, 8],
    [10, 68, 8],
    [15, 45, 8],
    [20, 28, 8],
    [30, 12, 7],
    [40, 5, 6]
  ];
  for (const [ft, pct, tol] of targets) {
    it(`${ft}ft ≈ ${pct}%`, () => {
      const rate = makeRate(ft, 'perfect');
      expect(rate, `${ft}ft made ${rate.toFixed(1)}% (target ${pct}±${tol})`).toBeGreaterThanOrEqual(pct - tol);
      expect(rate, `${ft}ft made ${rate.toFixed(1)}% (target ${pct}±${tol})`).toBeLessThanOrEqual(pct + tol);
    });
  }

  it('make rate decreases monotonically with distance', () => {
    const rates = [3, 8, 15, 30].map((ft) => makeRate(ft, 'perfect', 800));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThan(rates[i - 1]);
  });
});

describe('Appendix A putting — average stroke (good band)', () => {
  const targets: Array<[ft: number, pct: number, tol: number]> = [
    [5, 88, 9],
    [10, 50, 10],
    [20, 12, 8]
  ];
  for (const [ft, pct, tol] of targets) {
    it(`${ft}ft ≈ ${pct}%`, () => {
      const rate = makeRate(ft, 'good');
      expect(rate, `${ft}ft made ${rate.toFixed(1)}%`).toBeGreaterThanOrEqual(pct - tol);
      expect(rate, `${ft}ft made ${rate.toFixed(1)}%`).toBeLessThanOrEqual(pct + tol);
    });
  }
});
