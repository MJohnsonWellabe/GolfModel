import { describe, expect, it } from 'vitest';
import { angleTo, clamp, dist, pointInEllipse, pointInGreens, pointInPolygon, randomPinForGreen } from '../src/utils/Geometry';
import { mulberry32 } from '../src/utils/Random';
import { loadCourse, CourseAuthoring } from '../src/data/courseLoader';
import wildwood from '../src/data/courses/wildwood.json';
import sablebay from '../src/data/courses/sablebay.json';
import timberline from '../src/data/courses/timberline.json';
import portjohnson from '../src/data/courses/portjohnson.json';

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

describe('randomPinForGreen', () => {
  const COURSES = {
    wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
    sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
    timberline: loadCourse(timberline as unknown as CourseAuthoring),
    portjohnson: loadCourse(portjohnson as unknown as CourseAuthoring)
  };

  it('always lands inside the green (both lobes), clear of the rim, for every course/hole', () => {
    for (const [id, course] of Object.entries(COURSES)) {
      for (const h of course.holes) {
        for (let s = 0; s < 60; s++) {
          const pin = randomPinForGreen(h.green, h.green2, mulberry32(s * 131 + 7));
          // Strictly inside the putting surface (margin 0 — the pin sits well
          // in from the -edge sampling boundary).
          expect(pointInGreens(pin.x, pin.y, h.green, h.green2), `${id} h${h.number} seed${s}`).toBe(true);
        }
      }
    }
  });

  it('is deterministic for a fixed seed (tournament parity)', () => {
    const h = COURSES.wildwood.holes[0];
    const a = randomPinForGreen(h.green, h.green2, mulberry32(42));
    const b = randomPinForGreen(h.green, h.green2, mulberry32(42));
    expect(a).toEqual(b);
    const c = randomPinForGreen(h.green, h.green2, mulberry32(43));
    expect(a.x === c.x && a.y === c.y).toBe(false); // different seed → different pin
  });

  it('varies the pin across seeds (not pinned to the centre)', () => {
    const h = COURSES.wildwood.holes[0];
    const pins = Array.from({ length: 20 }, (_, s) => randomPinForGreen(h.green, h.green2, mulberry32(s * 17 + 1)));
    const spread = Math.max(...pins.map((p) => dist(p, { x: h.green.cx, y: h.green.cy })));
    expect(spread).toBeGreaterThan(5); // real movement off centre
  });
});
