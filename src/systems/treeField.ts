import { pointInPolygon } from '../utils/Geometry';
import { Hazard, HoleData, Polygon } from '../core/types';

/**
 * Per-tree canopy blobs for a hole — the single source of truth for where the
 * individual trees actually stand. The 3D billboards, the baked drop shadows,
 * AND the ball-flight collision (PhysicsEngine) all read these, so a ball is
 * only stopped when it truly reaches a trunk/canopy — not anywhere over the
 * whole tree polygon (playtest FB9). Pure math (no rendering deps) so it can
 * live below both the physics and rendering layers without an import cycle.
 */
export interface TreeBlob {
  x: number;
  y: number;
  r: number;
  /** 0 = round oak, 1 = tall poplar, 2 = wide double-crown, 3 = blossom. */
  kind: number;
  /** Per-tree canopy tint multiplier. */
  tint: number;
  /** True for trunks from a `blossom` trees hazard — course3d plants these from
   *  the pink-canopy prototype. */
  blossom?: boolean;
  /** True for trunks from an `accent: true` hazard — always planted from the
   *  theme's accentTreeKeys set (deliberate palms etc.). */
  accent?: boolean;
  /** Per-hazard accent fraction (types.ts accentChance) — a mixed line. */
  accentChance?: number;
  /** True if THIS trunk collides as a palm (trunk + elevated canopy, gap
   *  between) rather than the usual single flat band. Resolved per-trunk at
   *  build time: `hz.palm` (100% palm hazards) OR, for a mixed `accentChance`
   *  hazard flagged `accentIsPalm`, the identical per-trunk hash course3d's
   *  renderer uses to pick the accent species — so a trunk only gets
   *  palm-shaped collision when it actually renders as a palm frond. */
  isPalm?: boolean;
}

/** Deterministic 0..1 jitter shared by the texture bake and the tree billboards. */
export function blobHash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Deterministic 0..1 hash used for prop placement AND the per-trunk accent
 * species roll (course3d's `plantTree`) — lives here (not natureModels.ts, a
 * Babylon-dependent module) so PhysicsEngine/treeField can make the exact
 * same per-trunk species decision the renderer makes, keeping palm-shaped
 * collision in sync with which trunks actually render as palm fronds.
 * natureModels.ts re-exports this rather than defining its own copy.
 */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Per-trunk palm decision: a flat `hz.palm` hazard is 100% palm; a mixed
 *  `accentIsPalm` hazard rolls the SAME per-trunk hash course3d's renderer
 *  uses (`hash2(x*1.7, y*0.9) < accentChance`) to decide the accent species,
 *  so collision only palm-shapes the trunks that actually render as palms. */
function resolveIsPalm(hz: Hazard, x: number, y: number): boolean {
  if (hz.palm) return true;
  if (hz.accentIsPalm) return hash2(x * 1.7, y * 0.9) < (hz.accentChance ?? 0.15);
  return false;
}

/** Distance from a point to the nearest fairway polygon (0 if inside one). */
function distToFairway(x: number, y: number, fairway: readonly Polygon[]): number {
  let best = Infinity;
  for (const poly of fairway) {
    if (pointInPolygon(x, y, poly)) return 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const d = distToSeg(x, y, ax, ay, bx, by);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The tree positions for a hole — one source for billboards, shadows AND
 * collision. `forRender` opts into visual-only hazard fields (`renderOffset`
 * nudge, a denser `visualSpacing` grid, and `visualOnly` hazards that
 * otherwise contribute nothing) — leave it false for anything collision/
 * shadow-facing (PhysicsEngine, bakeGroundShadows) so a hazard's true
 * position/density is always what the ball and its baked shadow see; only
 * the 3D mesh placement (course3d.ts) passes true. Woods can look far denser
 * than they collide: canopy radius is large enough that a genuinely dense
 * COLLISION grid can make a corridor physically unescapable (confirmed via
 * the playability sim) — `visualSpacing`/`visualOnly` add render-only trunks
 * instead of tightening the real hazard.
 */
export function collectTreeBlobs(hole: HoleData, blossomChance = 0, forRender = false): TreeBlob[] {
  const blobs: TreeBlob[] = [];
  // Trees never grow in water: any trunk whose FINAL position lands inside a
  // water hazard is skipped — render, bake shadow and collision together, so
  // an authored woods polygon may safely overlap a pond/creek (the overlap is
  // simply empty) instead of every course pass hand-carving polygons around
  // the waterline (recurring playtest bug: "there are trees in the pond").
  const waterPolys = hole.hazards.filter((z) => z.type === 'water').map((z) => z.polygon);
  const inWater = (x: number, y: number): boolean => waterPolys.some((w) => pointInPolygon(x, y, w));
  for (const hz of hole.hazards) {
    if (hz.type !== 'trees') continue;
    if (hz.visualOnly && !forRender) continue;
    const xs = hz.polygon.map((p) => p[0]);
    const ys = hz.polygon.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Authored density knob: hazard.spacing (default 52). Jitter scales with
    // the step so dense woods stay organic without trunks overlapping.
    // Rendering can opt into a denser step via visualSpacing (collision and
    // the baked shadow always use the real `spacing`, never this one).
    const step = (forRender ? hz.visualSpacing : undefined) ?? hz.spacing ?? 52;
    const jitter = step * (36 / 52);
    const [offX, offY] = forRender ? hz.renderOffset ?? [0, 0] : [0, 0];
    // Natural edge thinning: woods should peter out toward their boundary
    // instead of stopping on a ruler line (visual pass 7). Estimate how deep a
    // trunk sits with four offset point-in-polygon probes and keep edge trunks
    // with falling probability, gated by ONE deterministic hash for both
    // passes. The render pass thins hard (the visible feathering); collision/
    // bake keeps a higher floor so corridor walls still play like walls —
    // and because the render threshold is always ≤ the collision one, every
    // tree you can see still collides (extra edge hitboxes hide under the
    // overlapping canopies beside them). Small specimen hazards (lone trees,
    // pairs) skip the fade: they ARE their own edge.
    const FADE = 20;
    const fade = Math.min(maxX - minX, maxY - minY) > FADE * 4.5;
    const fadeFloor = forRender ? 0.3 : 0.7;
    const fadeSlope = (1 - fadeFloor) / 4;
    // Depth-of-woods thinning (render only): a corridor wants to read DENSE
    // right at the fairway edge (the "walled in" look) but doesn't need that
    // same density purely as distant backdrop — the extra trunks back there
    // are never seen up close, just paid for every frame (Timberline's
    // reported lag despite the hole-1 fix: its woods still carry a much
    // tighter authored spacing over a large area than any other course).
    // Keep-probability falls off linearly with distance from the nearest
    // fairway polygon, floored so the backdrop still reads as woods, never
    // patchy. Tightened FAR/FLOOR (320/0.22 -> 230/0.15) thins sooner and
    // deeper — still invisible from the corridor, fewer trunks paid for at
    // the horizon. Collision/bake are unaffected (playability unchanged).
    const FAIRWAY_THIN_NEAR = 70;
    const FAIRWAY_THIN_FAR = 230;
    const FAIRWAY_THIN_FLOOR = 0.15;
    const before = blobs.length;
    for (let yy = minY; yy < maxY; yy += step) {
      for (let xx = minX; xx < maxX; xx += step) {
        const jx = xx + (blobHash(xx, yy) - 0.5) * jitter;
        const jy = yy + (blobHash(yy, xx) - 0.5) * jitter;
        if (!pointInPolygon(jx, jy, hz.polygon)) continue;
        let keepThreshold = 1;
        if (fade) {
          const depth =
            (pointInPolygon(jx + FADE, jy, hz.polygon) ? 1 : 0) +
            (pointInPolygon(jx - FADE, jy, hz.polygon) ? 1 : 0) +
            (pointInPolygon(jx, jy + FADE, hz.polygon) ? 1 : 0) +
            (pointInPolygon(jx, jy - FADE, hz.polygon) ? 1 : 0);
          // Interior (4/4 probes inside) always keeps; the outermost band
          // dissolves organically (render keeps ~30%, collision ~70%).
          keepThreshold = Math.min(keepThreshold, fadeFloor + fadeSlope * depth);
        }
        if (forRender && hole.fairway.length) {
          const fd = distToFairway(jx, jy, hole.fairway);
          const t = Math.max(0, Math.min(1, (fd - FAIRWAY_THIN_NEAR) / (FAIRWAY_THIN_FAR - FAIRWAY_THIN_NEAR)));
          keepThreshold = Math.min(keepThreshold, 1 - t * (1 - FAIRWAY_THIN_FLOOR));
        }
        if (keepThreshold < 1 && blobHash(jx * 1.7, jy * 3.1) > keepThreshold) continue;
        // Deliberate accent specimens are exempt from the water guard — the
        // author placed them knowingly (e.g. island-green palms standing on
        // sand that's painted OVER the surrounding water polygon).
        if (!hz.accent && inWater(jx + offX, jy + offY)) continue;
        const k = blobHash(xx + 31, yy + 17);
        blobs.push({
          x: jx + offX,
          y: jy + offY,
          r: hz.treeR ?? 15 + blobHash(xx + 7, yy + 3) * 12,
          kind: k < blossomChance ? 3 : Math.floor(((k - blossomChance) / (1 - blossomChance)) * 3),
          tint: 0.82 + blobHash(xx + 3, yy + 11) * 0.32,
          blossom: hz.blossom,
          accent: hz.accent,
          accentChance: hz.accentChance,
          isPalm: resolveIsPalm(hz, jx + offX, jy + offY)
        });
      }
    }
    // A specimen tree authored as a SMALL polygon (a lone fairway tree, a pair
    // of "thinking trees") can be finer than the sampling step and land zero
    // grid trunks — so the tree silently vanishes from BOTH the render and the
    // collision (playtest: Timberline h1's fairway tree had no hitbox and no
    // mesh). Guarantee at least one trunk per authored hazard by planting it at
    // the polygon centroid, deterministically sized/tinted from that centroid.
    const ccx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const ccy = ys.reduce((a, b) => a + b, 0) / ys.length;
    if (blobs.length === before && (hz.accent || !inWater(ccx + offX, ccy + offY))) {
      const cx = ccx;
      const cy = ccy;
      const k = blobHash(cx + 31, cy + 17);
      blobs.push({
        x: cx + offX,
        y: cy + offY,
        r: hz.treeR ?? 15 + blobHash(cx + 7, cy + 3) * 12,
        kind: k < blossomChance ? 3 : Math.floor(((k - blossomChance) / (1 - blossomChance)) * 3),
        tint: 0.82 + blobHash(cx + 3, cy + 11) * 0.32,
        blossom: hz.blossom,
        accent: hz.accent,
        accentChance: hz.accentChance,
        isPalm: resolveIsPalm(hz, cx + offX, cy + offY)
      });
    }
  }
  return blobs;
}
