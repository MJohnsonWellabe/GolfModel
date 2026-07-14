import { HoleData } from '../core/types';
import { pointInGreens } from '../utils/Geometry';

/**
 * Authored macro-terrain for a hole: a sum of radial control-point bumps
 * compiled into a sampled grid. Hand-authorable and diffable — each entry in
 * a hole's `elevation` array is a dome (smooth hill) or plateau (flat top
 * with a smooth falloff skirt) at a world position.
 *
 * Physics, the ground mesh, cameras and placement all sample the same
 * compiled field, so the ball always sits on the terrain the player sees.
 * A hole with no `elevation` entries gets NO HeightField (null) — the engine
 * then behaves bit-identically to the original flat build, which keeps the
 * pre-elevation test suite as the regression gate.
 */

export interface ElevationPoint {
  x: number;
  y: number;
  /** Peak height, world units (ball diameter = 1). Negative digs a hollow. */
  h: number;
  /** Falloff radius, world px. */
  r: number;
  /** dome = smooth hill; plateau = flat top (inner 55%) with smooth skirt. */
  shape?: 'dome' | 'plateau';
}

const CELL = 8; // grid resolution, world px — smooth macro terrain only

/** Keep-clear buffer (world px) beyond the green/fringe a bunker's dish rim
 *  must respect — a greenside trap is common, and its pothole must never
 *  bleed a slope or crater into the putting surface itself. */
const GREEN_KEEPOUT = 24;

/** Shrink `desiredR` (in 4px steps) until no sample around the dish's outer
 *  rim falls inside the green (padded by GREEN_KEEPOUT) — cheap, one-time,
 *  hole-build-only work, and robust to the green's real shape (rotated,
 *  wobbled, lobed) since it reuses the same pointInGreens the rest of the
 *  game plays by, rather than an approximate circle. */
function maxRadiusClearOfGreen(hole: HoleData, cx: number, cy: number, desiredR: number): number {
  const SAMPLES = 16;
  let r = desiredR;
  while (r > 0) {
    let hits = false;
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * Math.PI * 2;
      if (pointInGreens(cx + Math.cos(a) * r, cy + Math.sin(a) * r, hole.green, hole.green2, GREEN_KEEPOUT)) {
        hits = true;
        break;
      }
    }
    if (!hits) return r;
    r -= 4;
  }
  return 0;
}

export class HeightField {
  private grid: Float32Array;
  private gw: number;
  private gh: number;

  constructor(points: ElevationPoint[], width: number, height: number) {
    this.gw = Math.ceil(width / CELL) + 1;
    this.gh = Math.ceil(height / CELL) + 1;
    this.grid = new Float32Array(this.gw * this.gh);
    // Splat each point into only the cells its radius touches — the old
    // per-cell scan over EVERY point was O(grid × points), which turned the
    // headless simulator's per-round field builds into the bottleneck once
    // the rolling-hills pass multiplied the authored point counts (~70/hole).
    // Same math, same result, ~50× less work.
    for (const p of points) {
      const gx0 = Math.max(0, Math.floor((p.x - p.r) / CELL));
      const gx1 = Math.min(this.gw - 1, Math.ceil((p.x + p.r) / CELL));
      const gy0 = Math.max(0, Math.floor((p.y - p.r) / CELL));
      const gy1 = Math.min(this.gh - 1, Math.ceil((p.y + p.r) / CELL));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const d = Math.hypot(gx * CELL - p.x, gy * CELL - p.y) / p.r;
          if (d >= 1) continue;
          let t: number;
          if (p.shape === 'plateau') {
            // Flat inner 55%, smoothstep skirt to the rim
            const s = Math.min(1, Math.max(0, (d - 0.55) / 0.45));
            t = 1 - s * s * (3 - 2 * s);
          } else {
            const s = 1 - d;
            t = s * s * (3 - 2 * s); // smoothstep dome
          }
          this.grid[gy * this.gw + gx] += p.h * t;
        }
      }
    }
  }

  /** Bilinear height at a world point (clamped at the field edges). */
  heightAt(x: number, y: number): number {
    const fx = Math.min(Math.max(x / CELL, 0), this.gw - 1.001);
    const fy = Math.min(Math.max(y / CELL, 0), this.gh - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const g = this.grid;
    const w = this.gw;
    const h00 = g[y0 * w + x0];
    const h10 = g[y0 * w + x0 + 1];
    const h01 = g[(y0 + 1) * w + x0];
    const h11 = g[(y0 + 1) * w + x0 + 1];
    return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
  }

  /** Terrain gradient (∂h/∂x, ∂h/∂y) — points uphill; units height/px. */
  gradientAt(x: number, y: number): { x: number; y: number } {
    const e = CELL;
    return {
      x: (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e),
      y: (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e)
    };
  }
}

/** Compile a hole's authored elevation (null when the hole is flat). Every
 *  bunker injects a sunken negative point so the sand actually sits below the
 *  turf rim — both the physics and the rendered ground mesh share the same
 *  HeightField, so a bunker reads as a real pothole scooped out of the
 *  ground instead of a flat disc of sand painted onto level turf. Revetted
 *  bunkers (hazard.wall) sink a flat plateau floor (course3d builds the
 *  stacked-stone wall ring around the resulting pit); ordinary bunkers get a
 *  shallower, rounded dome dish so they read as a natural hollow. Beach/waste
 *  sand stays flat — a coastal band or a sprawling links waste area is
 *  ground-level sand, not a dug trap. */
export function buildHeightField(hole: HoleData): HeightField | null {
  const pts: ElevationPoint[] = [...(hole.elevation ?? [])];
  for (const hz of hole.hazards) {
    if (hz.type !== 'bunker') continue;
    const xs = hz.polygon.map((p) => p[0]);
    const ys = hz.polygon.map((p) => p[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const r = Math.max(...hz.polygon.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    if (hz.wall) {
      // A flat sunken floor (plateau) a touch WIDER than the trap so the whole
      // sand sits low and the skirt (where the wall stands) hugs the rim.
      pts.push({ x: cx, y: cy, h: -WALL_DEPTH, r: r + 6, shape: 'plateau' });
    } else if (!hz.beach && !hz.waste) {
      // A smooth, rounded dish (dome, not a flat floor) so an ordinary trap
      // reads as a natural hollow carved into the hillside, with the turf
      // rim (and its fescue lip) sloping down into the sand. Clamped clear of
      // the green — a greenside bunker's pothole must never crater the
      // putting surface it sits beside.
      const dishR = maxRadiusClearOfGreen(hole, cx, cy, r + 12);
      if (dishR > 0) pts.push({ x: cx, y: cy, h: -DISH_DEPTH, r: dishR });
    }
  }
  if (pts.length === 0) return null;
  return new HeightField(pts, hole.world.width, hole.world.height);
}

/** Depth (world units) a revetted bunker floor sinks below the turf rim. */
export const WALL_DEPTH = 3.4;
/** Depth (world units) an ordinary (non-revetted) bunker's dish sinks below
 *  the turf rim — shallower than a walled pot bunker, so it reads as a
 *  natural hollow scooped out of the hillside rather than a dug pit. */
export const DISH_DEPTH = 1.4;
