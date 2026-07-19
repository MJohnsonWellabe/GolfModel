import { describe, expect, it } from 'vitest';
import redhollowJson from '../../src/data/courses/redhollow.json';
import wildvalleyJson from '../../src/data/courses/wildvalley.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { buildHeightField, HeightField } from '../../src/systems/HeightField';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
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
  it('h1 Rimrock: ONE continuous sidehill shelf — drop left, kickback terrace right', () => {
    // Pass 5 routing: the fairway wraps LEFT around the hillside
    // (centerline ~x382 at y690) before cutting back to the green shelf.
    const { hole, hf } = field(redhollow, 0);
    const teeH = hf.heightAt(hole.tee.x, hole.tee.y);
    const midH = hf.heightAt(382, 690);
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    // Continuous shelf: tee, mid-fairway and green share one level (±3).
    expect(Math.abs(teeH - midH)).toBeLessThanOrEqual(3);
    expect(Math.abs(greenH - midH)).toBeLessThanOrEqual(3);
    // LEFT: the shelf ends — a true cliff, the canyon floor far below.
    expect(midH - hf.heightAt(280, 690)).toBeGreaterThanOrEqual(25);
    expect(midH - hf.heightAt(180, 690)).toBeGreaterThanOrEqual(35);
    // RIGHT: the wall begins directly beside the fairway — an upper
    // terrace one level up within ~90 of the line.
    expect(hf.heightAt(470, 780) - hf.heightAt(370, 780)).toBeGreaterThanOrEqual(5);
    // The right slope KICKS BACK: gradient on the lower slope points uphill
    // to the right, i.e. a ball there rolls left toward the fairway.
    const g = hf.gradientAt(470, 780);
    expect(g.x).toBeGreaterThan(0.02);
  });

  it('h1: the canyon floor is TRUE out of bounds; the playing corridor is not', () => {
    const { hole, hf } = field(redhollow, 0);
    const ob = hole.hazards.find((hz) => hz.type === 'ob');
    expect(ob, 'h1 must carry an ob hazard').toBeDefined();
    const engine = new PhysicsEngine(hole, hf, () => 0.5);
    const oob = (x: number, y: number) =>
      (engine as unknown as { inOutOfBounds(x: number, y: number): boolean }).inOutOfBounds(x, y);
    // The whole canyon floor is gone — no recovery from down there.
    for (const [x, y] of [[200, 1000], [180, 800], [200, 650], [280, 450], [100, 500]]) {
      expect(oob(x, y), `floor ${x},${y}`).toBe(true);
    }
    // Tee, green, targets and the fairway's left edge all stay in bounds.
    expect(oob(hole.tee.x, hole.tee.y)).toBe(false);
    expect(oob(hole.green.cx, hole.green.cy)).toBe(false);
    for (const t of hole.aiTargets) expect(oob(t.x, t.y), `target ${t.x},${t.y}`).toBe(false);
    for (const [x, y] of [[301, 1100], [305, 820], [337, 690], [382, 580]]) {
      expect(oob(x, y), `fairway edge ${x},${y}`).toBe(false);
    }
  });

  it('h1: an OB finish costs a penalty and drops near where the ball crossed', () => {
    const { hole, hf } = field(redhollow, 0);
    const engine = new PhysicsEngine(hole, hf, () => 0.5);
    const drop = (path: Array<[number, number]>, origin: { x: number; y: number }) =>
      (engine as unknown as {
        obDropPoint(p: Array<{ x: number; y: number; z: number }>, o: { x: number; y: number }): { x: number; y: number };
      }).obDropPoint(path.map(([x, y]) => ({ x, y, z: 0 })), origin);
    // A pull that sails off the shelf at y~820 and finishes on the floor:
    // the drop comes back to the last in-bounds stretch of the flight line.
    const origin = { x: 330, y: 1100 };
    const p = drop(
      [[330, 1100], [330, 1000], [325, 920], [315, 860], [300, 820], [260, 780], [200, 760], [180, 750]],
      origin
    );
    const oob = (x: number, y: number) =>
      (engine as unknown as { inOutOfBounds(x: number, y: number): boolean }).inOutOfBounds(x, y);
    expect(oob(p.x, p.y)).toBe(false);
    // Near the crossing, not back at the tee.
    expect(Math.hypot(p.x - 315, p.y - 860)).toBeLessThanOrEqual(80);
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

  it('h2: no fairway at all — a pure tee-to-mesa carry', () => {
    expect(authoredRibbons(redhollowJson, 1).length).toBe(0);
  });

  it('h2: the greenside pots are DEEP erosion bowls (pass 5 depthMul)', () => {
    const { hole, hf } = field(redhollow, 1);
    const pots = hole.hazards.filter((hz) => hz.type === 'bunker' && !hz.waste);
    expect(pots.length).toBe(2);
    for (const hz of pots) {
      expect(hz.depthMul ?? 1, 'erosion bowls carry a depth multiplier').toBeGreaterThanOrEqual(2);
      const [cx, cy] = polyCentroid(hz.polygon as Array<[number, number]>);
      let rim = -Infinity;
      for (const [px, py] of hz.polygon as Array<[number, number]>) rim = Math.max(rim, hf.heightAt(px, py));
      expect(rim - hf.heightAt(cx, cy), `pot ${Math.round(cx)},${Math.round(cy)}`).toBeGreaterThanOrEqual(3.5);
    }
  });

  it('h2: long is dead — a significant drop-off directly behind the green', () => {
    const { hole, hf } = field(redhollow, 1);
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    // The back collar is still mesa top (puttable)...
    expect(Math.abs(hf.heightAt(hole.green.cx, 360) - greenH)).toBeLessThanOrEqual(2);
    // ...but within ~70 beyond the back edge the ground has fallen away.
    expect(greenH - hf.heightAt(hole.green.cx, 310)).toBeGreaterThanOrEqual(5);
    expect(greenH - hf.heightAt(hole.green.cx, 285)).toBeGreaterThanOrEqual(20);
  });

  it('h3 Wolf Run: three equal island platforms descending from an elevated tee', () => {
    const { hole, hf } = field(redhollow, 2);
    const ribbons = authoredRibbons(redhollowJson, 2);
    expect(ribbons.length).toBe(3); // island fairways
    const teeH = hf.heightAt(hole.tee.x, hole.tee.y);
    const islands = ribbons.map((r) => {
      const [a, b] = [r.centerline[0], r.centerline[r.centerline.length - 1]];
      return hf.heightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    });
    // Tee is a full level above the islands.
    for (const ih of islands) expect(teeH - ih).toBeGreaterThanOrEqual(10);
    // Islands share one height (±1.5).
    expect(Math.max(...islands) - Math.min(...islands)).toBeLessThanOrEqual(1.5);
    // The carry gaps between islands are canyon, below island level.
    expect(islands[0] - hf.heightAt(590, 1040)).toBeGreaterThanOrEqual(3);
    expect(islands[1] - hf.heightAt(430, 790)).toBeGreaterThanOrEqual(3);
    // Green sits BELOW the islands (inside terrain, not on a pedestal)...
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    expect(greenH).toBeLessThan(Math.min(...islands));
    // ...in a bowl: rising ground behind/left/right, OPEN at the front.
    // PASS 5: the horseshoe is RAISED — misses left/long/right hit real
    // walls and funnel back to collection areas; the front door stays open.
    expect(hf.heightAt(200, 380) - greenH).toBeGreaterThanOrEqual(8); // left wall
    expect(hf.heightAt(300, 210) - greenH).toBeGreaterThanOrEqual(6); // back wall
    expect(hf.heightAt(440, 300) - greenH).toBeGreaterThanOrEqual(8); // right wall
    expect(hf.heightAt(400, 470) - greenH).toBeLessThanOrEqual(2); // open front
    // The wall shoulders tower over the putting surface.
    expect(hf.heightAt(185, 385) - greenH).toBeGreaterThanOrEqual(15);
    expect(hf.heightAt(450, 290) - greenH).toBeGreaterThanOrEqual(12);
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

describe('green design rule (both courses)', () => {
  // "No green may terminate in an unputtable cliff": every point of every
  // putting surface must be reachable by putting — adjacent 8px samples
  // inside the green ellipse may not step more than 1.2 units, and total
  // relief across the surface stays gentle.
  const courses = [
    ['redhollow', redhollow],
    ['wildvalley', wildvalley]
  ] as const;
  for (const [name, course] of courses) {
    it(`${name}: every putting surface is smoothly puttable`, () => {
      const theme = resolveTheme(course);
      for (const hole of course.holes) {
        const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
        if (!hf) continue;
        for (const g of [hole.green, hole.green2].filter(Boolean) as Array<NonNullable<typeof hole.green2>>) {
          let min = Infinity;
          let max = -Infinity;
          for (let a = 0; a < 16; a++) {
            // Walk a radial spoke from center to rim, checking step sizes.
            const dx = Math.cos((a / 16) * Math.PI * 2);
            const dy = Math.sin((a / 16) * Math.PI * 2);
            const rMax = Math.min(g.rx, g.ry) * 0.95;
            let prev = hf.heightAt(g.cx, g.cy);
            for (let r = 8; r <= rMax; r += 8) {
              const h = hf.heightAt(g.cx + dx * r, g.cy + dy * r);
              expect(
                Math.abs(h - prev),
                `${name} h${hole.number} green step at r=${r} a=${a}`
              ).toBeLessThanOrEqual(1.2);
              min = Math.min(min, h);
              max = Math.max(max, h);
              prev = h;
            }
          }
          expect(max - min, `${name} h${hole.number} total green relief`).toBeLessThanOrEqual(5);
        }
      }
    });
  }
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
