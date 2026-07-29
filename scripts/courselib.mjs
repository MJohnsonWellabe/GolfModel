// Shared course-authoring library for the deterministic course generators
// (scripts/courses/*.mjs). Split out of gen-new-courses.mjs unchanged so
// every course module — the two expansion courses AND the v2 teardown/
// rebuild variants — authors with the same primitives and serializer.
//
// The SHAPE primitives (rng/R/blob/stream/rock/computedPins/pointInPoly and
// friends) no longer live here: they moved to src/systems/holeShapes.ts so the
// RUNTIME daily-hole generator can draw with the same vocabulary instead of
// keeping a partial second copy (it had `blob` and nothing else, which is why
// generated dailies had no water, no rock and no waste — owner: "too plain
// jane"). They are re-exported below verbatim, so every scripts/courses/*.mjs
// module keeps importing them from here exactly as before and the emitted JSON
// stays byte-identical.
//
// holeShapes.ts is imported AS TYPESCRIPT — node strips the annotations itself
// (built in since Node 22.18 / 23.6), so `node scripts/gen-new-courses.mjs`
// still runs with no build step. If that ever needs to work on an older node,
// pre-compile holeShapes.ts rather than forking it again.
import { writeFileSync } from 'node:fs';
import {
  rng,
  R,
  blob,
  stream,
  ROCK_R_PER_H,
  rock,
  dist,
  rot2,
  computedPins,
  pointInPoly,
  pathYards,
  alongPath
} from '../src/systems/holeShapes.ts';

export { rng, R, blob, stream, ROCK_R_PER_H, rock, dist, rot2, computedPins, pointInPoly, pathYards, alongPath };

export function computedAltTee(h) {
  const cl = h.centerline ?? h.fairways[0]?.centerline ?? [[h.green.cx, h.green.cy]];
  const aim = cl.length > 1 ? cl[1] : [h.green.cx, h.green.cy];
  let [tx, ty] = [aim[0] - h.tee[0], aim[1] - h.tee[1]];
  const l = Math.hypot(tx, ty) || 1;
  const [ux, uy] = [tx / l, ty / l];
  cand: for (const d of [72, -60, 110, -95]) {
    const x = R(h.tee[0] + ux * d), y = R(h.tee[1] + uy * d);
    const M = 40;
    if (x < M || y < M || x > h.world.width - M || y > h.world.height - M) continue;
    for (const hz of h.hazards) {
      for (const [ox, oy] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) {
        if (pointInPoly(x + ox, y + oy, hz.polygon)) continue cand;
      }
    }
    if (Math.hypot(x - h.green.cx, y - h.green.cy) < Math.max(h.green.rx, h.green.ry) + 40) continue;
    return { x, y };
  }
  return null;
}

/** The MAIN routing path through a hole's fairway ribbons, for yardage. A
 *  hole may carry ALTERNATE fairways (split holes — a second route that
 *  branches from the tee). Yardage must follow ONE route, so chain only the
 *  ribbons that connect end→start from the tee; branches (a ribbon starting
 *  back at the tee, or otherwise not continuing the chain) are ignored. */
export function mainRoutePts(ribbons, tee) {
  // Only chain proper centerline ribbons; anything else (raw polygons, empty)
  // falls back to the caller's flatMap behavior via an empty return.
  const rib = ribbons.filter((r) => Array.isArray(r?.centerline) && r.centerline.length);
  if (!rib.length) return [];
  const near = (a, b) => dist(a, b) < 30;
  const used = new Set();
  let cur = rib.findIndex((r) => near(r.centerline[0], tee));
  if (cur < 0) cur = 0;
  const pts = [...rib[cur].centerline];
  used.add(cur);
  for (let guard = 0; guard < rib.length; guard++) {
    const end = pts[pts.length - 1];
    const next = rib.findIndex((r, i) => !used.has(i) && near(r.centerline[0], end));
    if (next < 0) break;
    pts.push(...rib[next].centerline.slice(1));
    used.add(next);
  }
  return pts;
}

// ---- serialize to schema shape ------------------------------------------
export function emit(course, id, dir = 'src/data/courses') {
  const out = {
    name: course.name,
    version: 2,
    theme: course.theme,
    holes: course.holes.map((h) => {
      // A hole authors either one ribbon (centerline+width) or several
      // (fairways: [{centerline,width}] — e.g. Wolf Run's wash-split pair).
      const ribbons = h.fairways ?? [{ centerline: h.centerline, width: h.width }];
      // Yardage sums the MAIN-route ribbons. A split hole marks its ALTERNATE
      // fairways with `altFairways: N` (the last N ribbons) so the second
      // route doesn't inflate the number; holes without it keep the exact
      // flat-concatenation behavior (existing courses stay byte-identical).
      const mainRibbons = h.altFairways ? ribbons.slice(0, ribbons.length - h.altFairways) : ribbons;
      const pathPts = mainRibbons.flatMap((r) => r.centerline);
      return {
        number: h.number,
        name: h.name,
        par: h.par,
        yardage: pathYards([[h.tee[0], h.tee[1]], ...pathPts.slice(1), [h.green.cx, h.green.cy]]),
        world: h.world,
        tee: { x: h.tee[0], y: h.tee[1] },
        teeBox: h.teeBox,
        green: h.green,
        ...(h.green2 ? { green2: h.green2 } : {}),
        slope: h.slope,
        ...(() => {
          const pins = computedPins(h);
          const alt = computedAltTee(h);
          return { pin: pins[0], pins, ...(alt ? { tees: [alt] } : {}) };
        })(),
        fairway: ribbons,
        hazards: h.hazards,
        aiTargets: h.aiTargets.map(([x, y]) => ({ x, y })),
        elevation: h.elevation,
        ...(h.landforms ? { landforms: h.landforms } : {}),
        ...(h.cliffWalls ? { cliffWalls: h.cliffWalls } : {}),
        // Optional decorative / boundary authoring (v2 rebuild variants):
        // passed through verbatim when a course module authors them.
        ...(h.gardens ? { gardens: h.gardens } : {}),
        ...(h.props ? { props: h.props } : {}),
        ...(h.sailboats ? { sailboats: h.sailboats } : {}),
        ...(h.sailboatSpots ? { sailboatSpots: h.sailboatSpots } : {}),
        ...(h.recoveryZones ? { recoveryZones: h.recoveryZones } : {})
      };
    })
  };
  writeFileSync(`${dir}/${id}.json`, JSON.stringify(out, null, 2) + '\n');
  for (const h of out.holes) console.log(`${id} h${h.number} "${h.name}" par ${h.par} ${h.yardage}yd`);
}
