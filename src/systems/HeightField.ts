import { HoleData } from '../core/types';
import { pointInGreens } from '../utils/Geometry';
import { hash2 } from './treeField';

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
  /** Optional segment end (terrain identity pass): when set, distance is
   *  measured to the SEGMENT (x,y)→(x2,y2) instead of the point — one entry
   *  becomes a long dune ridge, valley wall, bench or canyon rim rather than
   *  an isolated circular bump. */
  x2?: number;
  y2?: number;
  /** Plateau flat-fraction override (default 0.55). 0.8–0.92 gives a
   *  near-vertical cliff face at the grid resolution — mesa sides, canyon
   *  walls, blowout lips. Ignored for domes. */
  skirt?: number;
}

const CELL = 8; // grid resolution, world px — smooth macro terrain only

/** Keep-clear buffer (world px) beyond the green/fringe a bunker's dish rim
 *  must respect — a greenside trap is common, and its pothole must never
 *  bleed a slope or crater into the putting surface itself. Exported so other
 *  systems that need the same "does this bunker's centroid sit on the green"
 *  test (course3d/CourseTexture's bunker-lip fescue) use the identical
 *  clearance rather than a second hand-tuned constant that could drift. */
export const GREEN_KEEPOUT = 24;

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

/** Deterministic 1-2 small dome mounds tucked against a bunker's OUTER rim
 *  (the side away from the green) — generalizes the "sitting in a dune" look
 *  Port Johnson's hand-authored elevation gives its traps to every ordinary
 *  bunker on every course, without hand-authoring per hole. Kept on the
 *  non-green side so it never competes with course3d's green-side fescue
 *  lip, and clamped clear of the green the same way the dish is. */
function addFlankingMounds(hole: HoleData, cx: number, cy: number, r: number, pts: ElevationPoint[]): void {
  const gx = hole.green.cx - cx;
  const gy = hole.green.cy - cy;
  const glen = Math.hypot(gx, gy) || 1;
  const outAngle = Math.atan2(-gy / glen, -gx / glen); // away from the green
  const moundCount = hash2(cx * 1.3 + 2, cy * 0.7 - 3) < 0.45 ? 1 : 2;
  for (let k = 0; k < moundCount; k++) {
    // First mound anywhere within ±80° of straight outward; the second (if
    // any) is rotated well clear of the first so the pair genuinely FLANKS
    // the bunker (one to each side) instead of stacking on one spot.
    const spread =
      k === 0
        ? (hash2(cx + 11, cy - 11) - 0.5) * ((160 * Math.PI) / 180)
        : (hash2(cx - 17, cy + 19) - 0.5) * ((60 * Math.PI) / 180) +
          Math.PI * (hash2(cx + 5, cy + 5) < 0.5 ? 0.55 : -0.55);
    const angle = outAngle + spread;
    const moundR = 40 + hash2(cx + k * 7, cy + k * 13) * 20; // 40-60, matches Port Johnson's examples
    const dist = r + moundR * 0.45; // overlaps the dish's outer rim slightly — no flat moat between them
    const mx = cx + Math.cos(angle) * dist;
    const my = cy + Math.sin(angle) * dist;
    const clampedR = maxRadiusClearOfGreen(hole, mx, my, moundR);
    if (clampedR <= 0) continue;
    const h = 1.5 + hash2(cx + k * 3, cy - k * 5) * 1.0; // 1.5-2.5, matches Port Johnson's examples
    pts.push({ x: mx, y: my, h, r: clampedR });
  }
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
      const x2 = p.x2 ?? p.x;
      const y2 = p.y2 ?? p.y;
      const gx0 = Math.max(0, Math.floor((Math.min(p.x, x2) - p.r) / CELL));
      const gx1 = Math.min(this.gw - 1, Math.ceil((Math.max(p.x, x2) + p.r) / CELL));
      const gy0 = Math.max(0, Math.floor((Math.min(p.y, y2) - p.r) / CELL));
      const gy1 = Math.min(this.gh - 1, Math.ceil((Math.max(p.y, y2) + p.r) / CELL));
      const dx = x2 - p.x;
      const dy = y2 - p.y;
      const segLen2 = dx * dx + dy * dy;
      // Plateau flat fraction: default 0.55; higher = steeper skirt (cliff).
      const flat = Math.min(0.95, Math.max(0.05, p.skirt ?? 0.55));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const wx = gx * CELL;
          const wy = gy * CELL;
          // Distance to the segment (degenerates to the point when no x2/y2).
          let px = p.x;
          let py = p.y;
          if (segLen2 > 0) {
            const tt = Math.min(1, Math.max(0, ((wx - p.x) * dx + (wy - p.y) * dy) / segLen2));
            px = p.x + dx * tt;
            py = p.y + dy * tt;
          }
          const d = Math.hypot(wx - px, wy - py) / p.r;
          if (d >= 1) continue;
          let t: number;
          if (p.shape === 'plateau') {
            const s = Math.min(1, Math.max(0, (d - flat) / (1 - flat)));
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
export function buildHeightField(hole: HoleData, bunkerDepthScale = 1, wasteDepthScale = 0): HeightField | null {
  const pts: ElevationPoint[] = [...(hole.elevation ?? [])];
  for (const hz of hole.hazards) {
    if (hz.type !== 'bunker') continue;
    const xs = hz.polygon.map((p) => p[0]);
    const ys = hz.polygon.map((p) => p[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const r = Math.max(...hz.polygon.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    if (hz.waste && !hz.beach && wasteDepthScale > 0) {
      // Waste blowout dish (theme.wasteDepthScale — Wild Valley): a rounded
      // dome dish like an ordinary bunker's, deepest at the center. Only for
      // COMPACT polygons — the dish is a circle at the centroid, so a long
      // winding wash (max/mean radius ratio ≫ 1) would crater terrain far
      // outside its own shape; those stay flat.
      const meanR =
        hz.polygon.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / hz.polygon.length;
      if (r / Math.max(1, meanR) < 1.8 && !pointInGreens(cx, cy, hole.green, hole.green2, GREEN_KEEPOUT)) {
        const dishR = maxRadiusClearOfGreen(hole, cx, cy, r + 10);
        if (dishR > 0) pts.push({ x: cx, y: cy, h: -DISH_DEPTH * wasteDepthScale, r: dishR });
      }
      continue;
    }
    if (hz.wall) {
      // A flat sunken floor (plateau) a touch WIDER than the trap so the whole
      // sand sits low and the skirt (where the wall stands) hugs the rim.
      pts.push({ x: cx, y: cy, h: -WALL_DEPTH, r: r + 6, shape: 'plateau' });
      addFlankingMounds(hole, cx, cy, r, pts);
    } else if (!hz.beach && !hz.waste) {
      // A smooth, rounded dish (dome, not a flat floor) so an ordinary trap
      // reads as a natural hollow carved into the hillside, with the turf
      // rim (and its fescue lip) sloping down into the sand. Clamped clear of
      // the green — a greenside bunker's pothole must never crater the
      // putting surface it sits beside.
      //
      // Guard: a bunker whose CENTROID lands on the green (a wrap-around/collar
      // trap, e.g. Sable Bay h2's island ring) must dig NO dish — the dome is
      // centered at the centroid, so its deepest point would crater the green
      // itself (maxRadiusClearOfGreen only keeps the RIM clear, not the
      // center). On a low island that dropped the green below the water line.
      // Such a bunker's sand reads as a shallow collar, not a deep pot.
      if (!pointInGreens(cx, cy, hole.green, hole.green2, GREEN_KEEPOUT)) {
        // Small traps are DEEP POTS; large traps are shallow saucers — the
        // real-world relationship, and the fix for tiny fairway pots reading
        // dead flat. A fixed shallow dish (DISH_DEPTH) spread over the +12 pad
        // barely dips below the surrounding dune mounds on a small trap: Sable
        // Bay h1's two r≈11 pots sit right on authored +1-2 mounds and read as
        // level sand. A trap at/above POT_R keeps the original saucer depth and
        // pad (mid/large bunkers unchanged); below it the dish deepens and
        // tightens so the sand actually sits in a scooped hollow.
        const POT_R = 26;
        const potT = Math.max(0, (POT_R - r) / POT_R); // 0 at r>=26, →1 as r→0
        const dishPad = 12 - potT * 6; // 12 for large, ~6 for a tiny pot
        const depth = DISH_DEPTH * bunkerDepthScale * (1 + potT * 0.9); // up to ~1.9x deeper for tiny
        const dishR = maxRadiusClearOfGreen(hole, cx, cy, r + dishPad);
        if (dishR > 0) pts.push({ x: cx, y: cy, h: -depth, r: dishR });
      }
      addFlankingMounds(hole, cx, cy, r, pts);
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
