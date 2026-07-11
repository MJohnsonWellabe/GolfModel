import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * The headline balance gate — GDD Appendix A skill ordering, MEASURED GAME-WIDE
 * ACROSS ALL COURSES.
 *
 * Calibration is INTENTIONALLY loose right now: the playtest pass tightened the
 * feel (halved aim sensitivity, shot-shape now curves flight, restored the
 * missing fairway-tree collisions) and the explicit direction was "let the game
 * get hard — I'll recalibrate the exact tier averages later." So these tiers no
 * longer pin a narrow mean per skill level; they assert only the INVARIANTS that
 * must hold at any difficulty:
 *   1. every tier stays in a sane, human band (not impossible, not trivial):
 *      roughly [−4, +6] to par over a 3-hole round;
 *   2. score improves monotonically with skill (the separate test below);
 *   3. −3 stays an accomplishment — rare even for good players.
 *
 * The courses have deliberately DIFFERENT difficulties by design (hard
 * Bethpage-style Wildwood, tight forest Timberline, demanding water Sable Bay),
 * so a tier is averaged across all three rather than pinned to one course. When
 * the exact Appendix A means are re-tuned, tighten these bands back up.
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
  // Wide sanity band shared by every tier (see the header): playable-but-not-
  // trivial over a 3-hole round. Ordering is enforced by the monotonic test.
  const SANE_LOW = -4;
  const SANE_HIGH = 6;

  it('casual tier (stat ~72) stays in a sane, human band', { timeout: T }, () => {
    const { mean } = meanToPar(72);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
  });

  it('returning tier (stat ~80) stays in a sane, human band', { timeout: T }, () => {
    const { mean } = meanToPar(80);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
  });

  it('good tier (stat ~88) stays sane and keeps −3 rare', { timeout: T }, () => {
    const { mean, threeUnderPct } = meanToPar(88);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
    // "-3 should feel like an accomplishment" even for good players.
    expect(threeUnderPct, `good tier -3s ${threeUnderPct.toFixed(1)}%`).toBeLessThan(18);
  });

  it('excellent tier (stat ~95) stays in a sane, human band', { timeout: T }, () => {
    const { mean } = meanToPar(95);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
  });

  it('scoring improves monotonically with skill', { timeout: T }, () => {
    const tiers = [72, 80, 88, 95].map((s) => meanToPar(s, 120).mean);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeLessThan(tiers[i - 1]);
  });
});
