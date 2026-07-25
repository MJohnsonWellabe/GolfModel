import { describe, expect, it } from 'vitest';
import {
  SWEEP_MS,
  effectivePower,
  guideAt,
  guideRoute,
  pointAt,
  readTrace,
  resolveTraceSwing,
  type TraceSample
} from '../../src/core/input/TraceSwing';
import * as swing from '../../src/systems/swingModel';

/**
 * The traced swing.
 *
 * The pull it replaces asked one question — how far back, how tidily — which a
 * player answers correctly on their third attempt and never thinks about again.
 * A golf swing is a PATH taken at a TEMPO, and this control measures both.
 *
 * Its one hard promise is unchanged and is the first thing asserted: only the
 * INPUT is different. Difficulty, scoring, every balance gate and the headless
 * simulator are calibrated against `swingModel`, so a traced swing and a tapped
 * swing that put the cursor in the same place must produce the same shot.
 */

const ctx: swing.SwingCtx = { stat: 80, powerTarget: 0.9, isPutt: false };
const ROUTE = guideRoute();

/**
 * A gesture that follows the guide dot, as far as `upTo`.
 *
 * `offset` displaces it along the route's own NORMAL rather than along x.
 * Shifting x on a CURVED route is not a symmetric perturbation — the same
 * number moves you much further from the line on one side than the other — so
 * an x-offset test would report an asymmetry the control does not have.
 */
function perfect(upTo = 1, offset = 0, tempo = 1): TraceSample[] {
  const out: TraceSample[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * upTo;
    const p = pointAt(ROUTE, s);
    const ahead = pointAt(ROUTE, Math.min(1, s + 0.01));
    const behind = pointAt(ROUTE, Math.max(0, s - 0.01));
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const len = Math.hypot(dx, dy) || 1;
    // The normal, rotated 90° from the direction of travel.
    out.push({ x: p.x + (-dy / len) * offset, y: p.y + (dx / len) * offset, t: (s * SWEEP_MS) / tempo });
  }
  return out;
}

describe('the guide route', () => {
  it('is a curve, not a straight line a thumb can rest against', () => {
    // A straight route is traced perfectly by holding a thumb to the edge of
    // the phone, which is not a skill.
    const a = pointAt(ROUTE, 0);
    const b = pointAt(ROUTE, 0.5);
    const c = pointAt(ROUTE, 1);
    const straight = Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x));
    expect(straight, 'the route is collinear').toBeGreaterThan(0.02);
  });

  it('stays inside the pad', () => {
    for (const p of ROUTE) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('moves the dot at a CONSTANT speed', () => {
    // Arc-length parameterised on purpose: an unparameterised curve hurries
    // through its tight part, and a player who followed it faithfully would be
    // told their timing was poor.
    const step = SWEEP_MS / 20;
    const gaps: number[] = [];
    for (let i = 1; i <= 20; i++) {
      const a = guideAt(ROUTE, (i - 1) * step);
      const b = guideAt(ROUTE, i * step);
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - mean) / mean, `gap ${g} vs ${mean}`).toBeLessThan(0.25);
  });
});

describe('reading a trace', () => {
  it('a gesture that follows the dot exactly is a perfect swing', () => {
    const t = readTrace(perfect(), ROUTE);
    expect(t.progress).toBeCloseTo(1, 1);
    expect(t.accuracy).toBeGreaterThan(0.95);
    expect(t.timing).toBeGreaterThan(0.9);
    expect(Math.abs(t.face)).toBeLessThan(0.05);
    expect(t.engaged).toBe(true);
  });

  it('ignores a stray touch that never travels', () => {
    expect(readTrace(perfect(0.02), ROUTE).engaged).toBe(false);
    expect(readTrace([], ROUTE).engaged).toBe(false);
  });

  it('a half-traced route is a half backswing', () => {
    expect(readTrace(perfect(0.5), ROUTE).progress).toBeCloseTo(0.5, 1);
  });

  it('reads the FURTHEST point, not the last one', () => {
    // Easing off at the end of a stroke is a release, not a decision to swing
    // shorter — reading the last sample would shave power off every shot.
    const path = perfect();
    const back = pointAt(ROUTE, 0.7);
    path.push({ x: back.x, y: back.y, t: SWEEP_MS + 40 });
    expect(readTrace(path, ROUTE).progress).toBeCloseTo(1, 1);
  });

  it('drifting off the line costs accuracy, and the SIDE is kept', () => {
    const wide = readTrace(perfect(1, 0.09), ROUTE);
    const inside = readTrace(perfect(1, -0.09), ROUTE);
    expect(wide.accuracy).toBeLessThan(0.7);
    // Cutting the corner and drifting wide are different misses and a golfer
    // feels them differently, so the sign survives.
    expect(Math.sign(wide.face)).toBe(-Math.sign(inside.face));
    expect(Math.abs(wide.face)).toBeCloseTo(Math.abs(inside.face), 1);
  });

  it('racing ahead of the dot costs timing but not the line', () => {
    const rushed = readTrace(perfect(1, 0, 3), ROUTE);
    expect(rushed.timing, `timing ${rushed.timing}`).toBeLessThan(0.6);
    // The PATH was still traced perfectly — the two faults are independent, so
    // a player is told which one they actually made.
    expect(rushed.accuracy).toBeGreaterThan(0.95);
  });
});

describe('a trace resolves through the SHARED swing model', () => {
  it('produces the identical result the tap meter would for the same cursor', () => {
    const target = swing.targetBar(ctx);
    for (const cursor of [target, target * 0.7, target * 1.1, 0.4]) {
      const band = swing.bandFor(cursor, target, swing.perfectHalf(ctx), swing.goodHalf(ctx));
      const tapPower = swing.deliveredPower(ctx, cursor, band);
      const traced = resolveTraceSwing(
        { progress: cursor, accuracy: 1, timing: 1, face: 0, engaged: true },
        ctx
      );
      expect(traced.powerQuality, `cursor ${cursor}`).toBe(band);
      expect(traced.power, `cursor ${cursor}`).toBeCloseTo(tapPower, 6);
    }
  });

  it('bad timing costs distance, but never more than the floor allows', () => {
    const target = swing.targetBar(ctx);
    const clean = resolveTraceSwing({ progress: target, accuracy: 1, timing: 1, face: 0, engaged: true }, ctx);
    const rushed = resolveTraceSwing({ progress: target, accuracy: 1, timing: 0, face: 0, engaged: true }, ctx);
    expect(clean.powerQuality).toBe('perfect');
    expect(rushed.power).toBeLessThan(clean.power);
    expect(rushed.powerQuality).not.toBe('perfect');
    // A badly timed swing is short, not a whiff.
    expect(effectivePower({ progress: 1, accuracy: 1, timing: 0, face: 0, engaged: true })).toBeGreaterThan(0.7);
  });

  it('a face left and a face right are mirror images', () => {
    // The drag swing's first bug: projecting the face through the bar's cursor
    // space, where the accuracy target sits near the LEFT edge, made an
    // identical miss left and right come out very differently.
    const right = resolveTraceSwing({ progress: 0.9, accuracy: 0.5, timing: 1, face: 0.6, engaged: true }, ctx);
    const left = resolveTraceSwing({ progress: 0.9, accuracy: 0.5, timing: 1, face: -0.6, engaged: true }, ctx);
    expect(Math.sign(right.accuracy)).toBe(-Math.sign(left.accuracy));
    expect(Math.abs(right.accuracy)).toBeCloseTo(Math.abs(left.accuracy), 6);
  });

  it('a harder lie narrows the perfect band for a trace exactly as for a tap', () => {
    const easy: swing.SwingCtx = { ...ctx, difficultyMult: 1 };
    const hard: swing.SwingCtx = { ...ctx, difficultyMult: 0.4 };
    const off = swing.targetBar(ctx) - swing.perfectHalf(easy) * 0.9;
    const at = (c: swing.SwingCtx): string =>
      resolveTraceSwing({ progress: off, accuracy: 1, timing: 1, face: 0, engaged: true }, c).powerQuality;
    expect(at(easy)).toBe('perfect');
    expect(at(hard)).not.toBe('perfect');
  });

  it('end to end: a hand that follows the dot to the target plays a perfect shot', () => {
    const target = swing.targetBar(ctx);
    const state = readTrace(perfect(target), ROUTE);
    const result = resolveTraceSwing(state, ctx);
    expect(
      result.powerQuality,
      `progress ${state.progress.toFixed(3)} timing ${state.timing.toFixed(2)}`
    ).toBe('perfect');
    expect(result.accuracyQuality).toBe('perfect');
  });
});
