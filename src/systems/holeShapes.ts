/**
 * Hole-shaping primitives — ONE implementation, shared by both generators.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The project has two hole generators and they had drifted apart:
 *
 *   - the BUILD-TIME one (`scripts/courselib.mjs` + `scripts/courses/*.mjs`),
 *     which authors Red Hollow, Wild Prairie and the v2 rebuilds, and which
 *     knows how to draw a winding creek, a boulder, a blob and a pin ring;
 *   - the RUNTIME one (`systems/DailyHole.ts`), which draws the hole of the
 *     day in the browser, and which had a private copy of `blob()` and
 *     nothing else — which is precisely why every daily hole was a fairway,
 *     a green and at most three bunkers ("too plain jane", owner report).
 *
 * Rather than copy `stream()` and `rock()` into the runtime as well (a third
 * copy of the same maths, guaranteed to drift), the primitives live here and
 * both sides import them. `courselib.mjs` re-exports them so the eight course
 * modules keep importing from the place they always did.
 *
 * NODE INTEROP
 * ------------
 * `node scripts/gen-new-courses.mjs` imports this file DIRECTLY as TypeScript
 * (`import ... from '../src/systems/holeShapes.ts'`). Node strips the type
 * annotations on the fly (built in since Node 22.18 / 23.6), so there is no
 * build step and no second JS copy to keep in sync. That constrains this file:
 *
 *   - **type-only syntax only** — no enums, no namespaces, no parameter
 *     properties, no `const enum`, nothing that needs a real transform;
 *   - every type import must be written `import type`, because the stripper
 *     erases text, it does not resolve modules;
 *   - it must stay PURE — no Babylon, no DOM, no fs. Both callers are
 *     headless (one is a node script, the other runs inside the difficulty
 *     simulator hundreds of times per candidate hole).
 *
 * DETERMINISM IS A HARD REQUIREMENT ON BOTH SIDES. The generated course JSON
 * is committed, so a change to `rng`/`R`/`blob` re-writes eight course files;
 * and every player must independently derive the same hole of the day. The
 * functions moved here were moved VERBATIM for exactly that reason — the only
 * change is that the random source may now be an existing generator function
 * as well as a seed (see `blob`), because the runtime generator threads one
 * rng through a whole hole instead of seeding each shape.
 */

import type { Hazard, Point, Polygon } from '../core/types';

/** Deterministic jitter (mulberry32) so shapes are organic but reproducible.
 *  Bit-identical to `utils/Random.mulberry32` — kept spelled out here because
 *  this module must stay importable by plain node without pulling the runtime
 *  in behind it. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to 0.1 world px — the authored precision of every course JSON. */
export const R = (v: number): number => Math.round(v * 10) / 10;

/**
 * Where a shape's jitter comes from: a SEED (the build-time generators seed
 * every shape individually, so an edit to hole 4 cannot move hole 2) or a live
 * generator (the runtime generator threads one stream through the whole hole).
 */
export type RandSource = number | (() => number) | undefined;

/** A missing seed is deliberately legal and means seed 0 — several authored
 *  shapes call `blob(...)` with no seed at all (Sable Bay's beach apron), and
 *  `rng(undefined)` used to fall through `>>> 0` to exactly that. Preserved so
 *  the committed course JSON stays byte-identical. */
const source = (r: RandSource): (() => number) => (typeof r === 'function' ? r : rng((r as number) >>> 0));

/** Organic blob polygon around (cx,cy) with per-axis radii. */
export function blob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  jitter: number,
  rand: RandSource,
  rot = 0
): Polygon {
  const r = source(rand);
  const pts: Polygon = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    const k = 1 - jitter / 2 + r() * jitter;
    pts.push([R(cx + Math.cos(a) * rx * k), R(cy + Math.sin(a) * ry * k)]);
  }
  return pts;
}

/** A winding stream polygon along control points with width w. */
export function stream(points: number[][], w: number, rand: RandSource): Polygon {
  const r = source(rand);
  const left: Polygon = [];
  const right: Polygon = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[Math.max(0, i - 1)];
    const [nx2, ny2] = points[Math.min(points.length - 1, i + 1)];
    const dx = nx2 - px;
    const dy = ny2 - py;
    const l = Math.hypot(dx, dy) || 1;
    const ox = (-dy / l) * (w / 2) * (0.85 + r() * 0.3);
    const oy = (dx / l) * (w / 2) * (0.85 + r() * 0.3);
    left.push([R(x + ox), R(y + oy)]);
    right.push([R(x - ox), R(y - oy)]);
  }
  return left.concat(right.reverse());
}

/** Rock collision radius as a multiple of its height — the rocks_red_*
 *  clusters are roughly as wide as they are tall. Gate-enforced (rockPass). */
export const ROCK_R_PER_H = 1.0;

/** A collidable boulder ('rock' hazard): swept-cylinder carom physics in
 *  PhysicsEngine + a grounded nature prototype rendered at (cx,cy). The
 *  polygon is a regular octagon so generic hazard consumers stay happy.
 *
 *  Authoring bands (the "3 sizes"): S h4-7, M h9-13, L h15-20 — crossed with
 *  the shade keys (rocks_red_bright / _mid / _cluster a.k.a. dark volcanic,
 *  plus _dark deep-shadow) for natural variation. */
export function rock(cx: number, cy: number, h: number, key = 'rocks_red_bright'): Hazard {
  const r = R(h * ROCK_R_PER_H);
  return { type: 'rock', cx, cy, r, height: h, key, polygon: blob(cx, cy, r, r, 8, 0, 1) };
}

export const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const rot2 = (x: number, y: number, r: number): [number, number] => [
  x * Math.cos(r) - y * Math.sin(r),
  x * Math.sin(r) + y * Math.cos(r)
];

/** The minimum a hole must expose for `computedPins` — deliberately structural
 *  rather than tied to either generator's own hole type. */
export interface PinnableHole {
  green: { cx: number; cy: number; rx: number; ry: number; rot?: number };
  tee: number[];
  pins?: number[][];
}

/** The standard three-pin ring: front (tee side), back, and one side. */
export function computedPins(h: PinnableHole): Point[] {
  // A hole may author its pins outright (absolute coords) when the default
  // front/back/side ring is wrong for it — Wild Prairie h2 favors the
  // back-right lobe of its kidney green, so its authored set leads there.
  if (h.pins) return h.pins.map(([x, y]) => ({ x: R(x), y: R(y) }));
  const g = h.green;
  const rv = g.rot ?? 0;
  const [lx, ly] = rot2(h.tee[0] - g.cx, h.tee[1] - g.cy, -rv);
  const ll = Math.hypot(lx, ly) || 1;
  const [ux, uy] = [lx / ll, ly / ll];
  const P = (ax: number, ay: number): Point => {
    const [wx, wy] = rot2(ax * g.rx, ay * g.ry, rv);
    return { x: R(g.cx + wx), y: R(g.cy + wy) };
  };
  return [P(ux * 0.55, uy * 0.55), P(-ux * 0.52, -uy * 0.52), P(-uy * 0.5, ux * 0.5)];
}

export function pointInPoly(x: number, y: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Path length of a centerline, in YARDS (PX_PER_YARD = 2). */
export function pathYards(cl: number[][]): number {
  let d = 0;
  for (let i = 1; i < cl.length; i++) d += dist(cl[i - 1], cl[i]);
  return Math.round(d / 2);
}

/**
 * Walk a polyline by arc length. Returns the point at fraction `t` of the
 * total length, and the unit LEFT normal there — the two things every
 * "put a hazard beside the fairway at 60% of the way out" call needs, and
 * the thing the daily generator was missing when it could only place sand
 * relative to the green or a hard-coded elbow.
 */
export function alongPath(path: number[][], t: number): { x: number; y: number; nx: number; ny: number } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i]);
    segs.push(d);
    total += d;
  }
  if (total <= 0) return { x: path[0][0], y: path[0][1], nx: 1, ny: 0 };
  let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (want > segs[i] && i < segs.length - 1) {
      want -= segs[i];
      continue;
    }
    const f = segs[i] > 0 ? Math.min(1, want / segs[i]) : 0;
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    return { x: ax + dx * f, y: ay + dy * f, nx: -dy / l, ny: dx / l };
  }
  const last = path[path.length - 1];
  return { x: last[0], y: last[1], nx: 1, ny: 0 };
}
