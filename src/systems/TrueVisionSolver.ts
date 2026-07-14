import { PHYSICS, PX_PER_YARD } from '../config';
import { clubById } from '../data/clubs';
import { angleTo, dist } from '../utils/Geometry';
import { Golfer, HoleData, Point, TrajectoryPoint } from '../core/types';
import { effectiveCarryYards, PhysicsEngine } from './PhysicsEngine';

/**
 * True Vision: solves the AIM ANGLE that sends a perfectly-paced putt into
 * the hole, given the green's real slope/break — the season-pass consumable
 * reveals this as a red dashed line. Deliberately uses the REAL engine (the
 * caller's `engine2d`, which carries actual slope/heightfield), NOT the flat
 * preview engine the ordinary white aim line uses — that flat-engine choice
 * is intentional everywhere else in the codebase ("the aim line NEVER
 * accounts for wind or slope"); True Vision is the one place meant to break
 * that rule and show the truth.
 *
 * Pace convention: fixed at a perfect flat-green putt struck at the ball→pin
 * distance (mirrors AimControl.resetAim's default putt aim) — no slope
 * compensation on PACE, only on the angle. The player still has to judge
 * distance themselves; only the LINE is revealed.
 *
 * `simulate({..., preview: true})` zeroes all randomness (pace noise,
 * direction dispersion, lip-out deflection), so outcome is a pure function of
 * `aimAngle` alone — exactly what a numeric root-find needs. Cup-capture
 * logic itself is unaffected by `preview`, so `outcome.holed` is a reliable,
 * deterministic success signal.
 */

/** How far off dead-straight the solver is allowed to aim, radians. */
const SEARCH_CONE = Math.PI / 6; // ±30°
/** Fixed angular probe used to bootstrap the secant method's second point. */
const PROBE_STEP = 0.03; // ~1.7°
const MAX_ITERATIONS = 6;

function closestApproach(path: TrajectoryPoint[], pin: Point): { point: TrajectoryPoint; dist: number } {
  let best: TrajectoryPoint = path[0] ?? { x: pin.x, y: pin.y, z: 0 };
  let bestDist = Infinity;
  for (const p of path) {
    const d = Math.hypot(p.x - pin.x, p.y - pin.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { point: best, dist: bestDist };
}

/** Signed lateral offset of `point` from the pin, relative to the straight
 *  ball→pin line — the secant method's root-find signal. Sign/magnitude only
 *  need to vary continuously with aim angle; the actual sign convention is
 *  irrelevant to convergence. */
function signedLateral(point: Point, ball: Point, pin: Point): number {
  const baseAngle = angleTo(ball, pin);
  const perpX = -Math.sin(baseAngle);
  const perpY = Math.cos(baseAngle);
  return (point.x - pin.x) * perpX + (point.y - pin.y) * perpY;
}

/**
 * Solve for the putt line into the hole. `engine` must be the REAL,
 * slope-aware engine (not a flat preview engine). Always returns a non-empty
 * path — falls back to the closest approach found within the search budget
 * if no exact hole-out solution exists.
 */
export function solveTrueVisionPath(engine: PhysicsEngine, hole: HoleData, ball: Point, golfer: Golfer): TrajectoryPoint[] {
  const putter = clubById('putter');
  const maxCarryPx = effectiveCarryYards(putter, golfer, 0, 'green') * PX_PER_YARD;
  const pinDist = dist(ball, hole.pin);
  const power = maxCarryPx > 0 ? pinDist / maxCarryPx : 0;
  const baseAngle = angleTo(ball, hole.pin);

  const clampToCone = (angle: number): number =>
    Math.max(baseAngle - SEARCH_CONE, Math.min(baseAngle + SEARCH_CONE, angle));

  let bestPath: TrajectoryPoint[] | null = null;
  let bestDist = Infinity;

  const evaluate = (angle: number): { holed: boolean; dist: number; lateral: number; path: TrajectoryPoint[] } => {
    const clamped = clampToCone(angle);
    const outcome = engine.simulate({
      origin: ball,
      aimAngle: clamped,
      swing: { power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'green',
      wind: { angle: 0, speed: 0 },
      hole,
      preview: true
    });
    const { point, dist: closest } = closestApproach(outcome.path, hole.pin);
    if (closest < bestDist) {
      bestDist = closest;
      bestPath = outcome.path;
    }
    return { holed: outcome.holed, dist: closest, lateral: signedLateral(point, ball, hole.pin), path: outcome.path };
  };

  const a0 = evaluate(baseAngle);
  if (a0.holed || a0.dist <= PHYSICS.cupRadius) return a0.path;

  let angle0 = baseAngle;
  let f0 = a0.lateral;
  let angle1 = baseAngle + PROBE_STEP;
  let a1 = evaluate(angle1);
  if (a1.holed || a1.dist <= PHYSICS.cupRadius) return a1.path;
  let f1 = a1.lateral;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (f1 === f0) break; // flat/degenerate slope — no usable secant slope, stop
    const angle2 = clampToCone(angle1 - (f1 * (angle1 - angle0)) / (f1 - f0));
    const a2 = evaluate(angle2);
    if (a2.holed || a2.dist <= PHYSICS.cupRadius) return a2.path;
    angle0 = angle1;
    f0 = f1;
    angle1 = angle2;
    f1 = a2.lateral;
  }

  // No exact solve within the budget — the closest approach found is always
  // strictly better (or equal) than the naive straight-at-pin aim, and is
  // never empty since `evaluate` runs at least twice above.
  return bestPath ?? a0.path;
}
