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
