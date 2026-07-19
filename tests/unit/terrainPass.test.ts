import { describe, expect, it } from 'vitest';
import redhollowJson from '../../src/data/courses/redhollow.json';
import wildvalleyJson from '../../src/data/courses/wildvalley.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { buildHeightField, HeightField } from '../../src/systems/HeightField';
import { HoleData } from '../../src/core/types';

/**
 * Terrain identity pass gates (docs/technical/WILD_VALLEY_RED_HOLLOW_TERRAIN_PASS.md).
 * Units: 1 world unit ≈ 1 ball diameter. These assert the SHAPE promises of
 * the identity sheet — canyon separation, cliff drops, wash crossing, dune
 * amplitude, blowout depth, strategic bunker placement, and fairway
 * continuity — against the compiled HeightField the game actually plays on.
 */

const redhollow = loadCourse(redhollowJson as unknown as CourseAuthoring);
const wildvalley = loadCourse(wildvalleyJson as unknown as CourseAuthoring);

/** Authored fairway ribbons (centerline+width) — the COMPILED HoleData
 *  carries only outline polygons, so centerline walks read the raw JSON. */
type Ribbon = { centerline: Array<[number, number]>; width: number[] };
const authoredRibbons = (json: unknown, holeIdx: number): Ribbon[] =>
  (json as { holes: Array<{ fairway: Ribbon[] }> }).holes[holeIdx].fairway;

function field(course: typeof redhollow, holeIdx: number): { hole: HoleData; hf: HeightField } {
  const theme = resolveTheme(course);
  const hole = course.holes[holeIdx];
  const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
  expect(hf, `hole ${holeIdx + 1} must have terrain`).not.toBeNull();
  return { hole, hf: hf as HeightField };
}

function polyCentroid(poly: Array<[number, number]>): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of poly) {
    sx += x;
    sy += y;
  }
  return [sx / poly.length, sy / poly.length];
}

describe('Red Hollow terrain identity', () => {
  it('h1 Rimrock: elevated tee, shelf fairway, cliff drop to canyon floor', () => {
    const { hole, hf } = field(redhollow, 0);
    const teeH = hf.heightAt(hole.tee.x, hole.tee.y);
    const fairwayH = hf.heightAt(400, 700); // mid-shelf
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    const floorH = hf.heightAt(58, 640); // canyon floor strip
    expect(teeH - fairwayH).toBeGreaterThanOrEqual(4); // elevated tee bench
    expect(greenH - fairwayH).toBeGreaterThanOrEqual(3); // distinct green bench
    expect(fairwayH - floorH).toBeGreaterThanOrEqual(14); // shelf-to-floor cliff
  });

  it('h2 Devils Kitchen: real canyon separation under the carry', () => {
    const { hole, hf } = field(redhollow, 1);
    const teeH = hf.heightAt(hole.tee.x, hole.tee.y);
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    const canyonH = hf.heightAt(450, 655); // kitchen floor between the mesas
    expect(greenH - canyonH).toBeGreaterThanOrEqual(22); // mesa over canyon
    expect(teeH - canyonH).toBeGreaterThanOrEqual(24); // highest tee
    expect(teeH).toBeGreaterThan(greenH); // tee is the top of the course
  });

  it('h2: the green mesa face is genuinely steep (cliff, not a ramp)', () => {
    const { hole, hf } = field(redhollow, 1);
    // Walk from the green center toward the canyon: height must lose 8+
    // units within a 40px horizontal run somewhere on the face.
    let steepest = 0;
    for (let d = 60; d <= 220; d += 8) {
      const drop = hf.heightAt(hole.green.cx, hole.green.cy + d) - hf.heightAt(hole.green.cx, hole.green.cy + d + 40);
      steepest = Math.max(steepest, drop);
    }
    expect(steepest).toBeGreaterThanOrEqual(8);
  });

  it('h3 Wolf Run: the wash actually crosses between the two fairway ribbons', () => {
    const hole = redhollow.holes[2];
    const ribbons = authoredRibbons(redhollowJson, 2);
    expect(ribbons.length).toBeGreaterThanOrEqual(2); // split ribbons
    // The gap between ribbon 1's end and ribbon 2's start must be waste
    // (the wash), verified against the authored wash polygon.
    const wash = hole.hazards.find((h) => h.type === 'bunker' && h.waste && h.polygon.length > 20);
    expect(wash).toBeDefined();
    const end = ribbons[0].centerline[ribbons[0].centerline.length - 1];
    const start = ribbons[1].centerline[0];
    const mid = [(end[0] + start[0]) / 2, (end[1] + start[1]) / 2];
    // Point-in-polygon over the wash outline.
    const poly = (wash as unknown as { polygon: Array<[number, number]> }).polygon;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > mid[1] !== yj > mid[1] && mid[0] < ((xj - xi) * (mid[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    expect(inside).toBe(true);
  });

  it('h3: shelves step down and the wash bed is sunken below its banks', () => {
    const { hf } = field(redhollow, 2);
    const shelf1 = hf.heightAt(750, 1250);
    const shelf2 = hf.heightAt(470, 780);
    const greenBench = hf.heightAt(330, 340);
    expect(shelf1 - shelf2).toBeGreaterThanOrEqual(3); // stepped shelves
    expect(greenBench).toBeGreaterThanOrEqual(5); // elevated final shelf
    const bed = hf.heightAt(560, 1010); // in the crossing wash
    const bank = hf.heightAt(560, 1120);
    expect(bank - bed).toBeGreaterThanOrEqual(2); // carved, not painted
  });

  it('no water hazards anywhere on the course', () => {
    for (const hole of redhollow.holes) {
      expect(hole.hazards.some((h) => h.type === 'water')).toBe(false);
    }
  });
});

describe('Wild Valley terrain identity', () => {
  it('every hole rolls: ridge-to-valley amplitude in the sandhills band', () => {
    for (let i = 0; i < 3; i++) {
      const { hole, hf } = field(wildvalley, i);
      let min = Infinity;
      let max = -Infinity;
      for (let y = 120; y < hole.world.height - 120; y += 24) {
        for (let x = 120; x < hole.world.width - 120; x += 24) {
          const h = hf.heightAt(x, y);
          min = Math.min(min, h);
          max = Math.max(max, h);
        }
      }
      expect(max - min, `h${i + 1} ridge-to-valley`).toBeGreaterThanOrEqual(6);
      // 20 (was 16): identity pass 3 scales the hero dunes to true
      // landforms (h11-13, the amphitheater's enclosing walls) with deep
      // blowout bowls cut into their faces.
      expect(max - min, `h${i + 1} stays sandhills, not mountains`).toBeLessThanOrEqual(20);
    }
  });

  it('blowouts are genuinely deep below their rims', () => {
    const theme = resolveTheme(wildvalley);
    for (let i = 0; i < 3; i++) {
      const hole = wildvalley.holes[i];
      const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0) as HeightField;
      for (const hz of hole.hazards) {
        if (hz.type !== 'bunker' || !hz.waste) continue;
        const [cx, cy] = polyCentroid(hz.polygon as Array<[number, number]>);
        const center = hf.heightAt(cx, cy);
        // Rim = highest sample on the polygon outline.
        let rim = -Infinity;
        for (const [px, py] of hz.polygon as Array<[number, number]>) rim = Math.max(rim, hf.heightAt(px, py));
        expect(rim - center, `h${i + 1} blowout at ${Math.round(cx)},${Math.round(cy)}`).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it('every bunker answers a shot (within strategy radius of a landing zone or green)', () => {
    for (const hole of wildvalley.holes) {
      const anchors = [...hole.aiTargets, { x: hole.green.cx, y: hole.green.cy }, { x: hole.tee.x, y: hole.tee.y }];
      for (const hz of hole.hazards) {
        if (hz.type !== 'bunker') continue;
        const [cx, cy] = polyCentroid(hz.polygon as Array<[number, number]>);
        const nearest = Math.min(...anchors.map((a) => Math.hypot(a.x - cx, a.y - cy)));
        expect(nearest, `h${hole.number} bunker at ${Math.round(cx)},${Math.round(cy)}`).toBeLessThanOrEqual(230);
      }
    }
  });

  it('the Kettle encloses its green (rising ground on 3+ of 4 sides)', () => {
    const { hole, hf } = field(wildvalley, 1);
    const g = hf.heightAt(hole.green.cx, hole.green.cy);
    let rising = 0;
    for (const [dx, dy] of [
      [-170, 0],
      [170, 0],
      [0, -170],
      [0, 170]
    ]) {
      if (hf.heightAt(hole.green.cx + dx, hole.green.cy + dy) > g + 1.2) rising++;
    }
    expect(rising).toBeGreaterThanOrEqual(3);
  });
});

describe('fairway terrain continuity (both courses)', () => {
  // No hidden walls under the ball: adjacent 8px samples along every
  // fairway centerline may not step more than 3 units.
  const courses = [
    ['redhollow', redhollow, redhollowJson],
    ['wildvalley', wildvalley, wildvalleyJson]
  ] as const;
  for (const [name, course, json] of courses) {
    it(`${name}: no terrain steps along fairway centerlines`, () => {
      const theme = resolveTheme(course);
      for (let hi = 0; hi < course.holes.length; hi++) {
        const hole = course.holes[hi];
        const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
        if (!hf) continue;
        for (const ribbon of authoredRibbons(json, hi)) {
          const cl = ribbon.centerline;
          for (let i = 1; i < cl.length; i++) {
            const [x0, y0] = cl[i - 1];
            const [x1, y1] = cl[i];
            const len = Math.hypot(x1 - x0, y1 - y0);
            const steps = Math.max(1, Math.round(len / 8));
            let prev = hf.heightAt(x0, y0);
            for (let sIdx = 1; sIdx <= steps; sIdx++) {
              const t = sIdx / steps;
              const h = hf.heightAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
              expect(
                Math.abs(h - prev),
                `${name} h${hole.number} step at ${Math.round(x0 + (x1 - x0) * t)},${Math.round(y0 + (y1 - y0) * t)}`
              ).toBeLessThanOrEqual(3);
              prev = h;
            }
          }
        }
      }
    });
  }
});
