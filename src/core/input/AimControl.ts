import { PX_PER_YARD, SWING } from '../../config';
import { CLUBS } from '../../data/clubs';
import { effectiveCarryYards, PhysicsEngine } from '../../systems/PhysicsEngine';
import { angleTo, clamp, dist } from '../../utils/Geometry';
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
   * Full-bar distance in world px. The putt bar is FIXED-length: its power
   * target always sits at the same spot (SWING.fullPowerMark) and a perfect
   * strike there rolls the ball exactly to the aim spot — a 4-ft putt and a
   * 40-ft putt show an identical bar, only the aim spot differs. So the aim
   * distance is baked into the bar's scale instead of into the target position:
   * fullPowerMark maps to the FLAT-ground aim distance.
   *
   * NO slope compensation (by design): a perfect strike is sized to the flat
   * pace for the aim distance, so uphill the ball naturally comes up short and
   * downhill it runs long. Reading the break and aiming further is the player's
   * skill — the "▲ uphill" readout is the only hint. (The AI reads greens on its
   * own in AIController.rollSwing; this only governs the human's meter.)
   */
  meterScalePx(ctx: ShotContext): number {
    if (!this.isPutting) return this.maxCarryPx(ctx);
    return this.distPx / SWING.fullPowerMark;
  }

  /** Where the power target line sits on the bar for the current aim. */
  barPowerTarget(ctx: ShotContext): number {
    if (!this.isPutting) {
      return clamp(this.distPx / this.maxCarryPx(ctx), 0.15, 1);
    }
    // Putts: the target ALWAYS sits at the same fixed spot on the bar. The aim
    // distance lives in meterScalePx instead, so a perfect strike here rolls
    // exactly to the aim spot no matter the putt length.
    return SWING.fullPowerMark;
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
    // Putts default the aim spot AT the cup, so a perfect stroke rolls the
    // ball exactly to the hole (fixed-length bar, perfect = aimed distance).
    // The player drags the aim past the hole to add pace.
    this.distPx = this.isPutting
      ? clamp(pinDist, 1, this.maxCarryPx(ctx))
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
      // Switching to the putter re-defaults the aim spot AT the cup
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
      launchMult
    });
    this.previewPath = outcome.path;
  }

  // ------------------------------------------------------------- dragging

  /** Jump the aim to a world point (overhead mode: aim follows the finger). */
  placeAim(ctx: ShotContext, world: Point): void {
    this.yaw = angleTo(ctx.ball, world);
    // Putts can be aimed right up to the cup (1px≈1.5ft); full shots keep a
    // sane 14px≈21ft minimum so a tap never arms a near-zero swing.
    this.distPx = clamp(dist(ctx.ball, world), this.isPutting ? 1 : 14, this.maxCarryPx(ctx));
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
    // Putts aim down to ~1.5ft so a short putt can be aimed at the cup (was a
    // 21ft floor); full shots keep the 14px floor.
    this.distPx = clamp(this.distPx - dy * DIST_PER_PX, this.isPutting ? 1 : 14, this.maxCarryPx(ctx));
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
