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

/** The tree positions for a hole — one source for billboards, shadows AND collision. */
export function collectTreeBlobs(hole: HoleData, blossomChance = 0): TreeBlob[] {
  const blobs: TreeBlob[] = [];
  for (const hz of hole.hazards) {
    if (hz.type !== 'trees') continue;
    const xs = hz.polygon.map((p) => p[0]);
    const ys = hz.polygon.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Authored density knob: hazard.spacing (default 52). Jitter scales with
    // the step so dense woods stay organic without trunks overlapping.
    const step = hz.spacing ?? 52;
    const jitter = step * (36 / 52);
    for (let yy = minY; yy < maxY; yy += step) {
      for (let xx = minX; xx < maxX; xx += step) {
        const jx = xx + (blobHash(xx, yy) - 0.5) * jitter;
        const jy = yy + (blobHash(yy, xx) - 0.5) * jitter;
        if (!pointInPolygon(jx, jy, hz.polygon)) continue;
        const k = blobHash(xx + 31, yy + 17);
        blobs.push({
          x: jx,
          y: jy,
          r: 15 + blobHash(xx + 7, yy + 3) * 12,
          kind: k < blossomChance ? 3 : Math.floor(((k - blossomChance) / (1 - blossomChance)) * 3),
          tint: 0.82 + blobHash(xx + 3, yy + 11) * 0.32
        });
      }
    }
  }
  return blobs;
}
