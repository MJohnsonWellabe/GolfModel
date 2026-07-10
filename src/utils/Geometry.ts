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
