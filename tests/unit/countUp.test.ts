import { describe, expect, it } from 'vitest';
import { countUpValue, easeOutCubic } from '../../src/core/countUp';

describe('easeOutCubic', () => {
  it('is clamped to [0,1] and monotonic', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('countUpValue', () => {
  it('starts at from and ends exactly at to', () => {
    expect(countUpValue(0, 11, 0)).toBe(0);
    expect(countUpValue(0, 11, 1)).toBe(11);
    expect(countUpValue(0, 11, 1.5)).toBe(11);
  });

  it('never overshoots and is monotonic for an increasing count', () => {
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.016) {
      const v = countUpValue(0, 12, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(12);
      prev = v;
    }
  });

  it('handles from > to (counting down) and equal endpoints', () => {
    expect(countUpValue(9, 3, 0.999)).toBeGreaterThanOrEqual(3);
    expect(countUpValue(9, 3, 1)).toBe(3);
    expect(countUpValue(7, 7, 0.5)).toBe(7);
  });
});
