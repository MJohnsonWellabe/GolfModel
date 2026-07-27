import { describe, expect, it } from 'vitest';

/**
 * LIVE SCATTER THINNING — the arithmetic only.
 *
 * `NatureBatcher.thinTo` needs Babylon meshes to run, which a unit test has no
 * business constructing. What matters and what CAN be checked here is the
 * selection rule: which slots survive. That rule is the whole reason this is a
 * stride rather than a truncation.
 *
 * Slots are appended in grid-scan order, so consecutive slots are adjacent
 * positions on the ground. A stride therefore removes an evenly spread sample
 * across the cell, while lowering `thinInstanceCount` — the cheaper option —
 * would delete the tail of the scan, which is a contiguous spatial band: a bald
 * stripe carved out of every cell.
 */

/**
 * The rule `thinTo` applies, transcribed. Note the early return at `keep >= 1`:
 * it is load-bearing, not a shortcut. `1 / (1 - keep)` is a division by zero
 * there, so a tier that sheds nothing MUST take the early exit — computing the
 * stride first would be the bug this mirrors.
 */
const hidden = (count: number, fraction: number): boolean[] => {
  const keep = Math.max(0.05, Math.min(1, fraction));
  if (keep >= 1) return Array.from({ length: count }, () => false);
  const stride = Math.max(2, Math.round(1 / (1 - keep)));
  return Array.from({ length: count }, (_, i) => i % stride === 0);
};

describe('which props a thin drops', () => {
  it('spreads the removals instead of carving a band', () => {
    // The property that matters. Split the cell into ten spatial slices (slot
    // order is scan order, so a contiguous slot range IS a contiguous region)
    // and require every slice to lose some and keep some.
    const count = 1000;
    const drop = hidden(count, 0.7);
    for (let slice = 0; slice < 10; slice++) {
      const part = drop.slice(slice * 100, (slice + 1) * 100);
      const removed = part.filter(Boolean).length;
      expect(removed, `slice ${slice} lost nothing`).toBeGreaterThan(0);
      expect(removed, `slice ${slice} was wiped out`).toBeLessThan(part.length);
    }
  });

  it('keeps roughly the fraction asked for', () => {
    for (const f of [0.8, 0.7, 0.5, 0.45]) {
      const drop = hidden(2000, f);
      const kept = drop.filter((d) => !d).length / drop.length;
      // The stride is an integer, so the kept share lands on 1/2, 2/3, 3/4 …
      // rather than exactly on the request. Within 15% is close enough for a
      // visual budget and keeps the rule a single cheap modulo.
      expect(Math.abs(kept - f), `keeping ${f} gave ${kept.toFixed(2)}`).toBeLessThan(0.15);
    }
  });

  it('never removes everything, even asked for zero', () => {
    const drop = hidden(500, 0);
    expect(drop.filter((d) => !d).length, 'some scatter must always survive').toBeGreaterThan(0);
  });

  it('is a no-op at full quality', () => {
    // A tier that sheds nothing must not touch the buffers at all — and must
    // not reach the stride arithmetic, where 1/(1-1) is Infinity.
    expect(hidden(200, 1).some(Boolean), 'tier 0 must not hide a single prop').toBe(false);
    // Anything above 1 is clamped down to it, not through it.
    expect(hidden(200, 1.4).some(Boolean)).toBe(false);
  });

  it('is idempotent — thinning twice removes the same slots', () => {
    const once = hidden(500, 0.7);
    const twice = hidden(500, 0.7);
    expect(twice).toEqual(once);
  });

  it('drops more as the tier gets cheaper', () => {
    const mild = hidden(1000, 0.8).filter(Boolean).length;
    const harsh = hidden(1000, 0.45).filter(Boolean).length;
    expect(harsh).toBeGreaterThan(mild);
  });
});
