import { EllipseArea, Point, Polygon } from '../core/types';

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point inside an ellipse, with optional margin added to both radii (for fringe). */
export function pointInEllipse(
  x: number,
  y: number,
  e: EllipseArea,
  margin = 0
): boolean {
  let px = x - e.cx;
  let py = y - e.cy;
  // Optional rotation lets greens be angled ovals (organic, non-circular).
  if (e.rot) {
    const c = Math.cos(-e.rot);
    const s = Math.sin(-e.rot);
    const rx0 = px * c - py * s;
    py = px * s + py * c;
    px = rx0;
  }
  const dx = px / (e.rx + margin);
  const dy = py / (e.ry + margin);
  return dx * dx + dy * dy <= 1;
}

/**
 * Deterministic radial wobble factor for a green boundary at local angle
 * `theta` (radians, measured in the green's own un-rotated frame). Real greens
 * are not perfect circles or ovals — this multiplies the ellipse radius by
 * `1 + Σ aᵢ·sin(kᵢθ+φᵢ)` over two low harmonics (k=2,3) so the edge undulates
 * smoothly and stays star-convex + puttable (|wobble| ≲ 0.16). Amplitudes and
 * phases are seeded from the green's own placement so EVERY consumer — the
 * physics surface test, the albedo bake, the plateau mesh, the putt aids —
 * derives the identical boundary and the sand drawn always matches the sand
 * played.
 */
export function greenBoundaryScale(theta: number, e: EllipseArea): number {
  const h1 = Math.sin(e.cx * 12.9898 + e.cy * 78.233 + (e.rot ?? 0) * 5.17) * 43758.5453;
  const f1 = h1 - Math.floor(h1);
  const h2 = Math.sin(e.cx * 39.3468 + e.cy * 11.135 + (e.rot ?? 0) * 2.71) * 24634.6345;
  const f2 = h2 - Math.floor(h2);
  const a2 = 0.055 + f1 * 0.05; // ~0.055..0.105
  const a3 = 0.03 + f2 * 0.045; // ~0.03..0.075
  const p2 = f1 * Math.PI * 2;
  const p3 = f2 * Math.PI * 2;
  return 1 + a2 * Math.sin(2 * theta + p2) + a3 * Math.sin(3 * theta + p3);
}

/**
 * Point inside an irregular (wobbled) green, with optional margin added to both
 * radii (for the fringe). Same rotated-ellipse test as `pointInEllipse` but the
 * boundary radius is scaled by `greenBoundaryScale` at the point's angle, so the
 * edge reads as a real green instead of a perfect ellipse. Star-convex boundary
 * ⇒ the per-angle radius test is exact.
 */
export function pointInGreen(x: number, y: number, e: EllipseArea, margin = 0): boolean {
  let px = x - e.cx;
  let py = y - e.cy;
  if (e.rot) {
    const c = Math.cos(-e.rot);
    const s = Math.sin(-e.rot);
    const rx0 = px * c - py * s;
    py = px * s + py * c;
    px = rx0;
  }
  const dx = px / (e.rx + margin);
  const dy = py / (e.ry + margin);
  const w = greenBoundaryScale(Math.atan2(py, px), e);
  return dx * dx + dy * dy <= w * w;
}

/**
 * Push any polygon vertex that sits on the green + collar radially outward to
 * just past that boundary, so a bunker whose authored outline runs under the
 * green stops SHORT of it with its own organic edge — instead of being sliced
 * flat along the green's rim (the green wins the surface precedence, so the
 * overlap reads as a hard straight cut). Vertices already clear of the green are
 * untouched, so the bunker keeps its Chaikin-rounded shape and only the
 * green-facing edge is carved back to hug the collar. Deterministic; run at load
 * (courseLoader) so physics, the albedo bake and the 3D sand all agree.
 */
export function clipPolyOffGreen(poly: Polygon, green: EllipseArea, margin: number, gap = 3): Polygon {
  return poly.map(([x, y]) => {
    if (!pointInGreen(x, y, green, margin)) return [x, y];
    const dx = x - green.cx;
    const dy = y - green.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Binary-search the boundary distance along the ray from the green centre.
    let lo = 0;
    let hi = (Math.max(green.rx, green.ry) + margin) * 1.6 + 40;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (pointInGreen(green.cx + ux * mid, green.cy + uy * mid, green, margin)) lo = mid;
      else hi = mid;
    }
    return [green.cx + ux * (hi + gap), green.cy + uy * (hi + gap)];
  });
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle in radians from a to b. */
export function angleTo(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Box–Muller gaussian sample. */
export function gaussian(mean = 0, sigma = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Catmull-Rom sample an open polyline of k-dimensional points (endpoints
 * duplicated so the curve passes through them). Returns the interpolated
 * points including both endpoints. Used by the course loader to turn a
 * fairway centerline + widths into a smooth organic ribbon.
 */
export function catmullRom(points: number[][], samplesPerSeg = 8): number[][] {
  if (points.length < 2) return points.map((p) => [...p]);
  const dims = points[0].length;
  const at = (i: number): number[] => points[Math.max(0, Math.min(points.length - 1, i))];
  const out: number[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const last = i === points.length - 2;
    const steps = last ? samplesPerSeg + 1 : samplesPerSeg; // include final endpoint once
    for (let s = 0; s < steps; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const pt: number[] = new Array(dims);
      for (let d = 0; d < dims; d++) {
        pt[d] =
          0.5 *
          (2 * p1[d] +
            (-p0[d] + p2[d]) * t +
            (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 +
            (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
      }
      out.push(pt);
    }
  }
  return out;
}

/**
 * Chaikin corner-cutting on a CLOSED ring: each pass replaces every vertex with
 * two points a quarter in from its neighbours along the adjoining edges. Sharp
 * corners round off while the polygon's overall form — and its concavities (a
 * crescent bunker stays a crescent) — are preserved, because the cut is purely
 * local and never references a centroid. `iterations` sets the roundness
 * (2 ≈ soft rounded corners; more = rounder + smaller). Deterministic and
 * cheap, so the physics point-in-polygon test and the texture bake can share
 * the same rounded ring with no chance of the sand drawn and the sand played
 * disagreeing.
 */
export function roundPolygon(poly: Polygon, iterations = 2): Polygon {
  if (poly.length < 3) return poly.map((p) => [...p]);
  let ring: number[][] = poly.map((p) => [p[0], p[1]]);
  for (let it = 0; it < iterations; it++) {
    const n = ring.length;
    const next: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    ring = next;
  }
  return ring;
}

/**
 * Offset an open polyline by per-point half-widths on both sides and join
 * the two edges into one closed polygon (a ribbon). Normals average the
 * adjacent segment directions so joints stay smooth.
 *
 * `roundCaps` replaces the blunt perpendicular end cuts with rounded shoulders
 * (a half-circle of radius = the end half-width), so a fairway tee/green end
 * reads organic instead of squared off.
 */
export function offsetPolyline(line: Point[], halfWidths: number[], roundCaps = false): Polygon {
  const n = line.length;
  if (n < 2) return [];
  const left: number[][] = [];
  const right: number[][] = [];
  const hwAt = (i: number): number => halfWidths[Math.min(i, halfWidths.length - 1)];
  for (let i = 0; i < n; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal (left of travel direction)
    const nx = -dy / len;
    const ny = dx / len;
    const hw = hwAt(i);
    left.push([line[i].x + nx * hw, line[i].y + ny * hw]);
    right.push([line[i].x - nx * hw, line[i].y - ny * hw]);
  }
  if (!roundCaps) return [...left, ...right.reverse()];
  // Half-circle cap: sweep from the +normal offset point (θ=0) through the
  // OUTWARD bulge (θ=π/2) to the −normal offset point (θ=π). `normU`/`outU` are
  // the unit normal and unit outward-tangent (perpendicular) at the endpoint.
  const arc = (cx: number, cy: number, normU: Point, outU: Point, hw: number): number[][] => {
    const steps = 6;
    const pts: number[][] = [];
    for (let s = 1; s < steps; s++) {
      const th = (Math.PI * s) / steps;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      pts.push([cx + hw * (c * normU.x + sn * outU.x), cy + hw * (c * normU.y + sn * outU.y)]);
    }
    return pts;
  };
  const unit = (x: number, y: number): Point => {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  };
  // End cap: from left[n-1] (+normal) → right[n-1] (−normal), bulging past the end.
  const hwE = hwAt(n - 1);
  const normE = unit(left[n - 1][0] - line[n - 1].x, left[n - 1][1] - line[n - 1].y);
  const outE = unit(line[n - 1].x - line[n - 2].x, line[n - 1].y - line[n - 2].y);
  const endCap = arc(line[n - 1].x, line[n - 1].y, normE, outE, hwE);
  // Start cap: from right[0] (−normal) → left[0] (+normal), bulging before the start.
  const hwS = hwAt(0);
  const normS = unit(right[0][0] - line[0].x, right[0][1] - line[0].y);
  const outS = unit(line[0].x - line[1].x, line[0].y - line[1].y);
  const startCap = arc(line[0].x, line[0].y, normS, outS, hwS);
  return [...left, ...endCap, ...right.reverse(), ...startCap];
}
