import { ClubSpec, HoleData, SpinState, TrajectoryPoint, Wind } from '../core/types';
import { ShotContext } from '../core/input/AimControl';
import { PhysicsEngine } from './PhysicsEngine';

/**
 * True Vision: reveals the REAL flight/roll of the shot the player is
 * CURRENTLY AIMED AT — not a solved "ideal" line. Uses the real, slope- and
 * wind-aware engine (the caller's `engine2d`), NOT the flat, zero-wind
 * preview engine the ordinary white aim guide deliberately uses (see
 * AimControl.computePreview: "the aim line NEVER accounts for wind or
 * slope" — True Vision is the one place meant to break that rule and show
 * the truth). A single deterministic `simulate({..., preview: true})` at the
 * player's current aim angle/power zeroes all randomness (lie noise, pace
 * noise, direction dispersion, lip-out deflection), so the same aim always
 * reveals the same path — but the path itself is exactly where THIS aim
 * sends the ball, dots and all, wherever it ends up. No root-finding, no
 * snapping to the hole.
 */
export interface TrueVisionShot {
  aimAngle: number;
  /** Physics power units (already converted from the swing-bar fraction). */
  power: number;
  club: ClubSpec;
  wind: Wind;
  spin?: SpinState;
  launchMult?: number;
}

export function computeTrueVisionPath(
  engine: PhysicsEngine,
  hole: HoleData,
  ctx: ShotContext,
  shot: TrueVisionShot
): TrajectoryPoint[] {
  const outcome = engine.simulate({
    origin: ctx.ball,
    aimAngle: shot.aimAngle,
    swing: { power: shot.power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
    club: shot.club,
    golfer: ctx.golfer,
    fireBoost: ctx.fireBoost,
    lie: ctx.lie,
    wind: shot.wind,
    hole,
    preview: true,
    spin: shot.spin ?? { side: 0, top: 0 },
    launchMult: shot.launchMult ?? 1,
    stroke: ctx.strokes
  });
  return outcome.path;
}
