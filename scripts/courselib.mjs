// Shared course-authoring library for the deterministic course generators
// (scripts/courses/*.mjs). Split out of gen-new-courses.mjs unchanged so
// every course module — the two expansion courses AND the v2 teardown/
// rebuild variants — authors with the same primitives and serializer.
import { writeFileSync } from 'node:fs';

// Deterministic jitter (mulberry-ish) so blobs are organic but reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const R = (v) => Math.round(v * 10) / 10;
/** Organic blob polygon around (cx,cy) with per-axis radii. */
export function blob(cx, cy, rx, ry, n, jitter, seed, rot = 0) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    const k = 1 - jitter / 2 + r() * jitter;
    pts.push([R(cx + Math.cos(a) * rx * k), R(cy + Math.sin(a) * ry * k)]);
  }
  return pts;
}
/** A winding stream polygon along control points with width w. */
export function stream(points, w, seed) {
  const r = rng(seed);
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[Math.max(0, i - 1)];
    const [nx2, ny2] = points[Math.min(points.length - 1, i + 1)];
    let dx = nx2 - px, dy = ny2 - py;
    const l = Math.hypot(dx, dy) || 1;
    const ox = (-dy / l) * (w / 2) * (0.85 + r() * 0.3);
    const oy = (dx / l) * (w / 2) * (0.85 + r() * 0.3);
    left.push([R(x + ox), R(y + oy)]);
    right.push([R(x - ox), R(y - oy)]);
  }
  return left.concat(right.reverse());
}
/** A collidable boulder ('rock' hazard): swept-cylinder carom physics in
 *  PhysicsEngine + a grounded nature prototype rendered at (cx,cy). The
 *  collision radius tracks the visual footprint at r = h (the rocks_red_*
 *  clusters are roughly as wide as tall) — gate-enforced in tests. The
 *  polygon is a regular octagon so generic hazard consumers stay happy. */
export const ROCK_R_PER_H = 1.0;
export const rock = (cx, cy, h, key = 'rocks_red_bright') => {
  const r = R(h * ROCK_R_PER_H);
  return { type: 'rock', cx, cy, r, height: h, key, polygon: blob(cx, cy, r, r, 8, 0, 1) };
};
/** Large-rock authoring bands (the "3 sizes"): S h4-7, M h9-13, L h15-20 —
 *  crossed with the three shade keys (rocks_red_bright / _mid / _cluster
 *  a.k.a. dark volcanic, plus _dark deep-shadow) for natural variation. */
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const rot2 = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
export function computedPins(h) {
  // A hole may author its pins outright (absolute coords) when the default
  // front/back/side ring is wrong for it — Wild Prairie h2 favors the
  // back-right lobe of its kidney green, so its authored set leads there.
  if (h.pins) return h.pins.map(([x, y]) => ({ x: R(x), y: R(y) }));
  const g = h.green;
  const rv = g.rot ?? 0;
  const [lx, ly] = rot2(h.tee[0] - g.cx, h.tee[1] - g.cy, -rv);
  const ll = Math.hypot(lx, ly) || 1;
  const [ux, uy] = [lx / ll, ly / ll];
  const P = (ax, ay) => {
    const [wx, wy] = rot2(ax * g.rx, ay * g.ry, rv);
    return { x: R(g.cx + wx), y: R(g.cy + wy) };
  };
  return [P(ux * 0.55, uy * 0.55), P(-ux * 0.52, -uy * 0.52), P(-uy * 0.5, ux * 0.5)];
}
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
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

export function pathYards(cl) {
  let d = 0;
  for (let i = 1; i < cl.length; i++) d += dist(cl[i - 1], cl[i]);
  return Math.round(d / 2); // PX_PER_YARD = 2
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
      const pathPts = ribbons.flatMap((r) => r.centerline);
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
        ...(h.recoveryZones ? { recoveryZones: h.recoveryZones } : {})
      };
    })
  };
  writeFileSync(`${dir}/${id}.json`, JSON.stringify(out, null, 2) + '\n');
  for (const h of out.holes) console.log(`${id} h${h.number} "${h.name}" par ${h.par} ${h.yardage}yd`);
}
