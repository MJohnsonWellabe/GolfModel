import { describe, expect, it } from 'vitest';
import {
  ADDRESS_Y,
  DOWN_FRACTION,
  MAX_PULL,
  RAIL_X,
  SWEEP_MS,
  cursorAt,
  effectivePower,
  rabbitAt,
  railY,
  readTrace,
  resolveTraceSwing,
  type TraceSample
} from '../../src/core/input/TraceSwing';
import * as swing from '../../src/systems/swingModel';

/**
 * The tempo trace (owner spec, EA-Sports style): a vertical rail, a rabbit
 * that runs straight down to this club's pull depth and straight back up, and
 * a player whose whole job is to stay with it. Track the tempo and the path
 * and you have hit a perfect shot.
 *
 * The one hard promise is unchanged and asserted first: only the INPUT is
 * different. A traced swing and a tapped swing that put the cursor in the same
 * place must produce the same shot, or the game quietly becomes a different
 * game on one control scheme.
 */

const ctx: swing.SwingCtx = { stat: 80, powerTarget: 0.9, isPutt: false };
const TARGET = swing.targetBar(ctx);

/**
 * A gesture that follows the rabbit, sampled every 16 ms.
 *
 * `tempo` scales the player's clock (2 = twice as fast as the rabbit);
 * `wobble` is a constant lateral offset; `depthScale` over/under-pulls the
 * turnaround while keeping the rhythm.
 */
function follow(target = TARGET, { tempo = 1, wobble = 0, depthScale = 1 } = {}): TraceSample[] {
  const out: TraceSample[] = [];
  for (let t = 0; t <= SWEEP_MS; t += 16) {
    const rb = rabbitAt(Math.min(SWEEP_MS, t * tempo), target);
    out.push({ x: RAIL_X + wobble, y: railY(rb.cursor * depthScale), t });
  }
  return out;
}

describe('the rail and the rabbit', () => {
  it('maps cursor to rail y and back, exactly', () => {
    for (const c of [0, 0.3, 0.9, 1, MAX_PULL]) {
      expect(cursorAt(railY(c))).toBeCloseTo(c, 6);
    }
  });

  it("the rabbit turns at THIS CLUB'S target depth, not at the bottom", () => {
    // The rabbit demonstrates the correct swing for the club in hand, so
    // tracking it exactly is a perfect shot by construction. A rabbit that
    // always ran to the bottom would coach every club into an overswing.
    const atTurn = rabbitAt(SWEEP_MS * DOWN_FRACTION, TARGET);
    expect(atTurn.cursor).toBeCloseTo(TARGET, 4);
    let deepest = 0;
    for (let t = 0; t <= SWEEP_MS; t += 10) deepest = Math.max(deepest, rabbitAt(t, TARGET).cursor);
    expect(deepest).toBeCloseTo(TARGET, 3);
  });

  it('runs down, then back up, and ends home', () => {
    expect(rabbitAt(0, TARGET).cursor).toBe(0);
    expect(rabbitAt(SWEEP_MS, TARGET).cursor).toBeCloseTo(0, 4);
    expect(rabbitAt(SWEEP_MS, TARGET).done).toBe(true);
    // The downstroke is the slower half — a real swing takes the club back
    // slower than it swings through.
    expect(DOWN_FRACTION).toBeGreaterThan(0.5);
  });
});

describe('reading a trace', () => {
  it('staying with the rabbit is a perfect swing', () => {
    const t = readTrace(follow(), TARGET);
    expect(t.progress).toBeCloseTo(TARGET, 2);
    expect(t.timing).toBeGreaterThan(0.9);
    expect(Math.abs(t.face)).toBeLessThan(0.05);
    expect(t.engaged).toBe(true);
  });

  it('ignores a stray touch that never travels', () => {
    expect(readTrace([{ x: RAIL_X, y: ADDRESS_Y, t: 0 }], TARGET).engaged).toBe(false);
    expect(readTrace([], TARGET).engaged).toBe(false);
  });

  it('reads the DEEPEST point — the release is not a decision to swing shorter', () => {
    const t = readTrace(follow(TARGET), TARGET);
    // The path ends back at address, yet the progress is the turnaround.
    expect(t.progress).toBeCloseTo(TARGET, 2);
  });

  it('an under-pull is short and an over-pull runs into the headroom', () => {
    expect(readTrace(follow(TARGET, { depthScale: 0.6 }), TARGET).progress).toBeCloseTo(TARGET * 0.6, 2);
    const over = readTrace(follow(TARGET, { depthScale: 1.5 }), TARGET);
    expect(over.progress).toBeGreaterThan(TARGET);
    expect(over.progress).toBeLessThanOrEqual(MAX_PULL);
  });

  it('racing the rabbit costs tempo but not the line', () => {
    const rushed = readTrace(follow(TARGET, { tempo: 2.4 }), TARGET);
    expect(rushed.timing, `timing ${rushed.timing}`).toBeLessThan(0.6);
    // The two faults are independent, so the player is told which one they
    // actually made.
    expect(Math.abs(rushed.face)).toBeLessThan(0.05);
  });

  it('a wobble off the rail costs the face, and the SIDE survives', () => {
    const right = readTrace(follow(TARGET, { wobble: 0.09 }), TARGET);
    const left = readTrace(follow(TARGET, { wobble: -0.09 }), TARGET);
    expect(right.face).toBeGreaterThan(0.3);
    expect(left.face).toBeCloseTo(-right.face, 6);
    // ...and it does not bleed into tempo.
    expect(right.timing).toBeGreaterThan(0.9);
  });
});

describe('a trace resolves through the SHARED swing model', () => {
  it('produces the identical result the tap meter would for the same cursor', () => {
    for (const cursor of [TARGET, TARGET * 0.7, TARGET * 1.1, 0.4]) {
      const band = swing.bandFor(cursor, TARGET, swing.perfectHalf(ctx), swing.goodHalf(ctx));
      const tapPower = swing.deliveredPower(ctx, cursor, band);
      const traced = resolveTraceSwing({ progress: cursor, timing: 1, face: 0, engaged: true }, ctx);
      expect(traced.powerQuality, `cursor ${cursor}`).toBe(band);
      expect(traced.power, `cursor ${cursor}`).toBeCloseTo(tapPower, 6);
    }
  });

  it('bad tempo costs distance, but never below the floor', () => {
    const clean = resolveTraceSwing({ progress: TARGET, timing: 1, face: 0, engaged: true }, ctx);
    const lunged = resolveTraceSwing({ progress: TARGET, timing: 0, face: 0, engaged: true }, ctx);
    expect(clean.powerQuality).toBe('perfect');
    expect(lunged.power).toBeLessThan(clean.power);
    expect(lunged.powerQuality).not.toBe('perfect');
    // A lunged swing is short, not a whiff.
    expect(effectivePower({ progress: 1, timing: 0, face: 0, engaged: true })).toBeGreaterThan(0.7);
  });

  it('a face left and a face right are mirror images', () => {
    // The original drag swing's first bug: projecting the face through the
    // bar's cursor space, where the accuracy target sits near the LEFT edge,
    // made identical misses left and right come out very differently.
    const right = resolveTraceSwing({ progress: 0.9, timing: 1, face: 0.6, engaged: true }, ctx);
    const left = resolveTraceSwing({ progress: 0.9, timing: 1, face: -0.6, engaged: true }, ctx);
    expect(Math.sign(right.accuracy)).toBe(-Math.sign(left.accuracy));
    expect(Math.abs(right.accuracy)).toBeCloseTo(Math.abs(left.accuracy), 6);
  });

  it('a harder lie narrows the perfect band for a trace exactly as for a tap', () => {
    const easy: swing.SwingCtx = { ...ctx, difficultyMult: 1 };
    const hard: swing.SwingCtx = { ...ctx, difficultyMult: 0.4 };
    const off = TARGET - swing.perfectHalf(easy) * 0.9;
    const at = (c: swing.SwingCtx): string =>
      resolveTraceSwing({ progress: off, timing: 1, face: 0, engaged: true }, c).powerQuality;
    expect(at(easy)).toBe('perfect');
    expect(at(hard)).not.toBe('perfect');
  });

  it('end to end: a hand that stays with the rabbit plays a perfect shot', () => {
    const state = readTrace(follow(), TARGET);
    const result = resolveTraceSwing(state, ctx);
    expect(result.powerQuality, `progress ${state.progress.toFixed(3)} timing ${state.timing.toFixed(2)}`).toBe(
      'perfect'
    );
    expect(result.accuracyQuality).toBe('perfect');
  });

  it('end to end: an off-tempo lunge is NOT a perfect shot', () => {
    // The whole point of the control: reaching the right depth is not enough.
    const state = readTrace(follow(TARGET, { tempo: 3 }), TARGET);
    const result = resolveTraceSwing(state, ctx);
    expect(result.powerQuality, `timing ${state.timing.toFixed(2)}`).not.toBe('perfect');
  });
});
