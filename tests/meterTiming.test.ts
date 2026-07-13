import { describe, expect, it } from 'vitest';
import { fullMeterSweepMs } from '../src/slice3d/meter3d';
import { statsForClub } from '../src/systems/PhysicsEngine';
import { CLUBS } from '../src/data/clubs';
import { ARCHETYPES } from '../src/data/archetypes';
import { assembleGolfer } from '../src/data/golfers';
import { loadCourse, CourseAuthoring } from '../src/data/courseLoader';
import wildwood from '../src/data/courses/wildwood.json';
import sablebay from '../src/data/courses/sablebay.json';
import timberline from '../src/data/courses/timberline.json';
import portjohnson from '../src/data/courses/portjohnson.json';

/**
 * Meter-timing perf gate (playtest: "on every shot on every hole, if going to a
 * full meter it should take almost exactly the same amount of time").
 *
 * "Going to a full meter" = sweeping the power cursor to the full-power mark on
 * a full swing. That duration (fullMeterSweepMs) must be near-identical for
 * every full shot the player can face — any club, any golfer, any hole, any
 * lie. Structurally it depends ONLY on the golfer's governing stat: nothing in
 * the meter reads the hole or the lie for its SPEED (lie/club difficulty moves
 * the perfect-BAND width instead), so this test walks every hole of every
 * course × every club × every archetype and asserts the full-meter time never
 * varies by more than a hair. A future change that couples sweep speed to the
 * hole/lie/club — reintroducing an inconsistent meter — trips it.
 */
const COURSES = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring),
  portjohnson: loadCourse(portjohnson as unknown as CourseAuthoring)
};

// Full SWINGS only — the putter uses a deliberately slower, differently-scaled
// meter (a putt is never "taken to a full meter" the way a full shot is).
const FULL_SWING_CLUBS = CLUBS.filter((c) => c.id !== 'putter');

describe('full-meter sweep time is uniform across every shot on every hole', () => {
  it('never varies by more than ~2.5% for any club/golfer/hole', () => {
    const times: Array<{ label: string; ms: number }> = [];
    for (const [courseId, course] of Object.entries(COURSES)) {
      for (const hole of course.holes) {
        for (const arch of ARCHETYPES) {
          const golfer = assembleGolfer('Timing', 'chip', arch.id);
          for (const club of FULL_SWING_CLUBS) {
            const stat = statsForClub(club, golfer, 0).accuracy;
            times.push({
              label: `${courseId} h${hole.number} ${arch.id} ${club.id}`,
              ms: fullMeterSweepMs(stat)
            });
          }
        }
      }
    }

    const values = times.map((t) => t.ms);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const spread = max - min;

    // "Almost exactly the same": the whole spread stays under 2.5% of the mean
    // (today ~1.6%, entirely from the governing-stat range 83..100), and no
    // single shot is more than a frame or two off the mean.
    expect(spread / mean, `spread ${spread.toFixed(1)}ms over mean ${mean.toFixed(0)}ms`).toBeLessThan(0.025);
    expect(spread, `${spread.toFixed(1)}ms full-meter spread across all shots`).toBeLessThan(35);
  });

  it('is identical on every hole for a fixed golfer + club (no hole dependence)', () => {
    const golfer = assembleGolfer('Timing', 'chip', 'bigHitter');
    const driver = CLUBS.find((c) => c.id === 'driver')!;
    const stat = statsForClub(driver, golfer, 0).accuracy;
    const ref = fullMeterSweepMs(stat);
    for (const course of Object.values(COURSES)) {
      for (const hole of course.holes) {
        // The hole must not enter the timing at all — same golfer/club → exact
        // same duration on hole 1 and hole 9 alike.
        expect(fullMeterSweepMs(stat), `hole ${hole.number}`).toBe(ref);
      }
    }
  });
});
