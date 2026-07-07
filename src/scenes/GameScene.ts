import Phaser from 'phaser';
import {
  COLORS,
  GAME_HEIGHT,
  GAME_WIDTH,
  PHYSICS,
  PX_PER_YARD,
  RULES
} from '../config';
import { AIController } from '../core/AIController';
import { state } from '../core/GameState';
import { angleTo, clamp, dist, pointInPolygon } from '../core/Geometry';
import { PerspectiveView, TrailDot } from '../core/PerspectiveView';
import { effectiveCarryYards, PhysicsEngine, statsForClub } from '../core/PhysicsEngine';
import { scoreName } from '../core/Scoring';
import { safePlay } from '../core/Sfx';
import { SwingMeter } from '../core/SwingMeter';
import {
  Band,
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  Polygon,
  ShotOutcome,
  Surface,
  SwingResult,
  TrajectoryPoint
} from '../core/types';
import { makeButton } from '../core/Ui';
import { CLUBS } from '../data/clubs';

interface PlayerRt {
  golfer: Golfer;
  isAI: boolean;
  ball: Point;
  strokes: number;
  holed: boolean;
  lie: Surface;
  sprite: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
}

interface ShotAnim {
  path: TrajectoryPoint[];
  progress: number;
  player: PlayerRt;
  outcome: ShotOutcome;
  landed: boolean;
  /** Live ball position while animating (world). */
  pos: TrajectoryPoint;
  onDone: () => void;
}

const SURFACE_LABEL: Record<Surface, string> = {
  tee: 'Tee',
  fairway: 'Fairway',
  rough: 'Rough',
  sand: 'Bunker',
  fringe: 'Fringe',
  green: 'Green',
  water: 'Water',
  trees: 'Trees'
};

const METER_Y = GAME_HEIGHT - 290;
const BUTTON_Y = GAME_HEIGHT - 122;
/** Interactive course viewport (below HUD, above meter panel). */
const VIEW_TOP = 270;
const VIEW_BOTTOM = METER_Y - 40;

type ViewMode = 'persp' | 'overhead';

export class GameScene extends Phaser.Scene {
  private hole!: HoleData;
  private engine!: PhysicsEngine;
  private players: PlayerRt[] = [];
  private currentIdx = 0;
  private meter!: SwingMeter;
  private ai: AIController | null = null;
  private worldLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private persp!: PerspectiveView;
  private viewMode: ViewMode = 'persp';
  private aimGraphics!: Phaser.GameObjects.Graphics;
  /** Aim expressed relative to the current ball. */
  private aimYaw = 0;
  private aimDistPx = 100;
  private previewPath: TrajectoryPoint[] | null = null;
  private clubIdx = 0;
  private busy = true;
  private anim: ShotAnim | null = null;
  private trail: TrailDot[] = [];
  private baseZoom = 0.8;
  private dragStart: Point | null = null;
  private dragLast: Point | null = null;
  private dragMoved = false;

  // Scramble (best-ball team) state
  private teamBall: Point = { x: 0, y: 0 };
  private teamLie: Surface = 'tee';
  private teamStrokes = 0;
  private teamHoled = false;
  private scramblePhase = 0;
  private scrambleOutcomes: Array<ShotOutcome | null> = [null, null];

  // HUD
  private clubText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private lieText!: Phaser.GameObjects.Text;
  private windText!: Phaser.GameObjects.Text;
  private windArrow!: Phaser.GameObjects.Container;
  private holeText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private distText!: Phaser.GameObjects.Text;
  private fireText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private feedback!: Phaser.GameObjects.Text;
  private aerialBtnText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    if (!state.golfer || !state.course || !state.scoring) {
      this.scene.start('TitleScene');
      return;
    }
    this.hole = state.course.holes[state.holeIndex];
    this.engine = new PhysicsEngine(this.hole);
    this.players = [];
    this.anim = null;
    this.trail = [];
    this.busy = true;
    this.viewMode = 'persp';
    this.previewPath = null;
    this.dragLast = null;

    this.worldLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0).setDepth(100);

    this.drawTopDownCourse();
    this.setupPlayers();
    this.teamBall = { ...this.hole.tee };
    this.teamLie = 'tee';
    this.teamStrokes = 0;
    this.teamHoled = false;
    this.scramblePhase = 0;
    this.scrambleOutcomes = [null, null];
    this.persp = new PerspectiveView(this, this.hole);
    this.setupCameras();
    this.setupHud();

    // Wind: fresh conditions on every hole
    state.wind = {
      angle: Math.random() * Math.PI * 2,
      speed: Math.round(2 + Math.random() * (PHYSICS.maxWind - 2))
    };

    this.meter = new SwingMeter(
      this,
      70,
      METER_Y,
      GAME_WIDTH - 140,
      50,
      BUTTON_Y,
      this.uiLayer
    );
    this.meter.onComplete = (result) => this.onSwingComplete(result);
    this.meter.onBand = (kind, band) => this.onBandLocked(kind, band);

    this.aimGraphics = this.add.graphics();
    this.worldLayer.add(this.aimGraphics);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    this.applyViewMode();
    this.updateHud();
    this.showHoleBanner();
    this.time.delayedCall(1500, () => {
      this.busy = false;
      this.startTurn();
    });
  }

  // ---------------------------------------------------------------- setup

  private setupPlayers(): void {
    const roster: Array<{ golfer: Golfer; isAI: boolean }> = [
      { golfer: state.golfer!, isAI: false }
    ];
    if (state.mode !== 'solo' && state.opponent) {
      roster.push({ golfer: state.opponent, isAI: true });
    }

    roster.forEach((entry, i) => {
      const pos = { x: this.hole.tee.x + i * 16, y: this.hole.tee.y + i * 10 };
      const shadow = this.add.ellipse(pos.x, pos.y, 12, 7, 0x000000, 0.35);
      const sprite = this.add.circle(pos.x, pos.y, 7, 0xffffff);
      sprite.setStrokeStyle(3, entry.golfer.color, 1);
      this.worldLayer.add([shadow, sprite]);
      this.players.push({
        golfer: entry.golfer,
        isAI: entry.isAI,
        ball: pos,
        strokes: 0,
        holed: false,
        lie: 'tee',
        sprite,
        shadow
      });
    });

    const aiPlayer = this.players.find((p) => p.isAI);
    this.ai = aiPlayer ? new AIController(aiPlayer.golfer, state.fire[1]) : null;
  }

  private setupCameras(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.hole.world.width, this.hole.world.height);
    this.baseZoom = clamp(GAME_WIDTH / this.hole.world.width, 0.5, 1.0);
    cam.setZoom(this.baseZoom);
    cam.centerOn(this.hole.world.width / 2, this.hole.world.height / 2);
    cam.ignore(this.uiLayer);
    cam.ignore(this.persp.root);

    this.uiCam = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.uiCam.ignore(this.worldLayer);
  }

  private applyViewMode(): void {
    const overhead = this.viewMode === 'overhead';
    this.persp.setVisible(!overhead);
    this.worldLayer.setVisible(overhead);
    if (this.aerialBtnText) this.aerialBtnText.setText(overhead ? 'BACK' : 'AERIAL');
    this.updateWindHud();
    if (overhead) this.drawTopDownAim();
  }

  private currentClub(): ClubSpec {
    return CLUBS[this.clubIdx];
  }

  private maxCarryPx(): number {
    const p = this.players[this.currentIdx];
    return (
      effectiveCarryYards(this.currentClub(), p.golfer, state.fire[this.currentIdx].statBoost, p.lie) *
      PX_PER_YARD
    );
  }

  private aimPoint(): Point {
    const p = this.players[this.currentIdx];
    return {
      x: p.ball.x + Math.cos(this.aimYaw) * this.aimDistPx,
      y: p.ball.y + Math.sin(this.aimYaw) * this.aimDistPx
    };
  }

  private isPutting(): boolean {
    return this.currentClub().id === 'putter';
  }

  /**
   * Full-bar distance in world px. Putts scale the bar to the aim spot:
   * a full stroke rolls exactly to where you're aiming, so aiming farther
   * makes every real distance a smaller fraction of the bar.
   */
  private meterScalePx(): number {
    return this.isPutting() ? this.aimDistPx : this.maxCarryPx();
  }

  /** Where the power target line sits on the bar for the current aim. */
  private barPowerTarget(): number {
    if (!this.isPutting()) {
      return clamp(this.aimDistPx / this.maxCarryPx(), 0.15, 1);
    }
    // Putts: the target is the power needed to reach the HOLE, as a fraction
    // of a full stroke to the aim spot — aim farther and the target slides
    // toward the start of the bar. Slope-aware: uphill needs more,
    // downhill less (rolling decel along the aim is mu - a_parallel).
    const p = this.players[this.currentIdx];
    const pinDist = dist(p.ball, this.hole.pin);
    const mu = PHYSICS.friction.green;
    const slope = this.hole.slope;
    const aPar = PHYSICS.slopeAccel * slope.strength * Math.cos(slope.angle - this.aimYaw);
    const effectivePinDist = pinDist * ((mu - aPar) / mu);
    return clamp(effectivePinDist / this.aimDistPx, 0.05, 1);
  }

  /** Convert a bar fraction to the physics engine's power units. */
  private barToPhysicsPower(barPower: number): number {
    if (!this.isPutting()) return barPower;
    return (barPower * this.meterScalePx()) / this.maxCarryPx();
  }

  // ------------------------------------------------------- top-down course

  private polyCentroid(poly: Polygon): Point {
    let x = 0;
    let y = 0;
    for (const [px, py] of poly) {
      x += px;
      y += py;
    }
    return { x: x / poly.length, y: y / poly.length };
  }

  private hash(x: number, y: number): number {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /** Overhead planning view (also the world the ball sprites live in). */
  private drawTopDownCourse(): void {
    const g = this.add.graphics();
    this.worldLayer.add(g);
    const { width: w, height: h } = this.hole.world;

    g.fillStyle(COLORS.roughDark, 1);
    g.fillRect(-800, -800, w + 1600, h + 1600);
    g.fillStyle(COLORS.rough, 0.75);
    for (let y = -800; y < h + 800; y += 130) {
      g.fillRect(-800, y, w + 1600, 65);
    }

    for (const poly of this.hole.fairway) {
      const pts = poly.map(([x, y]) => new Phaser.Geom.Point(x, y));
      g.lineStyle(10, 0x2a6130, 1);
      g.strokePoints(pts, true, true);
      g.fillStyle(COLORS.fairway, 1);
      g.fillPoints(pts, true);
    }

    // Water first so an island green paints over it
    for (const hz of this.hole.hazards) {
      if (hz.type !== 'water') continue;
      const pts = hz.polygon.map(([x, y]) => new Phaser.Geom.Point(x, y));
      const c = this.polyCentroid(hz.polygon);
      g.fillStyle(0x2c5a86, 1);
      g.fillPoints(pts, true);
      const inner = hz.polygon.map(([x, y]) => [
        x + (c.x - x) * 0.12,
        y + (c.y - y) * 0.12 + 3
      ]);
      g.fillStyle(COLORS.water, 1);
      g.fillPoints(inner.map(([x, y]) => new Phaser.Geom.Point(x, y)), true);
    }

    const green = this.hole.green;
    g.fillStyle(COLORS.fringe, 1);
    g.fillEllipse(green.cx, green.cy, (green.rx + 20) * 2, (green.ry + 20) * 2);
    g.fillStyle(COLORS.green, 1);
    g.fillEllipse(green.cx, green.cy, green.rx * 2, green.ry * 2);

    for (const hz of this.hole.hazards) {
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
        const c = this.polyCentroid(hz.polygon);
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
            const jx = xx + (this.hash(xx, yy) - 0.5) * 34;
            const jy = yy + (this.hash(yy, xx) - 0.5) * 34;
            if (!pointInPolygon(jx, jy, hz.polygon)) continue;
            const r = 14 + this.hash(xx + 7, yy + 3) * 10;
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
    g.fillCircle(this.hole.tee.x - 14, this.hole.tee.y, 5);
    g.fillCircle(this.hole.tee.x + 14, this.hole.tee.y, 5);
    const pin = this.hole.pin;
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

  // ---------------------------------------------------------------- HUD

  private setupHud(): void {
    const g = this.add.graphics();
    this.uiLayer.add(g);
    const panel = (px: number, py: number, pw: number, ph: number): void => {
      g.fillStyle(0x000000, 0.25);
      g.fillRoundedRect(px + 3, py + 4, pw, ph, 16);
      g.fillStyle(COLORS.uiPanel, 0.88);
      g.fillRoundedRect(px, py, pw, ph, 16);
      g.lineStyle(2, 0xffffff, 0.18);
      g.strokeRoundedRect(px, py, pw, ph, 16);
    };
    panel(14, 14, 226, 178);
    panel(252, 14, 216, 130);
    panel(GAME_WIDTH - 244, 14, 230, 178);

    const style = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: 'Arial, sans-serif',
      fontSize: `${size}px`,
      color,
      fontStyle: 'bold'
    });

    const prev = this.add.text(38, 44, '◀', style(36)).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const next = this.add.text(216, 44, '▶', style(36)).setOrigin(0.5).setInteractive({ useHandCursor: true });
    prev.on('pointerdown', () => this.cycleClub(-1));
    next.on('pointerdown', () => this.cycleClub(1));
    this.clubText = this.add.text(127, 36, '', style(32, '#ffd54f')).setOrigin(0.5);
    this.carryText = this.add.text(127, 64, '', style(17, '#9fbf9a')).setOrigin(0.5);
    this.lieText = this.add.text(26, 88, '', style(20, '#cfe2ca')).setOrigin(0, 0);
    this.distText = this.add.text(26, 118, '', style(22, '#ffffff')).setOrigin(0, 0);
    this.fireText = this.add.text(26, 152, '', style(19, '#ff8a50')).setOrigin(0, 0);

    const wg = this.add.graphics();
    wg.fillStyle(0x0a2010, 0.8);
    wg.fillCircle(360, 62, 38);
    wg.lineStyle(2, 0xffffff, 0.3);
    wg.strokeCircle(360, 62, 38);
    this.uiLayer.add(wg);
    const arrowG = this.add.graphics();
    arrowG.fillStyle(0xffd54f, 1);
    arrowG.fillTriangle(22, 0, -10, -12, -10, 12);
    arrowG.fillRect(-22, -5, 16, 10);
    this.windArrow = this.add.container(360, 62, [arrowG]);
    this.windText = this.add.text(360, 122, '', style(21)).setOrigin(0.5);

    this.holeText = this.add.text(GAME_WIDTH - 230, 28, '', style(23)).setOrigin(0, 0);
    this.scoreText = this.add
      .text(GAME_WIDTH - 230, 96, '', style(20, '#ffd54f'))
      .setOrigin(0, 0);

    // AERIAL / BACK view toggle
    const aerialBtn = makeButton(this, GAME_WIDTH - 84, 236, 132, 54, 'AERIAL', () => this.toggleView(), {
      fontSize: 22,
      fill: 0x11431f
    });
    this.aerialBtnText = aerialBtn.list[1] as Phaser.GameObjects.Text;
    this.uiLayer.add(aerialBtn);

    this.turnText = this.add.text(GAME_WIDTH / 2, 218, '', style(26)).setOrigin(0.5);
    this.feedback = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 160, '', {
        ...style(50),
        stroke: '#08240f',
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.uiLayer.add([
      prev,
      next,
      this.clubText,
      this.carryText,
      this.lieText,
      this.distText,
      this.fireText,
      this.windText,
      this.windArrow,
      this.holeText,
      this.scoreText,
      this.turnText,
      this.feedback
    ]);
  }

  private updateWindHud(): void {
    this.windText.setText(`Wind ${state.wind.speed} mph`);
    // In the shot view the arrow is relative to where you're facing
    const rot =
      this.viewMode === 'persp'
        ? state.wind.angle - this.aimYaw - Math.PI / 2
        : state.wind.angle;
    this.windArrow.setRotation(rot);
  }

  private updateHud(): void {
    const p = this.players[this.currentIdx];
    const remainingYds = this.engine.yardsToPin(p.ball);
    this.holeText.setText(
      `Hole ${this.hole.number} • Par ${this.hole.par}\n${this.hole.yardage} yds`
    );
    this.distText.setText(
      p.lie === 'green'
        ? `To pin: ${Math.round(remainingYds * 3)} ft`
        : `To pin: ${Math.round(remainingYds)} yds`
    );
    this.lieText.setText(`Lie: ${SURFACE_LABEL[p.lie]}`);
    const club = this.currentClub();
    this.clubText.setText(club.name);
    const carry = effectiveCarryYards(club, p.golfer, state.fire[this.currentIdx].statBoost, p.lie);
    this.carryText.setText(
      club.id === 'putter'
        ? `full ${Math.round((this.meterScalePx() / PX_PER_YARD) * 3)} ft`
        : `~${Math.round(carry)} yds`
    );

    const fire = state.fire[this.currentIdx];
    if (fire.isOnFire) {
      this.fireText.setText('🔥 ON FIRE!');
    } else if (fire.currentStreak > 0) {
      this.fireText.setText(`Streak ${'●'.repeat(fire.currentStreak)}`);
    } else {
      this.fireText.setText('');
    }

    if (state.mode === 'scramble') {
      const toPar = state.scoring!.totalToPar(0, state.holeIndex - 1);
      const sign = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
      this.scoreText.setText(`Team: ${sign}\nStrokes: ${this.teamStrokes}`);
    } else {
      const parts = this.players.map((pl, i) => {
        const toPar = state.scoring!.totalToPar(i, state.holeIndex - 1);
        const sign = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
        return `${pl.golfer.name}: ${sign}`;
      });
      this.scoreText.setText(`${parts.join('\n')}\nStrokes: ${p.strokes}`);
    }
    this.updateWindHud();
  }

  private showFeedback(msg: string, color = '#ffffff', holdMs = 900): void {
    this.feedback.setText(msg).setColor(color);
    this.tweens.killTweensOf(this.feedback);
    this.feedback.setAlpha(0).setScale(0.4).setY(GAME_HEIGHT / 2 - 160);
    this.tweens.add({
      targets: this.feedback,
      alpha: 1,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut'
    });
    this.tweens.add({
      targets: this.feedback,
      alpha: 0,
      y: GAME_HEIGHT / 2 - 220,
      delay: holdMs + 220,
      duration: 420,
      ease: 'Sine.easeIn'
    });
  }

  private showHoleBanner(): void {
    const cx = GAME_WIDTH / 2;
    const g = this.add.graphics();
    g.fillStyle(0x08240f, 0.92);
    g.fillRoundedRect(cx - 290, 480, 580, 190, 24);
    g.lineStyle(3, 0xffd54f, 0.8);
    g.strokeRoundedRect(cx - 290, 480, 580, 190, 24);
    const t1 = this.add
      .text(cx, 540, this.hole.name ? this.hole.name.toUpperCase() : `HOLE ${this.hole.number}`, {
        fontFamily: 'Georgia, serif',
        fontSize: '48px',
        color: '#f6f2df',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const t2 = this.add
      .text(cx, 608, `Hole ${this.hole.number}  •  Par ${this.hole.par}  •  ${this.hole.yardage} yds`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '30px',
        color: '#ffd54f',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const banner = this.add.container(0, 0, [g, t1, t2]).setAlpha(0).setDepth(90);
    this.uiLayer.add(banner);
    this.tweens.add({ targets: banner, alpha: 1, duration: 250 });
    this.tweens.add({
      targets: banner,
      alpha: 0,
      delay: 1300,
      duration: 350,
      onComplete: () => banner.destroy()
    });
  }

  // ---------------------------------------------------------------- turns

  private startTurn(): void {
    if (state.mode === 'scramble') {
      this.startScrambleTurn();
      return;
    }
    for (const p of this.players) {
      if (!p.holed && p.strokes >= RULES.maxStrokes) {
        p.holed = true;
        this.showFeedback(`${p.golfer.name} picks up`, '#f0c060');
      }
    }

    const active = this.players.filter((p) => !p.holed);
    if (active.length === 0) {
      this.endHole();
      return;
    }

    let idx = -1;
    let far = -1;
    this.players.forEach((p, i) => {
      if (p.holed) return;
      const d = dist(p.ball, this.hole.pin);
      if (d > far + 24) {
        far = d;
        idx = i;
      } else if (idx === -1) {
        idx = i;
      }
    });
    this.currentIdx = idx;
    const p = this.players[idx];

    state.ballPosition = p.ball;
    state.lie = p.lie;
    state.streak = state.fire[0].currentStreak;

    this.autoSelectClub(p);
    this.resetAim();
    this.viewMode = 'persp';
    this.applyViewMode();
    this.refreshShotView();
    this.persp.drawGolfer(p.golfer.look);
    this.updateHud();

    if (p.isAI) {
      this.busy = true;
      this.turnText.setText(`${p.golfer.name} is thinking...`);
      this.time.delayedCall(1300, () => this.aiShot());
    } else {
      this.turnText.setText(this.isPutting() ? 'Read the break — drag to aim' : 'Drag to aim');
      this.busy = false;
      this.armMeter();
    }
  }

  /**
   * Scramble: both teammates hit from the team ball, then the better
   * result becomes the new team ball (one stroke per cycle).
   */
  private startScrambleTurn(): void {
    if (this.teamHoled || this.teamStrokes >= RULES.maxStrokes) {
      if (!this.teamHoled) this.showFeedback('Team picks up', '#f0c060');
      this.endHole();
      return;
    }

    // Both play from the team ball
    const idx = this.scramblePhase;
    this.currentIdx = idx;
    const p = this.players[idx];
    p.ball = { ...this.teamBall };
    p.lie = this.teamLie;
    p.sprite.setPosition(p.ball.x, p.ball.y);
    p.shadow.setPosition(p.ball.x, p.ball.y);

    state.ballPosition = p.ball;
    state.lie = p.lie;
    state.streak = state.fire[0].currentStreak;

    this.autoSelectClub(p);
    this.resetAim();
    this.viewMode = 'persp';
    this.applyViewMode();
    this.refreshShotView();
    this.persp.drawGolfer(p.golfer.look);
    this.updateHud();

    if (p.isAI) {
      this.busy = true;
      this.turnText.setText(`Partner ${p.golfer.name} is up...`);
      this.time.delayedCall(1300, () => this.aiShot());
    } else {
      this.turnText.setText('Your shot — best ball counts');
      this.busy = false;
      this.armMeter();
    }
  }

  /** Pick the better of the two scramble results and continue from it. */
  private resolveScramble(): void {
    const [a, b] = this.scrambleOutcomes;
    if (!a || !b) return;
    const score = (o: ShotOutcome): number => {
      if (o.holed) return -1;
      return dist(o.finalPos, this.hole.pin) + (o.waterPenalty ? 100000 : 0);
    };
    const chooseA = score(a) <= score(b);
    const chosen = chooseA ? a : b;
    const chooser = this.players[chooseA ? 0 : 1];

    this.teamStrokes += 1 + (chosen.waterPenalty ? 1 : 0);
    this.teamBall = { ...chosen.finalPos };
    this.teamLie = chosen.surface;
    this.scrambleOutcomes = [null, null];
    this.scramblePhase = 0;

    for (const p of this.players) {
      p.ball = { ...this.teamBall };
      p.sprite.setPosition(p.ball.x, p.ball.y);
      p.shadow.setPosition(p.ball.x, p.ball.y);
    }

    let wait = 1200;
    if (chosen.holed) {
      this.teamHoled = true;
      safePlay(this, 'hole');
      this.showFeedback(
        `Team: ${scoreName(this.teamStrokes, this.hole.par)}`,
        '#ffd54f',
        1400
      );
      wait = 1700;
    } else {
      this.showFeedback(`Taking ${chooser.golfer.name}'s ball!`, '#9fe8ff', 1000);
    }

    this.time.delayedCall(wait, () => {
      this.busy = false;
      this.startTurn();
    });
  }

  /** Default aim: at the pin, clamped to a full swing with the current club. */
  private resetAim(): void {
    const p = this.players[this.currentIdx];
    this.aimYaw = angleTo(p.ball, this.hole.pin);
    const pinDist = dist(p.ball, this.hole.pin);
    // Putts default the aim spot ~30% past the cup so the target line
    // starts around three-quarters of the bar.
    this.aimDistPx = this.isPutting()
      ? clamp(pinDist * 1.3, 20, this.maxCarryPx())
      : Math.min(pinDist, this.maxCarryPx());
  }

  /** Recompute preview + perspective camera + overlays for the current aim. */
  private refreshShotView(): void {
    const p = this.players[this.currentIdx];
    this.persp.setCamera(p.ball, this.aimYaw, this.isPutting());
    this.computePreview();
    if (this.viewMode === 'overhead') this.drawTopDownAim();
    this.updateWindHud();
  }

  private computePreview(): void {
    const p = this.players[this.currentIdx];
    const fire = state.fire[this.currentIdx];
    const powerTarget = this.barToPhysicsPower(this.barPowerTarget());
    const outcome = this.engine.simulate({
      origin: p.ball,
      aimAngle: this.aimYaw,
      swing: { power: powerTarget, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
      club: this.currentClub(),
      golfer: p.golfer,
      fireBoost: fire.statBoost,
      lie: p.lie,
      wind: state.wind,
      hole: this.hole,
      preview: true
    });
    this.previewPath = outcome.path;
  }

  private armMeter(): void {
    const p = this.players[this.currentIdx];
    const club = this.currentClub();
    const fire = state.fire[this.currentIdx];
    const { accuracy } = statsForClub(club, p.golfer, fire.statBoost);
    this.meter.arm({
      stat: accuracy,
      firePerfectMult: fire.perfectZoneMultiplier,
      onFire: fire.isOnFire,
      isPutt: this.isPutting(),
      powerTarget: this.barPowerTarget()
    });
  }

  private autoSelectClub(p: PlayerRt): void {
    const needed = this.engine.yardsToPin(p.ball);
    let id: string;
    if (p.lie === 'green') {
      id = 'putter';
    } else if (p.lie === 'sand') {
      id = needed > 130 ? '9i' : 'sw';
    } else if (p.lie === 'fringe' && needed < 35) {
      id = 'putter';
    } else {
      id = 'driver';
      for (let i = CLUBS.length - 2; i >= 0; i--) {
        const carry = effectiveCarryYards(CLUBS[i], p.golfer, state.fire[this.currentIdx].statBoost, p.lie);
        if (carry >= needed) {
          id = CLUBS[i].id;
          break;
        }
      }
    }
    this.clubIdx = CLUBS.findIndex((c) => c.id === id);
    state.club = id;
  }

  private cycleClub(dir: number): void {
    if (this.busy || this.meter.isActive) return;
    this.clubIdx = (this.clubIdx + dir + CLUBS.length) % CLUBS.length;
    state.club = this.currentClub().id;
    if (this.isPutting()) {
      // Switching to the putter re-defaults the aim spot past the cup
      const p = this.players[this.currentIdx];
      this.aimDistPx = clamp(dist(p.ball, this.hole.pin) * 1.3, 20, this.maxCarryPx());
    } else {
      // Keep aiming at the same spot when possible; clamp to the new club's reach
      this.aimDistPx = Math.min(this.aimDistPx, this.maxCarryPx());
    }
    this.updateHud();
    this.armMeter();
    this.refreshShotView();
  }

  private toggleView(): void {
    if (this.busy || this.meter.isActive) return;
    this.viewMode = this.viewMode === 'persp' ? 'overhead' : 'persp';
    this.applyViewMode();
    if (this.viewMode === 'overhead') this.drawTopDownAim();
  }

  // ---------------------------------------------------------------- input

  private inViewport(p: Phaser.Input.Pointer): boolean {
    return p.y >= VIEW_TOP && p.y <= VIEW_BOTTOM;
  }

  /** Move the aim point to wherever the finger is (overhead mode). */
  private placeAimAtPointer(pointer: Phaser.Input.Pointer): void {
    const p = this.players[this.currentIdx];
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.aimYaw = angleTo(p.ball, { x: world.x, y: world.y });
    this.aimDistPx = clamp(dist(p.ball, { x: world.x, y: world.y }), 14, this.maxCarryPx());
    this.armMeter();
    this.refreshShotView();
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.meter.isActive) return;
    const p = this.players[this.currentIdx];
    if (p.isAI) return;
    if (!this.inViewport(pointer)) return;
    this.dragStart = { x: pointer.x, y: pointer.y };
    this.dragLast = { x: pointer.x, y: pointer.y };
    this.dragMoved = false;
    // Overhead aiming is live: the marker jumps to the finger immediately
    if (this.viewMode === 'overhead') this.placeAimAtPointer(pointer);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragStart || !this.dragLast || !pointer.isDown) return;
    if (this.busy || this.meter.isActive) return;

    if (this.viewMode === 'overhead') {
      // Marker follows the finger
      this.placeAimAtPointer(pointer);
      this.dragLast = { x: pointer.x, y: pointer.y };
      return;
    }

    // Shot view: 12px dead zone so a tap's jitter doesn't nudge the aim
    if (!this.dragMoved) {
      const fromStart =
        Math.abs(pointer.x - this.dragStart.x) + Math.abs(pointer.y - this.dragStart.y);
      if (fromStart < 12) return;
      this.dragMoved = true;
      this.dragLast = { x: pointer.x, y: pointer.y };
      return;
    }
    const dx = pointer.x - this.dragLast.x;
    const dy = pointer.y - this.dragLast.y;
    this.dragLast = { x: pointer.x, y: pointer.y };
    this.aimYaw += dx * 0.0032;
    this.aimDistPx = clamp(this.aimDistPx - dy * 1.1, 14, this.maxCarryPx());
    this.armMeter();
    this.refreshShotView();
  }

  private onPointerUp(_pointer: Phaser.Input.Pointer): void {
    this.dragStart = null;
    this.dragLast = null;
    this.dragMoved = false;
  }

  /** Top-down aim overlay (overhead mode). */
  private drawTopDownAim(): void {
    const g = this.aimGraphics;
    g.clear();
    const p = this.players[this.currentIdx];
    if (p.isAI || this.busy) return;

    if (this.previewPath) {
      for (let i = 6; i < this.previewPath.length; i += 7) {
        const pt = this.previewPath[i];
        const frac = i / this.previewPath.length;
        g.fillStyle(0xffffff, 0.75 - frac * 0.3);
        g.fillCircle(pt.x, pt.y - pt.z * 0.4, pt.z > 1 ? 4 : 3);
      }
    }
    const m = this.aimPoint();
    g.lineStyle(3, 0xffd54f, 0.95);
    g.strokeCircle(m.x, m.y, 15);
    g.beginPath();
    g.moveTo(m.x - 22, m.y);
    g.lineTo(m.x + 22, m.y);
    g.moveTo(m.x, m.y - 22);
    g.lineTo(m.x, m.y + 22);
    g.strokePath();
  }

  // ---------------------------------------------------------------- shots

  private onBandLocked(kind: 'power' | 'accuracy', band: Band): void {
    const msg = band === 'perfect' ? 'PERFECT!' : band === 'good' ? 'Good' : 'Miss!';
    const color = band === 'perfect' ? '#43d05c' : band === 'good' ? '#ffd54f' : '#ff6659';
    this.showFeedback(kind === 'power' ? `Power: ${msg}` : `Accuracy: ${msg}`, color, 450);
  }

  private onSwingComplete(swing: SwingResult): void {
    const p = this.players[this.currentIdx];
    // Putts: the bar is scaled to the aim spot; convert to engine power units
    const converted: SwingResult = { ...swing, power: this.barToPhysicsPower(swing.power) };
    this.executeShot(p, this.currentIdx, converted, this.aimYaw, this.currentClub());
  }

  private aiShot(): void {
    const p = this.players[this.currentIdx];
    if (!this.ai) return;
    const decision = this.ai.decide(p.ball, p.lie, state.wind, this.hole);
    this.clubIdx = CLUBS.findIndex((c) => c.id === decision.club.id);
    this.aimYaw = decision.aimAngle;
    this.aimDistPx = dist(p.ball, decision.aimPoint);
    this.turnText.setText(`${p.golfer.name} · ${decision.club.name}`);
    this.persp.setCamera(p.ball, this.aimYaw, decision.club.id === 'putter');
    this.previewPath = null;
    this.updateHud();
    this.executeShot(p, this.currentIdx, decision.swing, decision.aimAngle, decision.club);
  }

  private executeShot(
    p: PlayerRt,
    idx: number,
    swing: SwingResult,
    aimAngle: number,
    club: ClubSpec
  ): void {
    this.busy = true;
    this.viewMode = 'persp';
    this.applyViewMode();
    this.meter.hide();
    this.aimGraphics.clear();
    this.previewPath = null;

    const fire = state.fire[idx];
    const outcome = this.engine.simulate({
      origin: p.ball,
      aimAngle,
      swing,
      club,
      golfer: p.golfer,
      fireBoost: fire.statBoost,
      lie: p.lie,
      wind: state.wind,
      hole: this.hole
    });

    const ignited = fire.recordSwing(swing);
    p.strokes += 1;
    if (outcome.waterPenalty) p.strokes += 1;

    // Swing animation, then launch
    this.persp.swing(() => safePlay(this, 'swing'));
    this.time.delayedCall(320, () => {
      this.trail = [];
      this.anim = {
        path: outcome.path,
        progress: 0,
        player: p,
        outcome,
        landed: false,
        pos: outcome.path[0],
        onDone: () => this.afterShot(p, idx, outcome, ignited)
      };
    });
  }

  private afterShot(p: PlayerRt, idx: number, outcome: ShotOutcome, ignited: boolean): void {
    const scramble = state.mode === 'scramble';
    p.ball = { ...outcome.finalPos };
    p.lie = outcome.surface;
    p.sprite.setPosition(p.ball.x, p.ball.y);
    p.shadow.setPosition(p.ball.x, p.ball.y);
    this.trail = [];

    let wait = 800;
    if (outcome.holed) {
      if (scramble) {
        this.showFeedback(`${p.golfer.name} holed it!`, '#ffd54f', 1000);
        wait = 1200;
      } else {
        p.holed = true;
        safePlay(this, 'hole');
        this.showFeedback(
          `${p.golfer.name}: ${scoreName(p.strokes, this.hole.par)}`,
          '#ffd54f',
          1400
        );
        wait = 1700;
      }
    } else if (outcome.waterPenalty) {
      safePlay(this, 'splash');
      this.showFeedback('SPLASH! +1 penalty', '#7ec8e3', 1200);
      wait = 1400;
    } else if (outcome.hitTrees) {
      safePlay(this, 'hit');
      this.showFeedback('Clonk! Off the trees', '#f0c060', 1100);
      wait = 1300;
    } else if (outcome.surface === 'sand') {
      this.showFeedback('In the bunker', '#e8d9a0', 900);
    }

    if (ignited) {
      safePlay(this, 'fire');
      this.time.delayedCall(500, () =>
        this.showFeedback(`${p.golfer.name} is ON FIRE! 🔥`, '#ff8a50', 1300)
      );
      wait += 900;
    }

    if (scramble) {
      this.scrambleOutcomes[this.scramblePhase] = outcome;
      if (this.scramblePhase === 0) {
        this.scramblePhase = 1;
        this.time.delayedCall(wait, () => this.startScrambleTurn());
      } else {
        this.time.delayedCall(wait, () => this.resolveScramble());
      }
      return;
    }

    this.time.delayedCall(wait, () => {
      this.busy = false;
      this.startTurn();
    });
  }

  // ---------------------------------------------------------------- hole end

  private endHole(): void {
    this.busy = true;
    this.meter.hide();
    this.aimGraphics.clear();
    this.turnText.setText('');
    this.persp.drawGolfer(null);

    if (state.mode === 'scramble') {
      state.scoring!.recordHole(0, state.holeIndex, this.teamStrokes);
    } else {
      this.players.forEach((p, i) => {
        state.scoring!.recordHole(i, state.holeIndex, p.strokes);
      });
    }

    const cx = GAME_WIDTH / 2;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.6);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(COLORS.uiPanel, 0.97);
    g.fillRoundedRect(cx - 310, 360, 620, 470, 24);
    g.lineStyle(3, 0xffd54f, 0.7);
    g.strokeRoundedRect(cx - 310, 360, 620, 470, 24);
    this.uiLayer.add(g);

    const title = this.add
      .text(cx, 424, `HOLE ${this.hole.number} COMPLETE`, {
        fontFamily: 'Georgia, serif',
        fontSize: '40px',
        color: '#f6f2df',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    this.uiLayer.add(title);

    const lines: string[] =
      state.mode === 'scramble'
        ? [
            `${state.golfer!.name} & ${state.opponent!.name}`,
            `${this.teamStrokes}   ${scoreName(this.teamStrokes, this.hole.par)}`
          ]
        : this.players.map(
            (p) => `${p.golfer.name}   ${p.strokes}   ${scoreName(p.strokes, this.hole.par)}`
          );

    const body = this.add
      .text(cx, 590, lines.join('\n'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 12,
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    this.uiLayer.add(body);

    const lastHole = state.holeIndex >= state.course!.holes.length - 1;
    const btn = makeButton(this, cx, 758, 340, 84, lastHole ? 'RESULTS' : 'NEXT HOLE', () => {
      if (lastHole) {
        this.scene.start('ResultsScene');
      } else {
        state.holeIndex += 1;
        this.scene.restart();
      }
    });
    this.uiLayer.add(btn);
  }

  // ---------------------------------------------------------------- update

  update(time: number, delta: number): void {
    if (this.meter) this.meter.update(time, delta);

    // Advance flight animation
    if (this.anim) {
      const a = this.anim;
      a.progress += (delta / 1000) * 60 * 0.9;
      const i = Math.floor(a.progress);
      if (i >= a.path.length) {
        const done = a.onDone;
        this.anim = null;
        done();
      } else {
        const pt = a.path[i];
        a.pos = pt;
        a.player.sprite.setPosition(pt.x, pt.y - pt.z * 0.55);
        a.player.shadow.setPosition(pt.x, pt.y);
        if (pt.z > 2 && i % 3 === 0) {
          this.trail.push({
            x: pt.x,
            y: pt.y,
            z: pt.z,
            age: 0,
            onFire: state.fire[this.currentIdx].isOnFire
          });
        }
        if (!a.landed && pt.z <= 0.01 && i > 4) {
          a.landed = true;
          const carryPx = dist({ x: a.path[0].x, y: a.path[0].y }, { x: pt.x, y: pt.y });
          if (carryPx > 480) this.uiCam.shake(140, 0.004);
        }
      }
    }

    // Age out trail dots
    for (const t of this.trail) t.age += delta / 700;
    this.trail = this.trail.filter((t) => t.age < 1);

    // Perspective frame
    if (this.persp && this.viewMode === 'persp') {
      const balls = this.players
        .filter((pl) => !pl.holed || this.anim?.player === pl)
        .map((pl) => {
          if (this.anim && this.anim.player === pl) {
            return { x: this.anim.pos.x, y: this.anim.pos.y, z: this.anim.pos.z, color: pl.golfer.color };
          }
          return { x: pl.ball.x, y: pl.ball.y, z: 0, color: pl.golfer.color };
        });
      this.persp.updateDynamic({
        aimPoint: this.busy ? null : this.aimPoint(),
        previewPath: this.busy ? null : this.previewPath,
        balls,
        trail: this.trail,
        timeSec: time / 1000
      });
    }
  }
}
