import { describe, expect, it } from 'vitest';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import wildwood from '../../src/data/courses/wildwood.json';
import portjohnson from '../../src/data/courses/portjohnson.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * Every course must be *playable* — every hole reachable, greens holeable, and
 * average scores in a sane band for a good golfer. This catches broken geometry
 * (an unreachable green, water or sand that makes a hole impossible, a dogleg
 * that doesn't connect). The fairness invariant is `everyHoled` (kept tight);
 * the mean band is deliberately WIDE ([-3, +8]) because the courses are meant
 * to play hard and are recalibrated by feel later — this gate is a floor/ceiling
 * sanity check, not a calibration.
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
    expect(mean, `Sable Bay mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Timberline plays to a sane average and every hole finishes', () => {
    const { mean, everyHoled } = meanToPar(timberline as unknown as CourseAuthoring);
    expect(everyHoled, 'every hole holes out within the stroke cap').toBe(true);
    expect(mean, `Timberline mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Timberline mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Wildwood Glen plays to a sane average and every hole finishes', () => {
    // Small greens + greenside sand (Bethpage redesign) demand accuracy without
    // becoming unfair — the gate catches a green that got too small to hit.
    const { mean, everyHoled } = meanToPar(wildwood as unknown as CourseAuthoring);
    expect(everyHoled, 'every hole holes out within the stroke cap').toBe(true);
    expect(mean, `Wildwood mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Wildwood mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Port Johnson Links plays to a sane average and every hole finishes', () => {
    // Wide-open links: playable off the tee, but deep waste bunkers + tall grass
    // and the long par 5 keep it honest. The gate catches an unescapable waste
    // bunker or a green the wind makes unreachable.
    const { mean, everyHoled } = meanToPar(portjohnson as unknown as CourseAuthoring);
    expect(everyHoled, 'every hole holes out within the stroke cap').toBe(true);
    expect(mean, `Port Johnson mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Port Johnson mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);
});
