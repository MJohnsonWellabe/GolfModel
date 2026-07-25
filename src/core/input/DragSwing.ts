/**
 * Drag-back-and-release swing — one gesture instead of three taps.
 *
 * WHY
 * ---
 * A shot currently uses two different input languages: you AIM by dragging on
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
 * WHAT IS AND IS NOT DIFFERENT
 * ----------------------------
 * ONLY the input is different. Power, the perfect/good/miss bands, the
 * accuracy-to-start-line curve and the delivered physics power all come from
 * `systems/swingModel` — the same pure functions the tap meter, the headless
 * simulator and the balance gates use. A drag swing and a tap swing of equal
 * quality produce an identical `SwingResult`, so difficulty, scoring and every
 * simulation stay exactly where they were calibrated.
 *
 * THE MAPPING
 * -----------
 *   pull DOWN from the ball    → power, as a fraction of a full backswing
 *   sideways offset at release → face angle, i.e. accuracy
 *
 * Both are read at RELEASE, so the player can settle the club before letting
 * go — the affordance the tap meter cannot offer.
 */

import * as swing from '../../systems/swingModel';
import type { Band, SwingResult } from '../types';

export interface DragSwingTuning {
  /** Screen pixels of pull that equal a full backswing. Scaled by the caller
   *  against viewport height so the gesture feels the same on any phone. */
  fullPullPx: number;
  /** Sideways pixels that equal a maximum face-angle error. */
  fullFacePx: number;
}

export const DEFAULT_TUNING: DragSwingTuning = { fullPullPx: 190, fullFacePx: 130 };

export interface DragState {
  /** 0..1 of a full backswing. */
  power: number;
  /** −1..1 face offset (positive = released right of the ball). */
  face: number;
  /** True once the pull has passed the dead zone and the swing is live. */
  engaged: boolean;
}

/** Pull below this fraction is a stray touch, not a swing. */
const DEAD_ZONE = 0.06;
/** Overswing headroom: the bar can be pulled past full, which the shared model
 *  already treats as an over-power miss. Mirrors the tap meter's bounce past 1. */
const MAX_PULL = 1.18;

/**
 * Read a live drag. `dy` is pixels pulled DOWN from where the gesture started
 * (down = back = power), `dx` pixels sideways.
 */
export function readDrag(dx: number, dy: number, tuning: DragSwingTuning = DEFAULT_TUNING): DragState {
  const power = Math.max(0, Math.min(MAX_PULL, dy / tuning.fullPullPx));
  const face = Math.max(-1, Math.min(1, dx / tuning.fullFacePx));
  return { power, face, engaged: power > DEAD_ZONE };
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

  // POWER: how close the pull landed to the shot's target power.
  const powerCursor = Math.max(0, Math.min(1, state.power));
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

/** Tuning scaled to the viewport, so the same physical gesture reads the same
 *  on a small phone and a desktop window. */
export function tuningForViewport(heightPx: number): DragSwingTuning {
  const scale = Math.max(0.7, Math.min(1.6, heightPx / 800));
  return {
    fullPullPx: Math.round(DEFAULT_TUNING.fullPullPx * scale),
    fullFacePx: Math.round(DEFAULT_TUNING.fullFacePx * scale)
  };
}
