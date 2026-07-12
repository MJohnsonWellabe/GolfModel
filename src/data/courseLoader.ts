import { CourseData, HoleData, Polygon } from '../core/types';
import { catmullRom, clipPolyOffGreen, offsetPolyline, pointInPolygon, roundPolygon } from '../utils/Geometry';
import { FRINGE_VISUAL } from '../systems/PhysicsEngine';

/**
 * Bunkers that run under the green get sliced flat along the green's rim (the
 * green wins surface precedence). Carve their green-facing edge back to hug
 * the collar so they read as natural sand ending BEFORE the green — was
 * gated to Wildwood hole 3 for a look-approval; approved (visual pass 7:
 * Timberline hole 2's greenside bunkers were being "eaten" by the green the
 * same way), so it now applies to every hole.
 */

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

/** Chaikin passes applied to every water outline — a lighter touch than
 *  bunkers (blunt stream-end caps just need their straight chop softened
 *  into a taper, not the fully organic bunker-lip look). */
const WATER_ROUND_ITERATIONS = 1;

// Treeline visual rounding lives in CourseTexture's ground-color/shadow bake
// ONLY (not here). Trees hazards drive per-trunk collision via a grid sampled
// off the polygon's exact bounding box (treeField.collectTreeBlobs) — a
// narrow authored corridor (e.g. Timberline's "Pine Alley") can have as
// little as a couple of world px of margin between two facing woods, and
// even a small Chaikin nudge there was enough to occasionally wall off the
// AI's escape route (playability sim caught it). The baked ground patch
// doesn't have that fragility, so it gets the soft edge instead.

function isRibbon(f: FairwaySpec): f is FairwayRibbon {
  return !Array.isArray(f);
}

/**
 * Authoring lint: a bunker polygon overlapping a compiled fairway resolves
 * two OPPOSITE ways depending on the flag, and only some of those are ever
 * authored intent. `waste: true` LOSES to fairway — ANY overlap silently
 * swallows the sand (Sable Bay h1's "crossing" waste never touched a ball),
 * so any contact warns. A regular bunker WINS the overlap: fully INSIDE the
 * fairway it's a legitimate links pot (mid-fairway sand, the Principal's
 * Nose pattern) and stays silent — but a PARTIAL straddle bites a scalloped
 * notch out of the fairway's boundary (Sable Bay h3), which never looks
 * authored, so that warns. Vertex + edge-midpoint containment both ways is
 * enough resolution for hand-authored shapes.
 */
function warnBunkerFairwayOverlap(courseName: string, holeNumber: number, hzIdx: number, waste: boolean, bunker: Polygon, fairways: Polygon[]): void {
  const probes: Array<[number, number]> = [];
  for (let i = 0; i < bunker.length; i++) {
    const [ax, ay] = bunker[i];
    const [bx, by] = bunker[(i + 1) % bunker.length];
    probes.push([ax, ay], [(ax + bx) / 2, (ay + by) / 2]);
  }
  for (const fw of fairways) {
    const inside = probes.filter(([x, y]) => pointInPolygon(x, y, fw)).length;
    const fwVertexInBunker = fw.some(([x, y]) => pointInPolygon(x, y, bunker));
    const partial = (inside > 0 && inside < probes.length) || fwVertexInBunker;
    const bad = waste ? inside > 0 || fwVertexInBunker : partial;
    if (bad) {
      console.warn(
        `[courseLoader] ${courseName} hole ${holeNumber}: bunker #${hzIdx} ${waste ? 'overlaps' : 'straddles the edge of'} a fairway — ` +
          (waste
            ? 'waste sand LOSES to fairway, so the overlapped sand is silently unplayable.'
            : 'a regular bunker BEATS fairway, so the straddle bites a notch out of the fairway shape.') +
          ' Offset the bunker polygon clear of the fairway ribbon (a regular bunker FULLY inside the fairway is fine — links pot).'
      );
      return;
    }
  }
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
      const fairways = h.fairway.map((f) => (isRibbon(f) ? compileRibbon(f, roundCaps) : f));
      h.hazards.forEach((hz, i) => {
        if (hz.type === 'bunker' && !hz.beach) warnBunkerFairwayOverlap(data.name, h.number, i, !!hz.waste, hz.polygon, fairways);
      });
      return {
      ...h,
      fairway: fairways,
      ...(centerlines.length ? { fairwayCenterlines: centerlines } : {}),
      // Round every bunker outline once, here at the single compile choke point,
      // so physics (surfaceAt), the texture bake and the 3D scatter all read the
      // same soft-edged ring — the sand drawn and the sand played can't diverge.
      // Water gets the same treatment: hand-plotted shorelines end in blunt,
      // few-point caps (a stream mouth chopped off in 2-3 points) that read as
      // an abrupt straight edge ("water just abruptly ends") — water has none
      // of the trunk-sampling fragility that kept trees off this path (its
      // physics is a plain point-in-polygon test), so rounding it is safe.
      hazards: h.hazards.map((hz) => {
        if (hz.type === 'water') return { ...hz, polygon: roundPolygon(hz.polygon, WATER_ROUND_ITERATIONS) };
        if (hz.type !== 'bunker') return hz;
        const base = clipPolyOffGreen(hz.polygon, h.green, FRINGE_VISUAL);
        return { ...hz, polygon: roundPolygon(base, BUNKER_ROUND_ITERATIONS) };
      })
      };
    })
  };
}
