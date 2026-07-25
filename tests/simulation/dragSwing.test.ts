import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUNING,
  MAX_PULL,
  effectivePower,
  readDrag,
  resolveDragSwing,
  trackLayout,
  tuningForViewport,
  type DragSample
} from '../../src/core/input/DragSwing';
import * as swing from '../../src/systems/swingModel';

/**
 * The drag swing's one hard promise: it changes the INPUT and nothing else.
 *
 * Difficulty, scoring, every balance gate and the whole headless simulator are
 * calibrated against `swingModel`. If a drag of a given quality produced a
 * different SwingResult from a tap of the same quality, the game would quietly
 * become a different game on one control scheme — the exact regression that is
 * impossible to notice by playing and trivial to catch here.
 *
 * The rest of these gates guard the REBUILD. The first version read only the
 * release point and was anchored where a phone has no travel; both faults were
 * invisible to every test it shipped with.
 */

const ctx: swing.SwingCtx = { stat: 80, powerTarget: 0.9, isPutt: false };

/** A pull straight down to `depth` px over `ms`, sampled every 16ms at a
 *  constant speed — the cleanest stroke a hand could make. */
function smoothPull(depth: number, ms = 600, drift = 0): DragSample[] {
  const out: DragSample[] = [];
  for (let t = 0; t < ms; t += 16) {
    const f = t / ms;
    out.push({ x: drift * f, y: depth * f, t });
  }
  out.push({ x: drift, y: depth, t: ms });
  return out;
}

/** The same depth, taken back in stop-start lurches. */
function stabbedPull(depth: number, ms = 600): DragSample[] {
  const out: DragSample[] = [];
  for (let t = 0; t <= ms; t += 16) {
    // Alternating sprint/stall: the same average speed, none of the control.
    const lurch = Math.floor(t / 48) % 2 === 0 ? 1.85 : 0.15;
    const prev = out.length ? out[out.length - 1].y : 0;
    out.push({ x: 0, y: Math.min(depth, prev + depth * (16 / ms) * lurch), t });
  }
  out.push({ x: 0, y: depth, t: ms + 16 });
  return out;
}

describe('reading the pull', () => {
  it('maps pull depth to power', () => {
    const full = readDrag(smoothPull(DEFAULT_TUNING.fullPullPx));
    expect(full.power).toBeCloseTo(1, 2);
    expect(full.face).toBeCloseTo(0, 6);
    expect(full.engaged).toBe(true);
    expect(readDrag(smoothPull(DEFAULT_TUNING.fullPullPx / 2)).power).toBeCloseTo(0.5, 2);
  });

  it('ignores a stray touch that never pulls back', () => {
    expect(readDrag(smoothPull(3)).engaged).toBe(false);
    expect(readDrag([{ x: 40, y: 0, t: 0 }]).engaged).toBe(false);
    expect(readDrag([]).engaged).toBe(false);
  });

  it('allows an overswing past full, as the tap meter does', () => {
    expect(readDrag(smoothPull(DEFAULT_TUNING.fullPullPx * 2)).power).toBeGreaterThan(1);
    expect(readDrag(smoothPull(DEFAULT_TUNING.fullPullPx * 9)).power).toBeCloseTo(MAX_PULL, 6);
  });

  it('reads the DEEPEST point, not the release point', () => {
    // Easing the finger back up as you let go is a release, not a decision to
    // hit it shorter. Reading the last sample would shave power off every
    // single shot, and only ever slightly — the worst kind of bug.
    const path = smoothPull(DEFAULT_TUNING.fullPullPx);
    const deep = path[path.length - 1];
    path.push({ x: 0, y: deep.y - 18, t: deep.t + 16 });
    expect(readDrag(path).power).toBeCloseTo(1, 2);
  });

  it('clamps the face angle so a wild sideways flick cannot exceed a full miss', () => {
    expect(readDrag(smoothPull(200, 600, 99999)).face).toBe(1);
    expect(readDrag(smoothPull(200, 600, -99999)).face).toBe(-1);
  });
});

describe('smoothness — how the club was taken back', () => {
  it('a clean unhurried pull is smooth; the same depth stabbed is not', () => {
    const clean = readDrag(smoothPull(300));
    const stab = readDrag(stabbedPull(300));
    expect(clean.smoothness).toBeGreaterThan(0.85);
    expect(stab.smoothness, `stab scored ${stab.smoothness.toFixed(2)}`).toBeLessThan(0.6);
    // Same depth reached — the difference is entirely in the stroke.
    expect(stab.power).toBeCloseTo(clean.power, 2);
  });

  it('a hitch that backs UP mid-takeaway is caught', () => {
    const path = smoothPull(300, 400);
    // Splice a reversal into the middle of the stroke.
    const hitched = path.map((s, i) => (i > 10 && i < 15 ? { ...s, y: path[10].y - (i - 10) * 9 } : s));
    expect(readDrag(hitched).smoothness).toBeLessThan(readDrag(path).smoothness - 0.1);
  });

  it('holding at the bottom before releasing costs nothing', () => {
    // The whole advantage of a spatial control is that you may settle and
    // adjust before letting go. Scoring the motionless hold as part of the
    // stroke would read the most careful player as the jerkiest one.
    const path = smoothPull(300);
    const end = path[path.length - 1];
    for (let i = 1; i <= 40; i++) path.push({ x: 0, y: end.y, t: end.t + i * 16 });
    expect(readDrag(path).smoothness).toBeGreaterThan(0.85);
  });

  it('hesitating before starting the takeaway costs nothing either', () => {
    const pause: DragSample[] = [];
    for (let i = 0; i < 30; i++) pause.push({ x: 0, y: 0, t: i * 16 });
    const path = [...pause, ...smoothPull(300).map((s) => ({ ...s, t: s.t + 480 }))];
    expect(readDrag(path).smoothness).toBeGreaterThan(0.85);
  });

  it('a flick too fast to be a backswing is scored as the stab it is', () => {
    const flick = readDrag([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 150, t: 20 },
      { x: 0, y: 300, t: 40 }
    ]);
    expect(flick.smoothness).toBeLessThan(0.5);
  });

  it('costs distance, but never more than the floor allows', () => {
    const clean = readDrag(smoothPull(300));
    const stab = readDrag(stabbedPull(300));
    expect(effectivePower(stab)).toBeLessThan(effectivePower(clean));
    expect(effectivePower(clean)).toBeCloseTo(clean.power, 2);
    expect(effectivePower({ ...clean, smoothness: 0 })).toBeGreaterThan(clean.power * 0.7);
  });
});

describe('straightness — where the face points', () => {
  it('a pull that drifts right reads right, and left reads left, symmetrically', () => {
    const right = readDrag(smoothPull(300, 600, 60));
    const left = readDrag(smoothPull(300, 600, -60));
    expect(right.face).toBeGreaterThan(0);
    expect(left.face).toBeCloseTo(-right.face, 6);
  });

  it('a stroke that wanders both ways is still a miss, even though the drift cancels', () => {
    // An S-shaped pull has a net drift near zero. Reading drift alone would
    // call the least controlled stroke in the game perfectly straight.
    const path = smoothPull(300, 600);
    const wobbly = path.map((s, i) => ({ ...s, x: Math.sin((i / path.length) * Math.PI * 2) * 55 }));
    expect(Math.abs(readDrag(wobbly).face)).toBeGreaterThan(Math.abs(readDrag(path).face) + 0.2);
  });

  it('a dead-straight pull has no face angle at all', () => {
    expect(readDrag(smoothPull(300)).face).toBeCloseTo(0, 6);
  });
});

describe('the gesture has room to complete', () => {
  it('scales to the viewport so it feels the same on any device', () => {
    expect(tuningForViewport(400).fullPullPx).toBeLessThan(tuningForViewport(1200).fullPullPx);
  });

  it('a full backswing plus its overswing always fits below the grip', () => {
    // THE BUG THIS CONTROL SHIPPED WITH. Anchored on the SWING button, 18px off
    // the bottom, there was no travel — "you can't pull down far enough at the
    // bottom". The geometry is now data, so it can be asserted.
    for (const h of [568, 667, 740, 800, 844, 915, 1024, 1280, 1600]) {
      const l = trackLayout(h);
      expect(l.gripTopPx + l.gripHeightPx + l.travelPx, `${h}px viewport`).toBeLessThanOrEqual(h);
      // And it must not be pushed so high it collides with the round controls.
      expect(l.gripTopPx, `${h}px viewport`).toBeGreaterThan(60);
    }
  });
});

describe('drag resolves through the SHARED swing model', () => {
  it('a pull that lands on the target power is a perfect strike', () => {
    const target = swing.targetBar(ctx);
    const result = resolveDragSwing({ power: target, face: 0, smoothness: 1, engaged: true }, ctx);
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
      const drag = resolveDragSwing({ power: cursor, face: 0, smoothness: 1, engaged: true }, ctx);
      expect(drag.powerQuality, `cursor ${cursor}`).toBe(band);
      expect(drag.power, `cursor ${cursor}`).toBeCloseTo(tapPower, 6);
    }
  });

  it('a stab pulled to the right depth still comes up short', () => {
    // The point of scoring the stroke: depth alone is no longer the whole shot.
    const target = swing.targetBar(ctx);
    const clean = resolveDragSwing({ power: target, face: 0, smoothness: 1, engaged: true }, ctx);
    const stabbed = resolveDragSwing({ power: target, face: 0, smoothness: 0.1, engaged: true }, ctx);
    expect(clean.powerQuality).toBe('perfect');
    expect(stabbed.powerQuality).not.toBe('perfect');
    expect(stabbed.power).toBeLessThan(clean.power);
  });

  it('a released-right face sends the ball the way the meter would', () => {
    const right = resolveDragSwing({ power: 0.9, face: 0.6, smoothness: 1, engaged: true }, ctx);
    const left = resolveDragSwing({ power: 0.9, face: -0.6, smoothness: 1, engaged: true }, ctx);
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
    const at = (c: swing.SwingCtx): string =>
      resolveDragSwing({ power: off, face: 0, smoothness: 1, engaged: true }, c).powerQuality;
    expect(at(easy)).toBe('perfect');
    expect(at(hard)).not.toBe('perfect');
  });

  it('an end-to-end clean pull to the target plays as a perfect shot', () => {
    // The whole chain — path, depth, smoothness, band — from a gesture a hand
    // could actually make.
    const t = tuningForViewport(844);
    const target = swing.targetBar(ctx);
    const state = readDrag(smoothPull(target * t.fullPullPx, 620), t);
    const result = resolveDragSwing(state, ctx);
    expect(result.powerQuality, `power ${state.power.toFixed(3)} smooth ${state.smoothness.toFixed(2)}`).toBe(
      'perfect'
    );
    expect(result.accuracyQuality).toBe('perfect');
  });
});
