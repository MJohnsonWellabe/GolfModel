import { PHYSICS, PX_PER_YARD } from '../../config';
import { CLUBS } from '../../data/clubs';
import { effectiveCarryYards, PhysicsEngine } from '../../systems/PhysicsEngine';
import { angleTo, clamp, dist } from '../../utils/Geometry';
import {
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  Surface,
  TrajectoryPoint,
  Wind
} from '../types';

/** Everything about the hitter that club/aim decisions depend on. */
export interface ShotContext {
  ball: Point;
  lie: Surface;
  golfer: Golfer;
  fireBoost: number;
}

/** Pointer drag: tap jitter below this (screen px) never nudges the aim. */
const DRAG_DEAD_ZONE = 12;
/** Radians of yaw per horizontal screen px dragged in the shot view. */
const YAW_PER_PX = 0.0032;
/** World px of aim distance per vertical screen px dragged. */
const DIST_PER_PX = 1.1;

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
    private readonly engine: PhysicsEngine
  ) {}

  get club(): ClubSpec {
    return CLUBS[this.clubIdx];
  }

  get isPutting(): boolean {
    return this.club.id === 'putter';
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
   * Full-bar distance in world px. Putts scale the bar to the aim spot:
   * a full stroke rolls exactly to where you're aiming, so aiming farther
   * makes every real distance a smaller fraction of the bar.
   */
  meterScalePx(ctx: ShotContext): number {
    return this.isPutting ? this.distPx : this.maxCarryPx(ctx);
  }

  /** Where the power target line sits on the bar for the current aim. */
  barPowerTarget(ctx: ShotContext): number {
    if (!this.isPutting) {
      return clamp(this.distPx / this.maxCarryPx(ctx), 0.15, 1);
    }
    // Putts: the target is the power needed to reach the HOLE, as a fraction
    // of a full stroke to the aim spot — aim farther and the target slides
    // toward the start of the bar. Slope-aware: uphill needs more,
    // downhill less (rolling decel along the aim is mu - a_parallel). The
    // engine samples the real terrain gradient when the hole has one.
    const pinDist = dist(ctx.ball, this.hole.pin);
    const mu = PHYSICS.friction.green;
    const aPar = this.engine.slopeAccelAlong(ctx.ball, this.yaw, pinDist);
    const effectivePinDist = pinDist * ((mu - aPar) / mu);
    return clamp(effectivePinDist / this.distPx, 0.05, 1);
  }

  /** Convert a bar fraction to the physics engine's power units. */
  barToPhysicsPower(barPower: number, ctx: ShotContext): number {
    if (!this.isPutting) return barPower;
    return (barPower * this.meterScalePx(ctx)) / this.maxCarryPx(ctx);
  }

  /** Default aim: at the pin, clamped to a full swing with the current club. */
  resetAim(ctx: ShotContext): void {
    this.yaw = angleTo(ctx.ball, this.hole.pin);
    const pinDist = dist(ctx.ball, this.hole.pin);
    // Putts default the aim spot ~30% past the cup so the target line
    // starts around three-quarters of the bar.
    this.distPx = this.isPutting
      ? clamp(pinDist * 1.3, 20, this.maxCarryPx(ctx))
      : Math.min(pinDist, this.maxCarryPx(ctx));
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
    if (this.isPutting) {
      // Switching to the putter re-defaults the aim spot past the cup
      this.distPx = clamp(dist(ctx.ball, this.hole.pin) * 1.3, 20, this.maxCarryPx(ctx));
    } else {
      // Keep aiming at the same spot when possible; clamp to the new club's reach
      this.distPx = Math.min(this.distPx, this.maxCarryPx(ctx));
    }
  }

  setClubById(id: string): void {
    const idx = CLUBS.findIndex((c) => c.id === id);
    if (idx >= 0) this.clubIdx = idx;
  }

  /** Deterministic dry-run of a perfect swing at the aim point. */
  computePreview(ctx: ShotContext, wind: Wind): void {
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
      wind,
      hole: this.hole,
      preview: true
    });
    this.previewPath = outcome.path;
  }

  // ------------------------------------------------------------- dragging

  /** Jump the aim to a world point (overhead mode: aim follows the finger). */
  placeAim(ctx: ShotContext, world: Point): void {
    this.yaw = angleTo(ctx.ball, world);
    this.distPx = clamp(dist(ctx.ball, world), 14, this.maxCarryPx(ctx));
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
    this.yaw += dx * YAW_PER_PX;
    this.distPx = clamp(this.distPx - dy * DIST_PER_PX, 14, this.maxCarryPx(ctx));
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
