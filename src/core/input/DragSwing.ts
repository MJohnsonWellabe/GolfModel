/**
 * Drag-back-and-release swing — one gesture instead of three taps.
 *
 * WHY
 * ---
 * A shot otherwise uses two different input languages: you AIM by dragging on
 * the hole, then you SWING by tapping a sweeping bar three times. The three-tap
 * meter is a console convention (a button and a timing bar) that arrived on
 * phones with the genre and has been the most-complained-about control in
 * mobile golf ever since. This project's own playtest history is full of
 * meter-smoothness complaints — a signal about the CONTROL, not only the frame
 * pacing that was fixed underneath it.
 *
 * Pull the club back and let go is the gesture the sport actually has. It is
 * spatial rather than temporal, so power is something you can FEEL rather than
 * something you must react to; it is one continuous motion, so it matches the
 * drag that just set the aim; and it can be adjusted right up to the moment of
 * release instead of being committed at a tap you cannot take back.
 *
 * WHAT THE FIRST VERSION GOT WRONG
 * --------------------------------
 * It was anchored on the SWING button — bottom centre — and read only the final
 * offset. On a phone that leaves perhaps 60px of travel beneath the thumb, so
 * (owner report) "you can't pull down far enough at the bottom". And because
 * only the release point was read, the stroke itself carried no information: a
 * stab and a controlled pull to the same depth were the same shot.
 *
 * This version anchors the gesture on a TRACK DOWN THE RIGHT EDGE, where a
 * phone actually has room, and reads the WHOLE PATH:
 *
 *   how DEEP you pull       → how much of a backswing you took
 *   how SMOOTHLY you pull   → how well you struck it (a stab loses distance)
 *   how STRAIGHT you pull   → the face angle, i.e. where it starts
 *
 * That is the same three-part contract the tap meter has (power / strike
 * quality / face), expressed as one motion instead of three reactions.
 *
 * WHAT IS AND IS NOT DIFFERENT
 * ----------------------------
 * ONLY the input is different. Power, the perfect/good/miss bands, the
 * accuracy-to-start-line curve and the delivered physics power all come from
 * `systems/swingModel` — the same pure functions the tap meter, the headless
 * simulator and the balance gates use. A drag swing and a tap swing that put
 * the cursor in the same place produce an identical `SwingResult`, so
 * difficulty, scoring and every simulation stay exactly where they were
 * calibrated.
 */

import * as swing from '../../systems/swingModel';
import type { Band, SwingResult } from '../types';

/** One sampled pointer position, in pixels RELATIVE TO where the pull began,
 *  with the event's timestamp. `y` grows downward, as pointer events do. */
export interface DragSample {
  x: number;
  y: number;
  t: number;
}

export interface DragSwingTuning {
  /** Vertical pixels of pull that equal a full backswing. Scaled by the caller
   *  against viewport height so the gesture feels the same on any phone. */
  fullPullPx: number;
  /** Lateral pixels of wander that equal a maximum face-angle error. */
  fullFacePx: number;
}

export const DEFAULT_TUNING: DragSwingTuning = { fullPullPx: 300, fullFacePx: 84 };

export interface DragState {
  /** 0..MAX_PULL — how deep the backswing went, as a fraction of full. */
  power: number;
  /** −1..1 face offset (positive = the stroke wandered RIGHT of the line). */
  face: number;
  /** 0..1 — how clean the pull was. 1 is one unhurried motion; 0 is a stab. */
  smoothness: number;
  /** True once the pull has passed the dead zone and the swing is live. */
  engaged: boolean;
}

/** Pull below this fraction is a stray touch, not a swing. */
const DEAD_ZONE = 0.06;
/** Overswing headroom: the pull can go past full, which the shared model
 *  already treats as an over-power miss. Mirrors the tap meter's bounce past 1. */
export const MAX_PULL = 1.18;

/**
 * Minimum span, in ms, of a velocity bin.
 *
 * Pointer events arrive every ~8-16ms and the last few px of any move are
 * quantised to whole pixels, so raw per-event velocities are dominated by
 * sampling noise rather than by the hand. Coalescing into bins of at least this
 * long measures the MOTION and not the digitiser.
 */
const BIN_MS = 24;

/** Mean relative velocity change that costs all of the smoothness score. */
const JERK_TOL = 1.1;
/** A backswing that stalls or backs up mid-pull is the clearest stab there is,
 *  so reversal is scored separately from jerk and weighted harder. */
const REVERSAL_TOL = 0.22;
/**
 * A takeaway shorter than this has no measurable shape — but it is also not a
 * backswing. Rather than guess at its quality from two noisy samples, it is
 * scored on its DURATION: a flick that reaches full depth in a fifth of this is
 * a stab by definition, whatever the samples in between happen to say.
 */
const MIN_SHAPED_MS = 110;

/** How much of the pulled depth survives the worst possible stab. Deliberately
 *  generous: the miss shows up as a band, not as a humiliation. */
const SMOOTH_FLOOR = 0.78;
/** Weight on lateral WANDER (as opposed to net drift) in the face angle. */
const WANDER_W = 0.6;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Coalesce the raw path into bins of at least `BIN_MS`, returning each bin's
 * mean downward velocity in px/ms. Bins, not events, are what the hand controls.
 */
function binVelocities(path: DragSample[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < path.length - 1) {
    const start = path[i];
    let j = i + 1;
    while (j < path.length - 1 && path[j].t - start.t < BIN_MS) j++;
    const dt = path[j].t - start.t;
    if (dt > 0) out.push((path[j].y - start.y) / dt);
    i = j;
  }
  return out;
}

/**
 * The TAKEAWAY: the part of the gesture that actually moved the club back.
 *
 * A press-and-hesitate at the start and a settle at the bottom are both normal
 * and deliberate — the whole advantage of a spatial control is that you may
 * hold and adjust before letting go — but both are motionless, so scoring them
 * as part of the stroke would read a patient player as a jerky one. Only the
 * span between leaving the ball and arriving at the deepest point is the
 * stroke.
 */
function takeaway(path: DragSample[], deepest: number): DragSample[] {
  if (deepest <= 0) return path;
  let from = 0;
  while (from < path.length - 1 && path[from].y < deepest * 0.08) from++;
  let to = from;
  while (to < path.length - 1 && path[to].y < deepest * 0.97) to++;
  return path.slice(from, to + 1);
}

/**
 * Score how cleanly the club was taken back, 0..1.
 *
 * Two separate faults, because they feel different and a player fixes them
 * differently:
 *   - JERK: the speed changing abruptly from one moment to the next. Measured
 *     as the mean absolute change in velocity between adjacent bins, relative
 *     to the pull's own average speed — so a slow deliberate pull and a quick
 *     one are held to the same STANDARD rather than the same absolute number,
 *     and a natural ease-in/ease-out is not punished the way a
 *     deviation-from-mean metric would punish it.
 *   - REVERSAL: any part of the stroke that travels back UP. A hitch in the
 *     takeaway is the stab this control has to be able to see.
 */
function smoothnessOf(whole: DragSample[], deepest: number): number {
  const path = takeaway(whole, deepest);
  const span = path.length < 2 ? 0 : path[path.length - 1].t - path[0].t;
  if (span < MIN_SHAPED_MS) return clamp(span / MIN_SHAPED_MS, 0, 1);

  const v = binVelocities(path);
  if (v.length < 2) return 1;

  let sum = 0;
  for (const x of v) sum += Math.abs(x);
  const mean = sum / v.length;
  if (mean <= 0) return 1;

  let jerk = 0;
  for (let i = 1; i < v.length; i++) jerk += Math.abs(v[i] - v[i - 1]);
  jerk = jerk / (v.length - 1) / mean;

  // Fraction of the travel spent going the wrong way.
  let back = 0;
  let total = 0;
  for (const x of v) {
    total += Math.abs(x);
    if (x < 0) back += -x;
  }
  const reversal = total > 0 ? back / total : 0;

  const penalty = clamp(jerk / JERK_TOL, 0, 1) * 0.65 + clamp(reversal / REVERSAL_TOL, 0, 1) * 0.35;
  return clamp(1 - penalty, 0, 1);
}

/**
 * Read the whole pull.
 *
 * `path` is the gesture so far, in pixels relative to where it began. It is
 * re-folded on every pointer move rather than accumulated incrementally: a
 * swing is well under a hundred samples, so the cost is nothing next to the
 * clarity of a pure function that can be handed a recorded path in a test.
 */
export function readDrag(path: DragSample[], tuning: DragSwingTuning = DEFAULT_TUNING): DragState {
  if (path.length === 0) return { power: 0, face: 0, smoothness: 1, engaged: false };

  // DEPTH — the deepest point reached, not the release point. Easing the
  // finger back up at the very end is a release, not a decision to hit it
  // shorter, and reading the last sample would make every release shave power.
  let deepest = 0;
  for (const s of path) if (s.y > deepest) deepest = s.y;
  const power = clamp(deepest / tuning.fullPullPx, 0, MAX_PULL);

  // STRAIGHTNESS — lateral offset from the line the pull started on, weighted
  // toward the end of the stroke, because the face is set by where the club is
  // when it is released rather than by where it wandered early.
  let wsum = 0;
  let drift = 0;
  for (let i = 0; i < path.length; i++) {
    const w = i + 1;
    drift += path[i].x * w;
    wsum += w;
  }
  drift /= wsum;
  // Net drift alone under-reads an S-shaped pull, whose halves cancel. `wander`
  // is the spread about that drift, so a stroke that swings both ways is still
  // a miss — it just takes its SIGN from whichever way it finished.
  let wander = 0;
  for (let i = 0; i < path.length; i++) wander += Math.abs(path[i].x - drift) * (i + 1);
  wander /= wsum;

  const last = path[path.length - 1].x;
  const magnitude = (Math.abs(drift) + WANDER_W * wander) / tuning.fullFacePx;
  const sign = drift !== 0 ? Math.sign(drift) : Math.sign(last);
  const face = clamp(sign * magnitude, -1, 1);

  return { power, face, smoothness: smoothnessOf(path, deepest), engaged: power > DEAD_ZONE };
}

/**
 * The power cursor a pull actually delivers: its depth, discounted by how
 * cleanly it was taken back.
 *
 * Exposed so the meter can draw the SAME number the shot will use — a control
 * whose displayed cursor and its result disagree is unlearnable.
 */
export function effectivePower(state: DragState): number {
  return state.power * (SMOOTH_FLOOR + (1 - SMOOTH_FLOOR) * clamp(state.smoothness, 0, 1));
}

/**
 * Turn a released drag into the SAME `SwingResult` the tap meter produces.
 *
 * `ctx` is the meter context for this shot (club/lie difficulty, the golfer's
 * zone stat, the target bar) — passed straight through to the shared model so
 * a hard lie narrows the perfect band identically on both control schemes.
 */
export function resolveDragSwing(state: DragState, ctx: swing.SwingCtx): SwingResult {
  const target = swing.targetBar(ctx);
  const pHalf = swing.perfectHalf(ctx);
  const gHalf = swing.goodHalf(ctx);

  // POWER: depth × smoothness, banded against the shot's target power. A stab
  // therefore reads SHORT of where it was pulled, which is both the honest
  // physical answer and the one the player can act on next time.
  const powerCursor = clamp(effectivePower(state), 0, 1);
  const powerQuality: Band = swing.bandFor(powerCursor, target, pHalf, gHalf);
  const power = swing.deliveredPower(ctx, powerCursor, powerQuality);

  // ACCURACY: the face offset is ALREADY a signed, normalised −1..1 miss, which
  // is precisely what the meter's `normalizedAccuracyOffset` produces from a
  // locked cursor. So it is banded and shaped directly rather than re-projected
  // onto the bar's cursor space.
  //
  // Re-projecting was the first attempt and it was wrong in a way worth
  // recording: the accuracy target sits near the LEFT edge of the bar
  // (ACCURACY_TARGET = 0.08), so the travel available to the left of it is a
  // fraction of the travel to the right. Mapping a symmetric face angle through
  // it made an identical pull-left and pull-right produce very different misses
  // — a right-handed bias nobody would have found by playing.
  //
  // The band half-widths are fractions of the BAR, so they are converted to
  // fractions of the available accuracy travel before comparing.
  const travel = 1 - swing.ACCURACY_TARGET;
  const faceMiss = Math.abs(state.face);
  const accuracyQuality: Band =
    faceMiss <= pHalf / travel ? 'perfect' : faceMiss <= gHalf / travel ? 'good' : 'miss';
  // Player-meter convention: a face released RIGHT of the ball starts it LEFT
  // (the clubface over-corrects), so the sign is flipped exactly as
  // `accuracyOffsetSigned` does for a cursor.
  const accuracy = accuracyQuality === 'perfect' ? 0 : swing.shapeAccuracyOffset(-state.face);

  return { power, powerQuality, accuracy, accuracyQuality };
}

/**
 * Tuning scaled to the viewport, so the same physical gesture reads the same on
 * a small phone and a desktop window.
 *
 * The pull is a FRACTION OF SCREEN HEIGHT rather than a fixed pixel count —
 * that is the whole point of moving it to the right edge — and it is bounded so
 * a very tall window does not demand an arm's length and a very short one still
 * has meaningful resolution.
 */
export function tuningForViewport(heightPx: number): DragSwingTuning {
  return {
    fullPullPx: Math.round(clamp(heightPx * 0.42, 170, 430)),
    fullFacePx: Math.round(clamp(heightPx * 0.1, 52, 120))
  };
}

/**
 * Where the pull TRACK sits, as fractions of the viewport.
 *
 * The grip pad is placed high enough that a full backswing — plus the overswing
 * headroom — always fits between it and the bottom of the screen, which is the
 * failure the first version shipped with. Returned as data so the layout and
 * its gate read the same numbers.
 */
export function trackLayout(heightPx: number): { gripTopPx: number; gripHeightPx: number; travelPx: number } {
  const travel = tuningForViewport(heightPx).fullPullPx * MAX_PULL;
  const gripHeight = Math.round(clamp(heightPx * 0.14, 84, 150));
  // The whole travel must fit BELOW the grip — that is the bug this control
  // shipped with — so the grip is pushed up until it does, and never sits lower
  // than a third of the way down however much room there is.
  const gripTop = clamp(heightPx - travel - gripHeight, 0, heightPx * 0.34);
  return { gripTopPx: Math.round(gripTop), gripHeightPx: gripHeight, travelPx: Math.round(travel) };
}
