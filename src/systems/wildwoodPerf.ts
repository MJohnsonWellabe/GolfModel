import { CourseAuthoring } from '../data/courseLoader';
import { GardenBed, Hazard } from '../core/types';

/**
 * Wildwood Glen performance transform — DEV-ONLY, behind the `wildwoodPerf`
 * feature flag (src/core/flags.ts). Production loads the shipped `wildwood.json`
 * byte-for-byte; this runs only when the flag resolves ON (dev), applied at
 * COURSES-construction time in main.ts.
 *
 * It is a PURE, VISUAL-ONLY thinning of the authoring data:
 *  - It never mutates the imported JSON — it deep-clones first.
 *  - It never touches gameplay. Collision hitboxes (a tree hazard's `spacing`),
 *    hole geometry, fairways, pins, elevation, and putting are all untouched;
 *    only RENDER density (`visualSpacing`) and decorative bloom counts change.
 *
 * What it targets (owner direction: "thin anything out of sight from the tee;
 * gardens marginally; free rein on water reflections"): the render trunks a
 * player cannot pick out from the tee — the occluded interior + downrange depth
 * of the wood bands, any band sitting behind the player, and the horizon
 * backdrop wall — plus a marginal trim of garden blooms. The dominant WW1 cost
 * drivers were the dense flanking woods (`visualSpacing: 22`/`13`), each also
 * paid a second time by the water mirror; raising their render step thins the
 * unseen depth while the renderer's existing fairway-distance thinning already
 * protects the near, visible edge. The reflection half of the pass lives in
 * course3d.ts, gated on the same flag.
 */

/** Baseline render-spacing multiplier for wood bands that flank the corridor
 *  (in view, but their interior/downrange depth is not individually readable). */
const WOOD_THIN = 1.45;
/** Harder multiplier for a band whose whole span sits at/behind the tee. */
const OUT_OF_SIGHT_THIN = 2.2;
/** A band whose farthest vertex projects less than this fraction of the
 *  tee→pin axis is effectively behind the player — thin it hard. */
const BEHIND_TEE_FRAC = 0.12;
/** Marginal decorative-bloom trim (owner: "gardens marginally"). */
const GARDEN_DENSITY_SCALE = 0.85;
/** Floor for the backdrop conifer-wall grid step — Wildwood otherwise inherits
 *  the dense default; the backdrop is pure horizon scenery, never read up close. */
const BACKDROP_STEP_MIN = 96;
/** Cheaper water-mirror RTT ratio (default 0.35). The scrolling normal map +
 *  adaptive blur hide the drop; lakeside trees still reflect, just softer. */
const WATER_REFLECT_RATIO = 0.25;

/** Return a deep-cloned, visually-thinned copy of a Wildwood authoring doc. */
export function withWildwoodPerf(course: CourseAuthoring): CourseAuthoring {
  const c = JSON.parse(JSON.stringify(course)) as CourseAuthoring;

  // Sparser backdrop wall (horizon scenery only) + a cheaper water mirror.
  const theme = c.theme as { backdropTreeStep?: number; waterReflectRatio?: number };
  theme.backdropTreeStep = Math.max(theme.backdropTreeStep ?? 0, BACKDROP_STEP_MIN);
  theme.waterReflectRatio = WATER_REFLECT_RATIO;

  for (const h of c.holes) {
    const { tee, pin } = h;
    const axisLen = Math.hypot(pin.x - tee.x, pin.y - tee.y) || 1;
    const dx = (pin.x - tee.x) / axisLen;
    const dy = (pin.y - tee.y) / axisLen;

    for (const hz of (h.hazards ?? []) as Hazard[]) {
      if (hz.type !== 'trees' || !hz.polygon?.length) continue;
      // Farthest projection of any trunk-band vertex along tee→pin; a band that
      // never reaches meaningfully downrange is behind/beside the player.
      let maxProj = -Infinity;
      for (const [px, py] of hz.polygon) {
        maxProj = Math.max(maxProj, (px - tee.x) * dx + (py - tee.y) * dy);
      }
      const outOfSight = maxProj < BEHIND_TEE_FRAC * axisLen;
      const base = hz.visualSpacing ?? hz.spacing ?? 24;
      hz.visualSpacing = Math.round(base * (outOfSight ? OUT_OF_SIGHT_THIN : WOOD_THIN));
      // hz.spacing (collision) left as-authored — hitboxes stay identical.
    }

    for (const g of (h.gardens ?? []) as GardenBed[]) {
      if (typeof g.density === 'number') {
        g.density = Math.max(1, Math.round(g.density * GARDEN_DENSITY_SCALE));
      }
    }
  }

  return c;
}
