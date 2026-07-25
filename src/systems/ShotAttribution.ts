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
  kind: 'strike' | 'wind' | 'lie' | 'spin' | 'slope';
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
/** Below this, the ground is flat enough that saying so is noise. */
const MIN_CLIMB_FT = 8;

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
  actualFinal: Point,
  /**
   * Re-seed the engine's randomness to the state the ACTUAL shot resolved from.
   *
   * Without this the whole method is broken, and quietly: `resolveLaunch` draws
   * from the random stream (carry noise, lie noise, residual dispersion), so
   * every counterfactual re-flew the shot with FRESH noise. The difference then
   * measured "the factor, plus a new roll of the dice" — which is how a dead-calm
   * shot came to report "wind took 6 yd" and a tee shot "tee cost 11 yd".
   *
   * With the stream reset before each re-fly, the only thing that differs is the
   * factor being removed, which is what the counterfactual claimed to be all
   * along. Optional so a caller with a deterministic engine can omit it.
   */
  reseed?: () => void
): ShotAttribution {
  const origin = params.origin;
  const actual = distanceYd(origin, actualFinal);

  const flyTo = (over: Partial<ShotParams>, withSpin: SpinState = spin): Point => {
    try {
      reseed?.();
      const launch: ResolvedLaunch = engine.resolveLaunch({ ...params, ...over });
      return engine.integrateLaunch(launch, withSpin, 0).finalPos;
    } catch {
      return actualFinal; // a counterfactual that will not resolve simply says nothing
    }
  };
  const fly = (over: Partial<ShotParams>): number => distanceYd(origin, flyTo(over));

  // BASELINE: the same shot re-flown with nothing removed.
  //
  // Every factor is measured against this rather than against the live result,
  // so the comparison is counterfactual-to-counterfactual and the two travel the
  // same code path. The live outcome can differ from a re-fly for reasons that
  // are not a "factor" at all — an in-flight swipe applied from a later playback
  // step, for one — and charging that difference to the wind would be a lie.
  // `actual` is still what gets REPORTED as the distance; it is what happened.
  const baseline = fly({});

  const cleanPoint = flyTo({
    swing: { ...params.swing, accuracy: 0, powerQuality: 'perfect', accuracyQuality: 'perfect' }
  });
  const clean = distanceYd(origin, cleanPoint);
  const noWind = fly({ wind: { ...params.wind, speed: 0 } });
  const goodLie: Surface = 'fairway';
  const fromFairway = params.lie === goodLie ? baseline : fly({ lie: goodLie });

  // Sideways miss, measured perpendicular to the aim line the player actually
  // set — the number that explains "why is it over there" rather than "why is
  // it short".
  const ax = Math.cos(params.aimAngle);
  const ay = Math.sin(params.aimAngle);
  const lateralOf = (p: Point): number => ((p.x - origin.x) * ay - (p.y - origin.y) * ax) / PX_PER_YARD;
  const lateralYd = lateralOf(actualFinal);

  const factors: AttributionFactor[] = [];

  // STRIKE — the part that was the player's execution.
  //
  // Measured on BOTH axes, because a mis-hit usually costs accuracy rather than
  // distance: the bands mainly drive dispersion. Reporting only the distance
  // delta meant a shot that leaked 20 yards right got no cause at all — the
  // player saw "20 yd right" and no explanation, which is exactly the "I do not
  // know what happened" this feature exists to prevent.
  const strike = clean - baseline;
  const strikePush = lateralYd - lateralOf(cleanPoint);
  if (Math.abs(strike) >= MIN_YARDS) {
    factors.push({
      kind: 'strike',
      yards: strike,
      label: strike > 0 ? `strike cost ${Math.round(strike)} yd` : `caught it ${Math.round(-strike)} yd extra`
    });
  } else if (Math.abs(strikePush) >= MIN_LATERAL) {
    factors.push({
      kind: 'strike',
      yards: 0,
      label: `strike pushed it ${Math.round(Math.abs(strikePush))} yd ${strikePush > 0 ? 'right' : 'left'}`
    });
  }
  const wind = noWind - baseline;
  if (Math.abs(wind) >= MIN_YARDS) {
    factors.push({
      kind: 'wind',
      yards: wind,
      label: wind > 0 ? `wind took ${Math.round(wind)} yd` : `wind gave ${Math.round(-wind)} yd`
    });
  }
  const lie = fromFairway - baseline;
  if (params.lie !== goodLie && Math.abs(lie) >= MIN_YARDS) {
    factors.push({ kind: 'lie', yards: lie, label: `${params.lie} cost ${Math.round(Math.abs(lie))} yd` });
  }

  // SPIN. The player shaped this shot deliberately (strike pad) or worked it in
  // the air (swipe), and until now the breakdown never said what that did. The
  // counterfactual is the same shot hit dead straight: the sideways difference
  // is the shape, the distance difference is what top/back spin cost or bought.
  const shaped = Math.abs(spin.side) > 0.01 || Math.abs(spin.top) > 0.01 ||
    Math.abs(params.spin?.side ?? 0) > 0.01 || Math.abs(params.spin?.top ?? 0) > 0.01;
  if (shaped) {
    const flat = flyTo({ spin: { side: 0, top: 0 } }, { side: 0, top: 0 });
    const curve = lateralYd - lateralOf(flat);
    const spinYards = distanceYd(origin, flat) - baseline;
    if (Math.abs(curve) >= MIN_LATERAL) {
      factors.push({
        kind: 'spin',
        yards: spinYards,
        label: `${curve > 0 ? 'fade' : 'draw'} moved it ${Math.round(Math.abs(curve))} yd`
      });
    } else if (Math.abs(spinYards) >= MIN_YARDS) {
      factors.push({
        kind: 'spin',
        yards: spinYards,
        label: spinYards > 0 ? `spin cost ${Math.round(spinYards)} yd` : `spin ran ${Math.round(-spinYards)} yd`
      });
    }
  }

  // SLOPE. Not a counterfactual — the engine's terrain cannot be removed from
  // under a shot without rebuilding it — but the honest number the player wants
  // is simply how much the ground moved between where they hit from and where
  // it finished. Reported in FEET, because that is how golfers read elevation,
  // and the world's vertical unit is ~1.25 ft.
  const climbFt = (engine.groundAt(actualFinal.x, actualFinal.y) - engine.groundAt(origin.x, origin.y)) * 1.25;
  if (Math.abs(climbFt) >= MIN_CLIMB_FT) {
    factors.push({
      kind: 'slope',
      yards: 0,
      label: `${Math.round(Math.abs(climbFt))} ft ${climbFt > 0 ? 'uphill' : 'downhill'}`
    });
  }

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
