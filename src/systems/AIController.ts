import { PHYSICS, PX_PER_YARD } from '../config';
import { CLUBS, clubById } from '../data/clubs';
import { FireSystem } from './FireSystem';
import { angleTo, clamp, dist, gaussian } from '../utils/Geometry';
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

/**
 * AI shot planning: pick a target, pick a club, then produce a simulated
 * swing-meter result whose quality is driven by the golfer's stats (plus
 * the same fire system the player uses). The resulting swing feeds through
 * the exact same PhysicsEngine as player shots.
 */
export class AIController {
  constructor(
    private readonly golfer: Golfer,
    private readonly fire: FireSystem
  ) {}

  decide(ballPos: Point, lie: Surface, wind: Wind, hole: HoleData): AIDecision {
    const aimPoint = this.chooseTarget(ballPos, lie, hole);
    const club = this.chooseClub(ballPos, aimPoint, lie);

    // Compensate ~80% of expected wind drift by shifting the aim point.
    let adjusted = this.windAdjustedAim(ballPos, aimPoint, club, wind);
    if (club.id === 'putter') {
      // Play the break: aim partially uphill of the cup.
      const d = dist(ballPos, aimPoint);
      const comp = d * hole.slope.strength * 0.5;
      adjusted = {
        x: adjusted.x - Math.cos(hole.slope.angle) * comp,
        y: adjusted.y - Math.sin(hole.slope.angle) * comp
      };
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
    if (remainingYds <= maxCarry + 10) return pin;

    // Pin out of reach: aim at the best layup waypoint that makes progress.
    let best: Point | null = null;
    let bestRemaining = remainingYds;
    for (const t of hole.aiTargets) {
      const toTarget = dist(ballPos, t) / PX_PER_YARD;
      const afterTarget = dist(t, pin) / PX_PER_YARD;
      if (toTarget < 25) continue; // already there
      if (toTarget <= maxCarry + 5 && afterTarget < bestRemaining) {
        best = t;
        bestRemaining = afterTarget;
      }
    }
    return best ?? pin;
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
    const drift = 0.5 * accel * flightTime * flightTime;
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
    // The 0.35 floor keeps full swings from dribbling, but a putter carries
    // ~40yd, so a 20ft putt only needs ~0.16 power — floor it far lower or the
    // AI rams every putt yards past the hole.
    const minPower = club.id === 'putter' ? 0.04 : 0.35;
    const targetPower = clamp(neededYds / carry, minPower, 1.0);

    const powerBand = this.sampleBand(distance);
    const accuracyBand = this.sampleBand(accuracy);

    // Even "perfect" AI swings carry a little dispersion — a perfect meter
    // click for the player is deterministic, but the AI shouldn't be a robot
    // that holes out from the fairway every time.
    // Putts need to reach very low power for short distances; tighten the
    // AI's putt dispersion too so it lags close instead of blasting past.
    const isPutt = club.id === 'putter';
    const floor = isPutt ? 0.03 : 0.2;
    const perfectSd = isPutt ? 0.02 : 0.035;
    const goodSd = isPutt ? 0.05 : 0.07;
    const missSd = isPutt ? 0.11 : 0.15;
    let power = clamp(targetPower * (1 + gaussian(0, perfectSd)), floor, 1.08);
    if (powerBand === 'good') power = clamp(targetPower * (1 + gaussian(0, goodSd)), floor, 1.08);
    if (powerBand === 'miss') power = clamp(targetPower * (1 + gaussian(0, missSd)), floor, 1.08);

    let accOffset = clamp(gaussian(0, 0.15), -1, 1);
    if (accuracyBand === 'good') accOffset = clamp(gaussian(0, 0.3), -1, 1);
    if (accuracyBand === 'miss') accOffset = clamp(gaussian(0, 0.6), -1, 1);

    return {
      power,
      powerQuality: powerBand,
      accuracy: accOffset,
      accuracyQuality: accuracyBand
    };
  }

  private sampleBand(stat: number): Band {
    const pPerfect = 0.18 + (stat / 100) * 0.42; // stat 90 -> ~0.56
    const pMiss = clamp(0.16 - (stat / 100) * 0.12, 0.02, 0.2); // stat 90 -> ~0.05
    const r = Math.random();
    if (r < pPerfect) return 'perfect';
    if (r > 1 - pMiss) return 'miss';
    return 'good';
  }
}
