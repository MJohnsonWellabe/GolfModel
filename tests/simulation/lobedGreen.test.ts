import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { loadCourse, CourseAuthoring } from '../../src/data/courseLoader';
import { pointInGreens } from '../../src/utils/Geometry';
import { mulberry32 } from '../../src/utils/Random';
import { openHole } from './simHelpers';

/**
 * Lobed greens (HoleData.green2): the union of two wobbled ellipses IS the
 * green — physics surface classification, the fringe collar, and the
 * greenside bunker clip must all read the union, or the sand drawn and the
 * sand played diverge on the first kidney green shipped (Port Johnson's
 * Redan).
 */
describe('lobed green (green2 union)', () => {
  // Main lobe at (1500, 800); second lobe offset up-left, overlapping.
  const green = { cx: 1500, cy: 800, rx: 60, ry: 44, rot: 0.3 };
  const green2 = { cx: 1400, cy: 740, rx: 44, ry: 36, rot: 0.3 };

  it('surfaceAt reads green/fringe across BOTH lobes', () => {
    const hole = openHole({ green, green2, pin: { x: 1500, y: 800 } });
    const engine = new PhysicsEngine(hole, null, mulberry32(1));
    // Deep inside each lobe → green.
    expect(engine.surfaceAt(1500, 800)).toBe('green');
    expect(engine.surfaceAt(1400, 740)).toBe('green');
    // Just past lobe 2's far edge → fringe (the collar follows the union).
    expect(engine.surfaceAt(1400 - 44 - 12, 740)).toBe('fringe');
    // Far away (clear of the default fairway strip too) → rough.
    expect(engine.surfaceAt(900, 500)).toBe('rough');
    // Without green2 the same point is NOT green.
    const single = openHole({ green, pin: { x: 1500, y: 800 } });
    const engine1 = new PhysicsEngine(single, null, mulberry32(1));
    expect(engine1.surfaceAt(1400 - 20, 740)).not.toBe('green');
  });

  it('pointInGreens is the union of the two lobes', () => {
    expect(pointInGreens(1500, 800, green, green2)).toBe(true);
    expect(pointInGreens(1400, 740, green, green2)).toBe(true);
    expect(pointInGreens(1400, 740, green, undefined)).toBe(false);
    expect(pointInGreens(1200, 500, green, green2)).toBe(false);
  });

  it('greenside bunkers clip off the SECOND lobe too', () => {
    const course: CourseAuthoring = {
      name: 'LobeTest',
      holes: [
        {
          ...openHole({ green, green2, pin: { x: 1500, y: 800 } }),
          fairway: [],
          hazards: [
            {
              type: 'bunker' as const,
              // Authored square running under lobe 2's left flank.
              polygon: [
                [1340, 700],
                [1420, 700],
                [1420, 780],
                [1340, 780]
              ]
            }
          ]
        }
      ]
    } as unknown as CourseAuthoring;
    const compiled = loadCourse(course);
    const clipped = compiled.holes[0].hazards[0].polygon;
    // Every clipped vertex must sit OUTSIDE both lobes' putting surfaces.
    // (The Chaikin rounding applied after the clip can nudge a vertex a hair
    // back into the visual collar — true for single greens today too — but
    // never onto the green itself.)
    for (const [x, y] of clipped) {
      expect(pointInGreens(x, y, green, green2, 0)).toBe(false);
    }
  });
});
