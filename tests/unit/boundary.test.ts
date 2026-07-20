import { describe, expect, it } from 'vitest';
import sablebayJson from '../../src/data/courses/sablebay.json';
import wildwoodJson from '../../src/data/courses/wildwood.json';
import timberlineJson from '../../src/data/courses/timberline.json';
import portjohnsonJson from '../../src/data/courses/portjohnson.json';
import redhollowJson from '../../src/data/courses/redhollow.json';
import wildvalleyJson from '../../src/data/courses/wildvalley.json';
import { CourseAuthoring, loadCourse } from '../../src/data/courseLoader';
import { resolveTheme } from '../../src/core/rendering/Theme';
import { buildHeightField } from '../../src/systems/HeightField';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import {
  computeBoundary,
  DEFAULT_MARGIN,
  pointInBoundary,
  withPlayableBoundary
} from '../../src/systems/PlayableBoundary';
import { HoleData } from '../../src/core/types';

/**
 * BOUNDED PLAYABLE WORLD gates (docs/technical/BOUNDED_PLAYABLE_WORLD.md).
 * Every hole in the dev roster (all six courses) must yield a valid playable
 * boundary that (a) contains every play surface, (b) leaves ~20 yd of margin
 * and real off-course void, (c) penalizes and re-drops a ball that crosses it,
 * and (d) vanishes entirely when the rule is off (production byte-identical).
 */

const COURSES: Record<string, ReturnType<typeof loadCourse>> = {
  'Sable Bay': loadCourse(sablebayJson as unknown as CourseAuthoring),
  Wildwood: loadCourse(wildwoodJson as unknown as CourseAuthoring),
  Timberline: loadCourse(timberlineJson as unknown as CourseAuthoring),
  'Port Johnson': loadCourse(portjohnsonJson as unknown as CourseAuthoring),
  'Red Hollow': loadCourse(redhollowJson as unknown as CourseAuthoring),
  'Wild Prairie': loadCourse(wildvalleyJson as unknown as CourseAuthoring)
};

/** Fraction of the world rectangle that falls inside the boundary (in play). */
function inPlayFraction(hole: HoleData, boundary: HoleData['boundary']): number {
  const step = 20;
  let inside = 0;
  let total = 0;
  for (let y = 0; y < hole.world.height; y += step) {
    for (let x = 0; x < hole.world.width; x += step) {
      total++;
      if (boundary && pointInBoundary(x, y, boundary)) inside++;
    }
  }
  return inside / total;
}

describe('bounded playable world — boundary geometry', () => {
  for (const [courseName, course] of Object.entries(COURSES)) {
    describe(courseName, () => {
      course.holes.forEach((hole, i) => {
        const boundary = computeBoundary(hole);

        it(`h${i + 1}: yields a non-empty playable boundary`, () => {
          expect(boundary.length).toBeGreaterThan(0);
          for (const poly of boundary) expect(poly.length).toBeGreaterThanOrEqual(3);
        });

        it(`h${i + 1}: contains every play surface (tee, green, pin, landing zones, fairway)`, () => {
          expect(pointInBoundary(hole.tee.x, hole.tee.y, boundary), 'tee').toBe(true);
          expect(pointInBoundary(hole.green.cx, hole.green.cy, boundary), 'green').toBe(true);
          expect(pointInBoundary(hole.pin.x, hole.pin.y, boundary), 'pin').toBe(true);
          if (hole.green2)
            expect(pointInBoundary(hole.green2.cx, hole.green2.cy, boundary), 'green2').toBe(true);
          for (const t of hole.aiTargets)
            expect(pointInBoundary(t.x, t.y, boundary), `aiTarget ${t.x},${t.y}`).toBe(true);
          // Every authored fairway centerline point is inside the corridor.
          for (const cl of hole.fairwayCenterlines ?? [])
            for (const [x, y] of cl)
              expect(pointInBoundary(x, y, boundary), `fairway ${x},${y}`).toBe(true);
        });

        it(`h${i + 1}: leaves a real ~20 yd margin and off-course void`, () => {
          // Greenside recovery is in play in EVERY direction: a full ring at the
          // green's minor radius + the 20-yd margin stays inside the boundary
          // (the green blob is grown by FRINGE + margin, so this is guaranteed
          // unless a bug shrinks it). Proves the corridor isn't hugging the play.
          const ringR = Math.min(hole.green.rx, hole.green.ry) + DEFAULT_MARGIN;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const x = hole.green.cx + Math.cos(a) * ringR;
            const y = hole.green.cy + Math.sin(a) * ringR;
            expect(pointInBoundary(x, y, boundary), `greenside ring @${a.toFixed(2)}`).toBe(true);
          }
          // The world is genuinely bounded — a meaningful fraction is void, and
          // the four corners are off-course.
          expect(inPlayFraction(hole, boundary), 'in-play fraction').toBeLessThan(0.95);
          const W = hole.world.width;
          const H = hole.world.height;
          const corners = [
            [2, 2],
            [W - 2, 2],
            [2, H - 2],
            [W - 2, H - 2]
          ];
          const voidCorners = corners.filter(([x, y]) => !pointInBoundary(x, y, boundary)).length;
          expect(voidCorners, 'void corners').toBeGreaterThanOrEqual(3);
        });
      });
    });
  }
});

describe('bounded playable world — off-course penalty & relief', () => {
  for (const [courseName, course] of Object.entries(COURSES)) {
    course.holes.forEach((hole, i) => {
      it(`${courseName} h${i + 1}: a ball into the void is penalized and dropped back in play`, () => {
        const bounded = withPlayableBoundary(hole, true);
        const theme = resolveTheme(course);
        const hf = buildHeightField(bounded, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
        const engine = new PhysicsEngine(bounded, hf, () => 0.5);
        const priv = engine as unknown as {
          inOutOfBounds(x: number, y: number): boolean;
          obDropPoint(
            p: Array<{ x: number; y: number; z: number }>,
            o: { x: number; y: number }
          ): { x: number; y: number };
        };
        // A world corner is off-course; the tee is in play.
        const corner = { x: 4, y: 4 };
        expect(priv.inOutOfBounds(corner.x, corner.y), 'corner is OOB').toBe(true);
        expect(priv.inOutOfBounds(hole.tee.x, hole.tee.y), 'tee is in play').toBe(false);
        // A flight line from the tee out to the corner drops back INSIDE the
        // boundary near where it crossed — not at the corner, not back at the tee.
        const path = [];
        for (let t = 0; t <= 1.0001; t += 0.1)
          path.push({
            x: hole.tee.x + (corner.x - hole.tee.x) * t,
            y: hole.tee.y + (corner.y - hole.tee.y) * t,
            z: 0
          });
        const drop = priv.obDropPoint(path, hole.tee);
        expect(pointInBoundary(drop.x, drop.y, bounded.boundary!), 'drop is in play').toBe(true);
      });
    });
  }
});

describe('bounded playable world — rendered-area & scatter reduction', () => {
  // Before/after proxy: ground-scatter (grass/bush/flower/rock/litter) is placed
  // on every rough/fairway cell of the world grid; the boundary gate culls the
  // cells that fall in the off-course void. This measures the instance reduction
  // the rule asks for and gates that it is real (docs/technical/BOUNDED_PLAYABLE_WORLD.md).
  it('culls a substantial share of ground scatter into the void on every hole', () => {
    const rows: string[] = [];
    let sumBefore = 0;
    let sumAfter = 0;
    for (const [courseName, course] of Object.entries(COURSES)) {
      const theme = resolveTheme(course);
      const tuftStep = 34 / Math.sqrt((theme.tuftDensity as number) ?? 1);
      course.holes.forEach((hole, i) => {
        const engine = new PhysicsEngine(hole, null);
        const surfaceAt = (x: number, y: number) =>
          (engine as unknown as { surfaceAt(x: number, y: number): string }).surfaceAt(x, y);
        const boundary = computeBoundary(hole);
        let before = 0; // rough/fairway scatter cells across the whole world
        let after = 0; // those that survive the boundary gate
        let worldCells = 0;
        let playCells = 0;
        for (let y = 0; y < hole.world.height; y += tuftStep) {
          for (let x = 0; x < hole.world.width; x += tuftStep) {
            worldCells++;
            const inB = pointInBoundary(x, y, boundary);
            if (inB) playCells++;
            const surf = surfaceAt(x, y);
            if (surf === 'rough' || surf === 'fairway') {
              before++;
              if (inB) after++;
            }
          }
        }
        sumBefore += before;
        sumAfter += after;
        const scatterCut = before ? Math.round((1 - after / before) * 100) : 0;
        const areaCut = Math.round((1 - playCells / worldCells) * 100);
        rows.push(
          `${courseName} h${i + 1}: scatter ${before}→${after} (-${scatterCut}%), rendered area -${areaCut}%`
        );
        // Every hole must actually shrink the detailed world (rule: bounded).
        expect(after, `${courseName} h${i + 1} scatter kept`).toBeLessThan(before);
      });
    }
    const totalCut = Math.round((1 - sumAfter / sumBefore) * 100);
    // eslint-disable-next-line no-console
    console.log(
      `\nBOUNDED WORLD — scatter reduction (before→after):\n${rows.join('\n')}\n` +
        `TOTAL ground-scatter instances ${sumBefore}→${sumAfter} (-${totalCut}%)\n`
    );
    expect(totalCut).toBeGreaterThan(10);
  });
});

describe('bounded playable world — production safety (rule off)', () => {
  it('withPlayableBoundary leaves the hole untouched when the rule is off', () => {
    for (const course of Object.values(COURSES)) {
      for (const hole of course.holes) {
        expect(withPlayableBoundary(hole, false).boundary).toBeUndefined();
      }
    }
  });

  it('a hole with no boundary never flags a boundary crossing as OOB', () => {
    // Sable Bay carries no 'ob' hazards, so with the rule off nothing off the
    // fairway is out of bounds — the classic full-world behavior.
    const course = COURSES['Sable Bay'];
    const hole = course.holes[0];
    expect(hole.boundary).toBeUndefined();
    const theme = resolveTheme(course);
    const hf = buildHeightField(hole, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
    const engine = new PhysicsEngine(hole, hf, () => 0.5);
    const oob = (engine as unknown as { inOutOfBounds(x: number, y: number): boolean }).inOutOfBounds(
      2,
      2
    );
    expect(oob).toBe(false);
  });
});

describe('bounded playable world — authored recovery zones', () => {
  // A designed recovery area none of the derived inputs cover must join the
  // boundary union (grown by the margin) so it keeps detail and stays in play.
  const course = COURSES['Sable Bay'];
  const base = course.holes[0];

  /** A far-corner point that the derived boundary leaves as void. */
  function voidCorner(hole: HoleData): [number, number] {
    const boundary = computeBoundary(hole);
    const candidates: Array<[number, number]> = [
      [30, 30],
      [hole.world.width - 30, 30],
      [30, hole.world.height - 30],
      [hole.world.width - 30, hole.world.height - 30]
    ];
    const found = candidates.find(([x, y]) => !pointInBoundary(x, y, boundary));
    expect(found).toBeDefined();
    return found!;
  }

  it('unions an authored recoveryZones polygon into the derived boundary', () => {
    const [cx, cy] = voidCorner(base);
    const zone: Array<[number, number]> = [
      [cx - 30, cy - 30],
      [cx + 30, cy - 30],
      [cx + 30, cy + 30],
      [cx - 30, cy + 30]
    ];
    const hole: HoleData = { ...base, recoveryZones: [zone] };
    const boundary = computeBoundary(hole);
    // Zone interior is now in play…
    expect(pointInBoundary(cx, cy, boundary)).toBe(true);
    // …including the margin ring outside the authored polygon.
    const nearRing = Math.min(30 + DEFAULT_MARGIN * 0.5, 30 + DEFAULT_MARGIN - 4);
    expect(pointInBoundary(cx + nearRing, cy, boundary)).toBe(true);
  });

  it('a ball resting in a recovery zone is NOT out of bounds', () => {
    const [cx, cy] = voidCorner(base);
    const zone: Array<[number, number]> = [
      [cx - 30, cy - 30],
      [cx + 30, cy - 30],
      [cx + 30, cy + 30],
      [cx - 30, cy + 30]
    ];
    const withZone: HoleData = withPlayableBoundary({ ...base, recoveryZones: [zone] }, true);
    const without: HoleData = withPlayableBoundary({ ...base }, true);
    const theme = resolveTheme(course);
    const hf = buildHeightField(withZone, theme.bunkerDepthScale ?? 1, theme.wasteDepthScale ?? 0);
    type OobProbe = { inOutOfBounds(x: number, y: number): boolean };
    const engineWith = new PhysicsEngine(withZone, hf, () => 0.5) as unknown as OobProbe;
    const engineWithout = new PhysicsEngine(without, hf, () => 0.5) as unknown as OobProbe;
    expect(engineWithout.inOutOfBounds(cx, cy)).toBe(true); // void without the zone
    expect(engineWith.inOutOfBounds(cx, cy)).toBe(false); // in play with it
  });

  it('malformed (degenerate) recovery zones are ignored', () => {
    const hole: HoleData = { ...base, recoveryZones: [[[5, 5], [9, 9]]] };
    expect(computeBoundary(hole).length).toBe(computeBoundary(base).length);
  });
});
