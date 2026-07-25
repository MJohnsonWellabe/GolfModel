/**
 * "Why did that happen?" — the shot, broken into the things that produced it.
 *
 * THE PROBLEM
 * -----------
 * `docs/vision/03_PLAYER_EXPERIENCE.md` sets the bar: the player should think
 * "I can do that better", not "I do not know what happened". Today the game
 * tells them the RESULT (`142 yd to the hole`) and nothing about the CAUSE. A
 * new player who does not know the wind pushed them 9 yards short reads their
 * own miss as the game being random — and that is the single most common reason
 * people quit a golf game.
 *
 * THE APPROACH
 * ------------
 * Not estimates: COUNTERFACTUALS. The physics is pure, so the same shot can be
 * re-flown with one factor removed and the difference measured exactly.
 *
 *   - strike:    what a clean strike would have done (perfect bands, no
 *                accuracy offset) — the part that was the player's execution
 *   - wind:      the same shot in dead air
 *   - lie:       the same shot from a clean fairway lie
 *
 * Each is one extra integration of an already-resolved launch — microseconds of
 * arithmetic. It runs when the ball comes to REST, never on the tap path, in
 * line with the performance gates.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not tell the player what to do next, and it does not editorialise
 * about whether the shot was good. It reports what happened and lets them draw
 * the conclusion — a coach, not a commentator.
 */

import type { PhysicsEngine, ResolvedLaunch, ShotParams } from './PhysicsEngine';
import type { Point, SpinState, Surface } from '../core/types';
import { PX_PER_YARD } from '../config';

export interface AttributionFactor {
  kind: 'strike' | 'wind' | 'lie';
  /** Yards the factor cost (positive) or gained (negative) versus the ideal. */
  yards: number;
  /** Human-readable line, already phrased for display. */
  label: string;
}

export interface ShotAttribution {
  /** Actual carry+roll distance, yards. */
  distanceYd: number;
  /** Sideways miss from the aim line at rest, yards (positive = right). */
  lateralYd: number;
  factors: AttributionFactor[];
  /** One-line summary, or '' when nothing was worth saying. */
  summary: string;
}

/** Below this, a factor is noise and saying it would be worse than silence. */
const MIN_YARDS = 4;
/** Below this, a sideways miss is not worth naming. */
const MIN_LATERAL = 5;

function distanceYd(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y) / PX_PER_YARD;
}

/**
 * Break a shot down. `params` must be the EXACT parameters the live shot used,
 * so the counterfactuals differ from it in one variable only.
 */
export function attributeShot(
  engine: PhysicsEngine,
  params: ShotParams,
  spin: SpinState,
  actualFinal: Point
): ShotAttribution {
  const origin = params.origin;
  const actual = distanceYd(origin, actualFinal);

  const fly = (over: Partial<ShotParams>): number => {
    try {
      const launch: ResolvedLaunch = engine.resolveLaunch({ ...params, ...over });
      const out = engine.integrateLaunch(launch, spin, 0);
      return distanceYd(origin, out.finalPos);
    } catch {
      return actual; // a counterfactual that will not resolve simply says nothing
    }
  };

  const clean = fly({
    swing: { ...params.swing, accuracy: 0, powerQuality: 'perfect', accuracyQuality: 'perfect' }
  });
  const noWind = fly({ wind: { ...params.wind, speed: 0 } });
  const goodLie: Surface = 'fairway';
  const fromFairway = params.lie === goodLie ? actual : fly({ lie: goodLie });

  const factors: AttributionFactor[] = [];
  const strike = clean - actual;
  if (Math.abs(strike) >= MIN_YARDS) {
    factors.push({
      kind: 'strike',
      yards: strike,
      label: strike > 0 ? `strike cost ${Math.round(strike)} yd` : `caught it ${Math.round(-strike)} yd extra`
    });
  }
  const wind = noWind - actual;
  if (Math.abs(wind) >= MIN_YARDS) {
    factors.push({
      kind: 'wind',
      yards: wind,
      label: wind > 0 ? `wind took ${Math.round(wind)} yd` : `wind gave ${Math.round(-wind)} yd`
    });
  }
  const lie = fromFairway - actual;
  if (params.lie !== goodLie && Math.abs(lie) >= MIN_YARDS) {
    factors.push({ kind: 'lie', yards: lie, label: `${params.lie} cost ${Math.round(Math.abs(lie))} yd` });
  }

  // Sideways miss, measured perpendicular to the aim line the player actually
  // set — the number that explains "why is it over there" rather than "why is
  // it short".
  const ax = Math.cos(params.aimAngle);
  const ay = Math.sin(params.aimAngle);
  const dx = actualFinal.x - origin.x;
  const dy = actualFinal.y - origin.y;
  const lateralYd = (dx * ay - dy * ax) / PX_PER_YARD;

  const parts = factors.map((f) => f.label);
  if (Math.abs(lateralYd) >= MIN_LATERAL) {
    parts.push(`${Math.round(Math.abs(lateralYd))} yd ${lateralYd > 0 ? 'right' : 'left'}`);
  }
  return {
    distanceYd: actual,
    lateralYd,
    factors,
    summary: parts.length ? parts.join(' · ') : ''
  };
}
