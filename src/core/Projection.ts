import { EllipseArea, Point, Polygon } from './types';

/** Minimum camera-space depth — geometry closer than this gets clipped. */
const NEAR = 6;

export interface PerspCamera {
  /** World position the camera looks FROM (usually just behind the ball). */
  x: number;
  y: number;
  /** Facing direction in world radians. */
  yaw: number;
  /** Camera height above the ground, world px. */
  height: number;
  /** Focal length in screen px. */
  focal: number;
  /** Screen y of the horizon line. */
  horizonY: number;
  /** Screen x of the view center. */
  centerX: number;
}

export interface ViewPoint {
  /** Camera-space depth (along the view direction). */
  d: number;
  /** Camera-space lateral offset (positive = right of view). */
  s: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Screen px per world px at this depth — scales billboards. */
  scale: number;
  d: number;
}

/**
 * Ground-plane perspective ("mode-7") projection used by the behind-the-player
 * shot view. World stays the same 2D top-down space the physics runs in.
 */
export class Projection {
  constructor(public cam: PerspCamera) {}

  toView(wx: number, wy: number): ViewPoint {
    const { x, y, yaw } = this.cam;
    const rx = wx - x;
    const ry = wy - y;
    const fx = Math.cos(yaw);
    const fy = Math.sin(yaw);
    // right vector for a y-down world so that "right of view" maps right on screen
    const d = rx * fx + ry * fy;
    const s = rx * -fy + ry * fx;
    return { d, s };
  }

  viewToScreen(v: ViewPoint, z = 0): ScreenPoint | null {
    if (v.d < NEAR) return null;
    const { focal, horizonY, centerX, height } = this.cam;
    const scale = focal / v.d;
    return {
      x: centerX + v.s * scale,
      y: horizonY + height * scale - z * scale,
      scale,
      d: v.d
    };
  }

  toScreen(wx: number, wy: number, z = 0): ScreenPoint | null {
    return this.viewToScreen(this.toView(wx, wy), z);
  }

  /**
   * Project a world polygon, clipping against the near plane.
   * Returns screen-space vertices, or null when fully behind the camera.
   */
  projectPolygon(poly: Polygon): Array<{ x: number; y: number }> | null {
    // To view space
    const view = poly.map(([px, py]) => this.toView(px, py));
    // Sutherland–Hodgman clip against d >= NEAR
    const clipped: ViewPoint[] = [];
    for (let i = 0; i < view.length; i++) {
      const a = view[i];
      const b = view[(i + 1) % view.length];
      const aIn = a.d >= NEAR;
      const bIn = b.d >= NEAR;
      if (aIn) clipped.push(a);
      if (aIn !== bIn) {
        const t = (NEAR - a.d) / (b.d - a.d);
        clipped.push({ d: NEAR, s: a.s + (b.s - a.s) * t });
      }
    }
    if (clipped.length < 3) return null;
    return clipped.map((v) => {
      const p = this.viewToScreen(v)!;
      return { x: p.x, y: p.y };
    });
  }

  /** Ellipse → polygon (n segments) → projected screen polygon. */
  projectEllipse(e: EllipseArea, margin = 0, segments = 28): Array<{ x: number; y: number }> | null {
    const poly: Polygon = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      poly.push([e.cx + Math.cos(a) * (e.rx + margin), e.cy + Math.sin(a) * (e.ry + margin)]);
    }
    return this.projectPolygon(poly);
  }

  /** Project a world polyline; splits where it crosses the near plane. */
  projectLine(a: Point, b: Point): Array<{ x: number; y: number }> | null {
    let va = this.toView(a.x, a.y);
    let vb = this.toView(b.x, b.y);
    if (va.d < NEAR && vb.d < NEAR) return null;
    if (va.d < NEAR || vb.d < NEAR) {
      const t = (NEAR - va.d) / (vb.d - va.d);
      const cut = { d: NEAR, s: va.s + (vb.s - va.s) * t };
      if (va.d < NEAR) va = cut;
      else vb = cut;
    }
    const pa = this.viewToScreen(va)!;
    const pb = this.viewToScreen(vb)!;
    return [
      { x: pa.x, y: pa.y },
      { x: pb.x, y: pb.y }
    ];
  }
}
