import { describe, expect, it } from 'vitest';
import { compileRibbon, loadCourse, CourseAuthoring } from '../src/data/courseLoader';
import wildwood from '../src/data/courses/wildwood.json';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { catmullRom, offsetPolyline, pointInPolygon } from '../src/utils/Geometry';

describe('catmullRom', () => {
  it('passes through every control point', () => {
    const pts = [
      [0, 0],
      [10, 5],
      [20, 0],
      [30, 10]
    ];
    const out = catmullRom(pts, 4);
    for (const p of pts) {
      expect(out.some(([x, y]) => Math.abs(x - p[0]) < 1e-9 && Math.abs(y - p[1]) < 1e-9)).toBe(true);
    }
  });

  it('produces samplesPerSeg points per segment plus the final endpoint', () => {
    const out = catmullRom(
      [
        [0, 0],
        [10, 0],
        [20, 0]
      ],
      5
    );
    expect(out.length).toBe(2 * 5 + 1);
  });

  it('interpolates extra dimensions (widths) coherently', () => {
    const out = catmullRom(
      [
        [0, 0, 10],
        [100, 0, 30]
      ],
      4
    );
    // Width column should move monotonically from 10 to 30 on a straight pair
    const widths = out.map((p) => p[2]);
    expect(widths[0]).toBeCloseTo(10);
    expect(widths[widths.length - 1]).toBeCloseTo(30);
  });
});

describe('offsetPolyline', () => {
  it('a straight line becomes a rectangle of the requested width', () => {
    const poly = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ],
      [10, 10]
    );
    expect(poly.length).toBe(4);
    expect(pointInPolygon(50, 0, poly)).toBe(true);
    expect(pointInPolygon(50, 9, poly)).toBe(true);
    expect(pointInPolygon(50, 11, poly)).toBe(false);
  });
});

describe('compileRibbon', () => {
  it('contains the centerline and respects widths at both ends', () => {
    const poly = compileRibbon({
      centerline: [
        [0, 0],
        [0, 100],
        [40, 200]
      ],
      width: [20, 60, 30]
    });
    expect(pointInPolygon(0, 50, poly)).toBe(true);
    expect(pointInPolygon(0, 100, poly)).toBe(true);
    // Wide at the middle control point, narrow at the start
    expect(pointInPolygon(25, 100, poly)).toBe(true);
    expect(pointInPolygon(15, 0, poly)).toBe(false);
  });
});

describe('wildwood v2 course data', () => {
  const course = loadCourse(wildwood as unknown as CourseAuthoring);

  it('compiles every fairway ribbon into a polygon', () => {
    for (const h of course.holes) {
      for (const poly of h.fairway) {
        expect(Array.isArray(poly)).toBe(true);
        expect(poly.length).toBeGreaterThan(8); // sampled ribbons, not 4-pt rectangles
      }
    }
  });

  it('every hole: pin is on the green and the tee is playable', () => {
    for (const h of course.holes) {
      const engine = new PhysicsEngine(h);
      expect(engine.surfaceAt(h.pin.x, h.pin.y)).toBe('green');
      const teeSurf = engine.surfaceAt(h.tee.x, h.tee.y);
      expect(['fairway', 'rough', 'tee']).toContain(teeSurf);
    }
  });

  it('every AI layup target sits in the fairway', () => {
    for (const h of course.holes) {
      const engine = new PhysicsEngine(h);
      for (const t of h.aiTargets) {
        expect(engine.surfaceAt(t.x, t.y)).toBe('fairway');
      }
    }
  });

  it('fairway centerline midpoints are fairway (ribbon actually landed)', () => {
    for (const h of course.holes) {
      const engine = new PhysicsEngine(h);
      const raw = (wildwood as unknown as CourseAuthoring).holes.find((x) => x.number === h.number)!;
      for (const f of raw.fairway) {
        if (Array.isArray(f)) continue;
        // Probe segment midpoints — ribbon endpoints sit exactly on the
        // polygon's end-cap edge, which the boundary-exclusive ray cast skips.
        for (let i = 0; i < f.centerline.length - 1; i++) {
          const x = (f.centerline[i][0] + f.centerline[i + 1][0]) / 2;
          const y = (f.centerline[i][1] + f.centerline[i + 1][1]) / 2;
          const surf = engine.surfaceAt(x, y);
          // Greens/bunkers may legitimately overlap the ribbon near the green
          expect(['fairway', 'green', 'fringe', 'sand']).toContain(surf);
        }
      }
    }
  });
});
