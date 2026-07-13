import { describe, expect, it } from 'vitest';
import { advanceCursor } from '../src/slice3d/meter3d';

/**
 * The meter's deliverable power must be continuous in TIME, not quantized to
 * animation frames — the bug was per-frame cursor sampling, which stepped a
 * driver's carry in ~7yd jumps at 30fps ("I can hit 265 or 258, nothing in
 * between"). advanceCursor is the shared integrator: the frame renderer and
 * the tap sampler both use it, so a tap between frames reads an intermediate
 * cursor. These tests pin the pure math.
 */
describe('advanceCursor', () => {
  const SPEED = 1 / 1550; // fraction per ms (default sweep)

  it('is frame-rate independent: one 33ms step equals two 16.5ms steps', () => {
    const oneStep = advanceCursor(0.2, 1, SPEED, 33, true);
    let twoStep = advanceCursor(0.2, 1, SPEED, 16.5, true);
    twoStep = advanceCursor(twoStep.cursor, twoStep.dirSign, SPEED, 16.5, true);
    expect(twoStep.cursor).toBeCloseTo(oneStep.cursor, 10);
    expect(twoStep.dirSign).toBe(oneStep.dirSign);
  });

  it('yields intermediate values between frame boundaries (the actual bug)', () => {
    // A 30fps frame is 33.3ms. A tap 10ms after the last frame must land
    // strictly between the two frame-boundary cursors.
    const atFrame = advanceCursor(0.5, 1, SPEED, 0, true).cursor;
    const midTap = advanceCursor(0.5, 1, SPEED, 10, true).cursor;
    const nextFrame = advanceCursor(0.5, 1, SPEED, 33.3, true).cursor;
    expect(midTap).toBeGreaterThan(atFrame);
    expect(midTap).toBeLessThan(nextFrame);
  });

  it('reflects off the top and reverses (power sweep bounce)', () => {
    const r = advanceCursor(0.99, 1, SPEED, 50, true); // overshoots 1
    expect(r.dirSign).toBe(-1);
    expect(r.cursor).toBeLessThan(1);
    expect(r.cursor).toBeGreaterThan(0.9);
    // Mirror math: 0.99 + 50*speed = 1.0223 → reflected to 2 - 1.0223
    expect(r.cursor).toBeCloseTo(2 - (0.99 + 50 * SPEED), 10);
  });

  it('reflects off the bottom and reverses (power sweep bounce)', () => {
    const r = advanceCursor(0.01, -1, SPEED, 50, true);
    expect(r.dirSign).toBe(1);
    expect(r.cursor).toBeCloseTo(-(0.01 - 50 * SPEED), 10);
  });

  it('clamps at 0 without bouncing on the accuracy sweep', () => {
    const r = advanceCursor(0.01, -1, SPEED, 100, false);
    expect(r.cursor).toBe(0); // meter auto-misses at 0
    expect(r.dirSign).toBe(-1);
  });
});
