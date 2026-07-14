import { describe, expect, it } from 'vitest';
import { buildHeightField } from '../src/systems/HeightField';
import { CourseAuthoring, loadCourse } from '../src/data/courseLoader';
import portjohnson from '../src/data/courses/portjohnson.json';
import sablebay from '../src/data/courses/sablebay.json';
import timberline from '../src/data/courses/timberline.json';
import wildwood from '../src/data/courses/wildwood.json';

/**
 * The green plateau mesh (course3d buildPlateau) conforms to the heightfield
 * only at its ring vertices and interpolates linearly between them, while the
 * putt grid (+0.14 skin) and the cup disc (+0.06) conform to the TRUE field.
 * Wherever the interpolated mesh bows more than those offsets above the true
 * terrain, the grid/cup render UNDER the green and disappear — Port Johnson
 * hole 3 (green across an elevation-plateau skirt) shipped exactly that with
 * the old sparse rings [0, .45, .8, 1] (~0.36 excess). This guards the ring
 * density against any green authored on rough terrain.
 *
 * MUST MATCH course3d.ts buildPlateau: ANG and the top-ring factors.
 */
const ANG = 72;
const TOP_T = Array.from({ length: 21 }, (_, i) => i / 20);
/** The cup disc floats +0.06 over the true field — the tightest clearance. */
const CUP_CLEARANCE = 0.06;

const COURSES = [portjohnson, sablebay, timberline, wildwood].map((c) =>
  loadCourse(c as unknown as CourseAuthoring)
);

describe('green plateau mesh conforms to the heightfield', () => {
  for (const course of COURSES) {
    for (const h of course.holes) {
      it(`${course.name} hole ${h.number}: mesh never bows above the cup/grid skins`, () => {
        const hf = buildHeightField(h);
        if (!hf) return; // flat hole — mesh is exact by construction
        for (const g of [h.green, h.green2].filter(Boolean) as Array<typeof h.green>) {
          const c = Math.cos(g.rot ?? 0);
          const s = Math.sin(g.rot ?? 0);
          let worst = 0;
          for (let a = 0; a < ANG; a++) {
            const theta = (a / ANG) * Math.PI * 2;
            const at = (t: number): [number, number] => {
              const lx = Math.cos(theta) * g.rx * t;
              const ly = Math.sin(theta) * g.ry * t;
              return [g.cx + lx * c - ly * s, g.cy + lx * s + ly * c];
            };
            const ringH = TOP_T.map((t) => {
              const [x, y] = at(t);
              return hf.heightAt(x, y);
            });
            for (let seg = 0; seg < TOP_T.length - 1; seg++) {
              for (let f = 1; f < 10; f++) {
                const t = TOP_T[seg] + ((TOP_T[seg + 1] - TOP_T[seg]) * f) / 10;
                const mesh = ringH[seg] + (ringH[seg + 1] - ringH[seg]) * (f / 10);
                const [x, y] = at(t);
                worst = Math.max(worst, mesh - hf.heightAt(x, y));
              }
            }
          }
          expect(worst).toBeLessThan(CUP_CLEARANCE);
        }
      });
    }
  }
});
