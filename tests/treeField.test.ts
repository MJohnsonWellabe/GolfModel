import { describe, expect, it } from 'vitest';
import { collectTreeBlobs } from '../src/systems/treeField';
import { HoleData } from '../src/core/types';
import { pointInPolygon } from '../src/utils/Geometry';

const square: number[][] = [
  [100, 100],
  [400, 100],
  [400, 400],
  [100, 400]
];

function holeWith(spacing?: number): HoleData {
  return {
    number: 1,
    par: 4,
    yardage: 400,
    world: { width: 900, height: 1200 },
    tee: { x: 450, y: 1100 },
    green: { cx: 450, cy: 200, rx: 60, ry: 40 },
    slope: { angle: 0, strength: 0 },
    pin: { x: 450, y: 200 },
    fairway: [],
    hazards: [{ type: 'trees', polygon: square, ...(spacing !== undefined ? { spacing } : {}) }],
    aiTargets: []
  };
}

describe('collectTreeBlobs spacing', () => {
  it('keeps the historical density when no spacing is authored', () => {
    // 300x300 polygon on a 52-unit grid: the exact blob set is jitter-
    // dependent, but the count must match the long-standing default so
    // existing courses (and their balance) are untouched by the knob.
    expect(collectTreeBlobs(holeWith())).toEqual(collectTreeBlobs(holeWith(52)));
  });

  it('plants denser woods when the hazard authors a smaller spacing', () => {
    const sparse = collectTreeBlobs(holeWith()).length;
    const dense = collectTreeBlobs(holeWith(42)).length;
    expect(dense).toBeGreaterThan(sparse * 1.3);
  });

  it('keeps every trunk inside the authored polygon at any density', () => {
    for (const b of collectTreeBlobs(holeWith(40))) {
      expect(pointInPolygon(b.x, b.y, square)).toBe(true);
    }
  });
});
