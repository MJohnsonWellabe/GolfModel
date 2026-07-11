import { HoleData } from '../core/types';

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

export class HeightField {
  private grid: Float32Array;
  private gw: number;
  private gh: number;

  constructor(points: ElevationPoint[], width: number, height: number) {
    this.gw = Math.ceil(width / CELL) + 1;
    this.gh = Math.ceil(height / CELL) + 1;
    this.grid = new Float32Array(this.gw * this.gh);
    for (let gy = 0; gy < this.gh; gy++) {
      for (let gx = 0; gx < this.gw; gx++) {
        this.grid[gy * this.gw + gx] = HeightField.sample(points, gx * CELL, gy * CELL);
      }
    }
  }

  /** Analytic sum of the control-point bumps (used to fill the grid). */
  private static sample(points: ElevationPoint[], x: number, y: number): number {
    let h = 0;
    for (const p of points) {
      const d = Math.hypot(x - p.x, y - p.y) / p.r;
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
      h += p.h * t;
    }
    return h;
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

/** Compile a hole's authored elevation (null when the hole is flat).
 *  Revetted bunkers (hazard.wall) inject a sunken negative plateau so the floor
 *  sits below the turf — both the physics and the rendered ground share it, and
 *  course3d builds the stone wall ring around the resulting pit. */
export function buildHeightField(hole: HoleData): HeightField | null {
  const pts: ElevationPoint[] = [...(hole.elevation ?? [])];
  for (const hz of hole.hazards) {
    if (hz.type !== 'bunker' || !hz.wall) continue;
    const xs = hz.polygon.map((p) => p[0]);
    const ys = hz.polygon.map((p) => p[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const r = Math.max(...hz.polygon.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    // A flat sunken floor (plateau) a touch WIDER than the trap so the whole
    // sand sits low and the skirt (where the wall stands) hugs the rim.
    pts.push({ x: cx, y: cy, h: -WALL_DEPTH, r: r + 6, shape: 'plateau' });
  }
  if (pts.length === 0) return null;
  return new HeightField(pts, hole.world.width, hole.world.height);
}

/** Depth (world units) a revetted bunker floor sinks below the turf rim. */
export const WALL_DEPTH = 3.4;
