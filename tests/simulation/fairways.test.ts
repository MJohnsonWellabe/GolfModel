import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, NO_WIND, openHole, SWING_OF } from './simHelpers';

/**
 * GDD Appendix A fairway accuracy on a 30yd-wide fairway:
 *   perfect swing — driver 85% · fairway wood 90% · irons 95%
 *   missed swing — driver 60% · fairway wood 70% · irons 82%
 * Missed swings include the click offset, so those runs sample a uniform
 * accuracy offset in the miss band alongside the ×4 residual dispersion.
 */

const CORRIDOR_YD = 30;
const half = (CORRIDOR_YD / 2) * PX_PER_YARD;
const hole = openHole({
  fairway: [
    [
      [1500 - half, 2900],
      [1500 + half, 2900],
      [1500 + half, 100],
      [1500 - half, 100]
    ]
  ]
});
const golfer = golferWith(85);

function fairwayPct(clubId: string, quality: 'perfect' | 'miss', n = 1200): number {
  const rng = mulberry32(555 + clubId.length * 17 + quality.length);
  const engine = new PhysicsEngine(hole, null, rng);
  const club = clubById(clubId);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    // Miss clicks land anywhere outside the good band: sample a signed
    // offset in the miss range (the meter reports up to ±1, scaled ×1.5
    // beyond the band — typical real misses cluster just outside it).
    const off = quality === 'perfect' ? 0 : (rng() < 0.5 ? -1 : 1) * (0.18 + rng() * 0.3);
    const out = engine.simulate({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: SWING_OF(0.95, quality, off),
      club,
      golfer,
      fireBoost: 0,
      lie: 'tee',
      wind: NO_WIND,
      hole
    });
    const surf = engine.surfaceAt(out.finalPos.x, out.finalPos.y);
    if (surf === 'fairway' || surf === 'green' || surf === 'fringe') hit++;
  }
  return (100 * hit) / n;
}

/**
 * DOCUMENTED DEVIATION (see 02_GAME_DESIGN_DOCUMENT.md Appendix A note):
 * the GDD's dispersion table (driver ≤15yd p90) and its fairway table (85%
 * on a 30yd corridor) are mutually inconsistent — ≤15yd p90 mathematically
 * puts ~97% of perfect drives inside ±15yd. The dispersion table wins
 * (it's what shots FEEL like); these assertions pin the resulting rates so
 * regressions still surface, and enforce the orderings the GDD cares about.
 */
describe('Fairway accuracy — 30yd corridor (dispersion-first calibration)', () => {
  it('perfect driver stays on the intended fairway line', () => {
    const pct = fairwayPct('driver', 'perfect');
    expect(pct, `driver perfect ${pct.toFixed(1)}%`).toBeGreaterThanOrEqual(99);
  });
  it('perfect 3-wood beats perfect driver', () => {
    const w = fairwayPct('3w', 'perfect');
    const d = fairwayPct('driver', 'perfect');
    expect(w, `3w ${w.toFixed(1)}% vs driver ${d.toFixed(1)}%`).toBeGreaterThanOrEqual(d);
  });
  it('perfect 7-iron ≈ near-automatic', () => {
    expect(fairwayPct('7i', 'perfect')).toBeGreaterThanOrEqual(96);
  });
  it('missed driver drops toward the GDD 60% band', () => {
    const pct = fairwayPct('driver', 'miss');
    expect(pct, `driver miss ${pct.toFixed(1)}%`).toBeGreaterThanOrEqual(35);
    expect(pct, `driver miss ${pct.toFixed(1)}%`).toBeLessThanOrEqual(65);
  });
  it('missed 7-iron stays far more playable than a missed driver', () => {
    const iron = fairwayPct('7i', 'miss');
    const driver = fairwayPct('driver', 'miss');
    expect(iron, `7i miss ${iron.toFixed(1)}%`).toBeGreaterThanOrEqual(68);
    expect(iron).toBeGreaterThan(driver + 15);
  });
});
