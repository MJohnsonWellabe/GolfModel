import { describe, expect, it } from 'vitest';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * Phase 9: the two new courses (heavy-water Sable Bay, wooded Timberline) must
 * be *playable* — every hole reachable, greens holeable, and average scores in
 * a sane band for a good golfer. This catches broken geometry (unreachable
 * green, water that makes a hole impossible) that unit tests on Wildwood miss.
 */
function meanToPar(course: CourseAuthoring): { mean: number; everyHoled: boolean } {
  const c = loadCourse(course);
  const golfer = golferWith(85);
  let sum = 0;
  let everyHoled = true;
  const N = 120;
  for (let s = 0; s < N; s++) {
    const r = simulateRound(c, golfer, 4000 + s * 13);
    sum += r.toPar;
    if (r.holes.some((h) => !h.holed)) everyHoled = false;
  }
  return { mean: sum / N, everyHoled };
}

describe('new course playability', () => {
  // These Monte-Carlo suites play 120 full rounds each; the heavy-water Sable
  // Bay and per-trunk tree collision push them past the default 5s, so give
  // them room (they still finish in a few seconds).
  it('Sable Bay plays to a sane average and every hole finishes', () => {
    const { mean, everyHoled } = meanToPar(sablebay as unknown as CourseAuthoring);
    expect(everyHoled, 'every hole holes out within the stroke cap').toBe(true);
    // Water makes it demanding but not impossible for a strong player.
    expect(mean, `Sable Bay mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Sable Bay mean ${mean.toFixed(2)}`).toBeLessThan(6);
  }, 20000);

  it('Timberline plays to a sane average and every hole finishes', () => {
    const { mean, everyHoled } = meanToPar(timberline as unknown as CourseAuthoring);
    expect(everyHoled, 'every hole holes out within the stroke cap').toBe(true);
    expect(mean, `Timberline mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Timberline mean ${mean.toFixed(2)}`).toBeLessThan(6);
  }, 20000);
});
