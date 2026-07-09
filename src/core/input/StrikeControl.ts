import { SpinState } from '../types';
import { clamp } from '../../utils/Geometry';

/** Max deterministic side curve from a full left/right strike. */
const SHAPE_STRENGTH = 0.95;
/** Launch-angle swing from a full top/bottom strike. */
const LAUNCH_STRENGTH = 0.24;

/**
 * Pre-shot shot SHAPE, set by where the strike lands on the ball face
 * (a draggable dot). This is a fixed, predictable curve — NOT the in-flight
 * spin (that comes from swiping during flight, `main.ts applySwipeSpin`).
 *
 *  - dot RIGHT of center → draw (ball flies right-to-left)
 *  - dot LEFT  of center → fade (ball flies left-to-right)
 *  - dot BELOW center     → higher launch (steeper, stops faster)
 *  - dot ABOVE center     → lower launch (flatter, runs out)
 *
 * The shape is applied to the whole flight and shown in the aim dots, so you
 * aim the curve where you want it. Pure logic — the scene renders the widget.
 */
export class StrikeControl {
  /** Dot position on the ball face, both -1..1 (y+ = above center). */
  x = 0;
  y = 0;

  /** Deterministic pre-shot curve. Right strike (x>0) draws (curves left =
   *  negative side); left strike fades (positive side). No top spin here —
   *  trajectory height comes from `launchMult`; bite/run spin is in-flight. */
  get shapeSpin(): SpinState {
    return { side: -this.x * SHAPE_STRENGTH || 0, top: 0 };
  }

  /** Launch-angle multiplier from strike height (bottom = higher). */
  get launchMult(): number {
    return 1 - this.y * LAUNCH_STRENGTH;
  }

  /** Dispersion multiplier — extreme shapes are slightly harder to strike. */
  get riskMult(): number {
    const m = Math.max(Math.abs(this.x), Math.abs(this.y));
    return 1 + Math.max(0, m - 0.6) * 0.9;
  }

  get isNeutral(): boolean {
    return this.x === 0 && this.y === 0;
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

  /** Reset the strike dot between shots. */
  resetDot(): void {
    this.x = 0;
    this.y = 0;
  }
}
