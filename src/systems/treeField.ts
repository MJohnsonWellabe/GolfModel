import { pointInPolygon } from '../utils/Geometry';
import { HoleData } from '../core/types';

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
}

/** Deterministic 0..1 jitter shared by the texture bake and the tree billboards. */
export function blobHash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
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
    for (let yy = minY; yy < maxY; yy += step) {
      for (let xx = minX; xx < maxX; xx += step) {
        const jx = xx + (blobHash(xx, yy) - 0.5) * jitter;
        const jy = yy + (blobHash(yy, xx) - 0.5) * jitter;
        if (!pointInPolygon(jx, jy, hz.polygon)) continue;
        const k = blobHash(xx + 31, yy + 17);
        blobs.push({
          x: jx + offX,
          y: jy + offY,
          r: 15 + blobHash(xx + 7, yy + 3) * 12,
          kind: k < blossomChance ? 3 : Math.floor(((k - blossomChance) / (1 - blossomChance)) * 3),
          tint: 0.82 + blobHash(xx + 3, yy + 11) * 0.32
        });
      }
    }
  }
  return blobs;
}
