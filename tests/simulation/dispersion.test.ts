import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, NO_WIND, openHole, SWING_OF } from './simHelpers';

/**
 * GDD Appendix A shot dispersion (yards off line at full carry):
 *   perfect — driver 8–15 · fairway wood 6–10 · long iron 5–8 · short iron
 *   3–6 · wedge 2–4; average swing ×2; poor swing ×4.
 * We read the range as the typical miss envelope: |lateral| p90 must land
 * inside it, and the quality multipliers must hold as ratios.
 */

const hole = openHole();
const golfer = golferWith(85);

function lateralP90(clubId: string, quality: 'perfect' | 'good' | 'miss', n = 1200): number {
  const rng = mulberry32(99 + clubId.length * 31 + quality.length);
  const engine = new PhysicsEngine(hole, null, rng);
  const club = clubById(clubId);
  const lats: number[] = [];
  for (let i = 0; i < n; i++) {
    // Full swing straight downrange; accuracy click offset 0 isolates the
    // residual dispersion model (the click-offset term is player skill).
    const out = engine.simulate({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: SWING_OF(0.95, quality, 0),
      club,
      golfer,
      fireBoost: 0,
      lie: 'tee',
      wind: NO_WIND,
      hole
    });
    lats.push(Math.abs(out.finalPos.x - 1500) / PX_PER_YARD);
  }
  lats.sort((a, b) => a - b);
  return lats[Math.floor(n * 0.9)];
}

describe('Appendix A dispersion — perfect swings (p90 lateral, yards)', () => {
  it('driver lands in the 8–15yd envelope', () => {
    const p = lateralP90('driver', 'perfect');
    expect(p, `driver p90=${p.toFixed(1)}yd`).toBeGreaterThanOrEqual(8);
    expect(p, `driver p90=${p.toFixed(1)}yd`).toBeLessThanOrEqual(15);
  });
  it('5-iron lands in the 5–8yd envelope', () => {
    const p = lateralP90('5i', 'perfect');
    expect(p, `5i p90=${p.toFixed(1)}yd`).toBeGreaterThanOrEqual(4);
    expect(p, `5i p90=${p.toFixed(1)}yd`).toBeLessThanOrEqual(8);
  });
  it('wedge lands in the 2–4yd envelope', () => {
    const p = lateralP90('pw', 'perfect');
    expect(p, `pw p90=${p.toFixed(1)}yd`).toBeGreaterThanOrEqual(1.5);
    expect(p, `pw p90=${p.toFixed(1)}yd`).toBeLessThanOrEqual(4.5);
  });
  it('dispersion orders driver > iron > wedge', () => {
    expect(lateralP90('driver', 'perfect', 600)).toBeGreaterThan(lateralP90('7i', 'perfect', 600));
    expect(lateralP90('7i', 'perfect', 600)).toBeGreaterThan(lateralP90('pw', 'perfect', 600));
  });
});

describe('Appendix A dispersion — quality multipliers', () => {
  it('good swings spread ~2x a perfect swing', () => {
    const ratio = lateralP90('driver', 'good') / lateralP90('driver', 'perfect');
    expect(ratio, `good/perfect=${ratio.toFixed(2)}`).toBeGreaterThan(1.6);
    expect(ratio, `good/perfect=${ratio.toFixed(2)}`).toBeLessThan(2.5);
  });
  it('missed swings spread ~4x a perfect swing', () => {
    const ratio = lateralP90('driver', 'miss') / lateralP90('driver', 'perfect');
    expect(ratio, `miss/perfect=${ratio.toFixed(2)}`).toBeGreaterThan(3.2);
    expect(ratio, `miss/perfect=${ratio.toFixed(2)}`).toBeLessThan(5);
  });
});
