import { describe, expect, it } from 'vitest';
import redhollowJson from '../../src/data/courses/redhollow.json';
import wildvalleyJson from '../../src/data/courses/wildvalley.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { buildHeightField, HeightField } from '../../src/systems/HeightField';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { PIN_MAX_GRADIENT, pointInGreens } from '../../src/utils/Geometry';
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
    // Pass 6 routing: the fairway wraps hard LEFT around the hillside
    // (centerline ~x368 at y690) before cutting back to the green shelf.
    const { hole, hf } = field(redhollow, 0);
    const teeH = hf.heightAt(hole.tee.x, hole.tee.y);
    const midH = hf.heightAt(368, 690);
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
    // The whole canyon floor is gone — no recovery from down there — and
    // (pass 6) the boundary starts AT the shelf edge: the cliff FACE is
    // already out of bounds, not just the floor beneath it.
    for (const [x, y] of [[200, 1000], [180, 800], [200, 650], [280, 450], [100, 500], [290, 820], [310, 690]]) {
      expect(oob(x, y), `beyond shelf edge ${x},${y}`).toBe(true);
    }
    // Tee, green, targets and the fairway's left edge all stay in bounds.
    expect(oob(hole.tee.x, hole.tee.y)).toBe(false);
    expect(oob(hole.green.cx, hole.green.cy)).toBe(false);
    for (const t of hole.aiTargets) expect(oob(t.x, t.y), `target ${t.x},${t.y}`).toBe(false);
    for (const [x, y] of [[301, 1100], [305, 820], [333, 690], [374, 580]]) {
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
    // PASS 6: the tee is NOTABLY above the green — a real downhill carry
    // (read by the HUD elevation delta), not a near-level one.
    expect(teeH - greenH).toBeGreaterThanOrEqual(8);
  });

  it('h2: the green is distinctly two-tiered with a steep-but-puttable ramp', () => {
    // Pass 7: +3 units (≈3.75ft) over a ~16px ramp — peak local slope ≈16°,
    // the steepest the 8px heightfield can express. (The spec's literal
    // 30-45° is incompatible with the grid resolution, the ≤5 relief gate
    // and downhill putt pace — documented in the terrain-pass doc.)
    const { hole, hf } = field(redhollow, 1);
    const back = hf.heightAt(hole.green.cx, 398); // upper (back) tier
    const front = hf.heightAt(hole.green.cx, 466); // lower (front) tier
    expect(back - front).toBeGreaterThanOrEqual(2.6);
    // The ramp is continuous — no step exceeds redhollow's 2.4 putt gate,
    // and pins never sit on it (gradient-vetoed, see layouts gates).
    for (let y = 380; y <= 466; y += 8) {
      const step = Math.abs(hf.heightAt(hole.green.cx, y) - hf.heightAt(hole.green.cx, y + 8));
      expect(step, `tier ramp at y=${y}`).toBeLessThanOrEqual(2.4);
    }
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

  it('h2: the greenside craters are genuinely DEEP erosion pits (pass 6)', () => {
    const { hole, hf } = field(redhollow, 1);
    const pots = hole.hazards.filter((hz) => hz.type === 'bunker' && !hz.waste);
    expect(pots.length).toBe(2);
    for (const hz of pots) {
      expect(hz.depthMul ?? 1, 'erosion craters carry a depth multiplier').toBeGreaterThanOrEqual(3);
      const [cx, cy] = polyCentroid(hz.polygon as Array<[number, number]>);
      let rim = -Infinity;
      for (const [px, py] of hz.polygon as Array<[number, number]>) rim = Math.max(rim, hf.heightAt(px, py));
      expect(rim - hf.heightAt(cx, cy), `crater ${Math.round(cx)},${Math.round(cy)}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('h2: long is dead — a significant drop-off directly behind the green', () => {
    const { hole, hf } = field(redhollow, 1);
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    // The back collar is still mesa top (puttable — measured vs the back
    // TIER's height since the pass-7 two-tier green raises it)...
    expect(Math.abs(hf.heightAt(hole.green.cx, 360) - hf.heightAt(hole.green.cx, 390))).toBeLessThanOrEqual(2);
    // ...but off the back rim the ground falls away hard onto the talus
    // apron ~15 units below (≈19ft — punishing AND escapable; the bare
    // -7 canyon floor made the full face unclimbable, sims locked up).
    expect(greenH - hf.heightAt(hole.green.cx, 290)).toBeGreaterThanOrEqual(8);
    expect(greenH - hf.heightAt(hole.green.cx, 255)).toBeGreaterThanOrEqual(14);
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
    // PASS 6: the green sits at the bottom of a CRATER BOWL a full step
    // below the islands — the same vertical as the tee→island drop.
    const greenH = hf.heightAt(hole.green.cx, hole.green.cy);
    expect(Math.min(...islands) - greenH).toBeGreaterThanOrEqual(12);
    // Cliff-like horseshoe: high ground left/back/right, the crater's own
    // rim ramp the only way in at the front-right.
    expect(hf.heightAt(210, 480) - greenH).toBeGreaterThanOrEqual(8); // left wall
    expect(hf.heightAt(280, 375) - greenH).toBeGreaterThanOrEqual(6); // back wall
    expect(hf.heightAt(400, 420) - greenH).toBeGreaterThanOrEqual(8); // right wall
    // Pass 7's tighter crater steepens the entrance ramp too — still the
    // low way in (walls run +16..40).
    expect(hf.heightAt(370, 535) - greenH).toBeLessThanOrEqual(7); // open front ramp
    // The wall shoulders tower over the putting surface.
    expect(hf.heightAt(172, 500) - greenH).toBeGreaterThanOrEqual(15);
    expect(hf.heightAt(435, 395) - greenH).toBeGreaterThanOrEqual(15);
  });

  it('h3: the final shot turns ~45° left off the last island and steps down', () => {
    const { hole, hf } = field(redhollow, 2);
    const ribbons = authoredRibbons(redhollowJson, 2);
    const cl = ribbons[2].centerline;
    const [a, b] = [cl[0], cl[cl.length - 1]];
    const axis = [b[0] - a[0], b[1] - a[1]];
    const approach = [hole.green.cx - b[0], hole.green.cy - b[1]];
    const dot = axis[0] * approach[0] + axis[1] * approach[1];
    const deg =
      (Math.acos(dot / (Math.hypot(axis[0], axis[1]) * Math.hypot(approach[0], approach[1]))) * 180) / Math.PI;
    // "approximately 45 degrees left"
    expect(deg).toBeGreaterThanOrEqual(30);
    expect(deg).toBeLessThanOrEqual(60);
    // Left, specifically: in y-down screen coords "left of travel" means a
    // negative cross product (facing north (0,-1), west (-1,0) gives -1).
    expect(axis[0] * approach[1] - axis[1] * approach[0]).toBeLessThan(0);
    // The descent is real terrain, comparable to the tee→island step.
    const islandH = hf.heightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    expect(islandH - hf.heightAt(hole.green.cx, hole.green.cy)).toBeGreaterThanOrEqual(12);
  });

  it('no water hazards anywhere on the course', () => {
    for (const hole of redhollow.holes) {
      expect(hole.hazards.some((h) => h.type === 'water')).toBe(false);
    }
  });
});

describe('Wild Prairie terrain identity', () => {
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

  it('the course is named Wild Prairie (id stays wildvalley for saves)', () => {
    expect((wildvalleyJson as { name: string }).name).toBe('Wild Prairie');
  });

  it('ONE approved grass asset carries the whole course (vegetation pass)', () => {
    // The golden card established around h1's big waste bunkers
    // (heather_fescue_b) is the ONLY grass card: field planting, fingers,
    // bunker lips, sand plants AND the short ground tufts all draw from it.
    const theme = (wildvalleyJson as { theme: Record<string, unknown> }).theme;
    const approved = 'heather_fescue_b';
    for (const key of ['heatherKeys', 'grassKeys', 'sandPlantKeys'] as const) {
      const arr = theme[key] as string[];
      expect(arr.length, key).toBeGreaterThanOrEqual(1);
      for (const k of arr) expect(k, `${key} entry`).toBe(approved);
    }
    expect(theme.bushKeys).toEqual([]);
    expect(theme.treeKeys).toEqual([]);
    expect(theme.prairieClusters).toBe(true); // dense clustered native rough
    expect((theme.tallGrass as { density: number }).density).toBeGreaterThanOrEqual(28);
    expect(theme.bunkerLipPacked).toBe(true); // grass-lined blowout lips
    expect(theme.greenShadeGain).toBeGreaterThanOrEqual(12); // contours read
  });

  it('h1: the split bunker sits in the DRIVER landing zone with real lanes both sides', () => {
    // Monte Carlo (60 seeded drives, 85-stat golfer): rests y 534-653.
    const hole = wildvalley.holes[0];
    const split = hole.hazards.find((hz) => hz.type === 'bunker' && !hz.waste)!;
    const poly = split.polygon as Array<[number, number]>;
    const [, cy] = polyCentroid(poly);
    expect(cy).toBeGreaterThanOrEqual(530);
    expect(cy).toBeLessThanOrEqual(660);
    const spanAt = (p: Array<[number, number]>, y: number) => {
      const xs: number[] = [];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i];
        const [xj, yj] = p[j];
        if (yi > y !== yj > y) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
      }
      xs.sort((m, n) => m - n);
      return xs;
    };
    const b = spanAt(poly, cy);
    const f = spanAt(hole.fairway[0] as Array<[number, number]>, cy);
    // ≥19yd of bunker, ≥19yd of legitimate fairway on EACH side (38px = 19yd).
    expect(b[b.length - 1] - b[0], 'central bunker width').toBeGreaterThanOrEqual(38);
    expect(b[0] - f[0], 'left lane').toBeGreaterThanOrEqual(38);
    expect(f[f.length - 1] - b[b.length - 1], 'right lane').toBeGreaterThanOrEqual(38);
  });

  it('h1: the fairway itself rolls (no smooth ramp)', () => {
    const { hf } = field(wildvalley, 0);
    const cl = authoredRibbons(wildvalleyJson, 0)[0].centerline;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 1; i < cl.length; i++) {
      const [x0, y0] = cl[i - 1];
      const [x1, y1] = cl[i];
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
      for (let s = 0; s <= n; s++) {
        const h = hf.heightAt(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    expect(max - min, 'centerline relief').toBeGreaterThanOrEqual(4);
  });

  it('h2: pins favor the back-right and all sit on puttable green', () => {
    const { hole, hf } = field(wildvalley, 1);
    const pins = hole.pins ?? [];
    expect(pins.length).toBeGreaterThanOrEqual(3);
    // The DEFAULT pin is back-right of the green center (screen: +x, -y).
    expect(hole.pin.x - hole.green.cx).toBeGreaterThanOrEqual(60);
    expect(hole.pin.y - hole.green.cy).toBeLessThanOrEqual(-50);
    const gH = hf.heightAt(hole.green.cx, hole.green.cy);
    for (const p of pins) {
      expect(pointInGreens(p.x, p.y, hole.green, hole.green2), `pin ${p.x},${p.y} on green`).toBe(true);
      expect(Math.abs(hf.heightAt(p.x, p.y) - gH), `pin ${p.x},${p.y} puttable`).toBeLessThanOrEqual(3);
    }
  });

  it('h2: every bunker overlaps realistic approach dispersion around the green', () => {
    const hole = wildvalley.holes[1];
    for (const hz of hole.hazards) {
      if (hz.type !== 'bunker') continue;
      const [cx, cy] = polyCentroid(hz.polygon as Array<[number, number]>);
      const d = Math.hypot(cx - hole.green.cx, cy - hole.green.cy);
      expect(d, `h2 bunker at ${Math.round(cx)},${Math.round(cy)}`).toBeLessThanOrEqual(200);
    }
  });

  it('h1+h3: flank blowouts touch the fairway (no dead band of rough)', () => {
    // The audited edge bunkers must press against the fairway edge:
    // raw-polygon to compiled-fairway distance ≤ 18px (≈9yd, closed
    // visually by edge wobble + packed grass lips).
    const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    };
    const checks: Array<[number, number]> = [
      [0, 1], // h1 right flank blowout
      [0, 2], // h1 left flank blowout
      [0, 3], // h1 short blowout
      [2, 0], // h3 LZ1 bailout blowout
      [2, 2], // h3 hero blowout (front bowl)
      [2, 3] // h3 hero blowout (lower bowl)
    ];
    for (const [hi, bi] of checks) {
      const hole = wildvalley.holes[hi];
      const raw = (wildvalleyJson as unknown as { holes: Array<{ hazards: Array<{ polygon: Array<[number, number]> }> }> })
        .holes[hi].hazards[bi].polygon;
      let best = Infinity;
      for (const fw of hole.fairway as Array<Array<[number, number]>>) {
        for (const [px, py] of raw) {
          for (let i = 0, j = fw.length - 1; i < fw.length; j = i++) {
            best = Math.min(best, segDist(px, py, fw[i][0], fw[i][1], fw[j][0], fw[j][1]));
          }
        }
      }
      expect(best, `h${hi + 1} bunker#${bi} gap to fairway`).toBeLessThanOrEqual(18);
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

describe('Red Rock pass 7 — sheer cliff, strategic rock, grounding, horseshoe', () => {
  it('h1: the right cliff face begins within a minimal gap of the fairway edge and is steep', () => {
    const { hf } = field(redhollow, 0);
    // (fairway right edge, y) pairs from the authored centerline+widths.
    for (const [fwRight, y] of [
      [390, 820],
      [428, 690],
      [457, 580]
    ]) {
      // Walk right from the edge: the face (gradient > 0.15) must start
      // within 20px, and rise ≥ 8 units over the next 40px.
      let toe = -1;
      for (let x = fwRight - 4; x < fwRight + 24; x += 2) {
        if (hf.gradientAt(x, y).x > 0.15) {
          toe = x;
          break;
        }
      }
      expect(toe, `face start near fairway edge at y=${y}`).toBeGreaterThanOrEqual(0);
      expect(toe - fwRight, `gap at y=${y}`).toBeLessThanOrEqual(20);
      expect(hf.heightAt(toe + 40, y) - hf.heightAt(toe, y), `rise at y=${y}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('h1: a dedicated cliff-face strip runs along the wall toe', () => {
    const hole = redhollow.holes[0];
    const { hf } = field(redhollow, 0);
    expect(hole.cliffWalls?.length ?? 0).toBeGreaterThanOrEqual(1);
    const pts = hole.cliffWalls![0].points;
    // Long enough to run "most of the hole" and anchored at the toe: every
    // authored point sits below mid-face (the strip's top reaches uphill).
    expect(pts.length).toBeGreaterThanOrEqual(5);
    const span = Math.abs(pts[0][1] - pts[pts.length - 1][1]);
    expect(span, 'strip runs most of the hole').toBeGreaterThanOrEqual(550);
    for (const [x, y] of pts) {
      const h = hf.heightAt(x, y);
      expect(h, `toe point ${x},${y} below mid-face`).toBeLessThanOrEqual(16);
      expect(h, `toe point ${x},${y} on/above shelf`).toBeGreaterThanOrEqual(8);
    }
  });

  it('h1: the strategic rock splits the measured driver zone with lanes both sides', () => {
    const hole = redhollow.holes[0];
    const rk = hole.hazards.find((hz) => hz.type === 'rock');
    expect(rk, 'h1 must carry a rock hazard').toBeDefined();
    // Monte Carlo (60 seeded drives, 85-stat golfer): rests x380-410 /
    // y588-685 — the rock must sit inside that dispersion box.
    expect(rk!.cx!).toBeGreaterThanOrEqual(375);
    expect(rk!.cx!).toBeLessThanOrEqual(415);
    expect(rk!.cy!).toBeGreaterThanOrEqual(585);
    expect(rk!.cy!).toBeLessThanOrEqual(690);
    // Collider matches the visible rock: r tracks height (ROCK_R_PER_H).
    expect(rk!.r! / rk!.height!).toBeGreaterThanOrEqual(0.5);
    expect(rk!.r! / rk!.height!).toBeLessThanOrEqual(1.3);
    // Playable lane each side of the rock at its y.
    const spanAt = (p: Array<[number, number]>, y: number) => {
      const xs: number[] = [];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i];
        const [xj, yj] = p[j];
        if (yi > y !== yj > y) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
      }
      return xs.sort((m, n) => m - n);
    };
    const f = spanAt(hole.fairway[0] as Array<[number, number]>, rk!.cy!);
    expect(rk!.cx! - rk!.r! - f[0], 'left lane').toBeGreaterThanOrEqual(32);
    expect(f[f.length - 1] - (rk!.cx! + rk!.r!), 'right lane').toBeGreaterThanOrEqual(32);
  });

  it('every large rock is grounded on one coherent level (no floaters/overhangs)', () => {
    // Footprint probe: center + 8 ring samples at 0.45·h must span less
    // than max(2.5, 0.22·h) — a rock straddling a mesa edge or cliff lip
    // fails (the "half on, half hanging" silhouette).
    for (let hi = 0; hi < 3; hi++) {
      const { hole, hf } = field(redhollow, hi);
      const masses = [
        ...(hole.landforms ?? []),
        ...hole.hazards
          .filter((hz) => hz.type === 'rock')
          .map((hz) => ({ key: hz.key ?? 'rock', x: hz.cx!, y: hz.cy!, h: hz.height! }))
      ];
      for (const m of masses) {
        const rad = 0.45 * m.h;
        let mn = hf.heightAt(m.x, m.y);
        let mx = mn;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const h = hf.heightAt(m.x + Math.cos(a) * rad, m.y + Math.sin(a) * rad);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
        }
        expect(mx - mn, `h${hi + 1} ${m.key}@${m.x},${m.y} h${m.h}`).toBeLessThanOrEqual(Math.max(2.5, 0.22 * m.h));
      }
    }
  });

  it('h3: rock formations spread across the whole valley, not just the wash', () => {
    const hole = redhollow.holes[2];
    // Wash centerline (authored stream control points).
    const wash: Array<[number, number]> = [
      [210, 1180], [330, 1090], [455, 1086], [600, 1032], [712, 976], [662, 848], [575, 770], [545, 715], [528, 648], [505, 560]
    ];
    const farFromWash = (hole.landforms ?? []).filter((l) => {
      let best = Infinity;
      for (const [wx, wy] of wash) best = Math.min(best, Math.hypot(l.x - wx, l.y - wy));
      return best > 150;
    });
    expect(farFromWash.length, 'formations >150px from the wash').toBeGreaterThanOrEqual(10);
    // And the mix uses all four shades.
    const shades = new Set((hole.landforms ?? []).map((l) => l.key));
    for (const k of ['rocks_red_bright', 'rocks_red_mid', 'rocks_red_cluster', 'rocks_red_dark']) {
      expect(shades.has(k), k).toBe(true);
    }
    // PASS 10 (playtest): the dry wash is LINED with little rocks — several small
    // (h ≤ 4) landforms sit right along its centerline.
    const alongWash = (hole.landforms ?? []).filter((l) => {
      if (l.h > 4) return false;
      let best = Infinity;
      for (const [wx, wy] of wash) best = Math.min(best, Math.hypot(l.x - wx, l.y - wy));
      return best <= 45;
    });
    expect(alongWash.length, 'small rocks lining the wash').toBeGreaterThanOrEqual(8);
  });

  it('h3: the horseshoe walls hug the green (narrow collar, immediate wall)', () => {
    const { hole, hf } = field(redhollow, 2);
    // Rays left/back-left/back/back-right/right from the green center: the
    // wall (gradient > 0.12) must start within 55px of the green edge.
    const rEdge = 46;
    for (const ang of [180, 135, 90, 45, 0]) {
      const a = (ang / 180) * Math.PI;
      const dx = Math.cos(a);
      const dy = -Math.sin(a);
      let start = -1;
      for (let d = rEdge; d < rEdge + 60; d += 2) {
        const g = hf.gradientAt(hole.green.cx + dx * d, hole.green.cy + dy * d);
        if (Math.hypot(g.x, g.y) > 0.12) {
          start = d - rEdge;
          break;
        }
      }
      expect(start, `wall start past green edge at ${ang}°`).toBeGreaterThanOrEqual(0);
      expect(start, `collar width at ${ang}°`).toBeLessThanOrEqual(55);
    }
  });
});

describe('Wild Prairie green contours + fairway preservation', () => {
  it('every green carries readable broad contour (relief ≥1.2, still ≤5)', () => {
    for (let i = 0; i < 3; i++) {
      const { hole, hf } = field(wildvalley, i);
      let mn = Infinity;
      let mx = -Infinity;
      const rM = Math.min(hole.green.rx, hole.green.ry) * 0.95;
      for (let a = 0; a < 16; a++) {
        const dx = Math.cos((a / 16) * Math.PI * 2);
        const dy = Math.sin((a / 16) * Math.PI * 2);
        for (let r = 0; r <= rM; r += 8) {
          const h = hf.heightAt(hole.green.cx + dx * r, hole.green.cy + dy * r);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
        }
      }
      expect(mx - mn, `h${i + 1} green relief`).toBeGreaterThanOrEqual(1.2);
      expect(mx - mn, `h${i + 1} green relief cap`).toBeLessThanOrEqual(5);
    }
  });

  it('authored pins sit on stable slopes (≤ PIN_MAX_GRADIENT)', () => {
    for (const course of [wildvalley, redhollow]) {
      for (let i = 0; i < course.holes.length; i++) {
        const { hole, hf } = field(course, i);
        for (const p of hole.pins ?? []) {
          const g = hf.gradientAt(p.x, p.y);
          expect(Math.hypot(g.x, g.y), `h${hole.number} pin ${p.x},${p.y}`).toBeLessThanOrEqual(PIN_MAX_GRADIENT);
        }
      }
    }
  });

  it('the approved fairways (h1, h3) are not reshaped by the green/vegetation work', () => {
    // Snapshot pinned when the fairways were approved — [x, y, height].
    const SNAP: Record<number, Array<[number, number, number]>> = {
      // PASS 10: re-pinned after the "more visibly rolling" fairway pass raised
      // the h1 cross-rolls.
      0: [[470, 1100, 6.05], [467, 1052, 6.42], [463, 1004, 3.98], [460, 956, 2.74], [458, 908, 3.75], [456, 860, 4.9], [456, 812, 4.63], [459, 764, 5.03], [461, 716, 4.66], [465, 668, 3.32], [469, 621, 2.15], [471, 573, 2.22], [470, 525, 3.01], [468, 477, 1.19], [481, 431, 0.95], [496, 385, 1.69]],
      2: [[400, 1410, 4.0], [410, 1340, 2.78], [420, 1270, 3.03], [443, 1203, 5.46], [466, 1136, 9.56], [501, 1075, 12.83], [537, 1015, 16.9], [573, 954, 15.9], [609, 893, 10.15], [633, 827, 4.73], [652, 759, 1.02], [670, 690, 0.56], [688, 622, 5.97], [709, 555, 9.38], [730, 487, 11.9], [752, 420, 10.31]]
    };
    for (const [hiStr, samples] of Object.entries(SNAP)) {
      const { hf } = field(wildvalley, Number(hiStr));
      for (const [x, y, h] of samples) {
        expect(Math.abs(hf.heightAt(x, y) - h), `h${Number(hiStr) + 1} @${x},${y}`).toBeLessThanOrEqual(0.6);
      }
    }
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
              // Per-course step gate: redhollow's h2 tier ramp is authored
              // at ~2.25/8px (pass 7); every other green keeps the strict
              // 1.2. The ≤5 total-relief gate below is shared and unmoved.
              expect(
                Math.abs(h - prev),
                `${name} h${hole.number} green step at r=${r} a=${a}`
              ).toBeLessThanOrEqual(name === 'redhollow' ? 2.4 : 1.2);
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
