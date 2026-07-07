import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../../config';
import { pointInPolygon } from '../../utils/Geometry';
import { drawDino, drawHeart, drawPikachu } from '../../ui/Ui';
import { Projection, PerspCamera } from './Projection';
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
  private groundG: Phaser.GameObjects.Graphics;
  private animG: Phaser.GameObjects.Graphics;
  private golferG: Phaser.GameObjects.Graphics;
  private clubG: Phaser.GameObjects.Graphics;
  private trees: TreeBlob[] = [];
  private proj: Projection;
  private showGrid = false;

  constructor(private scene: Phaser.Scene, private hole: HoleData) {
    this.skyG = scene.add.graphics();
    this.groundG = scene.add.graphics();
    this.animG = scene.add.graphics();
    this.golferG = scene.add.graphics();
    this.clubG = scene.add.graphics();
    this.root = scene.add.container(0, 0, [
      this.skyG,
      this.groundG,
      this.animG,
      this.golferG,
      this.clubG
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
    this.drawSky();
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
          this.trees.push({ x: jx, y: jy, r: 15 + this.hash(xx + 7, yy + 3) * 12 });
        }
      }
    }
  }

  /** Position the camera behind `ball` looking along `yaw`. */
  setCamera(ball: Point, yaw: number, putting: boolean): void {
    const cam: PerspCamera = putting
      ? {
          x: ball.x - Math.cos(yaw) * 26,
          y: ball.y - Math.sin(yaw) * 26,
          yaw,
          height: 22,
          focal: 620,
          horizonY: 400,
          centerX: GAME_WIDTH / 2
        }
      : {
          x: ball.x - Math.cos(yaw) * 50,
          y: ball.y - Math.sin(yaw) * 50,
          yaw,
          height: 40,
          focal: 520,
          horizonY: SKY_HORIZON_DEFAULT,
          centerX: GAME_WIDTH / 2
        };
    this.proj = new Projection(cam);
    this.showGrid = putting;
    this.redrawGround();
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
    const H = SKY_HORIZON_DEFAULT + 10;
    g.clear();
    g.fillGradientStyle(0x5aa7dd, 0x5aa7dd, 0xbfe3f2, 0xbfe3f2, 1);
    g.fillRect(0, 0, GAME_WIDTH, H);
    // Sun + glow
    g.fillStyle(0xfff3c4, 0.35);
    g.fillCircle(560, 120, 70);
    g.fillStyle(0xfff8dc, 1);
    g.fillCircle(560, 120, 38);
    // Clouds
    g.fillStyle(0xffffff, 0.85);
    for (const [cx, cy, w] of [
      [140, 110, 130],
      [340, 180, 100],
      [620, 230, 120],
      [90, 260, 90]
    ]) {
      g.fillEllipse(cx, cy, w, w * 0.32);
      g.fillEllipse(cx + w * 0.25, cy - w * 0.12, w * 0.6, w * 0.24);
    }
    // Distant tree line on the horizon
    g.fillStyle(0x16381d, 1);
    g.fillRect(0, H - 26, GAME_WIDTH, 26);
    for (let x = 0; x < GAME_WIDTH; x += 26) {
      const r = 10 + this.hash(x, 1) * 16;
      g.fillCircle(x, H - 26, r);
    }
    // Haze above the horizon
    g.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0, 0, 0.28, 0.28);
    g.fillRect(0, H - 70, GAME_WIDTH, 44);
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
    const H = cam.horizonY;
    g.clear();

    // Base ground: distance-shaded rough
    g.fillGradientStyle(0x24512b, 0x24512b, 0x2f6b36, 0x2f6b36, 1);
    g.fillRect(0, H, GAME_WIDTH, GAME_HEIGHT - H);

    // Receding mow bands (world-depth stripes projected to screen rows)
    g.fillStyle(0x000000, 0.05);
    const stripe = 70;
    for (let dNear = 8; dNear < 2600; dNear += stripe * 2) {
      const yNear = H + (cam.height * cam.focal) / dNear;
      const yFar = H + (cam.height * cam.focal) / (dNear + stripe);
      if (yNear - yFar < 0.8 || yFar > GAME_HEIGHT) {
        if (yFar < H + 2) break;
        continue;
      }
      g.fillRect(0, yFar, GAME_WIDTH, yNear - yFar);
    }

    // Fairways
    for (const poly of this.hole.fairway) {
      this.fillProjected(g, proj.projectPolygon(poly), COLORS.fairway, 1, 0x2a6130);
    }

    // Water first, so an island green paints on top of it
    for (const hz of this.hole.hazards) {
      if (hz.type === 'water') {
        this.fillProjected(g, proj.projectPolygon(hz.polygon), COLORS.water, 1, 0x2c5a86);
      }
    }

    // Fringe + green
    this.fillProjected(g, proj.projectEllipse(this.hole.green, 20), COLORS.fringe);
    this.fillProjected(g, proj.projectEllipse(this.hole.green, 0), COLORS.green, 1, 0x4aa554);

    // Bunkers
    for (const hz of this.hole.hazards) {
      if (hz.type === 'bunker') {
        this.fillProjected(g, proj.projectPolygon(hz.polygon), COLORS.sand, 1, 0xb3a06a);
      }
    }

    // Putting grid + break arrows
    if (this.showGrid) this.drawGreenGrid(g);

    // Buildings: extruded boxes you can fly over
    for (const hz of this.hole.hazards) {
      if (hz.type === 'building') this.drawBuilding(g, hz.polygon);
    }

    // Trees: billboards sorted far -> near
    const drawn = this.trees
      .map((t) => ({ t, p: proj.toScreen(t.x, t.y) }))
      .filter((e) => e.p !== null && e.p.d < 2400)
      .sort((a, b) => b.p!.d - a.p!.d);
    for (const { t, p } of drawn) {
      const sp = p!;
      const r = t.r * sp.scale;
      if (r < 1.2) continue;
      const trunkH = 26 * sp.scale;
      g.fillStyle(0x000000, 0.18);
      g.fillEllipse(sp.x + r * 0.3, sp.y + 2, r * 1.6, r * 0.4);
      g.fillStyle(0x5a4632, 1);
      g.fillRect(sp.x - 1.5 * sp.scale, sp.y - trunkH, 3 * sp.scale, trunkH);
      g.fillStyle(0x1e4c26, 1);
      g.fillCircle(sp.x, sp.y - trunkH - r * 0.6, r);
      g.fillStyle(0x2b6b34, 1);
      g.fillCircle(sp.x - r * 0.3, sp.y - trunkH - r * 0.75, r * 0.62);
    }
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
    // Ground shadow
    g.fillStyle(0x000000, 0.2);
    g.fillPoints(base.map((p) => new Phaser.Geom.Point(p.x + 6, p.y + 3)), true);
    // Walls (each footprint edge extruded upward)
    for (let i = 0; i < base.length; i++) {
      const j = (i + 1) % base.length;
      g.fillStyle(i % 2 === 0 ? 0x9a9184 : 0x847c70, 1);
      g.fillPoints(
        [
          new Phaser.Geom.Point(base[i].x, base[i].y),
          new Phaser.Geom.Point(base[j].x, base[j].y),
          new Phaser.Geom.Point(top[j].x, top[j].y),
          new Phaser.Geom.Point(top[i].x, top[i].y)
        ],
        true
      );
    }
    // Roof
    g.fillStyle(0x5f5b52, 1);
    g.fillPoints(top.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
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
