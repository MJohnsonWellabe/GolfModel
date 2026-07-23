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
  SpinState,
  Surface,
  SwingResult,
  Wind
} from '../core/types';

export interface AIDecision {
  club: ClubSpec;
  aimAngle: number;
  aimPoint: Point;
  swing: SwingResult;
  /** Intended power as a physics fraction, BEFORE any execution noise — the bar
   *  target the swing was rated for (elevation/lie/putt-slope aware). The skill
   *  simulator uses this as the powerTarget a modeled USER swings at, keeping the
   *  AI's club + aim + strategy but substituting the user's timing execution. */
  powerTarget: number;
  /** Shot-shaping spin (pin hunters spin their wedges back). */
  spin?: SpinState;
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
      surfaceAt?(x: number, y: number): Surface;
      groundAt?(x: number, y: number): number;
    } | null = null,
    /** Uniform random source — inject a seeded rng for deterministic sims. */
    private readonly rng: Rng = Math.random,
    /** How this AI attacks holes; balanced when unspecified. */
    private readonly personality: AIPersonality = BALANCED_PERSONALITY
  ) {}

  decide(ballPos: Point, lie: Surface, wind: Wind, hole: HoleData): AIDecision {
    let aimPoint = this.chooseTarget(ballPos, lie, hole);
    // Walled in (a canyon face/mesa cliff between ball and target that no
    // wedge loft can clear at this range): pitch out downhill first — the
    // same idea as the trees punch-out. Without this the AI bangs a wedge
    // into the wall forever (Devil's Kitchen back-canyon sims).
    if (lie !== 'green' && lie !== 'tee') {
      const esc = this.wallEscapeTarget(ballPos, aimPoint);
      if (esc) aimPoint = esc;
    }
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

    const { swing, powerTarget } = this.rollSwing(ballPos, aimPoint, club, lie);
    // Pin hunters rip their wedges back at the flag (Phase 4 spin usage)
    const spinsWedge =
      this.personality.pinHunting > 0.6 &&
      (club.id === 'pw' || club.id === 'sw' || club.id === '9i') &&
      (lie === 'fairway' || lie === 'tee' || lie === 'fringe');
    const spin = spinsWedge ? { side: 0, top: -0.7 } : undefined;
    return { club, aimAngle, aimPoint: adjusted, swing, powerTarget, spin };
  }

  private chooseTarget(ballPos: Point, lie: Surface, hole: HoleData): Point {
    const pin = hole.pin;
    if (lie === 'green') return pin;
    // In the trees: punch out to the nearest open ground rather than firing at
    // the flag through more trunks. With per-trunk collision that now stops
    // rising balls too, aiming at the pin through a stand just re-hits trees
    // and stalls (playtest FB9) — a real recovery escapes sideways.
    if (lie === 'trees') return this.punchOutTarget(ballPos, hole);
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

  /**
   * Trees recovery: scan outward in every direction for the shortest way back
   * to open ground (lightly favouring progress toward the pin), never punching
   * into water. Needs a surface probe; without one it falls back to the pin.
   */
  private punchOutTarget(ballPos: Point, hole: HoleData): Point {
    const probe = this.terrain?.surfaceAt?.bind(this.terrain);
    const pin = hole.pin;
    if (!probe) return pin;
    const toPin = angleTo(ballPos, pin);
    let best: Point | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 24; i++) {
      const ang = toPin + (i / 24) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      for (let d = 12; d <= 150; d += 8) {
        const px = ballPos.x + dx * d;
        const py = ballPos.y + dy * d;
        if (px < 10 || py < 10 || px > hole.world.width - 10 || py > hole.world.height - 10) break;
        const s = probe(px, py);
        if (s === 'water') break; // never punch into water
        if (s !== 'trees') {
          // Clear ground: aim a touch past the tree line so the ball settles out.
          const exit = { x: px + dx * 16, y: py + dy * 16 };
          const es = probe(exit.x, exit.y);
          if (es !== 'trees' && es !== 'water') {
            const score = d + 0.15 * dist(exit, pin);
            if (score < bestScore) {
              bestScore = score;
              best = exit;
            }
          }
          break;
        }
      }
    }
    return best ?? pin;
  }

  /**
   * "Plays-like" elevation adjustment, in yards: a target BELOW the ball
   * extends the carry (the ground meets the falling ball later), above
   * shortens it. ~1.1yd per height unit matches a mid-iron's descent
   * geometry — the same compensation a human reads off the HUD's ▲/▼
   * elevation label. Without this the AI airmails every raised-tee par 3
   * (Devil's Kitchen sims proved it: long into the back canyon all day).
   */
  private elevPlaysLikeYds(ballPos: Point, aimPoint: Point): number {
    if (!this.terrain?.groundAt) return 0;
    const rise = this.terrain.groundAt(aimPoint.x, aimPoint.y) - this.terrain.groundAt(ballPos.x, ballPos.y);
    return rise * 1.1;
  }

  /**
   * A pitch-out spot when the direct line is blocked by a terrain WALL the
   * highest-lofted club cannot clear at that range (rise steeper than
   * ~0.57·run inside the first ~56px — a genuine cliff face, not a slope).
   * Escapes along the local downhill (breakAccel points down-slope: away
   * from the wall by construction), or straight back from the target when
   * the ground under the ball is flat. Null when the line is clear.
   */
  private wallEscapeTarget(ballPos: Point, target: Point): Point | null {
    if (!this.terrain?.groundAt) return null;
    const g0 = this.terrain.groundAt(ballPos.x, ballPos.y);
    const yaw = angleTo(ballPos, target);
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let blocked = false;
    for (let t = 10; t <= 100; t += 6) {
      const rise = this.terrain.groundAt(ballPos.x + cs * t, ballPos.y + sn * t) - g0;
      if (rise > Math.max(14, t * 0.52)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return null;
    // Escape direction: straight AWAY from the wall by default; follow the
    // local downhill instead only when it clearly agrees (a flat bowl floor
    // returns junk near-zero gradients that can point back INTO the wall).
    // The hop is sized so ONE pitch-out reaches ground with enough run-up
    // for the next shot's arc to clear the wall.
    const HOP = 120;
    const b = this.terrain.breakAccel(ballPos.x, ballPos.y);
    const l = Math.hypot(b.ax, b.ay);
    if (l > 0.5 && (b.ax * -cs + b.ay * -sn) / l > 0.3) {
      return { x: ballPos.x + (b.ax / l) * HOP, y: ballPos.y + (b.ay / l) * HOP };
    }
    return { x: ballPos.x - cs * HOP, y: ballPos.y - sn * HOP };
  }

  private chooseClub(ballPos: Point, aimPoint: Point, lie: Surface): ClubSpec {
    if (lie === 'green') return clubById('putter');
    const neededYds = Math.max(2, dist(ballPos, aimPoint) / PX_PER_YARD + this.elevPlaysLikeYds(ballPos, aimPoint));

    if (lie === 'sand') {
      // Escape club — but only while the SW can genuinely make the
      // distance. Sand cuts carry hard (lieDistance 0.55): a fixed 130yd
      // threshold sent 44yd sand wedges at 110yd targets, whose arcs died
      // against canyon walls short of the green (Devil's Kitchen sims).
      const swReach = effectiveCarryYards(clubById('sw'), this.golfer, this.fire.statBoost, lie);
      return neededYds > swReach * 1.25 ? clubById('9i') : clubById('sw');
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
  ): { swing: SwingResult; powerTarget: number } {
    // zone (the per-part touch stat) sizes the swing meter, so it governs how
    // cleanly the AI strikes BOTH meter clicks — matching the player, whose
    // perfect/good zone is set by the same touch stat. (The carry the AI plans
    // to is effectiveCarryYards below, which reads Power internally.)
    const { zone } = statsForClub(club, this.golfer, this.fire.statBoost);
    const carry = effectiveCarryYards(club, this.golfer, this.fire.statBoost, lie);
    // Full shots rate their power for the elevation-adjusted distance (putts
    // have their own slope-aware pace path below).
    const elevAdj = club.id === 'putter' ? 0 : this.elevPlaysLikeYds(ballPos, aimPoint);
    const neededYds = Math.max(1, dist(ballPos, aimPoint) / PX_PER_YARD + elevAdj);
    // Floors are ABSOLUTE distances, not power fractions — a fractional
    // floor rams tap-ins past the cup and blasts greenside chips over the
    // green (worse the higher the stat, since carry scales with it).
    const minPower = club.id === 'putter' ? 0.25 / carry : Math.min(0.35, 2.5 / carry);
    let targetPower = clamp(neededYds / carry, minPower, 1.0);
    if (club.id === 'putter') {
      // Slope-aware pace, same math as the player's meter target: uphill
      // needs more, downhill less (rolling decel along the line = μ ∓ a).
      // UPHILL also pays the climb-cost boost (PHYSICS.puttSlopePaceBoost) the
      // roll adds while climbing, so the AI rates the stroke up to match the
      // real uphill cost and doesn't chronically leave putts short (which read
      // as extra 3-putts / unfinished holes on hilly greens). Downhill is
      // untouched, mirroring the roll (the boost is climb-only).
      if (this.terrain?.slopeAccelAlong) {
        const yaw = angleTo(ballPos, aimPoint);
        const aPar = this.terrain.slopeAccelAlong(ballPos, yaw, dist(ballPos, aimPoint));
        const aParEff = aPar < 0 ? aPar * (1 + PHYSICS.puttSlopePaceBoost) : aPar;
        targetPower = clamp((targetPower * (PHYSICS.friction.green - aParEff)) / PHYSICS.friction.green, minPower, 1.0);
      }
      // Fringe putts fight ~3x green friction until they reach the surface —
      // rate the stroke up or they die well short.
      if (lie === 'fringe') targetPower = clamp(targetPower * 1.5, minPower, 1.0);
    }

    const powerBand = this.sampleBand(zone);
    const accuracyBand = this.sampleBand(zone);

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
      swing: {
        power,
        powerQuality: powerBand,
        accuracy: accOffset,
        accuracyQuality: accuracyBand
      },
      powerTarget: targetPower
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
