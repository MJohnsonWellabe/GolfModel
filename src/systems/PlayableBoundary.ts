/**
 * BOUNDED PLAYABLE WORLD (`boundedWorld` flag).
 *
 * The global development rule: each hole is built and rendered as a tightly
 * bounded playable environment rather than a complete surrounding landscape.
 * The playable boundary is the UNION of playable regions — a point is "in play"
 * when it lies inside ANY of the polygons. Everything outside is off-course
 * VOID: no detailed terrain, vegetation, or rocks are generated there, and a
 * ball crossing it takes a one-stroke off-course penalty (handled by
 * PhysicsEngine exactly like an 'ob' hazard).
 *
 * The boundary is normally DERIVED from geometry the hole already carries
 * (`computeBoundary`): the fairway corridor(s), the green complex, the tee, the
 * AI landing zones, and any playable bunkers/waste — each expanded outward by
 * the default ~20 yard margin (40 world px at PX_PER_YARD = 2.0). A course may
 * instead author `hole.boundary` outright for exceptions (island greens,
 * coastlines, custom margins), in which case the authored polygons win.
 *
 * Pure and dependency-free (no rendering, no flags) so it is unit-testable and
 * shared by physics, the 3D build, the camera, and the debug overlay.
 */

import type { EllipseArea, HoleData, Point, Polygon } from '../core/types';
import { catmullRom, distToPolygon, offsetPolyline, pointInPolygon } from '../utils/Geometry';

/** Default off-course margin beyond the playable corridor: ~20 yd = 40 px. */
export const DEFAULT_MARGIN = 40;

/** Playable rough kept each side of the fairway (normal recovery) BEFORE the
 *  margin is added — so a slightly errant shot still finds recoverable rough,
 *  not void. ~22 yd. */
const ROUGH_BAND = 44;

/** Samples per centerline segment when rebuilding a fairway corridor — matches
 *  courseLoader.compileRibbon so the derived corridor tracks the real fairway. */
const RIBBON_SAMPLES = 9;

/** Polygon fidelity for circular/elliptical playable blobs (green/tee/landing). */
const BLOB_STEPS = 26;

/**
 * A playable "blob" — a circle sampled as a closed polygon. Used for the tee,
 * the AI landing zones, and (via `ellipsePoly`) the green complex.
 */
function circlePoly(cx: number, cy: number, r: number, steps = BLOB_STEPS): Polygon {
  const pts: Polygon = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** The green (or any ellipse) grown by `pad` in every direction, as a polygon. */
function ellipsePoly(e: EllipseArea, pad: number, steps = BLOB_STEPS): Polygon {
  const rot = e.rot ?? 0;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const rx = e.rx + pad;
  const ry = e.ry + pad;
  const pts: Polygon = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const lx = Math.cos(a) * rx;
    const ly = Math.sin(a) * ry;
    pts.push([e.cx + lx * cr - ly * sr, e.cy + lx * sr + ly * cr]);
  }
  return pts;
}

/** Centroid of a polygon (vertex average — good enough for a convex inflate). */
function centroid(poly: Polygon): Point {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of poly) {
    sx += x;
    sy += y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

/** Push every vertex outward from the centroid by `pad`. A crude Minkowski
 *  expansion used only for v1 raw-polygon fairways (roughly convex); ribbon
 *  fairways use the accurate `corridorPoly` instead. */
function inflatePolygon(poly: Polygon, pad: number): Polygon {
  if (poly.length < 3) return poly;
  const c = centroid(poly);
  return poly.map(([x, y]) => {
    const dx = x - c.x;
    const dy = y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * pad, y + (dy / len) * pad];
  });
}

/**
 * Rebuild a fairway ribbon as a wide corridor polygon: the authored centerline,
 * offset by (local fairway half-width + recovery rough + margin). Mirrors
 * courseLoader.compileRibbon exactly, only wider, so the corridor follows every
 * dogleg the fairway does.
 */
function corridorPoly(centerline: number[][], widths: number[], extra: number): Polygon {
  if (centerline.length < 2) return [];
  const merged = centerline.map((p, i) => [
    p[0],
    p[1],
    (widths[Math.min(i, widths.length - 1)] ?? 40) / 2 + extra
  ]);
  const samples = catmullRom(merged, RIBBON_SAMPLES);
  return offsetPolyline(
    samples.map(([x, y]) => ({ x, y })),
    samples.map(([, , hw]) => Math.max(4, hw)),
    true
  );
}

/**
 * Derive the playable boundary for a hole: the union of the fairway corridors,
 * green complex, tee, landing zones, and any playable bunkers/waste, each grown
 * by `margin` (default ~20 yd). Returns one polygon per region — "in play" means
 * inside ANY of them (see `pointInBoundary`).
 */
export function computeBoundary(hole: HoleData, margin = DEFAULT_MARGIN): Polygon[] {
  const regions: Polygon[] = [];

  // 1. Fairway corridors — the spine of the playable world; follows doglegs and
  //    split fairways (one polygon per ribbon).
  const centerlines = hole.fairwayCenterlines ?? [];
  const widths = hole.fairwayCenterlineWidths ?? [];
  if (centerlines.length) {
    centerlines.forEach((cl, i) => {
      const poly = corridorPoly(cl, widths[i] ?? [40], ROUGH_BAND + margin);
      if (poly.length >= 3) regions.push(poly);
    });
  } else {
    // v1 raw-polygon fairways (no centerline): inflate each polygon directly.
    for (const fw of hole.fairway) {
      if (fw.length >= 3) regions.push(inflatePolygon(fw, ROUGH_BAND + margin));
    }
  }

  // 2. Green complex (both lobes) — includes the greenside recovery collar.
  const greenPad = 32 /* FRINGE_MARGIN */ + margin;
  regions.push(ellipsePoly(hole.green, greenPad));
  if (hole.green2) regions.push(ellipsePoly(hole.green2, greenPad));

  // 3. Tee complex + camera staging behind it.
  const teeR =
    Math.hypot((hole.teeBox?.w ?? 28) / 2, (hole.teeBox?.d ?? 20) / 2) + margin + 18;
  regions.push(circlePoly(hole.tee.x, hole.tee.y, teeR));

  // 4. AI landing zones — real landing/recovery areas + likely dispersion.
  const landingR = 70 + margin; // ~55 yd radius of tolerated dispersion
  for (const t of hole.aiTargets ?? []) regions.push(circlePoly(t.x, t.y, landingR));

  // 5. Playable bunkers & waste that touch the corridor: a hazard whose sand is
  //    reachable in normal play stays in bounds (grown by margin). Far-flung
  //    decorative waste that never comes near play is left as void.
  const core = regions.slice();
  const near = (x: number, y: number): boolean =>
    core.some((p) => pointInPolygon(x, y, p) || distToPolygon(x, y, p) <= margin);
  for (const hz of hole.hazards) {
    if (hz.type !== 'bunker') continue;
    if (hz.polygon.length < 3) continue;
    if (hz.polygon.some(([x, y]) => near(x, y))) {
      regions.push(inflatePolygon(hz.polygon, margin));
    }
  }

  return regions;
}

/** True when (x,y) is inside the playable world — inside ANY boundary region. */
export function pointInBoundary(x: number, y: number, boundary: Polygon[]): boolean {
  for (const poly of boundary) {
    if (pointInPolygon(x, y, poly)) return true;
  }
  return false;
}

/** Shortest distance from (x,y) to the nearest boundary edge (any region). */
export function distToBoundary(x: number, y: number, boundary: Polygon[]): number {
  let min = Infinity;
  for (const poly of boundary) min = Math.min(min, distToPolygon(x, y, poly));
  return min;
}

/** Axis-aligned bounds [minX, minY, maxX, maxY] of the whole boundary union
 *  (used to size the void skirt and clamp the aerial camera). */
export function boundaryBBox(boundary: Polygon[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of boundary) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Attach a playable boundary to a hole when the bounded-world rule is active.
 * Returns the hole untouched when `on` is false (production stays byte-identical)
 * or when it already carries an authored boundary. Otherwise derives one.
 */
export function withPlayableBoundary(hole: HoleData, on: boolean): HoleData {
  if (!on || hole.boundary) return hole;
  return { ...hole, boundary: computeBoundary(hole) };
}
