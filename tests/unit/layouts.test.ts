import { describe, expect, it } from 'vitest';
import { CourseData, HoleData, Point } from '../../src/core/types';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { applyTeeVariants, pickAuthoredPin, teeForSeed } from '../../src/systems/Layouts';
import { pointInGreens } from '../../src/utils/Geometry';
import sablebay from '../../src/data/courses/sablebay.json';
import wildwood from '../../src/data/courses/wildwood.json';
import timberline from '../../src/data/courses/timberline.json';
import portjohnson from '../../src/data/courses/portjohnson.json';
import redhollow from '../../src/data/courses/redhollow.json';
import wildvalley from '../../src/data/courses/wildvalley.json';

const ROSTER: Array<[string, CourseAuthoring]> = [
  ['sablebay', sablebay as unknown as CourseAuthoring],
  ['wildwood', wildwood as unknown as CourseAuthoring],
  ['timberline', timberline as unknown as CourseAuthoring],
  ['portjohnson', portjohnson as unknown as CourseAuthoring],
  ['redhollow', redhollow as unknown as CourseAuthoring],
  ['wildvalley', wildvalley as unknown as CourseAuthoring]
];

function inPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('authored layout data (every course)', () => {
  for (const [id, raw] of ROSTER) {
    const course = loadCourse(raw);
    it(`${id}: every authored pin sits ON its green with the random-pin margin`, () => {
      for (const h of course.holes) {
        for (const p of h.pins ?? []) {
          // Same inset randomPinForGreen enforces, so authored pins are never
          // closer to the collar than a random pin could be.
          const minR = Math.min(h.green.rx, h.green.ry, ...(h.green2 ? [h.green2.rx, h.green2.ry] : [Infinity]));
          const edge = Math.min(14, minR * 0.35);
          expect(
            pointInGreens(p.x, p.y, h.green, h.green2, -edge),
            `${id} h${h.number} pin (${p.x},${p.y})`
          ).toBe(true);
        }
      }
    });
    it(`${id}: every alternate tee is in-bounds and clear of hazards`, () => {
      for (const h of course.holes) {
        for (const t of h.tees ?? []) {
          expect(t.x).toBeGreaterThan(30);
          expect(t.y).toBeGreaterThan(30);
          expect(t.x).toBeLessThan(h.world.width - 30);
          expect(t.y).toBeLessThan(h.world.height - 30);
          for (const hz of h.hazards) {
            if (hz.type === 'water' || hz.type === 'bunker' || hz.type === 'trees') {
              expect(inPoly(t.x, t.y, hz.polygon as number[][]), `${id} h${h.number} tee in ${hz.type}`).toBe(false);
            }
          }
        }
      }
    });
  }
});

describe('layout selection mechanics', () => {
  const hole = (over: Partial<HoleData>): HoleData =>
    ({
      number: 1,
      par: 4,
      yardage: 400,
      world: { width: 900, height: 1200 },
      tee: { x: 450, y: 1050 },
      green: { cx: 450, cy: 260, rx: 60, ry: 50, rot: 0 },
      slope: { angle: 0, strength: 0 },
      pin: { x: 450, y: 260 },
      fairway: [],
      hazards: [],
      aiTargets: [],
      ...over
    }) as HoleData;
  const course = (holes: HoleData[]): CourseData => ({ name: 'T', holes }) as CourseData;

  it('is deterministic per seed and includes the standard tee in the draw', () => {
    const alt: Point = { x: 450, y: 980 };
    const h = hole({ tees: [alt] });
    const a = teeForSeed(h, 1234, 0);
    expect(teeForSeed(h, 1234, 0)).toEqual(a);
    // Across many seeds BOTH variants appear.
    const seen = new Set<number>();
    for (let s = 0; s < 40; s++) seen.add(teeForSeed(h, s, 0).y);
    expect(seen.has(1050)).toBe(true);
    expect(seen.has(980)).toBe(true);
  });

  it('applyTeeVariants returns the SAME course object when nothing varies', () => {
    const c = course([hole({})]);
    expect(applyTeeVariants(c, 99)).toBe(c);
    const withTees = course([hole({ tees: [{ x: 450, y: 980 }] })]);
    expect(applyTeeVariants(withTees, undefined)).toBe(withTees);
  });

  it('applyTeeVariants is idempotent (safe to call per hole)', () => {
    const withTees = course([hole({ tees: [{ x: 450, y: 980 }] })]);
    let seed = 0;
    // find a seed that picks the alternate so the interesting path is covered
    while (teeForSeed(withTees.holes[0], seed, 0).y !== 980) seed++;
    const once = applyTeeVariants(withTees, seed);
    const twice = applyTeeVariants(once, seed);
    expect(once.holes[0].tee).toEqual({ x: 450, y: 980 });
    expect(twice.holes[0].tee).toEqual(once.holes[0].tee);
  });

  it('pickAuthoredPin draws among authored pins, null without them', () => {
    const pins: Point[] = [
      { x: 440, y: 280 },
      { x: 460, y: 240 }
    ];
    const h = hole({ pins });
    expect(pickAuthoredPin(h, () => 0)).toEqual(pins[0]);
    expect(pickAuthoredPin(h, () => 0.99)).toEqual(pins[1]);
    expect(pickAuthoredPin(hole({}), () => 0.5)).toBeNull();
  });
});
