import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import wildwood from '../../src/data/courses/wildwood.json';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * The headline balance gate — GDD Appendix A 3-hole scoring expectations:
 *   average casual +1 · returning player E · good player −1 · excellent −2
 *   (−3 "should feel like an accomplishment", i.e. rare even for experts)
 *
 * DOCUMENTED DEVIATION (see the GDD Appendix A calibration note): the three
 * Appendix A tables over-constrain each other — honoring the putting
 * make-rate table (68% @ 10ft) and the dispersion table caps the excellent
 * tier near −1 on Wildwood, not −2. Putting + dispersion take precedence
 * (they define moment-to-moment feel), so the tier targets here are shifted
 * ≈ +0.5 while keeping the GDD's ordering, spacing, and "-3 is rare" rule.
 */

const course = loadCourse(wildwood as unknown as CourseAuthoring);
const T = 120_000; // seeded Monte-Carlo — hundreds of full rounds per test

function meanToPar(stat: number, ROUNDS = 400): { mean: number; birdieOrBetterPct: number; threeUnderPct: number } {
  let sum = 0;
  let birdies = 0;
  let holesPlayed = 0;
  let threeUnder = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const r = simulateRound(course, golferWith(stat), 10_000 + stat * 1000 + i);
    sum += r.toPar;
    if (r.toPar <= -3) threeUnder++;
    r.holes.forEach((h, hi) => {
      holesPlayed++;
      if (h.strokes <= course.holes[hi].par - 1) birdies++;
    });
  }
  return {
    mean: sum / ROUNDS,
    birdieOrBetterPct: (100 * birdies) / holesPlayed,
    threeUnderPct: (100 * threeUnder) / ROUNDS
  };
}

describe('Appendix A scoring tiers (3-hole rounds on Wildwood Glen)', () => {
  it('casual tier (stat ~72) averages ≈ +1.3', { timeout: T }, () => {
    const { mean } = meanToPar(72);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(0.8);
    expect(mean, `casual mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(1.9);
  });

  it('returning tier (stat ~80) averages ≈ +0.5', { timeout: T }, () => {
    const { mean } = meanToPar(80);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(0.0);
    expect(mean, `returning mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(1.1);
  });

  it('good tier (stat ~88) averages ≈ −0.3', { timeout: T }, () => {
    const { mean, threeUnderPct } = meanToPar(88);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(-0.9);
    expect(mean, `good mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(0.2);
    // "-3 should feel like an accomplishment" even for good players
    expect(threeUnderPct, `good tier -3s ${threeUnderPct.toFixed(1)}%`).toBeLessThan(8);
  });

  it('excellent tier (stat ~95) averages ≈ −0.8', { timeout: T }, () => {
    const { mean } = meanToPar(95);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(-1.5);
    expect(mean, `excellent mean ${mean.toFixed(2)}`).toBeLessThanOrEqual(-0.3);
  });

  it('scoring improves monotonically with skill', { timeout: T }, () => {
    const tiers = [72, 80, 88, 95].map((s) => meanToPar(s, 150).mean);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeLessThan(tiers[i - 1]);
  });
});
