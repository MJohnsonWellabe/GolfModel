import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import maplevale from '../../src/data/courses/maplevale.json';
import sablebay from '../../src/data/courses/v2/sablebay.json';
import { buildHeightField, HeightField, WATER_BED_DEPTH, WATER_SHORE_BLEND } from '../../src/systems/HeightField';
import { distToPolygon, pointInPolygon } from '../../src/utils/Geometry';
import type { HoleData } from '../../src/core/types';

/** The SAME compiled terrain minus the water cut — bunker dishes and their
 *  flanking mounds included, so the only difference is the thing under test.
 *  (buildHeightField both digs and raises: `addFlankingMounds` puts dunes
 *  around every trap, so the raw `elevation` array is not a valid baseline.) */
const withoutWater = (hole: HoleData): HeightField | null =>
  buildHeightField({ ...hole, hazards: hole.hazards.filter((h) => h.type !== 'water') });

/**
 * Water needs a bed.
 *
 * The heightfield is ADDITIVE and water is a flat plane at a fixed height, so
 * a pond or creek authored anywhere near rising ground is simply buried by it.
 * That is not a hypothetical — it is Maple Vale h3, where a creek at water
 * level 0.35 runs straight under a `+8` dome, and it was going to be every
 * generated daily hole that pairs water with elevation.
 *
 * The rule these tests hold: NO PART OF A WATER POLYGON'S BED MAY STAND AT OR
 * ABOVE THAT WATER'S OWN SURFACE — and terrain outside the water is left
 * alone, because the cut may only ever lower ground, never raise it.
 */

const sample = (hf: HeightField | null, poly: number[][], step = 6): number[] => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const out: number[] = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      if (!pointInPolygon(x, y, poly)) continue;
      out.push(hf ? hf.heightAt(x, y) : 0);
    }
  }
  return out;
};

describe('water sits in carved ground, not on top of it', () => {
  it('un-buries the Maple Vale h3 creek (the report this was built for)', () => {
    const course = loadCourse(maplevale as unknown as CourseAuthoring);
    const hole = course.holes[2];
    const water = hole.hazards.filter((h) => h.type === 'water');
    expect(water.length, 'Maple Vale h3 is the water fixture — it must have water').toBeGreaterThan(0);

    // What the terrain does WITHOUT the cut: the authored domes alone.
    const uncut = new HeightField(hole.elevation ?? [], hole.world.width, hole.world.height);
    const cut = buildHeightField(hole)!;

    for (const hz of water) {
      const surface = hz.level ?? 0.35;
      const before = sample(uncut, hz.polygon);
      const after = sample(cut, hz.polygon);
      expect(before.length).toBeGreaterThan(100);
      // Before: the creek really was buried — this is the defect, asserted so
      // nobody "fixes" the fixture by moving the dome and quietly deletes the
      // reason this code exists.
      expect(Math.max(...before), 'the fixture must still be a BURIED creek').toBeGreaterThan(surface + 1);
      // After: every sampled cell of the bed is under the water plane.
      expect(Math.max(...after), 'the creek bed is still above its own water level').toBeLessThan(surface);
    }
  });

  it('carves to roughly the authored depth, and never deeper', () => {
    const course = loadCourse(maplevale as unknown as CourseAuthoring);
    const hole = course.holes[2];
    const hf = buildHeightField(hole)!;
    for (const hz of hole.hazards.filter((h) => h.type === 'water')) {
      const surface = hz.level ?? 0.35;
      const bed = sample(hf, hz.polygon);
      expect(Math.min(...bed)).toBeGreaterThanOrEqual(surface - WATER_BED_DEPTH - 0.01);
    }
  });

  it('changes nothing beyond the shore ramp', () => {
    // The blast radius has to be bounded, because this runs on every shipped
    // hole. Outside a water outline plus its ramp, the compiled terrain must be
    // bit-identical to what it was before the cut existed — greens, fairway
    // snapshots and rock footprints all depend on that.
    //
    // (Inside the ramp it certainly does change, and on more than the reported
    // hole: Sable Bay h2's sea is tiled into seven polygons and five of them
    // had bed heights of +4 to +11.6 under a 0.35 water plane — the same defect
    // as Maple Vale h3, in a hole nobody had reported.)
    for (const raw of [sablebay, maplevale]) {
      const course = loadCourse(raw as unknown as CourseAuthoring);
      for (const hole of course.holes) {
        const water = hole.hazards.filter((h) => h.type === 'water');
        if (!water.length) continue;
        const uncut = withoutWater(hole)!;
        const cut = buildHeightField(hole)!;
        for (let y = 0; y < hole.world.height; y += 16) {
          for (let x = 0; x < hole.world.width; x += 16) {
            const near = water.some(
              (hz) => pointInPolygon(x, y, hz.polygon) || distToPolygon(x, y, hz.polygon) <= WATER_SHORE_BLEND + 12
            );
            if (near) continue;
            expect(cut.heightAt(x, y), `hole ${hole.number} at ${x},${y}`).toBeCloseTo(uncut.heightAt(x, y), 5);
          }
        }
      }
    }
  });

  it('never raises ground, anywhere', () => {
    // The cut is a `min` over the summed grid. If it can ever raise a cell,
    // it can push a green up, a rock off its shelf, or a fairway out of its
    // snapshot lock — so this is the property the terrain gates depend on.
    const course = loadCourse(maplevale as unknown as CourseAuthoring);
    for (const hole of course.holes) {
      const uncut = withoutWater(hole);
      const cut = buildHeightField(hole);
      if (!cut || !uncut) continue;
      for (let y = 0; y < hole.world.height; y += 24) {
        for (let x = 0; x < hole.world.width; x += 24) {
          // Bunker dishes are part of `buildHeightField` too and also only dig
          // down, so the whole compiled field must be ≤ the authored terrain.
          expect(cut.heightAt(x, y)).toBeLessThanOrEqual(uncut.heightAt(x, y) + 1e-6);
        }
      }
    }
  });

  it('a hole whose only terrain input is unburied water stays flat', () => {
    // `buildHeightField` returning null is what keeps the pre-elevation engine
    // behaviour (and the flat regression suite) meaningful.
    const flat: HoleData = {
      number: 1,
      par: 3,
      yardage: 150,
      world: { width: 800, height: 800 },
      tee: { x: 400, y: 700 },
      green: { cx: 400, cy: 200, rx: 60, ry: 60 },
      slope: { angle: 0, strength: 0 },
      pin: { x: 400, y: 200 },
      fairway: [],
      hazards: [
        {
          type: 'water',
          level: 0.35,
          polygon: [
            [300, 350],
            [500, 350],
            [500, 450],
            [300, 450]
          ]
        }
      ],
      aiTargets: []
    };
    expect(buildHeightField(flat)).toBeNull();
  });
});

/**
 * THE GREEN IS NOT CARVEABLE.
 *
 * Sable Bay h1's green lies inside the bounding outline of the bay, so the
 * first version of this carve pulled the putting surface itself down — the pin
 * dropped ~2 units below the green's centre, tilting it, and a routine hole
 * replayed as a 14. `tests/simulation/roundRecording.test.ts` is what caught
 * it; this is the gate that names the cause.
 */
describe('a water carve never lowers a putting surface', () => {
  const bay = loadCourse(sablebay as unknown as CourseAuthoring);

  it('leaves every green as flat as it was authored, on every hole', () => {
    for (const hole of bay.holes) {
      const withWater = buildHeightField(hole, 1, 0);
      // The same hole with its water removed — the terrain the carve must not
      // have departed from ON THE GREEN.
      const dry = buildHeightField({ ...hole, hazards: hole.hazards.filter((h) => h.type !== 'water') }, 1, 0);
      const g = hole.green;
      let worst = 0;
      for (let a = 0; a < 16; a++) {
        for (const f of [0, 0.5, 1]) {
          const x = g.cx + Math.cos((a / 16) * Math.PI * 2) * g.rx * f;
          const y = g.cy + Math.sin((a / 16) * Math.PI * 2) * g.ry * f;
          worst = Math.max(worst, Math.abs((withWater?.heightAt(x, y) ?? 0) - (dry?.heightAt(x, y) ?? 0)));
        }
      }
      expect(worst, `hole ${hole.number}: the water carve moved the green by ${worst.toFixed(2)}`).toBeLessThan(0.01);
    }
  });
})
