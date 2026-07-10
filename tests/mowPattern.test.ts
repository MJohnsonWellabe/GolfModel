import { describe, expect, it } from 'vitest';
import { mowCheckerboard } from '../src/core/rendering/mowPattern';

describe('mowCheckerboard', () => {
  const T = 30; // cell width

  it('is a four-quadrant checkerboard: diagonal cells match, neighbours flip', () => {
    const c00 = mowCheckerboard(15, 15, T); // both first cells
    const c10 = mowCheckerboard(45, 15, T); // next cell along
    const c01 = mowCheckerboard(15, 45, T); // next cell across
    const c11 = mowCheckerboard(45, 45, T); // diagonal
    expect(Math.sign(c00)).toBe(1);
    expect(Math.sign(c10)).toBe(-1); // flips along the axis
    expect(Math.sign(c01)).toBe(-1); // flips across the axis
    expect(Math.sign(c11)).toBe(1); // diagonal cell matches the origin
  });

  it('cell centres saturate to ±1 (flat, hard-edged cells)', () => {
    expect(mowCheckerboard(15, 15, T)).toBeCloseTo(1, 5);
    expect(mowCheckerboard(45, 15, T)).toBeCloseTo(-1, 5);
  });

  it('stays within [-1, 1] everywhere', () => {
    for (let a = 0; a < 120; a += 7) {
      for (let b = 0; b < 120; b += 5) {
        const v = mowCheckerboard(a, b, T);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
