import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * The headline balance gate — GDD Appendix A 3-hole scoring expectations:
 *   average casual ≈ +1 · returning ≈ +0.5 · good ≈ −0.3 · excellent ≈ −0.8
 *   (−3 "should feel like an accomplishment", i.e. rare even for experts)
 *
 * MEASURED GAME-WIDE, ACROSS ALL COURSES. The courses now have deliberately
 * DIFFERENT difficulties by design — Wildwood is a hard Bethpage-style
 * championship layout (small greens, greenside sand, long holes), Timberline is
 * a tight tree-lined forest, Sable Bay a demanding water course. The Appendix A
 * tiers are a GAME-WIDE player-experience target, so we average a tier's score
 * across all three courses rather than pin the calibration to any single one
 * (Wildwood used to be the neutral baseline; it no longer is). The three-course
 * average still tracks Appendix A, while any one course may play harder/easier.
 *
 * Prior calibration history: the FB9 putting rework and the ~10% drive nerf
 * (PHYSICS.driveDistanceScale) each shifted the curve; ordering, spacing and the
 * "−3 is rare" rule are the invariants that must always hold.
 */

const courses = [wildwood, sablebay, timberline].map((c) => loadCourse(c as unknown as CourseAuthoring));
const T = 120_000; // seeded Monte-Carlo — hundreds of full rounds per test

/** Game-wide mean-to-par for a skill tier: averaged across every course. */
function meanToPar(stat: number, ROUNDS = 240): { mean: number; threeUnderPct: number } {
  let sum = 0;
  let rounds = 0;
  let threeUnder = 0;
  for (const course of courses) {
    for (let i = 0; i < ROUNDS; i++) {
      const r = simulateRound(course, golferWith(stat), 10_000 + stat * 1000 + i);
      sum += r.toPar;
      if (r.toPar <= -3) threeUnder++;
      rounds++;
    }
  }
  return { mean: sum / rounds, threeUnderPct: (100 * threeUnder) / rounds };
}

describe('Appendix A scoring tiers (3-hole rounds, game-wide across courses)', () => {
  it('casual tier (stat ~72) averages ≈ +1', { timeout: T }, () => {
    const { mean } = meanToPar(72);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(0.6);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(2.2);
  });

  it('returning tier (stat ~80) averages ≈ +0.5', { timeout: T }, () => {
    const { mean } = meanToPar(80);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(0.0);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(1.4);
  });

  it('good tier (stat ~88) averages ≈ −0.2', { timeout: T }, () => {
    const { mean, threeUnderPct } = meanToPar(88);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(-0.9);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(0.6);
    // "-3 should feel like an accomplishment" even for good players
    expect(threeUnderPct, `good tier -3s ${threeUnderPct.toFixed(1)}%`).toBeLessThan(18);
  });

  it('excellent tier (stat ~95) averages ≈ −0.8', { timeout: T }, () => {
    const { mean } = meanToPar(95);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(-1.6);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(-0.2);
  });

  it('scoring improves monotonically with skill', { timeout: T }, () => {
    const tiers = [72, 80, 88, 95].map((s) => meanToPar(s, 120).mean);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeLessThan(tiers[i - 1]);
  });
});
