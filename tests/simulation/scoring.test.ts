import { beforeAll, describe, expect, it } from 'vitest';
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
 *
 * PERF: every test here reads the SAME per-tier Monte-Carlo, computed ONCE in
 * beforeAll and cached (the 5 tests used to each re-run overlapping batches —
 * ~4300 rounds total). 90 rounds/course/tier keeps the loose bands + the −3
 * rarity estimate stable while cutting the file from ~28s to a few seconds. The
 * bands and assertions below are unchanged.
 */

const courses = [wildwood, sablebay, timberline].map((c) => loadCourse(c as unknown as CourseAuthoring));
const T = 120_000; // seeded Monte-Carlo timeout ceiling
const ROUNDS = 90; // per course per tier (was 240); shared across every test

/** Game-wide mean-to-par for a skill tier: averaged across every course. */
function meanToPar(stat: number, rounds = ROUNDS): { mean: number; threeUnderPct: number } {
  let sum = 0;
  let n = 0;
  let threeUnder = 0;
  for (const course of courses) {
    for (let i = 0; i < rounds; i++) {
      const r = simulateRound(course, golferWith(stat), 10_000 + stat * 1000 + i);
      sum += r.toPar;
      if (r.toPar <= -3) threeUnder++;
      n++;
    }
  }
  return { mean: sum / n, threeUnderPct: (100 * threeUnder) / n };
}

// Compute each tier's Monte-Carlo ONCE and share across all tests (the old file
// re-simulated overlapping batches per test — the dominant cost of the suite).
const TIERS = [72, 80, 88, 95];
const cache = new Map<number, { mean: number; threeUnderPct: number }>();
const tier = (stat: number): { mean: number; threeUnderPct: number } => cache.get(stat)!;

describe('Appendix A scoring tiers (3-hole rounds, game-wide across courses)', () => {
  beforeAll(() => {
    for (const s of TIERS) cache.set(s, meanToPar(s));
  }, T);

  // Wide sanity band shared by every tier (see the header): playable-but-not-
  // trivial over a 3-hole round. Ordering is enforced by the monotonic test.
  const SANE_LOW = -4;
  const SANE_HIGH = 6;

  it('casual tier (stat ~72) stays in a sane, human band', () => {
    const { mean } = tier(72);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
  });

  it('returning tier (stat ~80) stays in a sane, human band', () => {
    const { mean } = tier(80);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
  });

  it('good tier (stat ~88) stays sane and keeps −3 rare', () => {
    const { mean, threeUnderPct } = tier(88);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
    // "-3 should feel like an accomplishment" even for good players.
    expect(threeUnderPct, `good tier -3s ${threeUnderPct.toFixed(1)}%`).toBeLessThan(18);
  });

  it('excellent tier (stat ~95) stays in a sane, human band', () => {
    const { mean } = tier(95);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(SANE_LOW);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(SANE_HIGH);
  });

  it('scoring improves monotonically with skill', () => {
    const means = TIERS.map((s) => tier(s).mean);
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeLessThan(means[i - 1]);
  });
});
