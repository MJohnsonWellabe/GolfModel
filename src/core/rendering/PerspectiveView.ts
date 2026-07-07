import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import { CourseTheme, DEFAULT_THEME, shade } from './Theme';
import { pointInPolygon } from '../../utils/Geometry';
import { drawDino, drawHeart, drawPikachu } from '../../ui/Ui';
import { Projection, PerspCamera, ScreenPoint } from './Projection';
import {
  GolferLook,
  HoleData,
  Point,
  TrajectoryPoint
} from '../types';

export interface ViewBall {
  x: number;
  y: number;
  z: number;
  color: number;
}

export interface TrailDot {
  x: number;
  y: number;
  z: number;
  /** 0 = fresh, 1 = expired. */
  age: number;
  onFire: boolean;
}

export interface DynamicState {
  aimPoint: Point | null;
  previewPath: TrajectoryPoint[] | null;
  balls: ViewBall[];
  trail: TrailDot[];
  timeSec: number;
}

interface TreeBlob {
  x: number;
  y: number;
  r: number;
  /** 0 = round oak, 1 = tall poplar, 2 = wide double-crown. */
  kind: number;
  /** Per-tree canopy tint multiplier (0.82..1.14). */
  tint: number;
}

const SKY_HORIZON_DEFAULT = 430;

/**
 * Behind-the-player "shot view": ground-plane perspective rendering of the
 * course, drawn in screen space beneath the HUD. The physics world stays
 * top-down; this is purely a presentation layer.
 */
export class PerspectiveView {
  readonly root: Phaser.GameObjects.Container;
  private skyG: Phaser.GameObjects.Graphics;
  private cloudG: Phaser.GameObjects.Graphics;
  private groundG: Phaser.GameObjects.Graphics;
  private animG: Phaser.GameObjects.Graphics;
  private golferG: Phaser.GameObjects.Graphics;
  private clubG: Phaser.GameObjects.Graphics;
  private trees: TreeBlob[] = [];
  private proj: Projection;
  private showGrid = false;
  /** Adaptive ground-repaint pacing (see applyCamera). */
  private lastGroundAt = -Infinity;
  private redrawCostEma = 4;
  /** Scratch list for depth-sorted tree drawing (reused every repaint). */
  private treeDraw: Array<{ t: TreeBlob; p: ScreenPoint }> = [];
  /** Stable world points inside water hazards that glint over time. */
  private sparkles: Array<{ x: number; y: number; seed: number }> = [];

  constructor(
    private scene: Phaser.Scene,
    private hole: HoleData,
    private theme: CourseTheme = DEFAULT_THEME
  ) {
    this.skyG = scene.add.graphics();
    this.cloudG = scene.add.graphics();
    this.groundG = scene.add.graphics();
    this.animG = scene.add.graphics();
    this.golferG = scene.add.graphics();
    this.clubG = scene.add.graphics();
    const vignetteG = scene.add.graphics();
    this.root = scene.add.container(0, 0, [
      this.skyG,
      this.cloudG,
      this.groundG,
      this.animG,
      this.golferG,
      this.clubG,
      vignetteG
    ]);
    this.root.setDepth(10);
    this.proj = new Projection({
      x: 0,
      y: 0,
      yaw: 0,
      height: 40,
      focal: 520,
      horizonY: SKY_HORIZON_DEFAULT,
      centerX: GAME_WIDTH / 2
    });
    this.collectTrees();
    this.collectSparkles();
    this.drawSky();
    this.drawClouds();
    this.drawVignette(vignetteG);
  }

  /**
   * Clouds drawn twice (one screen apart) into their own layer; sliding the
   * layer with wrap-around in updateDynamic makes them drift for free.
   */
  private drawClouds(): void {
    const g = this.cloudG;
    g.clear();
    for (const dx of [0, GAME_WIDTH]) {
      for (const [cx, cy, w] of [
        [140, 110, 130],
        [340, 180, 100],
        [620, 230, 120],
        [90, 260, 90]
      ]) {
        const x = cx + dx;
        g.fillStyle(0xe9f3f8, 0.7);
        g.fillEllipse(x + 6, cy + 8, w, w * 0.3);
        g.fillStyle(0xffffff, 0.92);
        g.fillEllipse(x, cy, w, w * 0.32);
        g.fillEllipse(x + w * 0.25, cy - w * 0.12, w * 0.6, w * 0.24);
        g.fillEllipse(x - w * 0.28, cy - w * 0.06, w * 0.5, w * 0.2);
      }
    }
  }

  /** Soft edge darkening, drawn once — pulls the eye to the center. */
  private drawVignette(g: Phaser.GameObjects.Graphics): void {
    const w = 110;
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.12, 0, 0.12, 0);
    g.fillRect(0, 0, w, GAME_HEIGHT);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0.12, 0, 0.12);
    g.fillRect(GAME_WIDTH - w, 0, w, GAME_HEIGHT);
  }

  /** Deterministic 0..1 jitter (stable across redraws). */
  private hash(x: number, y: number): number {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  private collectTrees(): void {
    for (const hz of this.hole.hazards) {
      if (hz.type !== 'trees') continue;
      const xs = hz.polygon.map((p) => p[0]);
      const ys = hz.polygon.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      for (let yy = minY; yy < maxY; yy += 52) {
        for (let xx = minX; xx < maxX; xx += 52) {
          const jx = xx + (this.hash(xx, yy) - 0.5) * 36;
          const jy = yy + (this.hash(yy, xx) - 0.5) * 36;
          if (!pointInPolygon(jx, jy, hz.polygon)) continue;
          const h1 = this.hash(xx + 7, yy + 3);
          const h2 = this.hash(xx + 31, yy + 17);
          this.trees.push({
            x: jx,
            y: jy,
            r: 15 + h1 * 12,
            kind: Math.floor(h2 * 3),
            tint: 0.82 + this.hash(xx + 3, yy + 11) * 0.32
          });
        }
      }
    }
  }

  /** Stable in-water points that glint in updateDynamic. */
  private collectSparkles(): void {
    for (const hz of this.hole.hazards) {
      if (hz.type !== 'water') continue;
      const xs = hz.polygon.map((p) => p[0]);
      const ys = hz.polygon.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      for (let yy = minY; yy < maxY; yy += 42) {
        for (let xx = minX; xx < maxX; xx += 42) {
          const jx = xx + (this.hash(xx, yy + 9) - 0.5) * 30;
          const jy = yy + (this.hash(yy + 9, xx) - 0.5) * 30;
          if (!pointInPolygon(jx, jy, hz.polygon)) continue;
          this.sparkles.push({ x: jx, y: jy, seed: this.hash(xx, yy) * Math.PI * 2 });
        }
      }
    }
  }

  /**
   * Apply a camera (from CameraDirector). The projection updates immediately
   * (balls, trails and overlays never lag), but the ground repaint is
   * adaptive: devices that can afford a repaint every frame get one, slower
   * devices repaint as often as their measured repaint cost allows. This
   * keeps input and ball motion at full frame rate everywhere.
   */
  applyCamera(cam: PerspCamera, showGrid: boolean): void {
    this.proj = new Projection({ ...cam });
    this.showGrid = showGrid;
    const now = performance.now();
    const budget = Math.min(120, this.redrawCostEma * 1.5);
    if (now - this.lastGroundAt >= budget) {
      this.redrawGround();
      const cost = performance.now() - now;
      this.redrawCostEma = this.redrawCostEma * 0.8 + cost * 0.2;
      this.lastGroundAt = now;
    }
  }

  get projection(): Projection {
    return this.proj;
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
  }

  // ------------------------------------------------------------------ sky

  private drawSky(): void {
    const g = this.skyG;
    const t = this.theme;
    const H = SKY_HORIZON_DEFAULT + 10;
    g.clear();
    // Two-band gradient reads as a deeper sky dome than a single ramp
    const mid = shade(t.skyTop, 1.35);
    g.fillGradientStyle(t.skyTop, t.skyTop, mid, mid, 1);
    g.fillRect(0, 0, GAME_WIDTH, H * 0.55);
    g.fillGradientStyle(mid, mid, t.skyBottom, t.skyBottom, 1);
    g.fillRect(0, H * 0.55 - 1, GAME_WIDTH, H * 0.45 + 1);

    // Sun: layered bloom
    g.fillStyle(0xfff3c4, 0.18);
    g.fillCircle(t.sunX, t.sunY, 110);
    g.fillStyle(0xfff3c4, 0.35);
    g.fillCircle(t.sunX, t.sunY, 70);
    g.fillStyle(0xfff8dc, 1);
    g.fillCircle(t.sunX, t.sunY, 38);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(t.sunX - 6, t.sunY - 8, 26);

    // Clouds live on their own layer (drawClouds) so they can drift

    // Distant tree line on the horizon (two depths for parallax feel)
    const far = shade(t.treeCanopy, 0.72);
    g.fillStyle(far, 1);
    for (let x = -10; x < GAME_WIDTH + 10; x += 34) {
      const r = 12 + this.hash(x, 5) * 18;
      g.fillCircle(x, H - 20, r);
    }
    g.fillStyle(shade(t.treeCanopy, 0.9), 1);
    g.fillRect(0, H - 22, GAME_WIDTH, 22);
    for (let x = 0; x < GAME_WIDTH; x += 26) {
      const r = 10 + this.hash(x, 1) * 16;
      g.fillCircle(x, H - 22, r);
    }

    // Atmospheric haze above the horizon
    const hz = this.theme.hazeStrength;
    g.fillGradientStyle(t.haze, t.haze, t.haze, t.haze, 0, 0, 0.62 * hz, 0.62 * hz);
    g.fillRect(0, H - 80, GAME_WIDTH, 54);
  }

  // ---------------------------------------------------------------- ground

  private fillProjected(
    g: Phaser.GameObjects.Graphics,
    pts: Array<{ x: number; y: number }> | null,
    color: number,
    alpha = 1,
    outline?: number
  ): void {
    if (!pts) return;
    g.fillStyle(color, alpha);
    g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
    if (outline !== undefined) {
      g.lineStyle(2, outline, 0.7);
      g.strokePoints(pts.map((p) => new Phaser.Geom.Point(p.x, p.y)), true, true);
    }
  }

  private redrawGround(): void {
    const g = this.groundG;
    const proj = this.proj;
    const cam = proj.cam;
    const t = this.theme;
    const H = cam.horizonY;
    g.clear();

    // Base ground: distance-shaded rough
    const roughFar = shade(t.roughDark, 0.92);
    g.fillGradientStyle(roughFar, roughFar, t.rough, t.rough, 1);
    g.fillRect(0, H, GAME_WIDTH, GAME_HEIGHT - H);

    // Receding mow bands (world-depth stripes projected to screen rows).
    // Fairway/green fills below are slightly transparent so these bands
    // ghost through as mowing stripes on every surface.
    // Mow stripes: bands of world distance anchored to the world (phase
    // follows the camera's position along its heading), so they hold still
    // while the camera glides. ~20yd wavelength reads like real mowing.
    const stripe = 42;
    const along = cam.x * Math.cos(cam.yaw) + cam.y * Math.sin(cam.yaw);
    const phase = ((along % (stripe * 2)) + stripe * 2) % (stripe * 2);
    for (let dNear = 6 - phase; dNear < 2600; dNear += stripe * 2) {
      const dA = Math.max(6, dNear);
      const dB = dNear + stripe;
      if (dB <= 6) continue;
      const yNear = H + (cam.height * cam.focal) / dA;
      const yFar = H + (cam.height * cam.focal) / dB;
      if (yNear - yFar < 0.8) {
        if (yFar < H + 2) break;
        continue;
      }
      if (yFar > GAME_HEIGHT) continue;
      g.fillStyle(0x000000, 0.09);
      g.fillRect(0, yFar, GAME_WIDTH, Math.min(yNear, GAME_HEIGHT + 40) - yFar);
      // Sun-catching counter-stripe just beyond each dark band
      const yFar2 = H + (cam.height * cam.focal) / (dB + stripe);
      if (yFar - yFar2 >= 0.8 && yFar2 <= GAME_HEIGHT) {
        g.fillStyle(0xffffff, 0.05);
        g.fillRect(0, yFar2, GAME_WIDTH, yFar - yFar2);
      }
    }

    // Near-field grass flecks, anchored to the world so they hold still
    // while the camera glides (sparse — texture, not noise)
    const step = 56;
    const cx0 = Math.round(cam.x / step) * step;
    const cy0 = Math.round(cam.y / step) * step;
    for (let wy = cy0 - 420; wy <= cy0 + 420; wy += step) {
      for (let wx = cx0 - 420; wx <= cx0 + 420; wx += step) {
        const h = this.hash(wx, wy);
        if (h < 0.45) continue;
        const p = proj.toScreen(wx + (h - 0.5) * 40, wy + (this.hash(wy, wx) - 0.5) * 40);
        if (!p || p.d > 520 || p.y > GAME_HEIGHT) continue;
        const len = Math.max(3, 9 * p.scale * (0.5 + h * 0.5));
        g.fillStyle(h > 0.72 ? 0xd9ecb8 : 0x0a2410, h > 0.72 ? 0.1 : 0.13);
        g.fillRect(p.x, p.y - len, Math.max(2, p.scale * 0.6), len);
      }
    }

    // Fairways (slightly transparent: mow bands show through)
    for (const poly of this.hole.fairway) {
      this.fillProjected(g, proj.projectPolygon(poly), t.fairway, 0.88, t.fairwayDark);
    }

    // Water first, so an island green paints on top of it.
    // Shore ring -> body -> deeper center reads as real depth.
    for (const hz of this.hole.hazards) {
      if (hz.type !== 'water') continue;
      const shore = proj.projectPolygon(hz.polygon);
      if (!shore) continue;
      g.lineStyle(5, shade(t.sand, 1.05), 0.5);
      g.strokePoints(shore.map((p) => new Phaser.Geom.Point(p.x, p.y)), true, true);
      this.fillProjected(g, shore, t.water, 1);
      const cxy = hz.polygon.reduce(
        (a, [x, y]) => [a[0] + x / hz.polygon.length, a[1] + y / hz.polygon.length],
        [0, 0]
      );
      const inner = hz.polygon.map(([x, y]) => [
        x + (cxy[0] - x) * 0.3,
        y + (cxy[1] - y) * 0.3
      ]);
      this.fillProjected(g, proj.projectPolygon(inner), t.waterDeep, 0.85);
    }

    // Fringe ring + green with a soft crown highlight
    this.fillProjected(g, proj.projectEllipse(this.hole.green, 20), t.fringe, 0.96);
    this.fillProjected(g, proj.projectEllipse(this.hole.green, 0), t.green, 0.95, shade(t.green, 0.72));
    const crown = Math.min(this.hole.green.rx, this.hole.green.ry) * 0.38;
    this.fillProjected(g, proj.projectEllipse(this.hole.green, -crown), t.greenLight, 0.5);

    // Bunkers: lip shadow behind, sand body, sun-bleached center
    for (const hz of this.hole.hazards) {
      if (hz.type !== 'bunker') continue;
      const lip = hz.polygon.map(([x, y]) => [x - 3, y - 3]);
      this.fillProjected(g, proj.projectPolygon(lip), shade(t.sandDark, 0.72), 0.85);
      this.fillProjected(g, proj.projectPolygon(hz.polygon), t.sand, 1, t.sandDark);
      const cxy = hz.polygon.reduce(
        (a, [x, y]) => [a[0] + x / hz.polygon.length, a[1] + y / hz.polygon.length],
        [0, 0]
      );
      const inner = hz.polygon.map(([x, y]) => [
        x + (cxy[0] - x) * 0.35,
        y + (cxy[1] - y) * 0.35
      ]);
      this.fillProjected(g, proj.projectPolygon(inner), shade(t.sand, 1.12), 0.75);
    }

    // Putting grid + break arrows
    if (this.showGrid) this.drawGreenGrid(g);

    // Buildings: extruded boxes you can fly over
    for (const hz of this.hole.hazards) {
      if (hz.type === 'building') this.drawBuilding(g, hz.polygon);
    }

    // Trees: billboards sorted far -> near (scratch array reused per frame)
    this.treeDraw.length = 0;
    for (const t of this.trees) {
      const p = proj.toScreen(t.x, t.y);
      if (p !== null && p.d < 2400) this.treeDraw.push({ t, p });
    }
    this.treeDraw.sort((a, b) => b.p.d - a.p.d);
    // Shadows stretch away from the sun's side of the screen
    const shadowLean = this.theme.sunX > GAME_WIDTH / 2 ? -1 : 1;
    for (const { t, p: sp } of this.treeDraw) {
      const r = t.r * sp.scale;
      if (r < 1.2) continue;
      const trunkH = (t.kind === 1 ? 34 : 26) * sp.scale;
      const canopy = shade(this.theme.treeCanopy, t.tint);
      const canopyLight = shade(this.theme.treeCanopyLight, t.tint);
      if (r < 3.2) {
        // Distant trees: a single canopy blob is indistinguishable and cheap
        g.fillStyle(canopy, 1);
        g.fillCircle(sp.x, sp.y - trunkH - r * 0.6, r);
        continue;
      }
      // Directional ground shadow
      g.fillStyle(0x000000, 0.16);
      g.fillEllipse(sp.x + shadowLean * r * 0.75, sp.y + 2, r * 1.9, r * 0.42);
      // Trunk
      g.fillStyle(this.theme.treeTrunk, 1);
      g.fillRect(sp.x - 1.5 * sp.scale, sp.y - trunkH, 3 * sp.scale, trunkH);
      const cy = sp.y - trunkH;
      if (t.kind === 1) {
        // Tall poplar: stacked narrow ovals
        g.fillStyle(canopy, 1);
        g.fillEllipse(sp.x, cy - r * 1.05, r * 1.1, r * 2.3);
        g.fillStyle(canopyLight, 1);
        g.fillEllipse(sp.x - r * 0.2, cy - r * 1.25, r * 0.6, r * 1.5);
      } else if (t.kind === 2) {
        // Wide double-crown
        g.fillStyle(canopy, 1);
        g.fillCircle(sp.x - r * 0.45, cy - r * 0.5, r * 0.78);
        g.fillCircle(sp.x + r * 0.45, cy - r * 0.62, r * 0.82);
        g.fillCircle(sp.x, cy - r * 0.95, r * 0.7);
        g.fillStyle(canopyLight, 1);
        g.fillCircle(sp.x - r * 0.5, cy - r * 0.72, r * 0.42);
        g.fillCircle(sp.x + r * 0.2, cy - r * 1.05, r * 0.4);
      } else {
        // Round oak: layered lobes
        g.fillStyle(canopy, 1);
        g.fillCircle(sp.x, cy - r * 0.6, r);
        g.fillCircle(sp.x - r * 0.55, cy - r * 0.35, r * 0.62);
        g.fillCircle(sp.x + r * 0.55, cy - r * 0.4, r * 0.6);
        g.fillStyle(canopyLight, 1);
        g.fillCircle(sp.x - r * 0.3, cy - r * 0.78, r * 0.6);
      }
    }

    // Ground-side atmospheric haze: the far course melts into the sky
    const t2 = this.theme;
    const hazeH = 46;
    g.fillGradientStyle(
      t2.haze, t2.haze, t2.haze, t2.haze,
      0.5 * t2.hazeStrength, 0.5 * t2.hazeStrength, 0, 0
    );
    g.fillRect(0, H, GAME_WIDTH, hazeH);
  }

  /** Project a building footprint at ground + roof height and draw the box. */
  private drawBuilding(g: Phaser.GameObjects.Graphics, poly: number[][]): void {
    const proj = this.proj;
    const H = 46; // render height, world px
    const base: Array<{ x: number; y: number }> = [];
    const top: Array<{ x: number; y: number }> = [];
    for (const [x, y] of poly) {
      const v = proj.toView(x, y);
      if (v.d < 8) return; // camera too close/inside — skip this frame
      const b = proj.viewToScreen(v)!;
      const t = proj.viewToScreen(v, H)!;
      base.push({ x: b.x, y: b.y });
      top.push({ x: t.x, y: t.y });
    }
    // Ground shadow, stretched away from the sun
    const lean = this.theme.sunX > GAME_WIDTH / 2 ? -10 : 10;
    g.fillStyle(0x000000, 0.2);
    g.fillPoints(base.map((p) => new Phaser.Geom.Point(p.x + lean, p.y + 4)), true);
    // Walls (each footprint edge extruded upward), lit by facing
    for (let i = 0; i < base.length; i++) {
      const j = (i + 1) % base.length;
      const facing = i % 2 === 0 ? 1.0 : 0.82;
      const wall = shade(0x9a8f7d, facing);
      g.fillStyle(wall, 1);
      g.fillPoints(
        [
          new Phaser.Geom.Point(base[i].x, base[i].y),
          new Phaser.Geom.Point(base[j].x, base[j].y),
          new Phaser.Geom.Point(top[j].x, top[j].y),
          new Phaser.Geom.Point(top[i].x, top[i].y)
        ],
        true
      );
      // Windows: two floors of panes lerped along the wall face
      const wallW = Math.hypot(base[j].x - base[i].x, base[j].y - base[i].y);
      const cols = Math.min(8, Math.floor(wallW / 26));
      if (cols >= 2) {
        g.fillStyle(0x333c46, 0.9);
        for (let c = 0; c < cols; c++) {
          const u = (c + 0.5) / cols;
          for (const vfrac of [0.32, 0.68]) {
            const bx = base[i].x + (base[j].x - base[i].x) * u;
            const by = base[i].y + (base[j].y - base[i].y) * u;
            const tx = top[i].x + (top[j].x - top[i].x) * u;
            const ty = top[i].y + (top[j].y - top[i].y) * u;
            const wx = bx + (tx - bx) * vfrac;
            const wy = by + (ty - by) * vfrac;
            const paneW = Math.max(2, (wallW / cols) * 0.36);
            const paneH = Math.max(2.5, Math.abs(ty - by) * 0.16);
            g.fillRect(wx - paneW / 2, wy - paneH / 2, paneW, paneH);
          }
        }
      }
    }
    // Roof: sun-lit slope + shaded slope split along the ridge
    const rc = top.reduce(
      (a, pnt) => ({ x: a.x + pnt.x / top.length, y: a.y + pnt.y / top.length }),
      { x: 0, y: 0 }
    );
    g.fillStyle(0x6e6557, 1);
    g.fillPoints(top.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
    if (top.length >= 4) {
      g.fillStyle(0x584f44, 1);
      g.fillPoints(
        [
          new Phaser.Geom.Point(top[0].x, top[0].y),
          new Phaser.Geom.Point(top[1].x, top[1].y),
          new Phaser.Geom.Point(rc.x, rc.y)
        ],
        true
      );
    }
    g.lineStyle(2, 0x3f3c36, 1);
    g.strokePoints(top.map((p) => new Phaser.Geom.Point(p.x, p.y)), true, true);
  }

  private drawGreenGrid(g: Phaser.GameObjects.Graphics): void {
    const green = this.hole.green;
    const proj = this.proj;
    const step = 26;
    g.lineStyle(1.5, 0xffffff, 0.28);

    const inGreen = (x: number, y: number): boolean => {
      const dx = (x - green.cx) / green.rx;
      const dy = (y - green.cy) / green.ry;
      return dx * dx + dy * dy <= 1;
    };
    const drawWorldLine = (ax: number, ay: number, bx: number, by: number): void => {
      const seg = proj.projectLine({ x: ax, y: ay }, { x: bx, y: by });
      if (!seg) return;
      g.beginPath();
      g.moveTo(seg[0].x, seg[0].y);
      g.lineTo(seg[1].x, seg[1].y);
      g.strokePath();
    };

    // Grid lines clipped to the green ellipse
    for (let gx = green.cx - green.rx; gx <= green.cx + green.rx; gx += step) {
      const dx = (gx - green.cx) / green.rx;
      if (Math.abs(dx) > 1) continue;
      const half = green.ry * Math.sqrt(Math.max(0, 1 - dx * dx));
      drawWorldLine(gx, green.cy - half, gx, green.cy + half);
    }
    for (let gy = green.cy - green.ry; gy <= green.cy + green.ry; gy += step) {
      const dy = (gy - green.cy) / green.ry;
      if (Math.abs(dy) > 1) continue;
      const half = green.rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      drawWorldLine(green.cx - half, gy, green.cx + half, gy);
    }

    // Break chevrons pointing downhill
    const slope = this.hole.slope;
    const ax = Math.cos(slope.angle);
    const ay = Math.sin(slope.angle);
    g.lineStyle(2.5, 0x9fe8ff, 0.9);
    for (let gy = green.cy - green.ry; gy <= green.cy + green.ry; gy += step * 2) {
      for (let gx = green.cx - green.rx; gx <= green.cx + green.rx; gx += step * 2) {
        if (!inGreen(gx, gy)) continue;
        const len = 8 + slope.strength * 14;
        const tip = { x: gx + ax * len, y: gy + ay * len };
        const base = { x: gx, y: gy };
        const seg = proj.projectLine(base, tip);
        if (!seg) continue;
        g.beginPath();
        g.moveTo(seg[0].x, seg[0].y);
        g.lineTo(seg[1].x, seg[1].y);
        g.strokePath();
        // Arrow head
        const wing = 5;
        for (const side of [Math.PI * 0.78, -Math.PI * 0.78]) {
          const wx = tip.x + Math.cos(slope.angle + side) * wing;
          const wy = tip.y + Math.sin(slope.angle + side) * wing;
          const ws = proj.projectLine(tip, { x: wx, y: wy });
          if (!ws) continue;
          g.beginPath();
          g.moveTo(ws[0].x, ws[0].y);
          g.lineTo(ws[1].x, ws[1].y);
          g.strokePath();
        }
      }
    }
  }

  // --------------------------------------------------------------- dynamic

  updateDynamic(state: DynamicState): void {
    const g = this.animG;
    const proj = this.proj;
    // Clouds drift slowly with wrap-around
    this.cloudG.x = -((state.timeSec * 5) % GAME_WIDTH);
    g.clear();

    // Aim marker (projected ring)
    if (state.aimPoint) {
      const p = proj.toScreen(state.aimPoint.x, state.aimPoint.y);
      if (p) {
        const rx = Math.max(6, 14 * p.scale);
        g.lineStyle(3, 0xffd54f, 0.95);
        g.strokeEllipse(p.x, p.y, rx * 2, rx * 0.8);
        g.fillStyle(0xffd54f, 0.9);
        g.fillCircle(p.x, p.y, 3);
      }
    }

    // Preview arc dots
    if (state.previewPath) {
      for (let i = 4; i < state.previewPath.length; i += 5) {
        const pt = state.previewPath[i];
        const p = proj.toScreen(pt.x, pt.y, pt.z);
        if (!p) continue;
        const frac = i / state.previewPath.length;
        g.fillStyle(0xffffff, 0.8 - frac * 0.35);
        g.fillCircle(p.x, p.y, Math.max(2, 3.5 * Math.min(p.scale, 1.6)));
      }
    }

    // Water glints: stable points, alpha rides a slow sine per point
    for (const spk of this.sparkles) {
      const p = proj.toScreen(spk.x, spk.y);
      if (!p || p.d > 1400) continue;
      const tw = (Math.sin(state.timeSec * 2.2 + spk.seed) + 1) / 2;
      if (tw < 0.55) continue;
      g.fillStyle(0xffffff, (tw - 0.55) * 0.9);
      g.fillRect(p.x, p.y, Math.max(1.5, 3 * p.scale), Math.max(1, p.scale * 0.6));
    }

    // Flag (waving)
    const pin = this.hole.pin;
    const base = proj.toScreen(pin.x, pin.y);
    if (base) {
      const top = proj.toScreen(pin.x, pin.y, 46)!;
      const s = Math.min(base.scale, 2);
      // Cup
      g.fillStyle(0x0c2410, 1);
      g.fillEllipse(base.x, base.y, Math.max(4, 10 * s), Math.max(2, 4 * s));
      g.lineStyle(Math.max(2, 3 * s), 0xf5f5f0, 1);
      g.beginPath();
      g.moveTo(base.x, base.y);
      g.lineTo(top.x, top.y);
      g.strokePath();
      const wave = Math.sin(state.timeSec * 5) * 4 * s;
      const fw = Math.max(8, 26 * s);
      const fh = Math.max(5, 16 * s);
      g.fillStyle(0xd23c3c, 1);
      g.fillTriangle(top.x, top.y, top.x + fw, top.y + fh * 0.4 + wave, top.x, top.y + fh);
    }

    // Ball trail
    for (const t of state.trail) {
      const p = proj.toScreen(t.x, t.y, t.z);
      if (!p) continue;
      const alpha = (1 - t.age) * (t.onFire ? 0.85 : 0.55);
      g.fillStyle(t.onFire ? 0xff7b2e : 0xffffff, alpha);
      g.fillCircle(p.x, p.y, Math.max(2, 3 * Math.min(p.scale, 2)) * (1 - t.age * 0.5));
    }

    // Balls (current player's ball is the closest to the camera)
    for (const b of state.balls) {
      const ground = proj.toScreen(b.x, b.y);
      if (!ground) continue;
      const p = proj.toScreen(b.x, b.y, b.z)!;
      const r = Math.min(Math.max(1.5 * ground.scale, 2.5), 10);
      g.fillStyle(0x000000, 0.3);
      g.fillEllipse(ground.x, ground.y, r * 1.6, r * 0.5);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(p.x, p.y - r * 0.6, r);
      g.lineStyle(Math.max(1.5, r * 0.28), b.color, 1);
      g.strokeCircle(p.x, p.y - r * 0.6, r);
    }
  }

  // ---------------------------------------------------------------- golfer

  /** Back-view golfer at the bottom of the frame. Pass null to hide. */
  drawGolfer(look: GolferLook | null): void {
    const g = this.golferG;
    const c = this.clubG;
    g.clear();
    c.clear();
    if (!look) return;

    const s = look.child ? 0.72 : 1; // kids are smaller...
    const headR = look.child ? 20 : 21; // ...with proportionally bigger heads
    const bx = GAME_WIDTH / 2 - 86; // golfer stands left of the ball line
    const by = GAME_HEIGHT - 402; // feet
    // Shadow
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(bx + 12 * s, by + 6, 120 * s, 24 * s);

    // Legs
    g.fillStyle(look.dress ? look.skin : 0xdcd7c8, 1);
    g.fillRoundedRect(bx - 26 * s, by - 78 * s, 22 * s, 78 * s, 8 * s);
    g.fillRoundedRect(bx + 6 * s, by - 78 * s, 22 * s, 78 * s, 8 * s);
    // Shoes
    g.fillStyle(look.dress ? 0xffffff : 0x3a332c, 1);
    g.fillRoundedRect(bx - 30 * s, by - 8 * s, 30 * s, 12 * s, 5 * s);
    g.fillRoundedRect(bx + 2 * s, by - 8 * s, 30 * s, 12 * s, 5 * s);

    // Torso (back view): polo or flared dress
    if (look.dress) {
      g.fillStyle(look.shirt, 1);
      g.fillPoints(
        [
          new Phaser.Geom.Point(bx - 22 * s, by - 152 * s),
          new Phaser.Geom.Point(bx + 24 * s, by - 152 * s),
          new Phaser.Geom.Point(bx + 44 * s, by - 56 * s),
          new Phaser.Geom.Point(bx - 42 * s, by - 56 * s)
        ],
        true
      );
      g.fillStyle(0x000000, 0.08);
      g.fillPoints(
        [
          new Phaser.Geom.Point(bx + 6 * s, by - 152 * s),
          new Phaser.Geom.Point(bx + 24 * s, by - 152 * s),
          new Phaser.Geom.Point(bx + 44 * s, by - 56 * s),
          new Phaser.Geom.Point(bx + 12 * s, by - 56 * s)
        ],
        true
      );
      // Sash bow at the back
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(bx, by - 118 * s, 6 * s);
      g.fillTriangle(bx, by - 118 * s, bx - 14 * s, by - 128 * s, bx - 12 * s, by - 106 * s);
      g.fillTriangle(bx, by - 118 * s, bx + 14 * s, by - 128 * s, bx + 12 * s, by - 106 * s);
    } else {
      g.fillStyle(look.shirt, 1);
      g.fillRoundedRect(bx - 34 * s, by - 152 * s, 70 * s, 84 * s, 16 * s);
      g.fillStyle(0x000000, 0.12);
      g.fillRoundedRect(bx + 12 * s, by - 152 * s, 24 * s, 84 * s, 12 * s);
    }
    if (look.motif === 'dino') {
      drawDino(g, bx, by - 112 * s, 24 * s, 0x1f5e28);
    } else if (look.motif === 'pikachu') {
      drawPikachu(g, bx, by - 110 * s, 22 * s);
    } else if (look.motif === 'heart') {
      drawHeart(g, bx, by - 112 * s, 20 * s);
    }

    // Arms reaching toward the ball
    g.lineStyle(13 * s, look.dress ? look.skin : look.shirt, 1);
    g.beginPath();
    g.moveTo(bx - 24 * s, by - 138 * s);
    g.lineTo(bx + 44 * s, by - 96 * s);
    g.strokePath();
    g.lineStyle(11 * s, look.skin, 1);
    g.beginPath();
    g.moveTo(bx + 30 * s, by - 106 * s);
    g.lineTo(bx + 52 * s, by - 90 * s);
    g.strokePath();

    // Head + hair/hat (back view)
    const hy = by - 152 * s - headR * 0.95;
    if (look.longHair && look.hair !== null) {
      // Hair falling down the back, drawn behind/around the head
      g.fillStyle(look.hair, 1);
      g.fillRoundedRect(bx - headR * 0.95, hy - headR * 0.4, headR * 1.9, 152 * s * 0.62, headR * 0.7);
      if (look.hairStreak !== undefined) {
        g.fillStyle(look.hairStreak, 1);
        g.fillRoundedRect(bx - headR * 0.55, hy - headR * 0.1, headR * 0.32, 152 * s * 0.56, headR * 0.16);
      }
    }
    g.fillStyle(look.skin, 1);
    g.fillCircle(bx, hy, headR);
    if (look.hat !== null) {
      if (look.hatSecondary !== undefined) {
        // Two-tone Pokéball-style cap (back view: secondary color dominant)
        g.fillStyle(look.hatSecondary, 1);
        g.slice(bx, hy - 2, headR + 0.5, Math.PI, Math.PI * 1.5, false);
        g.fillPath();
        g.fillStyle(look.hat, 1);
        g.slice(bx, hy - 2, headR + 0.5, Math.PI * 1.5, Math.PI * 2, false);
        g.fillPath();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(bx, hy - 2 - (headR + 0.5) * 0.82, (headR + 0.5) * 0.14);
        g.fillStyle(look.hat, 1);
      } else {
        g.fillStyle(look.hat, 1);
        g.slice(bx, hy - 2, headR + 0.5, Math.PI, Math.PI * 2, false);
        g.fillPath();
      }
      g.fillRoundedRect(bx - headR - 1, hy - 4, headR * 2 + 2, 7, 3);
    } else if (look.hair !== null) {
      // Back of the head is all hair
      g.fillStyle(look.hair, 1);
      if (look.longHair) {
        g.fillCircle(bx, hy - headR * 0.08, headR * 0.98);
      } else {
        g.slice(bx, hy - 3, headR, Math.PI * 0.95, Math.PI * 2.05, false);
        g.fillPath();
      }
    }

    // Club: shaft from hands down to the ball position
    c.setPosition(bx + 52 * s, by - 90 * s); // grip point
    c.lineStyle(4, 0x777d86, 1);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(56 + (1 - s) * 30, 84 + (1 - s) * 46);
    c.strokePath();
    c.fillStyle(0x50565e, 1);
    c.fillEllipse(60 + (1 - s) * 30, 88 + (1 - s) * 46, 18, 9);
    c.setRotation(0);
  }

  /** Quick backswing + follow-through animation on shot. */
  swing(onDone?: () => void): void {
    this.clubG.setRotation(0);
    this.scene.tweens.add({
      targets: this.clubG,
      rotation: -2.4,
      duration: 260,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.clubG,
          rotation: 0.7,
          duration: 130,
          ease: 'Sine.easeIn',
          onComplete: () => {
            onDone?.();
            this.scene.tweens.add({
              targets: this.clubG,
              rotation: 0,
              duration: 250,
              delay: 350
            });
          }
        });
      }
    });
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
