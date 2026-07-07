import Phaser from 'phaser';
import { COLORS } from '../../config';
import { pointInPolygon } from '../../utils/Geometry';
import { HoleData, Point, Polygon } from '../types';

function polyCentroid(poly: Polygon): Point {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** Deterministic 0..1 jitter (stable across redraws). */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Draw the overhead planning view of a hole into `g` (world space).
 * This is also the world the ball sprites live in during play.
 */
export function drawOverheadCourse(g: Phaser.GameObjects.Graphics, hole: HoleData): void {
  const { width: w, height: h } = hole.world;

  g.fillStyle(COLORS.roughDark, 1);
  g.fillRect(-800, -800, w + 1600, h + 1600);
  g.fillStyle(COLORS.rough, 0.75);
  for (let y = -800; y < h + 800; y += 130) {
    g.fillRect(-800, y, w + 1600, 65);
  }

  for (const poly of hole.fairway) {
    const pts = poly.map(([x, y]) => new Phaser.Geom.Point(x, y));
    g.lineStyle(10, 0x2a6130, 1);
    g.strokePoints(pts, true, true);
    g.fillStyle(COLORS.fairway, 1);
    g.fillPoints(pts, true);
  }

  // Water first so an island green paints over it
  for (const hz of hole.hazards) {
    if (hz.type !== 'water') continue;
    const pts = hz.polygon.map(([x, y]) => new Phaser.Geom.Point(x, y));
    const c = polyCentroid(hz.polygon);
    g.fillStyle(0x2c5a86, 1);
    g.fillPoints(pts, true);
    const inner = hz.polygon.map(([x, y]) => [
      x + (c.x - x) * 0.12,
      y + (c.y - y) * 0.12 + 3
    ]);
    g.fillStyle(COLORS.water, 1);
    g.fillPoints(inner.map(([x, y]) => new Phaser.Geom.Point(x, y)), true);
  }

  const green = hole.green;
  g.fillStyle(COLORS.fringe, 1);
  g.fillEllipse(green.cx, green.cy, (green.rx + 20) * 2, (green.ry + 20) * 2);
  g.fillStyle(COLORS.green, 1);
  g.fillEllipse(green.cx, green.cy, green.rx * 2, green.ry * 2);

  for (const hz of hole.hazards) {
    const pts = hz.polygon.map(([x, y]) => new Phaser.Geom.Point(x, y));
    if (hz.type === 'water') {
      continue; // drawn above
    } else if (hz.type === 'bunker') {
      g.fillStyle(0xcbb87c, 1);
      g.fillPoints(pts, true);
    } else if (hz.type === 'building') {
      g.fillStyle(0x8a8378, 1);
      g.fillPoints(pts, true);
      g.lineStyle(3, 0x4a463f, 1);
      g.strokePoints(pts, true, true);
      // Roof ridge across the footprint
      const c = polyCentroid(hz.polygon);
      g.lineStyle(2, 0x5f5b52, 1);
      g.beginPath();
      g.moveTo(hz.polygon[0][0], hz.polygon[0][1]);
      g.lineTo(c.x, c.y);
      g.lineTo(hz.polygon[2][0], hz.polygon[2][1]);
      g.strokePath();
    } else {
      g.fillStyle(0x1a3d20, 1);
      g.fillPoints(pts, true);
      const xs = hz.polygon.map((p) => p[0]);
      const ys = hz.polygon.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      for (let yy = minY; yy < maxY; yy += 50) {
        for (let xx = minX; xx < maxX; xx += 50) {
          const jx = xx + (hash(xx, yy) - 0.5) * 34;
          const jy = yy + (hash(yy, xx) - 0.5) * 34;
          if (!pointInPolygon(jx, jy, hz.polygon)) continue;
          const r = 14 + hash(xx + 7, yy + 3) * 10;
          g.fillStyle(0x235a2b, 1);
          g.fillCircle(jx, jy, r);
          g.fillStyle(0x2f7a39, 1);
          g.fillCircle(jx - r * 0.3, jy - r * 0.3, r * 0.5);
        }
      }
    }
  }

  // Tee + pin markers
  g.fillStyle(0xffffff, 1);
  g.fillCircle(hole.tee.x - 14, hole.tee.y, 5);
  g.fillCircle(hole.tee.x + 14, hole.tee.y, 5);
  const pin = hole.pin;
  g.fillStyle(0x0c2410, 1);
  g.fillCircle(pin.x, pin.y, 5);
  g.lineStyle(3, 0xf5f5f0, 1);
  g.beginPath();
  g.moveTo(pin.x, pin.y);
  g.lineTo(pin.x, pin.y - 40);
  g.strokePath();
  g.fillStyle(0xd23c3c, 1);
  g.fillTriangle(pin.x, pin.y - 40, pin.x + 24, pin.y - 32, pin.x, pin.y - 24);
}
