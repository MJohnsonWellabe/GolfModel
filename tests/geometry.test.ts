import { describe, expect, it } from 'vitest';
import { angleTo, clamp, dist, pointInEllipse, pointInPolygon } from '../src/utils/Geometry';

const SQUARE = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100]
];

describe('pointInPolygon', () => {
  it('detects points inside and outside a square', () => {
    expect(pointInPolygon(50, 50, SQUARE)).toBe(true);
    expect(pointInPolygon(150, 50, SQUARE)).toBe(false);
    expect(pointInPolygon(-1, 50, SQUARE)).toBe(false);
  });

  it('handles concave polygons', () => {
    // A "U" shape: the notch between the prongs is outside
    const u = [
      [0, 0],
      [30, 0],
      [30, 60],
      [60, 60],
      [60, 0],
      [90, 0],
      [90, 100],
      [0, 100]
    ];
    expect(pointInPolygon(45, 30, u)).toBe(false); // in the notch
    expect(pointInPolygon(15, 30, u)).toBe(true); // left prong
    expect(pointInPolygon(45, 80, u)).toBe(true); // base
  });
});

describe('pointInEllipse', () => {
  const green = { cx: 100, cy: 100, rx: 40, ry: 20 };

  it('respects both radii', () => {
    expect(pointInEllipse(100, 100, green)).toBe(true);
    expect(pointInEllipse(139, 100, green)).toBe(true);
    expect(pointInEllipse(100, 121, green)).toBe(false);
  });

  it('margin expands the boundary (fringe ring)', () => {
    expect(pointInEllipse(145, 100, green)).toBe(false);
    expect(pointInEllipse(145, 100, green, 10)).toBe(true);
  });
});

describe('scalar helpers', () => {
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('dist and angleTo are consistent', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(angleTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(angleTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });
});
