import { PHYSICS, PX_PER_YARD } from '../config';
import { CLUBS, clubById } from '../data/clubs';
import { FireSystem } from './FireSystem';
import { gaussianOf, Rng } from '../utils/Random';
import { angleTo, clamp, dist } from '../utils/Geometry';
import { effectiveCarryYards, statsForClub } from './PhysicsEngine';
import {
  Band,
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  Surface,
  SwingResult,
  Wind
} from '../core/types';

export interface AIDecision {
  club: ClubSpec;
  aimAngle: number;
  aimPoint: Point;
  swing: SwingResult;
}

/** How an AI attacks holes (all 0..1). See data/opponents.ts. */
export interface AIPersonality {
  /** Willingness to attempt shots at the edge of (or beyond) its range. */
  aggression: number;
  /** Preference for laying back short of trouble instead of pressing. */
  layupBias: number;
  /** Aim at the pin vs the fat of the green on approaches. */
  pinHunting: number;
}

export const BALANCED_PERSONALITY: AIPersonality = { aggression: 0.5, layupBias: 0.5, pinHunting: 0.5 };

/**
 * AI shot planning: pick a target, pick a club, then produce a simulated
 * swing-meter result whose quality is driven by the golfer's stats (plus
 * the same fire system the player uses). The resulting swing feeds through
 * the exact same PhysicsEngine as player shots.
 */
export class AIController {
  constructor(
    private readonly golfer: Golfer,
    private readonly fire: FireSystem,
    /** Terrain reader for break/pace compensation; null = legacy single slope. */
    private readonly terrain: {
      breakAccel(x: number, y: number): { ax: number; ay: number };
      slopeAccelAlong?(from: Point, yaw: number, distPx: number): number;
    } | null = null,
    /** Uniform random source — inject a seeded rng for deterministic sims. */
    private readonly rng: Rng = Math.random,
    /** How this AI attacks holes; balanced when unspecified. */
    private readonly personality: AIPersonality = BALANCED_PERSONALITY
  ) {}

  decide(ballPos: Point, lie: Surface, wind: Wind, hole: HoleData): AIDecision {
    const aimPoint = this.chooseTarget(ballPos, lie, hole);
    const club = this.chooseClub(ballPos, aimPoint, lie);

    // Compensate ~80% of expected wind drift by shifting the aim point.
    let adjusted = this.windAdjustedAim(ballPos, aimPoint, club, wind);
    if (club.id === 'putter') {
      // Play the break: aim partially uphill of the cup.
      const d = dist(ballPos, aimPoint);
      if (this.terrain) {
        // Read the real gradient midway along the putt
        const mx = (ballPos.x + aimPoint.x) / 2;
        const my = (ballPos.y + aimPoint.y) / 2;
        const b = this.terrain.breakAccel(mx, my);
        const k = (d * 0.5) / PHYSICS.slopeAccel; // same scale as the legacy comp
        adjusted = { x: adjusted.x - b.ax * k, y: adjusted.y - b.ay * k };
      } else {
        const comp = d * hole.slope.strength * 0.5;
        adjusted = {
          x: adjusted.x - Math.cos(hole.slope.angle) * comp,
          y: adjusted.y - Math.sin(hole.slope.angle) * comp
        };
      }
    }
    const aimAngle = angleTo(ballPos, adjusted);

    const swing = this.rollSwing(ballPos, aimPoint, club, lie);
    return { club, aimAngle, aimPoint: adjusted, swing };
  }

  private chooseTarget(ballPos: Point, lie: Surface, hole: HoleData): Point {
    const pin = hole.pin;
    if (lie === 'green') return pin;
    const remainingYds = dist(ballPos, pin) / PX_PER_YARD;
    const maxCarry = effectiveCarryYards(
      clubById('driver'),
      this.golfer,
      this.fire.statBoost,
      lie
    );
    // Aggression extends (or shrinks) how far out this AI will "go for it":
    // a gambler attempts the green from 30yd beyond its rated carry, a
    // conservative player only when comfortably in range.
    const reachBonus = -14 + this.personality.aggression * 48;
    if (remainingYds <= maxCarry + reachBonus) {
      // Pin hunters fire at the flag; others play toward the green center
      const safety = Math.max(0, 0.5 - this.personality.pinHunting) * 1.4;
      return {
        x: pin.x + (hole.green.cx - pin.x) * safety,
        y: pin.y + (hole.green.cy - pin.y) * safety
      };
    }

    // Pin out of reach: advance along the authored fairway route
    // (aiTargets tee→green, then the pin), stretching PAST the farthest
    // reachable waypoint toward the next one with any leftover carry — so a
    // 290yd hitter and a 310yd hitter both drive to their own distance
    // instead of snapping to the same waypoint.
    const route = [...hole.aiTargets, pin];
    // Layup bias throttles how much of the full carry a layup uses —
    // conservative players leave a comfortable full-wedge number.
    const reachPx = maxCarry * PX_PER_YARD * (1.015 - this.personality.layupBias * 0.09);
    let idx = -1;
    for (let i = 0; i < route.length; i++) {
      const toT = dist(ballPos, route[i]);
      if (toT >= 25 * PX_PER_YARD && toT <= reachPx) idx = i;
    }
    if (idx === -1) {
      // No waypoint in range: press toward the first one that's ahead
      const next = route.find((t) => dist(ballPos, t) > 25 * PX_PER_YARD) ?? pin;
      const d = dist(ballPos, next);
      const t = Math.min(1, reachPx / d);
      return { x: ballPos.x + (next.x - ballPos.x) * t, y: ballPos.y + (next.y - ballPos.y) * t };
    }
    const base = route[idx];
    const next = route[Math.min(idx + 1, route.length - 1)];
    const leftover = reachPx - dist(ballPos, base);
    const segLen = dist(base, next);
    if (leftover > 10 && segLen > 1) {
      const t = Math.min(1, leftover / segLen);
      return { x: base.x + (next.x - base.x) * t, y: base.y + (next.y - base.y) * t };
    }
    return base;
  }

  private chooseClub(ballPos: Point, aimPoint: Point, lie: Surface): ClubSpec {
    if (lie === 'green') return clubById('putter');
    const neededYds = dist(ballPos, aimPoint) / PX_PER_YARD;

    if (lie === 'sand') {
      // Escape club unless the target is genuinely far.
      return neededYds > 130 ? clubById('9i') : clubById('sw');
    }
    if (lie === 'fringe' && neededYds < 35) return clubById('putter');

    // Smallest club that can reach the target at <= 100% power.
    const candidates = CLUBS.filter((c) => c.id !== 'putter');
    let choice = candidates[0]; // driver = longest
    for (let i = candidates.length - 1; i >= 0; i--) {
      const carry = effectiveCarryYards(candidates[i], this.golfer, this.fire.statBoost, lie);
      if (carry >= neededYds) {
        choice = candidates[i];
        break;
      }
    }
    if (lie === 'trees') choice = clubById('5i'); // punch out
    return choice;
  }

  private windAdjustedAim(
    ballPos: Point,
    aimPoint: Point,
    club: ClubSpec,
    wind: Wind
  ): Point {
    if (club.id === 'putter' || club.launchAngle <= 0) return aimPoint;
    const carryPx = dist(ballPos, aimPoint);
    const theta = (club.launchAngle * Math.PI) / 180;
    const v0 = Math.sqrt((carryPx * PHYSICS.gravity) / Math.sin(2 * theta));
    const flightTime = (2 * v0 * Math.sin(theta)) / PHYSICS.gravity;
    const accel = wind.speed * PHYSICS.windAccelPerMph;
    // The engine scales wind by altitude (low flight cuts through it); match
    // its average effect over a parabolic arc: mean height ≈ 2/3 of apex.
    const apex = (v0 * Math.sin(theta)) ** 2 / (2 * PHYSICS.gravity);
    const windScale = clamp(0.25 + 0.85 * ((apex * 0.66) / PHYSICS.windRefHeight), 0.25, 1.1);
    const drift = 0.5 * accel * windScale * flightTime * flightTime;
    return {
      x: aimPoint.x - Math.cos(wind.angle) * drift * 0.8,
      y: aimPoint.y - Math.sin(wind.angle) * drift * 0.8
    };
  }

  /** Sample a swing result from the golfer's stats. */
  private rollSwing(
    ballPos: Point,
    aimPoint: Point,
    club: ClubSpec,
    lie: Surface
  ): SwingResult {
    const { distance, accuracy } = statsForClub(club, this.golfer, this.fire.statBoost);
    const carry = effectiveCarryYards(club, this.golfer, this.fire.statBoost, lie);
    const neededYds = dist(ballPos, aimPoint) / PX_PER_YARD;
    // Floors are ABSOLUTE distances, not power fractions — a fractional
    // floor rams tap-ins past the cup and blasts greenside chips over the
    // green (worse the higher the stat, since carry scales with it).
    const minPower = club.id === 'putter' ? 0.25 / carry : Math.min(0.35, 2.5 / carry);
    let targetPower = clamp(neededYds / carry, minPower, 1.0);
    if (club.id === 'putter') {
      // Slope-aware pace, same math as the player's meter target: uphill
      // needs more, downhill less (rolling decel along the line = μ ∓ a).
      if (this.terrain?.slopeAccelAlong) {
        const yaw = angleTo(ballPos, aimPoint);
        const aPar = this.terrain.slopeAccelAlong(ballPos, yaw, dist(ballPos, aimPoint));
        targetPower = clamp((targetPower * (PHYSICS.friction.green - aPar)) / PHYSICS.friction.green, minPower, 1.0);
      }
      // Fringe putts fight ~3x green friction until they reach the surface —
      // rate the stroke up or they die well short.
      if (lie === 'fringe') targetPower = clamp(targetPower * 1.5, minPower, 1.0);
    }

    const powerBand = this.sampleBand(distance);
    const accuracyBand = this.sampleBand(accuracy);

    // Even "perfect" AI swings carry a little dispersion — a perfect meter
    // click for the player is deterministic, but the AI shouldn't be a robot
    // that holes out from the fairway every time.
    // Putts need to reach very low power for short distances; tighten the
    // AI's putt dispersion too so it lags close instead of blasting past.
    const isPutt = club.id === 'putter';
    const floor = isPutt ? 0.005 : 0.2;
    const perfectSd = isPutt ? 0.015 : 0.016;
    const goodSd = isPutt ? 0.05 : 0.055;
    const missSd = isPutt ? 0.11 : 0.15;
    let power = clamp(targetPower * (1 + gaussianOf(this.rng, 0, perfectSd)), floor, 1.08);
    if (powerBand === 'good') power = clamp(targetPower * (1 + gaussianOf(this.rng, 0, goodSd)), floor, 1.08);
    if (powerBand === 'miss') power = clamp(targetPower * (1 + gaussianOf(this.rng, 0, missSd)), floor, 1.08);

    // A perfect band click is a *clean* strike — the engine's residual
    // dispersion supplies the remaining spread, mirroring the player meter
    // (which snaps perfect clicks to offset 0).
    let accOffset = clamp(gaussianOf(this.rng, 0, 0.05), -1, 1);
    if (accuracyBand === 'good') accOffset = clamp(gaussianOf(this.rng, 0, 0.17), -1, 1);
    if (accuracyBand === 'miss') accOffset = clamp(gaussianOf(this.rng, 0, 0.5), -1, 1);

    return {
      power,
      powerQuality: powerBand,
      accuracy: accOffset,
      accuracyQuality: accuracyBand
    };
  }

  private sampleBand(stat: number): Band {
    // Steep skill curve so the GDD scoring tiers actually separate:
    // stat 72 → ~37% perfect / 8% miss · 80 → 53%/6.4% · 88 → 71%/4.6% ·
    // 95 → 87%/3.1% (calibrated by tests/simulation/scoring.test.ts).
    const pPerfect = clamp(Math.pow(Math.max(0, stat - 45) / 55, 1.4), 0.05, 0.95);
    const pMiss = clamp(0.24 - (stat / 100) * 0.22, 0.02, 0.3);
    const r = this.rng();
    if (r < pPerfect) return 'perfect';
    if (r > 1 - pMiss) return 'miss';
    return 'good';
  }
}
