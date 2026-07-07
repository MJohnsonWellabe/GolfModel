import { GAME_WIDTH } from '../../config';
import { Point, TrajectoryPoint } from '../types';
import { PerspCamera } from './Projection';

/** Screen y of the horizon for the standard shot view. */
export const HORIZON_SWING = 430;
/** Screen y of the horizon for the low, intimate putting view. */
export const HORIZON_PUTT = 400;

/** Per-mode exponential smoothing rates (1/s) — higher = tighter follow. */
const EASE = { setup: 4.5, flight: 8, landing: 4 } as const;

type CamMode = keyof typeof EASE;

/** The behind-the-player framing used while aiming (was PerspectiveView.setCamera). */
export function setupCamera(ball: Point, yaw: number, putting: boolean): PerspCamera {
  return putting
    ? {
        x: ball.x - Math.cos(yaw) * 26,
        y: ball.y - Math.sin(yaw) * 26,
        yaw,
        height: 22,
        focal: 620,
        horizonY: HORIZON_PUTT,
        centerX: GAME_WIDTH / 2
      }
    : {
        x: ball.x - Math.cos(yaw) * 50,
        y: ball.y - Math.sin(yaw) * 50,
        yaw,
        height: 40,
        focal: 520,
        horizonY: HORIZON_SWING,
        centerX: GAME_WIDTH / 2
      };
}

/** Shortest-arc angle interpolation. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Drives the perspective camera cinematically:
 * - setup: eases between players/aims instead of snapping
 * - flight: chase cam trailing the airborne ball, rising with its height
 * - landing: settles behind the touchdown point to watch the rollout
 *
 * `tick` smooths the live camera toward the current target and reports
 * whether it actually moved, so the ground is only redrawn while the
 * camera is in motion (idle frames cost nothing extra).
 */
export class CameraDirector {
  private cur: PerspCamera | null = null;
  private target: PerspCamera;
  private mode: CamMode = 'setup';
  private wasMoving = false;
  /** Forces one apply even when the camera snapped straight to its target. */
  private dirty = true;

  constructor() {
    this.target = setupCamera({ x: 0, y: 0 }, 0, false);
  }

  /** Aim/turn framing. Snaps on the first call of a hole, eases afterwards. */
  setSetupTarget(ball: Point, yaw: number, putting: boolean): void {
    this.mode = 'setup';
    this.target = setupCamera(ball, yaw, putting);
    if (!this.cur) {
      this.cur = { ...this.target };
      this.dirty = true;
    }
  }

  /** Chase the airborne ball along the launch direction. */
  setFlightTarget(pos: TrajectoryPoint, dir: number): void {
    this.mode = 'flight';
    const trail = 60 + pos.z * 0.35;
    this.target = {
      x: pos.x - Math.cos(dir) * trail,
      y: pos.y - Math.sin(dir) * trail,
      yaw: dir,
      height: 40 + pos.z * 0.45,
      focal: 520,
      horizonY: HORIZON_SWING,
      centerX: GAME_WIDTH / 2
    };
  }

  /** Settle behind the touchdown point and watch the bounce + rollout. */
  setLandingTarget(pos: Point, dir: number): void {
    this.mode = 'landing';
    this.target = {
      x: pos.x - Math.cos(dir) * 110,
      y: pos.y - Math.sin(dir) * 110,
      yaw: dir,
      height: 30,
      focal: 520,
      horizonY: HORIZON_SWING,
      centerX: GAME_WIDTH / 2
    };
  }

  /**
   * Advance the smoothing. Returns the live camera and whether it moved
   * this frame (callers skip the ground redraw when it did not).
   */
  tick(deltaMs: number): { cam: PerspCamera; moved: boolean } {
    if (!this.cur) this.cur = { ...this.target };
    const c = this.cur;
    const t = this.target;

    const arrived =
      Math.abs(c.x - t.x) < 0.5 &&
      Math.abs(c.y - t.y) < 0.5 &&
      Math.abs(c.height - t.height) < 0.3 &&
      Math.abs(c.focal - t.focal) < 1 &&
      Math.abs(c.horizonY - t.horizonY) < 0.5 &&
      Math.abs(lerpAngle(c.yaw, t.yaw, 1) - c.yaw) < 0.0015;

    if (arrived) {
      const moved = this.wasMoving || this.dirty;
      this.cur = { ...t };
      this.wasMoving = false;
      this.dirty = false;
      return { cam: this.cur, moved };
    }

    const k = 1 - Math.exp(-(deltaMs / 1000) * EASE[this.mode]);
    c.x += (t.x - c.x) * k;
    c.y += (t.y - c.y) * k;
    c.yaw = lerpAngle(c.yaw, t.yaw, k);
    c.height += (t.height - c.height) * k;
    c.focal += (t.focal - c.focal) * k;
    c.horizonY += (t.horizonY - c.horizonY) * k;
    this.wasMoving = true;
    return { cam: c, moved: true };
  }
}
