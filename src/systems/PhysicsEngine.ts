import { PHYSICS, PX_PER_YARD, RULES } from '../config';
import { HeightField } from './HeightField';
import { gaussianOf, Rng } from '../utils/Random';
import { clamp, dist, pointInEllipse, pointInPolygon } from '../utils/Geometry';
import {
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  ShotOutcome,
  SpinState,
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
  /** Pre-shot spin from the strike widget (Phase 4). */
  spin?: SpinState;
  /** Launch-angle multiplier from trajectory shaping / strike height. */
  launchMult?: number;
  /** Dispersion multiplier — extreme strike positions increase risk. */
  riskMult?: number;
}

/** A shot with all randomness drawn, ready to integrate (and re-integrate
 *  with different spin from any step — the aerial swipe mechanic). */
export interface ResolvedLaunch {
  origin: Point;
  carryPx: number;
  dir: number;
  club: ClubSpec;
  hole: HoleData;
  wind: Wind;
  launchMult: number;
  /** Club-family × lie spin authority, 0..1. */
  spinEff: number;
  preview: boolean;
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
    private readonly hf: HeightField | null = null,
    /** Uniform random source — inject a seeded rng for deterministic sims. */
    private readonly rng: Rng = Math.random
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
   * Mean roll friction a putt crosses from its origin toward the aim, so the
   * launch speed reaches the target distance from ANY lie — a putt started on
   * fringe/rough needs more pace to travel the same distance (fixes "off-green
   * putts go nowhere"). A putt that rolls entirely on the green averages to
   * exactly friction.green, so on-green pace (and the Appendix-A make rates)
   * is unchanged. Per-sample friction is capped at the rough value so a stray
   * water/trees sample can't blow the launch speed up.
   */
  private puttRollFriction(origin: Point, dir: number, distPx: number): number {
    const steps = 6;
    const cap = PHYSICS.friction.rough;
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const t = (distPx * (i + 0.5)) / steps;
      const surf = this.surfaceAt(origin.x + dx * t, origin.y + dy * t);
      sum += Math.min(PHYSICS.friction[surf] ?? PHYSICS.friction.green, cap);
    }
    return sum / steps;
  }

  /**
   * Simulate a full shot: flight, landing bounce, rollout, hazards, cup.
   * Split into resolveLaunch (all pre-flight randomness) + integrateLaunch
   * (the deterministic flight/roll) so mid-flight spin input can re-shape
   * the SAME resolved shot from any step (Phase 4 aerial swipe).
   */
  simulate(params: ShotParams): ShotOutcome {
    const launch = this.resolveLaunch(params);
    return this.integrateLaunch(launch, params.spin ?? { side: 0, top: 0 }, 0);
  }

  /** Draw all pre-flight randomness and fix the launch state. */
  resolveLaunch(params: ShotParams): ResolvedLaunch {
    const { origin, aimAngle, swing, club, golfer, fireBoost, lie, wind } = params;
    const { accuracy } = statsForClub(club, golfer, fireBoost);

    // Distance ------------------------------------------------------------
    const carryYds = effectiveCarryYards(club, golfer, fireBoost, lie) * swing.power;
    // Putts must be strokeable down to tap-in range — the general 4px floor
    // would force a 3ft putt to sail the cup at lip-out speed.
    let carryPx = Math.max(club.id === 'putter' ? 1 : 4, carryYds * PX_PER_YARD);
    // Putt pace noise: even a perfect stroke has human pace variance — this
    // (with the tight cup) produces the Appendix A make-rate curve. Grows
    // superlinearly with length: lag pace is the hard part of long putts.
    if (club.id === 'putter' && !params.preview) {
      const paceMult = swing.powerQuality === 'perfect' ? 1 : swing.powerQuality === 'good' ? 1.7 : 2.9;
      const sigmaPx = PHYSICS.puttPaceNoise * carryPx * (1 + carryPx / PHYSICS.puttPaceGrowPx) * paceMult;
      carryPx = Math.max(2, carryPx + gaussianOf(this.rng, 0, sigmaPx));
    } else if (!params.preview) {
      // Full-shot distance control: delicate part-swings (chips) carry more
      // relative depth noise than committed full swings — this is what makes
      // chip-ins special (GDD 40%/15%/6%) and caps approach proximity.
      const qMult = swing.powerQuality === 'perfect' ? 1 : swing.powerQuality === 'good' ? 2 : 3.2;
      const frac = 0.05 * (1.25 - Math.min(1, swing.power) * 0.85);
      carryPx *= Math.max(0.4, 1 + gaussianOf(this.rng, 0, frac * qMult));
    }

    // Direction -----------------------------------------------------------
    const errFactor = 0.4 + ((100 - accuracy) / 100) * 1.2;
    const maxErr = club.id === 'putter' ? PHYSICS.maxErrorDeg / 2.4 : PHYSICS.maxErrorDeg;
    const lieNoise = params.preview ? 0 : gaussianOf(this.rng, 0, PHYSICS.lieError[lie] ?? 0);
    // Residual dispersion even on a perfect (accuracy===0) click — a perfect
    // swing shouldn't guarantee a perfect line (GDD §864); ×2/×4 on good/miss
    // swings per the Appendix A dispersion table. Tightens as the governing
    // accuracy stat rises; skipped in preview so the aim line is exact.
    // riskMult: extreme strike positions widen dispersion (Phase 4 widget).
    const qualityMult = swing.accuracyQuality === 'perfect' ? 1 : swing.accuracyQuality === 'good' ? 2 : 4;
    const residualSigma =
      (PHYSICS.perfectDispersionDeg[clubFamily(club)] ?? 0) *
      (1.3 - accuracy / 200) *
      qualityMult *
      (params.riskMult ?? 1);
    const residual = params.preview ? 0 : gaussianOf(this.rng, 0, Math.max(0, residualSigma));
    const errorDeg = swing.accuracy * maxErr * errFactor + lieNoise + residual;
    const dir = aimAngle + (errorDeg * Math.PI) / 180;

    // Spin authority: club family × lie retention (GDD spin tables)
    const spinEff =
      (PHYSICS.spinEffectiveness[clubFamily(club)] ?? 0) * (PHYSICS.lieSpin[lie] ?? 1);

    return {
      origin,
      carryPx,
      dir,
      club,
      hole: params.hole,
      wind,
      launchMult: params.launchMult ?? 1,
      spinEff,
      preview: params.preview ?? false
    };
  }

  /**
   * Deterministic flight + roll for a resolved launch. `spinFromStep` applies
   * the aerial side-spin curve only from that step on, so re-integrating with
   * new spin mid-flight reproduces the already-flown prefix exactly.
   */
  integrateLaunch(launch: ResolvedLaunch, spin: SpinState, spinFromStep = 0): ShotOutcome {
    const { origin, carryPx, dir, club, hole, wind, launchMult, spinEff, preview } = launch;
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
    let lipped = false;
    // Short putt = started within ~5ft of the cup (gimme range, FB2).
    const shortPuttOrigin = Math.hypot(origin.x - hole.pin.x, origin.y - hole.pin.y) < PHYSICS.gimmeShortPuttPx;

    if (club.launchAngle <= 0) {
      // Putter: pure roll. Speed chosen so the friction the ball will ACTUALLY
      // roll through stops it at carryPx — a putt off the green (fringe/rough)
      // needs more pace to reach the same distance. On-green putts see only
      // green friction, so their pace is unchanged. The half-kick term
      // compensates the discrete integrator's systematic v0·dt/2 shortfall
      // (decelerate-then-move Euler ordering).
      const mu = this.puttRollFriction(origin, dir, carryPx);
      const v0 = Math.sqrt(2 * mu * carryPx) + (mu * PHYSICS.dt) / 2;
      vx = Math.cos(dir) * v0;
      vy = Math.sin(dir) * v0;
      vz = 0;
      rolling = true;
    } else {
      // Ballistic launch sized so ideal range equals carryPx. Trajectory
      // shaping (Low/High presets, strike height) tilts the launch angle.
      const theta = (clamp(club.launchAngle * launchMult, 6, 55) * Math.PI) / 180;
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
        // Airborne phase — wind bites harder the higher the ball flies
        // (GDD §Wind: "Lower shots reduce wind influence")
        const aboveGround = z - this.groundAt(x, y);
        const wScale = 0.25 + 0.85 * clamp(aboveGround / PHYSICS.windRefHeight, 0, 1.3);
        vx += windAx * wScale * dt;
        vy += windAy * wScale * dt;
        // Side spin: curve perpendicular to the current travel direction
        // (+side bends right of the line — a fade for a north-bound shot)
        if (spin.side !== 0 && step >= spinFromStep) {
          const hSpeed = Math.hypot(vx, vy) || 1;
          const k = spin.side * spinEff * PHYSICS.sideSpinAccel * dt;
          const perpX = -vy / hSpeed;
          const perpY = vx / hSpeed;
          vx += perpX * k;
          vy += perpY * k;
        }
        vz -= g * dt;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;

        const ground = this.groundAt(x, y);
        // Tree collision: a ball descending into the canopy — or a genuine low
        // liner (still under the trunk band while climbing) — that is inside a
        // tree polygon gets stopped. A high drive clearing an edge treeline is
        // above the liner band by then, so it sails over untouched (preserves
        // Wildwood's balance). Impact kills vertical carry and cuts horizontal
        // speed to a small, capped fraction of the impact speed.
        // Tree collision on the way down: a ball descending into the canopy
        // inside a tree polygon is stopped — vertical carry killed and
        // horizontal speed cut to a small, capped fraction of impact speed, so
        // a drive into a mid-fairway tree drops near it instead of sailing on.
        if (z > ground && z - ground < PHYSICS.treeHeight && vz < 0 && this.inTrees(x, y)) {
          hitTrees = true;
          z = ground;
          vz = 0;
          const speed = Math.hypot(vx, vy);
          if (speed > 0) {
            const out = Math.min(speed * PHYSICS.treeDamp, PHYSICS.treeKillSpeed);
            vx = (vx / speed) * out;
            vy = (vy / speed) * out;
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
          // Topspin runs out, backspin checks up (GDD: "Topspin should
          // increase rollout. Backspin should reduce rollout.")
          const spinKeep = clamp(1 + spin.top * 0.55 * spinEff, 0.05, 2);
          const keep = (PHYSICS.bounce[surf] ?? 0.4) * (1 - club.spin) * spinKeep;
          vx *= keep;
          vy *= keep;
          vz = 0;
          // Strong backspin on the short stuff bites and sucks back
          if (spin.top < -0.35 && (surf === 'green' || surf === 'fringe') && spinEff > 0.4) {
            const hs = Math.hypot(vx, vy) || 1;
            const bite = PHYSICS.backspinBite * (-spin.top - 0.35) * spinEff * 1.54;
            vx = (-vx / hs) * bite;
            vy = (-vy / hs) * bite;
          }
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
      // Gimme: on a SHORT putt (started near the cup), a slow ball trickling
      // by the hole falls in — tap-ins are automatic (FB2). Gated on the
      // putt's origin so a well-lagged long putt dying near the cup is NOT
      // gifted; only genuine short putts get the forgiveness.
      if (
        club.launchAngle <= 0 &&
        shortPuttOrigin &&
        dPin < PHYSICS.cupRadius * PHYSICS.gimmeRadiusMult &&
        speed < PHYSICS.gimmeSpeed
      ) {
        holed = true;
        x = hole.pin.x;
        y = hole.pin.y;
        path.push({ x, y, z: 0 });
        break;
      }
      // Lip-out: a touch too firm OVER the cup catches the rim and deflects.
      // (Only inside the cup radius — a wider band would eat dying putts
      // before they could reach the capture check.)
      if (
        !lipped &&
        dPin < PHYSICS.cupRadius &&
        speed >= PHYSICS.cupCaptureSpeed &&
        speed < PHYSICS.cupLipSpeed
      ) {
        lipped = true;
        const deflect = 0.5 + (preview ? 0.5 : this.rng()) * 0.35; // ~30-50°
        const cs = Math.cos(deflect);
        const sn = Math.sin(deflect);
        const nvx = vx * cs - vy * sn;
        const nvy = vx * sn + vy * cs;
        vx = nvx * 0.42;
        vy = nvy * 0.42;
        // The rim throws the ball clear of the hole — it must not dribble
        // back into the capture zone after horseshoeing out.
        const outSpeed = Math.hypot(vx, vy) || 1;
        x = hole.pin.x + (vx / outSpeed) * PHYSICS.cupRadius * 1.6;
        y = hole.pin.y + (vy / outSpeed) * PHYSICS.cupRadius * 1.6;
        path.push({ x, y, z: 0 });
      }
      if (speed <= PHYSICS.rollStopSpeed) break;
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
