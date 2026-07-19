import { describe, expect, it } from 'vitest';
import sablebay from '../../src/data/courses/sablebay.json';
import timberline from '../../src/data/courses/timberline.json';
import wildwood from '../../src/data/courses/wildwood.json';
import portjohnson from '../../src/data/courses/portjohnson.json';
import redhollow from '../../src/data/courses/redhollow.json';
import wildvalley from '../../src/data/courses/wildvalley.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * Every course must be *playable* — every hole reachable, greens holeable, and
 * average scores in a sane band for a good golfer. This catches broken geometry
 * (an unreachable green, water or sand that makes a hole impossible, a dogleg
 * that doesn't connect). The fairness invariant is a small unfinished-hole
 * tolerance: courses now carry real in-play water at landing zones (design
 * direction: "let the game get hard; occasional max-strokes are fine as long
 * as it's not pervasive"), so an OCCASIONAL stroke-cap pickup is accepted —
 * but anything past ~2% of hole-plays means a hole is genuinely walled off.
 * The mean band stays deliberately WIDE ([-3, +8]): the courses are meant to
 * play hard and are recalibrated by feel later — this gate is a floor/ceiling
 * sanity check, not a calibration.
 */
function meanToPar(course: CourseAuthoring, bounded = false): { mean: number; unfinished: number } {
  const c = loadCourse(course);
  const golfer = golferWith(85);
  let sum = 0;
  let unfinished = 0;
  const N = 60; // rounds/course (was 120) — halved for suite speed; the ~2%
  for (let s = 0; s < N; s++) {
    const r = simulateRound(c, golfer, 4000 + s * 13, undefined, bounded);
    sum += r.toPar;
    for (const h of r.holes) if (!h.holed) unfinished++;
  }
  return { mean: sum / N, unfinished };
}

/** ~2% of the 180 hole-plays above (60 rounds × 3 holes) — tolerance scaled with
 *  N so the "essentially every hole finishes" invariant is unchanged. */
const UNFINISHED_TOLERANCE = 4;

describe('new course playability', () => {
  // These Monte-Carlo suites play 120 full rounds each; the heavy-water Sable
  // Bay and per-trunk tree collision push them past the default 5s, so give
  // them room (they still finish in a few seconds).
  it('Sable Bay plays to a sane average and every hole finishes', () => {
    const { mean, unfinished } = meanToPar(sablebay as unknown as CourseAuthoring);
    expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
    // Water makes it demanding but not impossible for a strong player.
    expect(mean, `Sable Bay mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Sable Bay mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Timberline plays to a sane average and every hole finishes', () => {
    const { mean, unfinished } = meanToPar(timberline as unknown as CourseAuthoring);
    expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
    expect(mean, `Timberline mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Timberline mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Wildwood Glen plays to a sane average and every hole finishes', () => {
    // Small greens + greenside sand (Bethpage redesign) demand accuracy without
    // becoming unfair — the gate catches a green that got too small to hit.
    const { mean, unfinished } = meanToPar(wildwood as unknown as CourseAuthoring);
    expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
    expect(mean, `Wildwood mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Wildwood mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Port Johnson Links plays to a sane average and every hole finishes', () => {
    // Wide-open links: playable off the tee, but deep waste bunkers + tall grass
    // and the long par 5 keep it honest. The gate catches an unescapable waste
    // bunker or a green the wind makes unreachable.
    const { mean, unfinished } = meanToPar(portjohnson as unknown as CourseAuthoring);
    expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
    expect(mean, `Port Johnson mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Port Johnson mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Red Hollow plays to a sane average and every hole finishes', () => {
    // Desert carry golf: red-rock waste everywhere but real fairway to hit —
    // the gate catches a chasm/waste carry that walls a hole off.
    const { mean, unfinished } = meanToPar(redhollow as unknown as CourseAuthoring);
    expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
    expect(mean, `Red Hollow mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Red Hollow mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  it('Wild Prairie plays to a sane average and every hole finishes', () => {
    // Wide Sand Valley fairways, punishing blowouts: generous off the tee,
    // honest around the greens. The gate catches an unescapable blowout.
    const { mean, unfinished } = meanToPar(wildvalley as unknown as CourseAuthoring);
    expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
    expect(mean, `Wild Prairie mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
    expect(mean, `Wild Prairie mean ${mean.toFixed(2)}`).toBeLessThan(8);
  }, 35000);

  // BOUNDED WORLD (`boundedWorld` flag): with a playable boundary derived for
  // every hole, a ball into the off-course void takes a one-stroke penalty and
  // drops back in the rough. Every hole must STILL finish and stay in a sane
  // scoring band — the gate catches a boundary that walls a hole off or an
  // unrecoverable relief loop.
  const ALL: Array<[string, CourseAuthoring]> = [
    ['Sable Bay', sablebay as unknown as CourseAuthoring],
    ['Timberline', timberline as unknown as CourseAuthoring],
    ['Wildwood', wildwood as unknown as CourseAuthoring],
    ['Port Johnson', portjohnson as unknown as CourseAuthoring],
    ['Red Hollow', redhollow as unknown as CourseAuthoring],
    ['Wild Prairie', wildvalley as unknown as CourseAuthoring]
  ];
  it('every course still finishes under the bounded-world off-course penalty', () => {
    for (const [name, json] of ALL) {
      const { mean, unfinished } = meanToPar(json, true);
      expect(unfinished, `${name} unfinished (bounded) ${unfinished}`).toBeLessThanOrEqual(
        UNFINISHED_TOLERANCE * 2
      );
      expect(mean, `${name} mean (bounded) ${mean.toFixed(2)}`).toBeGreaterThan(-3);
      expect(mean, `${name} mean (bounded) ${mean.toFixed(2)}`).toBeLessThan(9);
    }
  }, 180000);
});
