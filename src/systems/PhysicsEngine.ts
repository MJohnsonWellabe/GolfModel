import { PHYSICS, PX_PER_YARD, RULES } from '../config';
import { HeightField } from './HeightField';
import { clamp, dist, gaussian, pointInEllipse, pointInPolygon } from '../utils/Geometry';
import {
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  ShotOutcome,
  Surface,
  SwingResult,
  TrajectoryPoint,
  Wind
} from '../core/types';

/** Fringe ring width around the green, world px. Wide enough that the mown
 *  collar still reads at gameplay camera distance (survives mip averaging). */
export const FRINGE_MARGIN = 32;

export interface ShotParams {
  origin: Point;
  /** Aim direction in radians (world space). */
  aimAngle: number;
  swing: SwingResult;
  club: ClubSpec;
  golfer: Golfer;
  /** Temporary stat boost from the fire system. */
  fireBoost: number;
  lie: Surface;
  wind: Wind;
  hole: HoleData;
  /** True = deterministic dry run for the aim preview (no lie noise). */
  preview?: boolean;
}

/** Which stats govern a given club. */
export function statsForClub(
  club: ClubSpec,
  golfer: Golfer,
  fireBoost: number
): { distance: number; accuracy: number } {
  const s = golfer.stats;
  let distance: number;
  let accuracy: number;
  if (club.id === 'driver' || club.id === '3w' || club.id === '5w') {
    distance = s.drivingPower;
    accuracy = s.drivingAccuracy;
  } else if (club.id === 'pw' || club.id === 'sw') {
    distance = s.chipping;
    accuracy = s.chipping;
  } else if (club.id === 'putter') {
    distance = s.putting;
    accuracy = s.putting;
  } else {
    distance = s.approach;
    accuracy = s.approach;
  }
  return {
    distance: Math.min(100, distance + fireBoost),
    accuracy: Math.min(100, accuracy + fireBoost)
  };
}

/** Club family key for per-club dispersion tuning (PHYSICS.perfectDispersionDeg). */
function clubFamily(club: ClubSpec): string {
  if (club.id === 'putter') return 'putter';
  if (club.id === 'pw' || club.id === 'sw') return 'wedge';
  if (club.id === 'driver' || club.id === '3w' || club.id === '5w') return 'wood';
  return 'iron';
}

/** Effective full-power carry (yards) for a club/golfer/lie combination. */
export function effectiveCarryYards(
  club: ClubSpec,
  golfer: Golfer,
  fireBoost: number,
  lie: Surface
): number {
  const { distance } = statsForClub(club, golfer, fireBoost);
  // GDD Appendix A driver carry table (base 270): power 70→245yd, 85→~283,
  // 100→320. statMult = 0.259 + power/100 * 0.926 fits those anchors, so the
  // full power spread lands on the documented targets.
  const statMult = 0.259 + (distance / 100) * 0.926;
  const lieMult = PHYSICS.lieDistance[lie] ?? 1;
  return club.baseDistance * statMult * lieMult;
}

export class PhysicsEngine {
  /**
   * @param hf Optional macro-terrain. When null (all pre-elevation courses
   * and tests) every code path below reduces to the original flat behavior —
   * that identity is the regression gate for the elevation feature.
   */
  constructor(
    private readonly hole: HoleData,
    private readonly hf: HeightField | null = null
  ) {}

  /** Terrain height under a world point (0 on flat/legacy holes). */
  groundAt(x: number, y: number): number {
    return this.hf ? this.hf.heightAt(x, y) : 0;
  }

  get heightField(): HeightField | null {
    return this.hf;
  }

  /**
   * Rolling acceleration from the local slope (px/s²). With a heightfield
   * this is the true downhill gradient anywhere on the hole; legacy holes
   * fall back to the single authored green slope (green/fringe only).
   */
  breakAccel(x: number, y: number): { ax: number; ay: number } {
    if (this.hf) {
      const g = this.hf.gradientAt(x, y);
      return { ax: -g.x * PHYSICS.slopeGradAccel, ay: -g.y * PHYSICS.slopeGradAccel };
    }
    const s = this.hole.slope;
    const surf = this.surfaceAt(x, y);
    if (surf !== 'green' && surf !== 'fringe') return { ax: 0, ay: 0 };
    return {
      ax: Math.cos(s.angle) * PHYSICS.slopeAccel * s.strength,
      ay: Math.sin(s.angle) * PHYSICS.slopeAccel * s.strength
    };
  }

  /**
   * Average slope acceleration parallel to an aim line (positive = helps the
   * ball along the line). Drives the putt meter's power target and AI pace.
   */
  slopeAccelAlong(from: Point, yaw: number, distPx: number): number {
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    if (!this.hf) {
      const s = this.hole.slope;
      return PHYSICS.slopeAccel * s.strength * Math.cos(s.angle - yaw);
    }
    const samples = 5;
    let sum = 0;
    for (let i = 1; i <= samples; i++) {
      const t = (i / (samples + 1)) * distPx;
      const b = this.breakAccel(from.x + dx * t, from.y + dy * t);
      sum += b.ax * dx + b.ay * dy;
    }
    return sum / samples;
  }

  /**
   * Surface classification at a world point, in priority order.
   * Green/fringe/bunkers come BEFORE water so an island green (surrounded
   * by water) still reads as land.
   */
  surfaceAt(x: number, y: number): Surface {
    const h = this.hole;
    if (pointInEllipse(x, y, h.green)) return 'green';
    for (const hz of h.hazards) {
      if (hz.type === 'bunker' && pointInPolygon(x, y, hz.polygon)) return 'sand';
    }
    if (pointInEllipse(x, y, h.green, FRINGE_MARGIN)) return 'fringe';
    for (const hz of h.hazards) {
      if (hz.type === 'water' && pointInPolygon(x, y, hz.polygon)) return 'water';
    }
    for (const hz of h.hazards) {
      if ((hz.type === 'trees' || hz.type === 'building') && pointInPolygon(x, y, hz.polygon)) {
        return 'trees';
      }
    }
    for (const poly of h.fairway) {
      if (pointInPolygon(x, y, poly)) return 'fairway';
    }
    return 'rough';
  }

  /** Trees and buildings both knock a descending ball out of the air. */
  private inTrees(x: number, y: number): boolean {
    return this.hole.hazards.some(
      (hz) =>
        (hz.type === 'trees' || hz.type === 'building') && pointInPolygon(x, y, hz.polygon)
    );
  }

  /**
   * Simulate a full shot: flight, landing bounce, rollout, hazards, cup.
   * Deterministic given its inputs (all randomness is injected before this call
   * except small lie noise, which is sampled here).
   */
  simulate(params: ShotParams): ShotOutcome {
    const { origin, aimAngle, swing, club, golfer, fireBoost, lie, wind, hole } = params;
    const { accuracy } = statsForClub(club, golfer, fireBoost);

    // Distance ------------------------------------------------------------
    const carryYds = effectiveCarryYards(club, golfer, fireBoost, lie) * swing.power;
    const carryPx = Math.max(4, carryYds * PX_PER_YARD);

    // Direction -----------------------------------------------------------
    const errFactor = 0.4 + ((100 - accuracy) / 100) * 1.2;
    const maxErr = club.id === 'putter' ? PHYSICS.maxErrorDeg / 2.4 : PHYSICS.maxErrorDeg;
    const lieNoise = params.preview ? 0 : gaussian(0, PHYSICS.lieError[lie] ?? 0);
    // Residual dispersion even on a perfect (accuracy===0) click — a perfect
    // swing shouldn't guarantee a perfect line (GDD §864). Tightens as the
    // governing accuracy stat rises; skipped in preview so the aim line is exact.
    const residualSigma = (PHYSICS.perfectDispersionDeg[clubFamily(club)] ?? 0) * (1.3 - accuracy / 200);
    const residual = params.preview ? 0 : gaussian(0, Math.max(0, residualSigma));
    const errorDeg = swing.accuracy * maxErr * errFactor + lieNoise + residual;
    const dir = aimAngle + (errorDeg * Math.PI) / 180;

    const path: TrajectoryPoint[] = [{ x: origin.x, y: origin.y, z: 0 }];
    const g = PHYSICS.gravity;
    const dt = PHYSICS.dt;
    const windAx = Math.cos(wind.angle) * wind.speed * PHYSICS.windAccelPerMph;
    const windAy = Math.sin(wind.angle) * wind.speed * PHYSICS.windAccelPerMph;

    let x = origin.x;
    let y = origin.y;
    // Flight height is ABSOLUTE (terrain-relative zero on flat holes); path
    // samples store height ABOVE the local ground so playback/land detection
    // stay terrain-agnostic.
    let z = this.groundAt(origin.x, origin.y);
    let vx: number;
    let vy: number;
    let vz: number;
    let rolling: boolean;
    let hitTrees = false;
    let waterPenalty = false;
    let holed = false;

    if (club.launchAngle <= 0) {
      // Putter: pure roll. Speed chosen so friction on green stops it at carryPx.
      const v0 = Math.sqrt(2 * PHYSICS.friction.green * carryPx);
      vx = Math.cos(dir) * v0;
      vy = Math.sin(dir) * v0;
      vz = 0;
      rolling = true;
    } else {
      // Ballistic launch sized so ideal range equals carryPx.
      const theta = (club.launchAngle * Math.PI) / 180;
      const v0 = Math.sqrt((carryPx * g) / Math.sin(2 * theta));
      const vh = v0 * Math.cos(theta);
      vx = Math.cos(dir) * vh;
      vy = Math.sin(dir) * vh;
      vz = v0 * Math.sin(theta);
      rolling = false;
    }

    const maxSteps = 60 * 25;
    for (let step = 0; step < maxSteps; step++) {
      if (!rolling) {
        // Airborne phase
        vx += windAx * dt;
        vy += windAy * dt;
        vz -= g * dt;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;

        const ground = this.groundAt(x, y);
        // Tree canopy collision on the way down (or flying low)
        if (z > ground && z - ground < PHYSICS.treeHeight && vz < 0 && this.inTrees(x, y)) {
          hitTrees = true;
          z = ground;
          const speed = Math.hypot(vx, vy);
          if (speed > 0) {
            vx = (vx / speed) * 40;
            vy = (vy / speed) * 40;
          }
          rolling = true;
        } else if (z <= ground) {
          // Landing (terrain-aware: uphill ground meets the ball early)
          z = ground;
          const surf = this.surfaceAt(x, y);
          // A ball landing in water is wet immediately — a fast splash can
          // bounce clear of the pond in one step before the roll check runs.
          if (surf === 'water') {
            waterPenalty = true;
            path.push({ x, y, z: 0 });
            break;
          }
          const keep = (PHYSICS.bounce[surf] ?? 0.4) * (1 - club.spin);
          vx *= keep;
          vy *= keep;
          vz = 0;
          rolling = true;
        }
        path.push({ x, y, z: Math.max(0, z - ground) });
        if (!rolling) continue;
      }

      // Rolling phase -----------------------------------------------------
      const surf = this.surfaceAt(x, y);
      if (surf === 'water') {
        waterPenalty = true;
        break;
      }
      const speed = Math.hypot(vx, vy);
      const dPin = Math.hypot(x - hole.pin.x, y - hole.pin.y);
      if (dPin < PHYSICS.cupRadius && speed < PHYSICS.cupCaptureSpeed) {
        holed = true;
        x = hole.pin.x;
        y = hole.pin.y;
        path.push({ x, y, z: 0 });
        break;
      }
      if (speed <= 6) break;
      const decel = PHYSICS.friction[surf] ?? 400;
      const newSpeed = Math.max(0, speed - decel * dt);
      vx = (vx / speed) * newSpeed;
      vy = (vy / speed) * newSpeed;
      // Slope: terrain gradient pushes the rolling ball downhill (legacy
      // holes: the single authored green slope, green/fringe only)
      if (this.hf) {
        const b = this.breakAccel(x, y);
        vx += b.ax * dt;
        vy += b.ay * dt;
      } else if (surf === 'green' || surf === 'fringe') {
        const slope = hole.slope;
        vx += Math.cos(slope.angle) * PHYSICS.slopeAccel * slope.strength * dt;
        vy += Math.sin(slope.angle) * PHYSICS.slopeAccel * slope.strength * dt;
      }
      x += vx * dt;
      y += vy * dt;
      path.push({ x, y, z: 0 });
    }

    // Clamp to the hole's world
    x = clamp(x, 10, hole.world.width - 10);
    y = clamp(y, 10, hole.world.height - 10);

    let finalPos: Point = { x, y };
    let surface = this.surfaceAt(x, y);

    if (waterPenalty || surface === 'water') {
      waterPenalty = true;
      finalPos = this.dropPoint(path, origin);
      surface = this.surfaceAt(finalPos.x, finalPos.y);
      path.push({ x: finalPos.x, y: finalPos.y, z: 0 });
    }

    return { path, finalPos, surface, waterPenalty, hitTrees, holed };
  }

  /** Walk the trajectory backwards to the last dry point for a water drop. */
  private dropPoint(path: TrajectoryPoint[], origin: Point): Point {
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      if (p.z === 0 || i === 0) {
        const surf = this.surfaceAt(p.x, p.y);
        if (surf !== 'water') return { x: p.x, y: p.y };
      }
      // Also accept airborne samples projected to the ground when dry.
      if (this.surfaceAt(p.x, p.y) !== 'water') return { x: p.x, y: p.y };
    }
    return { x: origin.x, y: origin.y };
  }

  /** Remaining distance to the pin, in yards. */
  yardsToPin(from: Point): number {
    return dist(from, this.hole.pin) / PX_PER_YARD;
  }

  static get maxStrokes(): number {
    return RULES.maxStrokes;
  }
}
