import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { Surface } from '../../src/core/types';
import { golferWith, NO_WIND, openHole, SWING_OF } from './simHelpers';

/**
 * A PERFECT swing launches on the intended start line — the start line is earned
 * (GDD §864). From a clean lie (tee/fairway) a perfect, centered swing has zero
 * residual start-line angle, so it begins dead on-line; believable END spread is
 * preserved elsewhere (perfect full swings keep a ~5% carry-depth variance, and
 * wind bends the ball in flight). Good and missed swings still widen
 * substantially (×2.4 / ×6), and a bad lie still adds its own scatter even on a
 * perfect click.
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

describe('Perfect-click dispersion — centered swings launch on the start line (p90 lateral, yards)', () => {
  it('a perfect driver from a clean lie begins on-line', () => {
    const p = lateralP90('driver', 'perfect');
    expect(p, `driver p90=${p.toFixed(2)}yd`).toBeLessThanOrEqual(1);
  });
  it('a perfect 5-iron begins on-line', () => {
    const p = lateralP90('5i', 'perfect');
    expect(p, `5i p90=${p.toFixed(2)}yd`).toBeLessThanOrEqual(1);
  });
  it('a perfect wedge begins on-line', () => {
    const p = lateralP90('pw', 'perfect');
    expect(p, `pw p90=${p.toFixed(2)}yd`).toBeLessThanOrEqual(1);
  });
  it('off-perfect dispersion still orders driver > iron > wedge', () => {
    // With a perfect swing now dead on-line, the club-by-club residual scaling
    // shows up on GOOD (and worse) swings, where it should still order longest
    // club widest.
    expect(lateralP90('driver', 'good', 600)).toBeGreaterThan(lateralP90('7i', 'good', 600));
    expect(lateralP90('7i', 'good', 600)).toBeGreaterThan(lateralP90('pw', 'good', 600));
  });
});

describe('Appendix A dispersion — quality multipliers', () => {
  it('a good swing starts clearly offline while a perfect one does not', () => {
    const perfect = lateralP90('driver', 'perfect');
    const good = lateralP90('driver', 'good');
    expect(perfect, `perfect p90=${perfect.toFixed(2)}yd`).toBeLessThanOrEqual(1);
    expect(good, `good p90=${good.toFixed(1)}yd`).toBeGreaterThan(3);
  });
  it('a missed swing is heavily punished vs a good swing (≈×2.5 the residual)', () => {
    const ratio = lateralP90('driver', 'miss') / lateralP90('driver', 'good');
    expect(ratio, `miss/good=${ratio.toFixed(2)}`).toBeGreaterThan(2);
    expect(ratio, `miss/good=${ratio.toFixed(2)}`).toBeLessThan(3.2);
  });
});

/**
 * A rough/sand lie adds its own direction noise (PHYSICS.lieError) on top of
 * the residual dispersion above. That term's quality scaling used to reuse
 * the SAME 1/2/4 multiplier as the residual — which quietly moved a GOOD (and
 * a miss) rough shot's scatter to 2x/4x its old flat value, since lieError
 * had never been quality-scaled before (bug report: "started to feel random
 * on some good hits"). Only PERFECT should tighten; GOOD must stay at the
 * historical baseline a rough/sand lie always scattered by.
 */
function lateralP90Lie(quality: 'perfect' | 'good' | 'miss', lie: Surface, n = 1200): number {
  const rng = mulberry32(77 + lie.length * 13 + quality.length);
  const engine = new PhysicsEngine(hole, null, rng);
  const club = clubById('7i');
  const lats: number[] = [];
  for (let i = 0; i < n; i++) {
    const out = engine.simulate({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: SWING_OF(0.95, quality, 0),
      club,
      golfer,
      fireBoost: 0,
      lie,
      wind: NO_WIND,
      hole
    });
    lats.push(Math.abs(out.finalPos.x - 1500) / PX_PER_YARD);
  }
  lats.sort((a, b) => a - b);
  return lats[Math.floor(n * 0.9)];
}

/**
 * SIGNED lateral offsets (yards) for a lie/quality combo — used to isolate the
 * lie term's own variance (below), where an unsigned/p90 read isn't precise
 * enough: a good/perfect RATIO stays ~2x whether "good" lie-noise is scaled at
 * 1x or 2x its perfect value (the ratio between them is identical either way —
 * a ratio-only check can't tell "both doubled" from "the baseline itself
 * moved"), so this must compare against the ABSOLUTE baseline instead.
 */
function signedLaterals(quality: 'perfect' | 'good' | 'miss', lie: Surface, n = 3000): number[] {
  const rng = mulberry32(41 + lie.length * 17 + quality.length);
  const engine = new PhysicsEngine(hole, null, rng);
  const club = clubById('7i');
  const lats: number[] = [];
  for (let i = 0; i < n; i++) {
    const out = engine.simulate({
      origin: { x: 1500, y: 2800 },
      aimAngle: -Math.PI / 2,
      swing: SWING_OF(0.95, quality, 0),
      club,
      golfer,
      fireBoost: 0,
      lie,
      wind: NO_WIND,
      hole
    });
    lats.push((out.finalPos.x - 1500) / PX_PER_YARD);
  }
  return lats;
}

function variance(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
}

describe('Rough-lie dispersion does not widen a GOOD swing beyond its historical baseline', () => {
  it('a PERFECT rough shot is tighter than a GOOD one, which is tighter than a MISS', () => {
    const perfect = lateralP90Lie('perfect', 'rough');
    const good = lateralP90Lie('good', 'rough');
    const miss = lateralP90Lie('miss', 'rough');
    expect(perfect, `perfect=${perfect.toFixed(1)} good=${good.toFixed(1)}`).toBeLessThan(good);
    expect(good, `good=${good.toFixed(1)} miss=${miss.toFixed(1)}`).toBeLessThan(miss);
  });

  it("a GOOD rough shot's variance vs a GOOD tee shot's isolates the lie-noise term at its historical (1x) strength, not 2x", () => {
    // Same club/quality/accuracy-click on both lies → the residual/click terms
    // contribute IDENTICAL variance either way, so the difference in total
    // variance is purely the added lie-noise variance. lieError.rough is 3.5°;
    // at a fixed 1x ("good" stays at the historical baseline) that variance
    // contribution is bounded well under what a reintroduced 2x would produce.
    const roughVar = variance(signedLaterals('good', 'rough'));
    const teeVar = variance(signedLaterals('good', 'tee'));
    const lieVarYds = roughVar - teeVar;
    // Measured: ~40yd² at the fixed 1x multiplier vs ~190yd² if the old bug's
    // 2x is reintroduced — comfortable margin either side of this ceiling.
    expect(lieVarYds, `lie-noise variance contribution ≈${lieVarYds.toFixed(1)} yd²`).toBeLessThan(100);
  });
});
