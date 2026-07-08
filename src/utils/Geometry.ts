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
 */
export function offsetPolyline(line: Point[], halfWidths: number[]): Polygon {
  const n = line.length;
  if (n < 2) return [];
  const left: number[][] = [];
  const right: number[][] = [];
  for (let i = 0; i < n; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal (left of travel direction)
    const nx = -dy / len;
    const ny = dx / len;
    const hw = halfWidths[Math.min(i, halfWidths.length - 1)];
    left.push([line[i].x + nx * hw, line[i].y + ny * hw]);
    right.push([line[i].x - nx * hw, line[i].y - ny * hw]);
  }
  return [...left, ...right.reverse()];
}
