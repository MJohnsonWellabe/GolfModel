/**
 * THE TRACED SWING — follow the club, don't just yank it.
 *
 * WHY THIS REPLACES THE PULL
 * --------------------------
 * The previous drag swing asked one question — how far back did you pull, and
 * how tidily — which a player answers correctly on their third attempt and then
 * never thinks about again. A golf swing is not a distance; it is a PATH taken
 * at a TEMPO, and both are things you can be good at.
 *
 * So the control is a rectangle with a guide dot travelling a route through it,
 * and the gesture is to follow that dot. Three things are then measurable, and
 * every one of them is a thing a real golfer would recognise:
 *
 *   how far along the route you got   → the length of the backswing
 *   how close to the line you stayed  → the strike, and the face
 *   how well you kept the dot's tempo → the timing
 *
 * WHAT IT FEEDS
 * -------------
 * The same `SwingResult` (power / powerQuality / accuracy / accuracyQuality)
 * the tap meter produces, resolved through the same `systems/swingModel`. So a
 * traced swing and a tapped swing of equal quality produce an identical shot,
 * and difficulty, scoring, recordings, replays and every headless simulation
 * stay exactly where they were calibrated. The control changes; the game does
 * not.
 *
 * WHY THE ROUTE IS AN ARC AND NOT A STRAIGHT LINE
 * -----------------------------------------------
 * A straight line is traced perfectly by resting a thumb against the edge of
 * the phone, which is not a skill. The route curves back and through, the way a
 * club does, so staying on it needs attention the whole way — and the deviation
 * that costs you is the same deviation that would open or close a clubface.
 */

import * as swing from '../../systems/swingModel';
import type { Band, SwingResult } from '../types';

/** One sampled point of the player's gesture, in NORMALISED pad space. */
export interface TraceSample {
  /** 0..1 across the pad, left to right. */
  x: number;
  /** 0..1 down the pad, top to bottom. */
  y: number;
  /** Milliseconds since the gesture began. */
  t: number;
}

/** A point on the guide route, in the same normalised pad space. */
export interface RoutePoint {
  x: number;
  y: number;
  /** Distance along the route, 0..1 — what the guide dot's progress means. */
  s: number;
}

export interface TraceState {
  /** 0..1 — how far along the route the gesture reached. The backswing. */
  progress: number;
  /** 0..1 — 1 is dead on the line. */
  accuracy: number;
  /** 0..1 — 1 is in perfect time with the guide dot. */
  timing: number;
  /**
   * Signed average deviation, −1 (inside the arc) .. 1 (outside it). This is
   * the FACE: cutting the corner and drifting wide are different misses and a
   * golfer feels them differently, so the sign is kept rather than squared away.
   */
  face: number;
  /** True once the gesture is far enough along to be a swing at all. */
  engaged: boolean;
}

/** Below this the player barely moved — a stray touch, not a swing. */
const DEAD_ZONE = 0.08;

/**
 * Deviation, as a fraction of the pad, that costs ALL of the accuracy score.
 *
 * Generous on purpose: this control is played with a thumb on glass, and the
 * difference between a good player and a great one should live in the last
 * fifth of the range rather than in whether they can hold a line at all.
 */
const FULL_MISS = 0.12;

/** Timing error, as a fraction of the total sweep, that costs all of the
 *  timing score. A fifth of the swing out of step is a lunge. */
const FULL_LATE = 0.22;

/** How much of the pulled distance survives a total loss of timing. A badly
 *  timed swing is short, not a whiff. */
const TIMING_FLOOR = 0.8;

/** How long the guide dot takes to travel the whole route, ms. Slow enough to
 *  follow, quick enough that a round does not become a chore. */
export const SWEEP_MS = 1150;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The guide route: the arc a club head takes, seen face-on.
 *
 * Starts low on the RIGHT (address), sweeps up over the top (the backswing) and
 * finishes low on the LEFT (through impact). One continuous arc — which reads
 * as a swing, spans the whole pad, and cannot be traced by resting a thumb
 * against a straight edge, which a line could be.
 *
 * The start matters as much as the shape: an earlier version began in the
 * MIDDLE of the pad, so a stray touch near the bottom landed close to the far
 * end of the route and registered as most of a backswing.
 */
export function guideRoute(steps = 48): RoutePoint[] {
  const pts: Array<{ x: number; y: number }> = [];
  const FROM = 0.11 * Math.PI; // 20°, low right
  const TO = 0.89 * Math.PI; // 160°, low left
  for (let i = 0; i <= steps; i++) {
    const a = FROM + (TO - FROM) * (i / steps);
    pts.push({ x: 0.5 + Math.cos(a) * 0.42, y: 0.95 - Math.sin(a) * 0.72 });
  }
  // Arc-length parameterise, so the dot moves at a CONSTANT speed. Without this
  // it hurries through the curve's tight part, and a player who followed it
  // faithfully would be told their timing was poor.
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  return pts.map((p, i) => ({ ...p, s: total > 0 ? cum[i] / total : 0 }));
}

/** Where the guide dot is at `ms` into the sweep. */
export function guideAt(route: RoutePoint[], ms: number): { x: number; y: number; s: number } {
  const s = clamp(ms / SWEEP_MS, 0, 1);
  return pointAt(route, s);
}

/** The route point at arc-length fraction `s`, linearly interpolated. */
export function pointAt(route: RoutePoint[], s: number): { x: number; y: number; s: number } {
  const t = clamp(s, 0, 1);
  for (let i = 1; i < route.length; i++) {
    if (route[i].s >= t) {
      const a = route[i - 1];
      const b = route[i];
      const span = b.s - a.s || 1;
      const k = (t - a.s) / span;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: t };
    }
  }
  const last = route[route.length - 1];
  return { x: last.x, y: last.y, s: t };
}

/**
 * Nearest point on the route to (x, y): its arc-length, and the SIGNED
 * perpendicular distance — positive when the gesture is outside the arc.
 *
 * Projected onto the SEGMENTS rather than measured to the nearest vertex. A
 * vertex measurement overstates the distance to a curve by up to half the
 * vertex spacing, and — worse — the sign of that phantom error is arbitrary, so
 * a gesture that followed the route exactly came out with a small systematic
 * face on it. The control would have had a permanent, invisible push.
 */
function nearest(route: RoutePoint[], x: number, y: number): { s: number; signed: number } {
  let bestD = Infinity;
  let bestS = 0;
  let bestSign = 1;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const k = len2 > 0 ? clamp(((x - a.x) * vx + (y - a.y) * vy) / len2, 0, 1) : 0;
    const px = a.x + vx * k;
    const py = a.y + vy * k;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      bestS = a.s + (b.s - a.s) * k;
      // Which side of the route's local direction the point falls on, so
      // cutting the corner and drifting wide are told apart.
      bestSign = vx * (y - a.y) - vy * (x - a.x) >= 0 ? 1 : -1;
    }
  }
  return { s: bestS, signed: bestD * bestSign };
}

/**
 * Read a traced gesture.
 *
 * `path` is the whole stroke in normalised pad space, and it is read as a
 * whole: a control that scores only the release point cannot tell a swing from
 * a flick, which is the lesson the previous version taught.
 */
export function readTrace(path: TraceSample[], route: RoutePoint[] = guideRoute()): TraceState {
  if (path.length < 2) return { progress: 0, accuracy: 1, timing: 1, face: 0, engaged: false };

  let progress = 0;
  let devSum = 0;
  let signedSum = 0;
  let lateSum = 0;
  let n = 0;

  for (const p of path) {
    const near = nearest(route, p.x, p.y);
    // Progress is the FURTHEST point reached, not the last: easing off at the
    // end of the stroke is a release, not a decision to swing shorter.
    if (near.s > progress) progress = near.s;
    devSum += Math.abs(near.signed);
    signedSum += near.signed;
    // Timing: where the guide dot was at this instant versus where the finger
    // actually is, along the same route.
    lateSum += Math.abs(near.s - clamp(p.t / SWEEP_MS, 0, 1));
    n++;
  }

  const meanDev = devSum / n;
  const meanLate = lateSum / n;
  return {
    progress,
    accuracy: clamp(1 - meanDev / FULL_MISS, 0, 1),
    timing: clamp(1 - meanLate / FULL_LATE, 0, 1),
    face: clamp(signedSum / n / FULL_MISS, -1, 1),
    engaged: progress > DEAD_ZONE
  };
}

/**
 * The power cursor a trace delivers: how far you took it back, discounted by
 * how well you kept time.
 *
 * Exposed so the pad can draw the SAME number the shot will use — a control
 * whose displayed power and its result disagree cannot be learned from.
 */
export function effectivePower(state: TraceState): number {
  return state.progress * (TIMING_FLOOR + (1 - TIMING_FLOOR) * clamp(state.timing, 0, 1));
}

/**
 * Turn a released trace into the SAME `SwingResult` the tap meter produces.
 */
export function resolveTraceSwing(state: TraceState, ctx: swing.SwingCtx): SwingResult {
  const target = swing.targetBar(ctx);
  const pHalf = swing.perfectHalf(ctx);
  const gHalf = swing.goodHalf(ctx);

  const powerCursor = clamp(effectivePower(state), 0, 1);
  const powerQuality: Band = swing.bandFor(powerCursor, target, pHalf, gHalf);
  const power = swing.deliveredPower(ctx, powerCursor, powerQuality);

  // The face offset is ALREADY a signed, normalised −1..1 miss — the same thing
  // the meter's locked accuracy cursor produces — so it is banded and shaped
  // directly rather than re-projected onto the bar's cursor space. (Projecting
  // it was the drag swing's first bug: the accuracy target sits near the bar's
  // left edge, so an identical miss left and right came out very differently.)
  const travel = 1 - swing.ACCURACY_TARGET;
  const faceMiss = Math.abs(state.face);
  const accuracyQuality: Band =
    faceMiss <= pHalf / travel ? 'perfect' : faceMiss <= gHalf / travel ? 'good' : 'miss';
  // Player-meter convention: a face released RIGHT starts the ball LEFT.
  const accuracy = accuracyQuality === 'perfect' ? 0 : swing.shapeAccuracyOffset(-state.face);

  return { power, powerQuality, accuracy, accuracyQuality };
}
