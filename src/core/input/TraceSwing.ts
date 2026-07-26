/**
 * THE TEMPO TRACE — follow the rabbit straight down, then straight back up.
 *
 * WHY THIS SHAPE (owner spec, EA-Sports style)
 * --------------------------------------------
 * The arc route was clever and wrong: a swing gesture on a phone is a THUMB
 * gesture, and a thumb's natural travel is straight up and down the edge of
 * the screen. So the control is a tall rectangle on the right, a vertical
 * rail, and a guide dot — the rabbit — that runs straight DOWN to this club's
 * pull depth and straight back UP through impact, at an unhurried, constant
 * tempo. The player's whole job is to stay with it:
 *
 *   how deep you actually went     → the backswing (power, vs the club's target)
 *   how well you stayed WITH the   → the strike (tempo — ahead of the rabbit is
 *     rabbit in time                  a lunge, behind it is a decel)
 *   how straight you kept the line → the face (lateral wobble off the rail)
 *
 * Track the tempo and the path and you have hit a perfect shot — which is the
 * whole promise: the skill is rhythm, not reaction.
 *
 * WHAT IT FEEDS
 * -------------
 * The same `SwingResult` the tap meter produces, resolved through the same
 * `systems/swingModel`, so a traced swing and a tapped swing that put the
 * cursor in the same place produce an identical shot. Difficulty, scoring,
 * recording, replay and every headless simulation stay exactly where they
 * were calibrated. Only the input changes.
 */

import * as swing from '../../systems/swingModel';
import type { Band, SwingResult } from '../types';

/** One sampled point of the gesture, in NORMALISED pad space (0..1 each way,
 *  y grows downward), stamped ms since the gesture began. */
export interface TraceSample {
  x: number;
  y: number;
  t: number;
}

export interface TraceState {
  /** 0..MAX_PULL — the deepest point reached, as a power cursor. */
  progress: number;
  /** 0..1 — how well the finger stayed WITH the rabbit. 1 = locked on. */
  timing: number;
  /** Signed lateral wobble, −1 (left of the rail) .. 1 (right of it). */
  face: number;
  /** True once the pull is deep enough to be a swing at all. */
  engaged: boolean;
}

/**
 * THE RAIL'S GEOMETRY, in pad space.
 *
 * The rabbit starts at ADDRESS_Y (the top of the stroke), and FULL_Y is a
 * 100% backswing; the club's target depth lands proportionally between them.
 * Data, not layout — the pad draws from these numbers and the reader scores
 * against them, so they cannot drift apart.
 */
export const RAIL_X = 0.5;
export const ADDRESS_Y = 0.1;
export const FULL_Y = 0.88;

/** Below this fraction of a full pull the touch is a stray, not a swing. */
const DEAD_ZONE = 0.06;
/** Overswing headroom past the club's target — same convention as the meter's
 *  bounce past 1; the shared model treats it as an over-power miss. */
export const MAX_PULL = 1.18;

/**
 * Lateral wobble, as a fraction of the pad's width, that costs the whole face.
 * A thumb on glass wobbles a little by physiology; the skill band lives above
 * that, not inside it. Tuned for the SLIM pad (~84 px): the fraction is larger
 * than the wide pad needed so the same physical wobble in millimetres costs
 * the same face.
 */
const FULL_MISS = 0.24;
/** Mean tempo error, in power-cursor units, that costs all of the timing. */
const FULL_OFF_TEMPO = 0.3;
/** How much of the pulled depth survives a total loss of tempo. A lunged
 *  swing is short, not a whiff. */
const TIMING_FLOOR = 0.8;

/** The rabbit's full trip, ms: down (backswing) then up (through). Slow enough
 *  to stay with, quick enough that a round keeps its pace. */
export const SWEEP_MS = 1400;
/** A real swing takes the club back slower than it swings through. */
export const DOWN_FRACTION = 0.55;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A power cursor (0..1 of a FULL pull) → the rail y it sits at. */
export function railY(cursor: number): number {
  return ADDRESS_Y + (FULL_Y - ADDRESS_Y) * clamp(cursor, 0, MAX_PULL);
}

/** A rail y → the power cursor it means. */
export function cursorAt(y: number): number {
  return clamp((y - ADDRESS_Y) / (FULL_Y - ADDRESS_Y), 0, MAX_PULL);
}

/**
 * Where the rabbit is, `ms` into the sweep, for a club whose target depth is
 * `target` (the shared model's `targetBar`).
 *
 * Down to the TARGET — not to the bottom — then back up through the address to
 * a short follow-through. The rabbit demonstrates the correct swing for THIS
 * club, so tracking it exactly is, by construction, a perfect shot.
 */
export function rabbitAt(ms: number, target: number): { y: number; cursor: number; done: boolean } {
  const downMs = SWEEP_MS * DOWN_FRACTION;
  const upMs = SWEEP_MS - downMs;
  const t = clamp(ms, 0, SWEEP_MS);
  if (t <= downMs) {
    const k = t / downMs;
    const cursor = target * k;
    return { y: railY(cursor), cursor, done: false };
  }
  const k = (t - downMs) / upMs;
  const cursor = target * (1 - k);
  return { y: railY(Math.max(0, cursor)), cursor, done: ms >= SWEEP_MS };
}

/**
 * Read the whole traced gesture against the rabbit it was chasing.
 *
 * The path is read as a whole — a control that scores only the release point
 * cannot tell a swing from a flick, which is the lesson every previous version
 * of this control taught the hard way.
 */
export function readTrace(path: TraceSample[], target = 0.9): TraceState {
  if (path.length < 2) return { progress: 0, timing: 1, face: 0, engaged: false };

  let deepest = 0;
  let offTempo = 0;
  let wobble = 0;
  let n = 0;
  for (const p of path) {
    const cur = cursorAt(p.y);
    if (cur > deepest) deepest = cur;
    // TEMPO: where the rabbit was at this instant vs where the finger is, in
    // power-cursor units so a deep club and a chip are held to the same
    // standard. Ahead of the rabbit is a lunge; behind it is a decel; both are
    // the same fault — not being WITH it.
    const rabbit = rabbitAt(p.t, target);
    offTempo += Math.abs(cur - rabbit.cursor);
    // FACE: signed wobble off the rail. Straight back and straight through is
    // the whole path skill, so the mean keeps its sign — a bowed-right stroke
    // and a bowed-left one are different misses.
    wobble += p.x - RAIL_X;
    n++;
  }

  const meanOff = offTempo / n;
  const meanWobble = wobble / n;
  // Depth may exceed the target (overswing) up to the same headroom the meter
  // allows; the shared model turns that into an over-power miss.
  const progress = clamp(deepest, 0, MAX_PULL);
  return {
    progress,
    timing: clamp(1 - meanOff / FULL_OFF_TEMPO, 0, 1),
    face: clamp(meanWobble / FULL_MISS, -1, 1),
    engaged: progress > DEAD_ZONE
  };
}

/**
 * The power cursor a trace delivers: the depth you reached, discounted by how
 * far you fell out of tempo. Exposed so the pad can draw the SAME number the
 * shot will use — a readout that disagrees with its result cannot be learned
 * from.
 */
export function effectivePower(state: TraceState): number {
  return state.progress * (TIMING_FLOOR + (1 - TIMING_FLOOR) * clamp(state.timing, 0, 1));
}

/** Turn a released trace into the SAME `SwingResult` the tap meter produces. */
export function resolveTraceSwing(state: TraceState, ctx: swing.SwingCtx): SwingResult {
  const target = swing.targetBar(ctx);
  const pHalf = swing.perfectHalf(ctx);
  const gHalf = swing.goodHalf(ctx);

  const powerCursor = clamp(effectivePower(state), 0, 1);
  const powerQuality: Band = swing.bandFor(powerCursor, target, pHalf, gHalf);
  const power = swing.deliveredPower(ctx, powerCursor, powerQuality);
  // The felt direction of the pull: past the rabbit's turnaround is an
  // overswing, whatever the tempo discount later delivers.
  const overswung = state.progress > target;

  // The face is ALREADY a signed, normalised −1..1 miss — exactly what the
  // meter's locked accuracy cursor produces — so it is banded and shaped
  // directly rather than re-projected onto the bar's cursor space. (Projecting
  // was the original drag swing's first bug: the accuracy target sits near the
  // bar's left edge, so an identical miss left and right came out different.)
  const travel = 1 - swing.ACCURACY_TARGET;
  const faceMiss = Math.abs(state.face);
  const accuracyQuality: Band =
    faceMiss <= pHalf / travel ? 'perfect' : faceMiss <= gHalf / travel ? 'good' : 'miss';
  // Player-meter convention: a face released RIGHT starts the ball LEFT.
  const accuracy = accuracyQuality === 'perfect' ? 0 : swing.shapeAccuracyOffset(-state.face);

  return { power, powerQuality, accuracy, accuracyQuality, overswung };
}
