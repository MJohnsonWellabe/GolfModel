import { describe, expect, it } from 'vitest';
import timberlineV2 from '../../src/data/courses/v2/timberline.json';
import timberlineWestV2 from '../../src/data/courses/v2/timberlinewest.json';
import sablebayV2 from '../../src/data/courses/v2/sablebay.json';
import portjohnsonV2 from '../../src/data/courses/v2/portjohnson.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { buildHeightField } from '../../src/systems/HeightField';
import { computeBoundary, pointInBoundary } from '../../src/systems/PlayableBoundary';
import { PIN_MAX_GRADIENT } from '../../src/utils/Geometry';
import { simulateRound } from '../../src/systems/RoundSimulator';
import { golferWith } from './simHelpers';

/**
 * TEARDOWN/REBUILD gates (dev-environment roadmap, `courseRebuilds` flag).
 * Every v2 rebuild variant must clear the same bar as the expansion courses
 * before it can replace the shipped original in the dev roster:
 *  - playable: every hole finishes, mean-to-par in the sane band, including
 *    under the bounded-world off-course penalty;
 *  - puttable: every green's surface is smooth enough to putt and every
 *    computed pin sits on a legal gradient;
 *  - bounded: the derived playable boundary exists and contains the play
 *    surfaces (the corridor system must work on the rebuilt geometry).
 * Add each new rebuild to REBUILDS as it lands — one uniform gate wall.
 */
const REBUILDS: Record<string, CourseAuthoring> = {
  'Timberline East': timberlineV2 as unknown as CourseAuthoring,
  'Timberline West': timberlineWestV2 as unknown as CourseAuthoring,
  'Sable Bay': sablebayV2 as unknown as CourseAuthoring,
  'Port Johnson': portjohnsonV2 as unknown as CourseAuthoring
};

const UNFINISHED_TOLERANCE = 4; // ~2% of 180 hole-plays, same as newCourses

function meanToPar(course: CourseAuthoring, bounded = false): { mean: number; unfinished: number } {
  const c = loadCourse(course);
  const golfer = golferWith(85);
  let sum = 0;
  let unfinished = 0;
  const N = 60;
  for (let s = 0; s < N; s++) {
    const r = simulateRound(c, golfer, 7000 + s * 17, undefined, bounded);
    sum += r.toPar;
    for (const h of r.holes) if (!h.holed) unfinished++;
  }
  return { mean: sum / N, unfinished };
}

for (const [name, authoring] of Object.entries(REBUILDS)) {
  const course = loadCourse(authoring);
  const theme = resolveTheme(course);

  describe(`${name} v2 rebuild — playability`, () => {
    it('plays to a sane average and every hole finishes', () => {
      const { mean, unfinished } = meanToPar(authoring);
      expect(unfinished, `unfinished holes ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
      expect(mean, `${name} v2 mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
      expect(mean, `${name} v2 mean ${mean.toFixed(2)}`).toBeLessThan(8);
    }, 35000);

    it('stays playable under the bounded off-course penalty', () => {
      const { mean, unfinished } = meanToPar(authoring, true);
      expect(unfinished, `unfinished (bounded) ${unfinished}`).toBeLessThanOrEqual(UNFINISHED_TOLERANCE);
      expect(mean, `${name} v2 bounded mean ${mean.toFixed(2)}`).toBeGreaterThan(-3);
      expect(mean, `${name} v2 bounded mean ${mean.toFixed(2)}`).toBeLessThan(9);
    }, 35000);
  });

  describe(`${name} v2 rebuild — greens & boundary`, () => {
    course.holes.forEach((hole, i) => {
      const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);

      it(`h${i + 1}: every putting surface is smoothly puttable`, () => {
        for (const g of [hole.green, hole.green2].filter(Boolean) as Array<typeof hole.green>) {
          let min = Infinity;
          let max = -Infinity;
          for (let s = 0; s < 12; s++) {
            const a = (s / 12) * Math.PI * 2;
            const rim = Math.min(g.rx, g.ry) - 2;
            let prev: number | null = null;
            for (let d = 0; d <= rim; d += 8) {
              const hv = hf ? hf.heightAt(g.cx + Math.cos(a) * d, g.cy + Math.sin(a) * d) : 0;
              min = Math.min(min, hv);
              max = Math.max(max, hv);
              if (prev !== null) {
                expect(Math.abs(hv - prev), `h${i + 1} spoke ${s} step @${d}`).toBeLessThanOrEqual(1.4);
              }
              prev = hv;
            }
          }
          expect(max - min, `h${i + 1} green total relief`).toBeLessThanOrEqual(5);
        }
      });

      it(`h${i + 1}: every pin sits on a puttable gradient`, () => {
        for (const p of [hole.pin, ...(hole.pins ?? [])]) {
          const g = hf ? hf.gradientAt(p.x, p.y) : { x: 0, y: 0 };
          expect(Math.hypot(g.x, g.y), `pin @${p.x},${p.y}`).toBeLessThanOrEqual(PIN_MAX_GRADIENT);
        }
      });

      it(`h${i + 1}: the derived boundary exists and contains the play surfaces`, () => {
        const boundary = computeBoundary(hole);
        expect(boundary.length).toBeGreaterThan(0);
        expect(pointInBoundary(hole.tee.x, hole.tee.y, boundary)).toBe(true);
        expect(pointInBoundary(hole.green.cx, hole.green.cy, boundary)).toBe(true);
        expect(pointInBoundary(hole.pin.x, hole.pin.y, boundary)).toBe(true);
        for (const t of hole.aiTargets) expect(pointInBoundary(t.x, t.y, boundary)).toBe(true);
        for (const rz of hole.recoveryZones ?? []) {
          for (const [x, y] of rz) expect(pointInBoundary(x, y, boundary), `rz pt ${x},${y}`).toBe(true);
        }
      });
    });
  });
}
