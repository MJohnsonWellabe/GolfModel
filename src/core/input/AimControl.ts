import { PHYSICS, PX_PER_YARD, SWING } from '../../config';
import { CLUBS } from '../../data/clubs';
import { effectiveCarryYards, PhysicsEngine } from '../../systems/PhysicsEngine';
import { angleTo, clamp, dist } from '../../utils/Geometry';
import { CHIP_GRID_YDS } from '../puttAids';
import {
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  SpinState,
  Surface,
  TrajectoryPoint
} from '../types';

/** Everything about the hitter that club/aim decisions depend on. */
export interface ShotContext {
  ball: Point;
  lie: Surface;
  golfer: Golfer;
  fireBoost: number;
  /** Strokes already played on this hole (0 = tee shot). */
  strokes: number;
}

/** Pointer drag: tap jitter below this (screen px) never nudges the aim. */
const DRAG_DEAD_ZONE = 12;
/** Radians of yaw per horizontal screen px dragged in the shot view.
 *  Halved on playtest ("aiming in general is too sensitive") so a slow drag
 *  makes deliberate micro-adjustments. */
const YAW_PER_PX = 0.0017;
/** Putts (and chips — see isChipping) aim over much shorter distances, so the
 *  same yaw-per-px swings the aim point too far on the green — a much finer
 *  rate for micro-movements (playtest: "putting aim is too touchy"). */
const PUTT_YAW_PER_PX = 0.00045;
/** World px of aim distance per vertical screen px dragged. */
const DIST_PER_PX = 0.6;
/** Finer pace drag for putts/chips (short distances magnify every px). Lowered
 *  again on playtest ("putting aim up/down still moves too fast") for finer
 *  distance control. */
const PUTT_DIST_PER_PX = 0.12;

/**
 * Shot setup: which club, where you're aiming, and the preview arc.
 * Also owns the putt meter scaling — a full putt stroke rolls exactly to the
 * aim spot, so the bar's power target is derived from the pin distance and
 * the green's slope along the aim line.
 *
 * Pure state + math; the scene renders the results and re-arms the meter.
 */
export class AimControl {
  /** Aim direction from the ball, radians in world space. */
  yaw = 0;
  /** Aim distance from the ball, world px. */
  distPx = 100;
  previewPath: TrajectoryPoint[] | null = null;

  private clubIdx = 0;
  private dragStart: Point | null = null;
  private dragLast: Point | null = null;
  private dragMoved = false;

  constructor(
    private readonly hole: HoleData,
    private readonly engine: PhysicsEngine,
    /** Slope-aware engine used ONLY for PACE queries (putt power comp). The real
     *  game passes the terrain+slope shot engine (engine2d) here while `engine`
     *  stays the FLAT preview engine, so the aim LINE never reveals slope/wind
     *  (computePreview/surfaceAt run on `engine`) but the putt POWER math reads
     *  the true green break. Defaults to `engine` for callers that build a
     *  single slope-aware engine (tests, AI). */
    private readonly slopeEngine: PhysicsEngine = engine
  ) {}

  get club(): ClubSpec {
    return CLUBS[this.clubIdx];
  }

  get isPutting(): boolean {
    return this.club.id === 'putter';
  }

  /** True for a chip: the sand wedge, played from within CHIP_GRID_YDS of the
   *  pin (the same greenside range the putting-read grid already shows for —
   *  see puttAids.ts). A chip keeps the sand wedge's normal ball flight/spin —
   *  only the aim/power mechanic changes to the putt-style "aim distance IS
   *  the target" model (see isDistanceAimed), since a short bump-and-run isn't
   *  a full swing. */
  isChipping(ctx: ShotContext): boolean {
    return this.club.id === 'sw' && dist(ctx.ball, this.hole.pin) / PX_PER_YARD <= CHIP_GRID_YDS;
  }

  /** Putts AND chips aim by DISTANCE: a perfect stroke at the bar's power
   *  target sends the ball exactly to the aim spot, so the aim distance itself
   *  IS the full-power target instead of a fraction of the club's max carry. */
  private isDistanceAimed(ctx: ShotContext): boolean {
    return this.isPutting || this.isChipping(ctx);
  }

  aimPoint(ball: Point): Point {
    return {
      x: ball.x + Math.cos(this.yaw) * this.distPx,
      y: ball.y + Math.sin(this.yaw) * this.distPx
    };
  }

  /** Full-power carry with the current club from the current lie, world px. */
  maxCarryPx(ctx: ShotContext): number {
    return effectiveCarryYards(this.club, ctx.golfer, ctx.fireBoost, ctx.lie) * PX_PER_YARD;
  }

  /**
   * Full-bar distance in world px. The putt/chip bar is FIXED-length: its
   * power target always sits at the same spot (SWING.fullPowerMark) and a
   * perfect strike there rolls/flies the ball exactly to the aim spot — a
   * 4-ft putt and a 40-ft putt (or a 10-yd chip and a 45-yd chip) show an
   * identical bar, only the aim spot differs. So the aim distance is baked
   * into the bar's scale instead of into the target position: fullPowerMark
   * maps to the aim distance. Putts include first-order green-slope pace so a
   * perfect stroke at the target reaches the aimed spot even on long uphill
   * reads; the player still owns the line/break and can add or take off pace by
   * dragging the aim.
   */
  meterScalePx(ctx: ShotContext): number {
    if (!this.isDistanceAimed(ctx)) return this.maxCarryPx(ctx);
    let targetPx = this.distPx;
    if (this.isPutting) {
      // PACE uses the REAL slope engine (see slopeEngine): on the flat preview
      // engine slopeAccelAlong is always 0, so uphill putts came up short and
      // downhill ran long (no compensation). The aim LINE stays flat.
      const along = this.slopeEngine.slopeAccelAlong(ctx.ball, this.yaw, this.distPx);
      // PhysicsEngine's putter launch uses v² = 2·μ·carryPx, then the real
      // integrator applies the green's acceleration along the putt. Solve the
      // matching constant-acceleration distance equation for the carry value
      // that stops at the aimed distance: carry = D·(μ - aAlong)/μ.
      const mu = PHYSICS.friction.green;
      const slopePace = (mu - along) / mu;
      targetPx *= clamp(slopePace > 1 ? 1 + (slopePace - 1) * 1.25 : slopePace, 0.45, 1.9);
    }
    return targetPx / SWING.fullPowerMark;
  }

  /** Where the power target line sits on the bar for the current aim. */
  barPowerTarget(ctx: ShotContext): number {
    if (!this.isDistanceAimed(ctx)) {
      return clamp(this.distPx / this.maxCarryPx(ctx), 0.15, 1);
    }
    // Putts/chips: the target ALWAYS sits at the same fixed spot on the bar.
    // The aim distance lives in meterScalePx instead, so a perfect
    // stroke/swing here sends the ball exactly to the aim spot no matter the
    // putt/chip length.
    return SWING.fullPowerMark;
  }

  /** Convert a bar fraction to the physics engine's power units. */
  barToPhysicsPower(barPower: number, ctx: ShotContext): number {
    if (!this.isDistanceAimed(ctx)) return barPower;
    return (barPower * this.meterScalePx(ctx)) / this.maxCarryPx(ctx);
  }

  /** Default aim: a sensible, DRY target. Putts/chips default at the pin. Full
   *  shots prefer the flag once the green is in reach (playtest: "just aim at
   *  the green"); otherwise the authored fairway waypoint that best matches a
   *  full swing, so a dogleg drive aims down the leg instead of at a pin
   *  hidden behind the corner. Whatever is preferred, the armed aim POINT must
   *  land on dry ground — a default that overshoots a dogleg elbow into a lake
   *  (Port Johnson 3 off the tee) or points a lay-up across water falls
   *  through to the next candidate. */
  resetAim(ctx: ShotContext): void {
    const pinDist = dist(ctx.ball, this.hole.pin);
    const maxCarry = this.maxCarryPx(ctx);
    if (this.isDistanceAimed(ctx)) {
      // Putts/chips default the aim spot AT the pin, so a perfect stroke/swing
      // sends the ball exactly to the hole (fixed-length bar, perfect = aimed
      // distance). The player drags the aim past the pin to add pace.
      this.yaw = angleTo(ctx.ball, this.hole.pin);
      this.distPx = clamp(pinDist, 1, maxCarry);
      return;
    }
    // Candidates in preference order: pin first whenever the green is in reach
    // or the tee shot is behind us, then the route waypoints, then the pin as
    // the final fallback (par 3s author no route).
    const candidates: Point[] = [];
    // Reachable shots — including par-3 tee shots and approaches — should aim
    // at the green/flag first. Unreachable tee shots should use the strategic
    // route near practical carry before falling back to the pin line.
    if (ctx.strokes >= 1 || pinDist <= maxCarry) candidates.push(this.hole.pin);
    candidates.push(...this.routePointsAhead(ctx.ball, Math.min(pinDist, maxCarry)));
    if (!candidates.includes(this.hole.pin)) candidates.push(this.hole.pin);
    // Armed distance for a candidate. The PIN is aimed AT (an approach must not
    // overswing the green). A strategic ROUTE waypoint instead arms a FULL carry
    // down its line — a tee shot lays OUT down the corridor rather than clubbing
    // down to the elbow: capping distPx at the nearest waypoint threw away
    // 10-33yd of a strong driver's carry (Wildwood 3 "The Long Meadow", whose T0
    // sits ~255yd out). The armed LANDING point must be dry, so the wetness probe
    // now tests the FULL-carry point, not the (often short) waypoint.
    const armDist = (t: Point): number =>
      t === this.hole.pin ? Math.min(dist(ctx.ball, t), maxCarry) : maxCarry;
    let pick = candidates[0];
    for (const t of candidates) {
      const yaw = angleTo(ctx.ball, t);
      const d = armDist(t);
      const wet =
        this.engine.surfaceAt(ctx.ball.x + Math.cos(yaw) * d, ctx.ball.y + Math.sin(yaw) * d) ===
        'water';
      if (!wet) {
        pick = t;
        break;
      }
    }
    this.yaw = angleTo(ctx.ball, pick);
    // Full carry down the chosen line (or AT the pin) — but never park the
    // default aim in water: if the full-carry point is wet, lay up to the
    // longest dry distance short of it.
    this.distPx = this.dryAimDistance(ctx.ball, this.yaw, armDist(pick));
  }

  /** Longest aim distance (≤ `maxDist`, world px) down `yaw` whose LANDING point
   *  is dry. Arms the full carry when the corridor is dry there; otherwise steps
   *  back to lay up short of the water so the default aim never parks in a
   *  hazard. The ball rests on land, so a short distance is always dry. */
  private dryAimDistance(from: Point, yaw: number, maxDist: number): number {
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    const step = PX_PER_YARD * 3; // 3yd back-off granularity
    for (let d = maxDist; d > step; d -= step) {
      if (this.engine.surfaceAt(from.x + dx * d, from.y + dy * d) !== 'water') return d;
    }
    return Math.min(maxDist, step);
  }

  /** Fairway waypoints ahead of the ball (closer to the pin than the ball is),
   *  ordered by how well each matches the armed shot distance — so a drive
   *  prefers the waypoint a full swing actually reaches, not the elbow 100
   *  yards out whose line the ball would overfly into trouble. */
  private routePointsAhead(ball: Point, armedPx: number): Point[] {
    const pinDist = dist(ball, this.hole.pin);
    return (this.hole.aiTargets ?? [])
      .filter((t) => dist(t, this.hole.pin) < pinDist - 8) // progress toward the green
      .sort((a, b) => Math.abs(dist(ball, a) - armedPx) - Math.abs(dist(ball, b) - armedPx));
  }

  /** Pick the sensible club for the current lie and distance. */
  autoSelectClub(ctx: ShotContext): void {
    const needed = this.engine.yardsToPin(ctx.ball);
    let id: string;
    if (ctx.lie === 'green') {
      id = 'putter';
    } else if (ctx.lie === 'sand') {
      id = needed > 130 ? '9i' : 'sw';
    } else if (ctx.lie === 'fringe' && needed < 35) {
      id = 'putter';
    } else {
      id = 'driver';
      for (let i = CLUBS.length - 2; i >= 0; i--) {
        const carry = effectiveCarryYards(CLUBS[i], ctx.golfer, ctx.fireBoost, ctx.lie);
        if (carry >= needed) {
          id = CLUBS[i].id;
          break;
        }
      }
    }
    this.setClubById(id);
  }

  /** Step through the bag, re-clamping the aim to the new club's reach. */
  cycleClub(dir: number, ctx: ShotContext): void {
    this.clubIdx = (this.clubIdx + dir + CLUBS.length) % CLUBS.length;
    if (this.isDistanceAimed(ctx)) {
      // Switching to the putter (or into chip range with the sand wedge)
      // re-defaults the aim spot AT the pin.
      this.distPx = clamp(dist(ctx.ball, this.hole.pin), 1, this.maxCarryPx(ctx));
    } else {
      // Keep aiming at the same spot when possible; clamp to the new club's reach
      this.distPx = Math.min(this.distPx, this.maxCarryPx(ctx));
    }
  }

  setClubById(id: string): void {
    const idx = CLUBS.findIndex((c) => c.id === id);
    if (idx >= 0) this.clubIdx = idx;
  }

  /**
   * Deterministic dry-run of a perfect swing at the aim point, showing the
   * chosen shot SHAPE. Runs on a flat, windless engine (the caller passes a
   * no-slope preview engine) so the aim line NEVER accounts for wind or
   * slope — the player must estimate hold-off themselves. The shape spin
   * curves the line so you can aim the draw/fade where you want it.
   */
  computePreview(ctx: ShotContext, shape: SpinState = { side: 0, top: 0 }, launchMult = 1): void {
    const powerTarget = this.barToPhysicsPower(this.barPowerTarget(ctx), ctx);
    const outcome = this.engine.simulate({
      origin: ctx.ball,
      aimAngle: this.yaw,
      swing: {
        power: powerTarget,
        powerQuality: 'perfect',
        accuracy: 0,
        accuracyQuality: 'perfect'
      },
      club: this.club,
      golfer: ctx.golfer,
      fireBoost: ctx.fireBoost,
      lie: ctx.lie,
      wind: { angle: 0, speed: 0 },
      hole: this.hole,
      preview: true,
      spin: shape,
      launchMult,
      // Match the ACTUAL shot's tree hitbox: a recovery shot (strokes >= 1) uses
      // the smaller `treeRecoveryMult` canopy, so the preview must too — else the
      // aim line predicts a tree contact the real forgiving shot clears (playtest:
      // "shows I'll hit a tree from under it, but I don't once I'm already in").
      stroke: ctx.strokes
    });
    this.previewPath = outcome.path;
  }

  // ------------------------------------------------------------- dragging

  /** Jump the aim to a world point (overhead mode: aim follows the finger). */
  placeAim(ctx: ShotContext, world: Point): void {
    this.yaw = angleTo(ctx.ball, world);
    // Putts/chips can be aimed right up close (1px≈1.5ft); full shots keep a
    // sane 14px≈21ft minimum so a tap never arms a near-zero swing.
    this.distPx = clamp(dist(ctx.ball, world), this.isDistanceAimed(ctx) ? 1 : 14, this.maxCarryPx(ctx));
  }

  beginDrag(screen: Point): void {
    this.dragStart = { ...screen };
    this.dragLast = { ...screen };
    this.dragMoved = false;
  }

  /**
   * Shot-view drag: horizontal rotates the aim, vertical changes distance,
   * after a small dead zone so taps don't nudge it. Returns true when the
   * aim changed (the scene then re-arms the meter and refreshes the view).
   */
  moveDrag(ctx: ShotContext, screen: Point): boolean {
    if (!this.dragStart || !this.dragLast) return false;
    if (!this.dragMoved) {
      const fromStart =
        Math.abs(screen.x - this.dragStart.x) + Math.abs(screen.y - this.dragStart.y);
      if (fromStart < DRAG_DEAD_ZONE) return false;
      this.dragMoved = true;
      this.dragLast = { ...screen };
      return false;
    }
    const dx = screen.x - this.dragLast.x;
    const dy = screen.y - this.dragLast.y;
    this.dragLast = { ...screen };
    const distanceAimed = this.isDistanceAimed(ctx);
    this.yaw += dx * (distanceAimed ? PUTT_YAW_PER_PX : YAW_PER_PX);
    // Putts/chips aim down to ~1.5ft so a short one can be aimed at the pin
    // (was a 21ft floor); full shots keep the 14px floor.
    const distPerPx = distanceAimed ? PUTT_DIST_PER_PX : DIST_PER_PX;
    this.distPx = clamp(this.distPx - dy * distPerPx, distanceAimed ? 1 : 14, this.maxCarryPx(ctx));
    return true;
  }

  get isDragging(): boolean {
    return this.dragStart !== null;
  }

  endDrag(): void {
    this.dragStart = null;
    this.dragLast = null;
    this.dragMoved = false;
  }
}
