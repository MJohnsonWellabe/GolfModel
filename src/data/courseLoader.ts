import { CourseData, HoleData, Polygon } from '../core/types';
import { catmullRom, offsetPolyline, roundPolygon } from '../utils/Geometry';

/**
 * Course authoring format (schema v2) → runtime `CourseData` compiler.
 *
 * v2 lets fairways be authored as smooth ribbons — a centerline of control
 * points plus a width at each — instead of hand-plotted polygons. The loader
 * Catmull-Rom-samples the centerline, offsets it by the interpolated
 * half-widths, and hands the game the same `Polygon` shape it has always
 * used, so PhysicsEngine.surfaceAt(), the texture bake, and every test keep
 * their existing interfaces. Raw v1 polygons still load untouched.
 */

export interface FairwayRibbon {
  /** Control points [x, y] from tee end to green end. */
  centerline: number[][];
  /** Full fairway width (world px) at each control point. */
  width: number[];
}

export type FairwaySpec = Polygon | FairwayRibbon;

export type HoleAuthoring = Omit<HoleData, 'fairway'> & {
  fairway: FairwaySpec[];
};

export type CourseAuthoring = Omit<CourseData, 'holes'> & {
  version?: number;
  /** Round the fairway ribbon end-caps (tee/green) instead of blunt square
   *  cuts. Opt-in per course so others stay byte-identical. */
  roundFairwayCaps?: boolean;
  holes: HoleAuthoring[];
};

/** Samples per centerline segment — plenty for organic edges, cheap to bake. */
const RIBBON_SAMPLES = 9;

/** Chaikin passes applied to every bunker outline — soft rounded sand edges as
 *  a general rule for all courses (authored bunkers are sharp-cornered polys). */
const BUNKER_ROUND_ITERATIONS = 2;

function isRibbon(f: FairwaySpec): f is FairwayRibbon {
  return !Array.isArray(f);
}

/** Compile one ribbon spec into a closed polygon. */
export function compileRibbon(ribbon: FairwayRibbon, roundCaps = false): Polygon {
  const { centerline, width } = ribbon;
  if (centerline.length < 2) return [];
  // Sample position and width together so both interpolate coherently
  const merged = centerline.map((p, i) => [p[0], p[1], (width[Math.min(i, width.length - 1)] ?? 40) / 2]);
  const samples = catmullRom(merged, RIBBON_SAMPLES);
  return offsetPolyline(
    samples.map(([x, y]) => ({ x, y })),
    samples.map(([, , hw]) => Math.max(4, hw)),
    roundCaps
  );
}

/** Compile a course authoring file into the runtime CourseData. */
export function loadCourse(data: CourseAuthoring): CourseData {
  // Rounded tee/green fairway ends are now the default for EVERY course
  // (playtest: "fairway N/S ends should always be rounded" / "fairways too
  // square"); a course may still opt out with `roundFairwayCaps: false`.
  const roundCaps = data.roundFairwayCaps !== false;
  return {
    ...data,
    holes: data.holes.map((h) => {
      // Keep the authored ribbon centerlines (before they collapse into offset
      // polygons) so the flyover can trace the real fairway route. Raw v1
      // polygon fairways contribute nothing here.
      const centerlines = h.fairway.filter(isRibbon).map((f) => f.centerline);
      return {
      ...h,
      fairway: h.fairway.map((f) => (isRibbon(f) ? compileRibbon(f, roundCaps) : f)),
      ...(centerlines.length ? { fairwayCenterlines: centerlines } : {}),
      // Round every bunker outline once, here at the single compile choke point,
      // so physics (surfaceAt), the texture bake and the 3D scatter all read the
      // same soft-edged ring — the sand drawn and the sand played can't diverge.
      hazards: h.hazards.map((hz) =>
        hz.type === 'bunker' ? { ...hz, polygon: roundPolygon(hz.polygon, BUNKER_ROUND_ITERATIONS) } : hz
      )
      };
    })
  };
}
