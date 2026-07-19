/**
 * Debug/capture flags parsed once from the page URL. Used by the screenshot
 * harness (`npm run shots`) to load a specific hole at a fixed camera with all
 * ambient animation frozen, so captures are deterministic between runs.
 *
 *   ?hole=2&cam=aerial&freeze=1
 *
 * Production play is untouched: without a `hole` param the game boots into
 * the normal setup wizard and nothing here has any effect.
 */

export type ShotCam = 'tee' | 'aerial' | 'approach' | 'green' | 'club';

export interface ShotParams {
  /** 1-based hole number to load directly (undefined = normal boot). */
  hole?: number;
  cam: ShotCam;
  /** Course id to load for the capture (undefined = default course). */
  course?: string;
  /** Freeze all ambient animation (flag wave, clouds, water sparkle, petals). */
  freeze: boolean;
  /** Draw the playable-world boundary overlay (bounded-world debug capture).
   *  Off for every normal screenshot; on only for the dedicated debug view. */
  boundary: boolean;
}

function parse(): ShotParams {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const holeRaw = q.get('hole');
  const cam = q.get('cam');
  return {
    hole: holeRaw ? Math.max(1, parseInt(holeRaw, 10) || 1) : undefined,
    cam:
      cam === 'aerial' || cam === 'approach' || cam === 'green' || cam === 'club' ? cam : 'tee',
    course: q.get('course') || undefined,
    freeze: q.get('freeze') === '1',
    boundary: q.get('boundary') === '1'
  };
}

export const SHOT: ShotParams = parse();

/** True when ambient animation should hold still (deterministic captures). */
export function isFrozen(): boolean {
  return SHOT.freeze;
}

/**
 * Animation clock (seconds). Frozen captures read a fixed instant so
 * time-driven materials (water sparkle, flag wave) render identically.
 */
export function animTime(): number {
  return SHOT.freeze ? 1.234 : performance.now() / 1000;
}
