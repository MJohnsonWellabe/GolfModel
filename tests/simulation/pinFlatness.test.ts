import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { buildHeightField } from '../../src/systems/HeightField';
import { PHYSICS, PX_PER_YARD } from '../../src/config';
import wildwood from '../../src/data/courses/wildwood.json';
import v2Timber from '../../src/data/courses/v2/timberline.json';
import v2West from '../../src/data/courses/v2/timberlinewest.json';
import v2Sable from '../../src/data/courses/v2/sablebay.json';
import v2PJ from '../../src/data/courses/v2/portjohnson.json';
import redhollow from '../../src/data/courses/redhollow.json';
import wildvalley from '../../src/data/courses/wildvalley.json';

/**
 * PIN FLATNESS (owner playtest rule): "the 2-foot circle around the hole needs
 * to be relatively flat — find flatter spots to put the holes." A ball dying at
 * the cup needs ~3.6 ft of runway to stop from cup-capture speed, so the pin's
 * ~4-ft settling area must be flat enough that a well-paced putt SETTLES rather
 * than trickling on. On the green (friction 150) the ball never rests once the
 * local slope accel beats friction — `slopeGradAccel·|grad| > 150`, i.e.
 * `|grad| > 0.27` ("creep"). This gate holds every pin well under that, with a
 * comfortable settling margin (|grad| ≤ 0.11 over a 4-ft disc).
 */
const COURSES: Array<[string, unknown]> = [
  ['Wildwood', wildwood], ['Timberline East', v2Timber], ['Timberline West', v2West],
  ['Sable Bay', v2Sable], ['Port Johnson', v2PJ], ['Red Hollow', redhollow], ['Wild Prairie', wildvalley]
];
const CREEP = PHYSICS.friction.green / PHYSICS.slopeGradAccel; // ≈ 0.273
const LIMIT = 0.11;
const ftPx = (2 / 3) * PX_PER_YARD;
const R = 4 * ftPx;

function settleGrad(hf: NonNullable<ReturnType<typeof buildHeightField>>, cx: number, cy: number): number {
  let m = Math.hypot(hf.gradientAt(cx, cy).x, hf.gradientAt(cx, cy).y);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    for (const r of [R * 0.4, R * 0.7, R]) {
      const g = hf.gradientAt(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      m = Math.max(m, Math.hypot(g.x, g.y));
    }
  }
  return m;
}

describe('pin flatness — every pin sits on a relatively flat settling area', () => {
  it(`is comfortably below the creep bar (${CREEP.toFixed(2)}) on every pin, every course`, () => {
    const bad: string[] = [];
    for (const [name, json] of COURSES) {
      const course = loadCourse(json as CourseAuthoring);
      for (const h of course.holes) {
        const hf = buildHeightField(h);
        if (!hf) continue;
        const pins = h.pins && h.pins.length ? h.pins : [h.pin];
        pins.forEach((p, i) => {
          const g = settleGrad(hf, p.x, p.y);
          if (g > LIMIT) bad.push(`${name} H${h.number} pin${i} (${p.x.toFixed(0)},${p.y.toFixed(0)}) |grad|=${g.toFixed(3)}`);
        });
      }
    }
    expect(bad, `pins on too-steep spots:\n${bad.join('\n')}`).toEqual([]);
  });
});
