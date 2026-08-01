import { describe, expect, it } from 'vitest';
import { loadCourse, CourseAuthoring } from '../../src/data/courseLoader';
import { buildHeightField } from '../../src/systems/HeightField';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { PHYSICS } from '../../src/config';
import type { CourseData, HoleData } from '../../src/core/types';

import redhollowJson from '../../src/data/courses/redhollow.json';
import wildvalleyJson from '../../src/data/courses/wildvalley.json';
import maplevaleJson from '../../src/data/courses/maplevale.json';
import wildwoodJson from '../../src/data/courses/wildwood.json';
import timberlineV2Json from '../../src/data/courses/v2/timberline.json';
import timberlinewestV2Json from '../../src/data/courses/v2/timberlinewest.json';
import sablebayV2Json from '../../src/data/courses/v2/sablebay.json';
import portjohnsonV2Json from '../../src/data/courses/v2/portjohnson.json';

/**
 * NO GREEN SHOULD MAKE A BALL CLIMB OR DESCEND MORE THAN 48 INCHES.
 *
 * Owner: "We probably shouldn't have any slopes on greens where you have to
 * go up or down a more than 48 inch slope. We have a couple where the ball
 * literally just won't stop." — then, once every green in the game turned
 * out to exceed that today: "flatten all greens to not have any variance
 * larger than 48 inches between lowest and highest elevation points. but
 * within that you can add more rolling hills that are smaller."
 *
 * A green's total worst-case rise has TWO additive sources (breakAccel,
 * src/systems/PhysicsEngine.ts): the authored `slope.angle`/`strength` (a
 * uniform tilt, full weight on green/fringe) and the heightfield's own
 * `elevation` bumps under the green (also full weight on green/fringe,
 * unlike fairway/rough which is damped). Neither alone tells the true
 * story once a green has both — this samples the green's actual ellipse on
 * a grid, combining both sources exactly as breakAccel does, and converts
 * to feet via the same 1.5ft/unit the game's own elevation readout uses
 * (config.ts:529, main.ts:2817).
 */

const FT_PER_UNIT = 1.5;
const CAP_INCHES = 48;
const CAP_FT = CAP_INCHES / 12;
/** accel-per-strength ÷ accel-per-heightfield-gradient-unit: converts the
 *  authored slope into an equivalent constant height-gradient, in the same
 *  units `HeightField.heightAt` returns. Same ratio the owner's originally
 *  reported holes were sized against. */
const SLOPE_TO_GRADIENT = PHYSICS.slopeAccel / PHYSICS.slopeGradAccel;

/** Samples one green ellipse on a grid, folding its (min, max) into the
 *  accumulator passed in — shared by `greenElevationSpanFt` so a two-lobe
 *  green (`green` + `green2`) samples both lobes into the same span. */
function sampleGreenLobe(
  green: { cx: number; cy: number; rx: number; ry: number; rot?: number },
  gx: number,
  gy: number,
  hf: ReturnType<typeof buildHeightField>,
  acc: { min: number; max: number }
): void {
  const { cx, cy, rx, ry, rot = 0 } = green;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const N = 12;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const u = (i / N) * 2 - 1;
      const v = (j / N) * 2 - 1;
      if (u * u + v * v > 1) continue; // sample only inside the ellipse
      const lx = u * rx;
      const ly = v * ry;
      const x = cx + lx * cosR - ly * sinR;
      const y = cy + lx * sinR + ly * cosR;
      const bumpH = hf ? hf.heightAt(x, y) : 0;
      const slopeH = gx * x + gy * y;
      const total = bumpH + slopeH;
      if (total < acc.min) acc.min = total;
      if (total > acc.max) acc.max = total;
    }
  }
}

/** Samples `hole`'s green ellipse (both lobes, when `green2` is set — e.g.
 *  Wild Prairie's kidney-bean h2) on a grid and returns the worst-case
 *  elevation span (feet) a ball could face crossing it, combining the
 *  authored slope with any heightfield relief under the green.
 *
 *  `course` is required so bunker dishes/dune mounds are built at the SAME
 *  bunkerDepthScale/wasteDepthScale the live game actually plays (main.ts
 *  passes `theme.bunkerDepthScale`/`wasteDepthScale`, not the (1, 0)
 *  defaults) — Wild Prairie (2.3/2.8) and Red Hollow (1.35/1.4) both scale
 *  every bunker-derived bump under a green, so testing at the defaults
 *  understates their real worst-case rise. */
export function greenElevationSpanFt(hole: HoleData, course: CourseData): number {
  const theme = resolveTheme(course);
  const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
  const { angle, strength } = hole.slope;
  // Authored slope as an equivalent constant gradient (gx, gy) = ∇h, matching
  // breakAccel's sign convention: ax = cos(angle)*slopeAccel*strength must
  // equal -gx*slopeGradAccel (the heightfield branch's own sign).
  const gx = -Math.cos(angle) * strength * SLOPE_TO_GRADIENT;
  const gy = -Math.sin(angle) * strength * SLOPE_TO_GRADIENT;

  const acc = { min: Infinity, max: -Infinity };
  sampleGreenLobe(hole.green, gx, gy, hf, acc);
  if (hole.green2) sampleGreenLobe(hole.green2, gx, gy, hf, acc);
  return (acc.max - acc.min) * FT_PER_UNIT;
}

const ACTIVE_COURSES: Array<{ id: string; json: unknown }> = [
  { id: 'redhollow', json: redhollowJson },
  { id: 'wildvalley', json: wildvalleyJson },
  { id: 'maplevale', json: maplevaleJson },
  { id: 'wildwood', json: wildwoodJson },
  { id: 'timberline (v2)', json: timberlineV2Json },
  { id: 'timberlinewest (v2)', json: timberlinewestV2Json },
  { id: 'sablebay (v2)', json: sablebayV2Json },
  { id: 'portjohnson (v2)', json: portjohnsonV2Json }
];

describe('greenElevationSpanFt sampler', () => {
  it('matches a hand-computed span on a synthetic flat-slope green', () => {
    // A pure linear tilt with no heightfield relief: the worst-case span is
    // just the green's diameter (along the tilt's own direction) times the
    // equivalent gradient, converted to feet — computable by hand, so this
    // pins the sampler's math independent of any authored course data.
    const hole = {
      green: { cx: 0, cy: 0, rx: 60, ry: 60, rot: 0 },
      slope: { angle: 0, strength: 0.3 },
      elevation: [],
      hazards: [],
      world: { width: 400, height: 400 }
    } as unknown as HoleData;
    const course = { holes: [hole] } as unknown as CourseData;
    const expectedFt = SLOPE_TO_GRADIENT * 0.3 * 120 * FT_PER_UNIT; // diameter 120px
    expect(greenElevationSpanFt(hole, course)).toBeCloseTo(expectedFt, 1);
  });

  for (const { id, json } of ACTIVE_COURSES) {
    it(`${id}: every hole's green stays within ${CAP_INCHES}in`, () => {
      const course = loadCourse(json as unknown as CourseAuthoring);
      for (const hole of course.holes) {
        const spanFt = greenElevationSpanFt(hole, course);
        expect(spanFt, `${id} h${hole.number} (${hole.name ?? ''}): ${(spanFt * 12).toFixed(0)}in`).toBeLessThanOrEqual(
          CAP_FT + 1e-6
        );
      }
    });
  }
});
