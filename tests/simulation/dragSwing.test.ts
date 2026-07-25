import { describe, expect, it } from 'vitest';
import { readDrag, resolveDragSwing, tuningForViewport, DEFAULT_TUNING } from '../../src/core/input/DragSwing';
import * as swing from '../../src/systems/swingModel';

/**
 * The drag swing's one hard promise: it changes the INPUT and nothing else.
 *
 * Difficulty, scoring, every balance gate and the whole headless simulator are
 * calibrated against `swingModel`. If a drag of a given quality produced a
 * different SwingResult from a tap of the same quality, the game would quietly
 * become a different game on one control scheme — the exact regression that is
 * impossible to notice by playing and trivial to catch here.
 */

const ctx: swing.SwingCtx = { stat: 80, powerTarget: 0.9, isPutt: false };

describe('drag reading', () => {
  it('maps pull distance to power and sideways travel to face angle', () => {
    const full = readDrag(0, DEFAULT_TUNING.fullPullPx);
    expect(full.power).toBeCloseTo(1, 2);
    expect(full.face).toBe(0);
    expect(full.engaged).toBe(true);
    const half = readDrag(0, DEFAULT_TUNING.fullPullPx / 2);
    expect(half.power).toBeCloseTo(0.5, 2);
  });

  it('ignores a stray touch that never pulls back', () => {
    expect(readDrag(0, 2).engaged).toBe(false);
    expect(readDrag(40, 0).engaged).toBe(false);
  });

  it('allows an overswing past full, as the tap meter does', () => {
    expect(readDrag(0, DEFAULT_TUNING.fullPullPx * 2).power).toBeGreaterThan(1);
  });

  it('clamps the face angle so a wild sideways flick cannot exceed a full miss', () => {
    expect(readDrag(99999, 200).face).toBe(1);
    expect(readDrag(-99999, 200).face).toBe(-1);
  });

  it('scales the gesture to the viewport so it feels the same on any device', () => {
    expect(tuningForViewport(400).fullPullPx).toBeLessThan(tuningForViewport(1200).fullPullPx);
  });
});

describe('drag resolves through the SHARED swing model', () => {
  it('a pull that lands on the target power is a perfect strike', () => {
    const target = swing.targetBar(ctx);
    const result = resolveDragSwing({ power: target, face: 0, engaged: true }, ctx);
    expect(result.powerQuality).toBe('perfect');
    expect(result.accuracyQuality).toBe('perfect');
  });

  it('produces the identical result the tap meter would for the same cursor', () => {
    // This is the parity that matters: same cursor position, same band, same
    // delivered power — whichever control put the cursor there.
    const target = swing.targetBar(ctx);
    for (const cursor of [target, target * 0.7, target * 1.1, 0.4]) {
      const band = swing.bandFor(cursor, target, swing.perfectHalf(ctx), swing.goodHalf(ctx));
      const tapPower = swing.deliveredPower(ctx, cursor, band);
      const drag = resolveDragSwing({ power: cursor, face: 0, engaged: true }, ctx);
      expect(drag.powerQuality, `cursor ${cursor}`).toBe(band);
      expect(drag.power, `cursor ${cursor}`).toBeCloseTo(tapPower, 6);
    }
  });

  it('a released-right face sends the ball the way the meter would', () => {
    const right = resolveDragSwing({ power: 0.9, face: 0.6, engaged: true }, ctx);
    const left = resolveDragSwing({ power: 0.9, face: -0.6, engaged: true }, ctx);
    // Signs must be opposite and magnitudes equal — the same symmetric curve
    // the tap meter's accuracy lock applies.
    expect(Math.sign(right.accuracy)).toBe(-Math.sign(left.accuracy));
    expect(Math.abs(right.accuracy)).toBeCloseTo(Math.abs(left.accuracy), 6);
  });

  it('a harder lie narrows the perfect band for a drag exactly as for a tap', () => {
    const easy: swing.SwingCtx = { ...ctx, difficultyMult: 1 };
    const hard: swing.SwingCtx = { ...ctx, difficultyMult: 0.4 };
    // A pull slightly off target: fine on a clean lie, not fine out of trouble.
    const off = swing.targetBar(ctx) - swing.perfectHalf(easy) * 0.9;
    expect(resolveDragSwing({ power: off, face: 0, engaged: true }, easy).powerQuality).toBe('perfect');
    expect(resolveDragSwing({ power: off, face: 0, engaged: true }, hard).powerQuality).not.toBe('perfect');
  });
});
