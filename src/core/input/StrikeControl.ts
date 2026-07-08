import { SpinState } from '../types';
import { clamp } from '../../utils/Geometry';

export type Trajectory = 'low' | 'normal' | 'high';

const TRAJ_LAUNCH: Record<Trajectory, number> = { low: 0.72, normal: 1, high: 1.25 };

/**
 * Pre-shot shot-shaping state (Phase 4): where on the ball face the strike
 * lands (a draggable dot) and the trajectory preset.
 *
 *  - dot left/right → draw/fade side spin
 *  - dot up (above center) → topspin: lower launch, runs out
 *  - dot down (below center) → backspin: higher launch, bites on the green
 *  - extreme positions widen dispersion (risk for reward)
 *
 * Pure logic — the scene renders the widget and feeds drags in.
 */
export class StrikeControl {
  /** Dot position on the ball face, both -1..1 (y+ = above center). */
  x = 0;
  y = 0;
  trajectory: Trajectory = 'normal';

  get spin(): SpinState {
    return { side: this.x, top: this.y };
  }

  /** Launch-angle multiplier: preset × strike height. */
  get launchMult(): number {
    return TRAJ_LAUNCH[this.trajectory] * (1 - this.y * 0.18);
  }

  /** Dispersion multiplier — pushing the strike to the edges adds risk. */
  get riskMult(): number {
    const m = Math.max(Math.abs(this.x), Math.abs(this.y));
    return m > 0.7 ? 1.5 : 1 + m * 0.35;
  }

  get isNeutral(): boolean {
    return this.x === 0 && this.y === 0 && this.trajectory === 'normal';
  }

  /** Place the dot from a pointer position relative to the widget center. */
  setFromOffset(dx: number, dy: number, radiusPx: number): void {
    const nx = dx / radiusPx;
    const ny = -dy / radiusPx; // screen y down → face y up
    const len = Math.hypot(nx, ny);
    const s = len > 1 ? 1 / len : 1;
    this.x = clamp(nx * s, -1, 1);
    this.y = clamp(ny * s, -1, 1);
  }

  setSpin(spin: SpinState): void {
    this.x = clamp(spin.side, -1, 1);
    this.y = clamp(spin.top, -1, 1);
  }

  cycleTrajectory(): Trajectory {
    this.trajectory = this.trajectory === 'normal' ? 'high' : this.trajectory === 'high' ? 'low' : 'normal';
    return this.trajectory;
  }

  /** Reset the strike dot (trajectory preset is sticky between shots). */
  resetDot(): void {
    this.x = 0;
    this.y = 0;
  }
}
