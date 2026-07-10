import { describe, expect, it } from 'vitest';
import { dotSpeed, sampleGreenPoint } from '../src/slice3d/breakDots';
import { pointInEllipse } from '../src/utils/Geometry';
import { EllipseArea } from '../src/core/types';

describe('break-dot flow field helpers', () => {
  it('dot speed has a visible floor and clamps on severe break', () => {
    expect(dotSpeed(0)).toBe(2);
    expect(dotSpeed(30)).toBeCloseTo(5.5);
    expect(dotSpeed(60)).toBe(9);
    expect(dotSpeed(500)).toBe(9); // clamped — dots never streak
  });

  it('samples stay inside a rotated green ellipse', () => {
    // Timberline hole 2's angled green (rot 0.4).
    const g: EllipseArea = { cx: 452, cy: 440, rx: 82, ry: 56, rot: 0.4 };
    for (let i = 0; i < 1000; i++) {
      const u = (i * 0.6180339887) % 1;
      const v = (i * 0.7548776662) % 1;
      const p = sampleGreenPoint(g, u, v);
      expect(pointInEllipse(p.x, p.y, g)).toBe(true);
    }
  });

  it('is deterministic for identical inputs (freeze-frame stability)', () => {
    const g: EllipseArea = { cx: 100, cy: 200, rx: 60, ry: 40 };
    expect(sampleGreenPoint(g, 0.3, 0.7)).toEqual(sampleGreenPoint(g, 0.3, 0.7));
  });
});
