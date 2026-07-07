import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PHYSICS, PX_PER_YARD } from '../config';
import { AimControl, ShotContext } from '../core/input/AimControl';
import { state } from '../core/GameState';
import { CameraDirector } from '../core/rendering/CameraDirector';
import { drawOverheadCourse } from '../core/rendering/OverheadCourse';
import { resolveTheme } from '../core/rendering/Theme';
import { PerspectiveView, TrailDot, ViewParticle } from '../core/rendering/PerspectiveView';
import { safePlay } from '../core/audio/Sfx';
import {
  Band,
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  ShotOutcome,
  Surface,
  SwingResult,
  TrajectoryPoint
} from '../core/types';
import { AIController } from '../systems/AIController';
import { PhysicsEngine, statsForClub } from '../systems/PhysicsEngine';
import { scoreName } from '../systems/Scoring';
import { SwingMeter } from '../systems/SwingMeter';
import { TurnManager } from '../systems/TurnManager';
import { GameHud } from '../ui/GameHud';
import { angleTo, clamp, dist } from '../utils/Geometry';
import { fadeIn, fadeToScene } from '../ui/Transitions';

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

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  color: number;
  size: number;
}

interface ShotAnim {
  path: TrajectoryPoint[];
  progress: number;
  player: PlayerRt;
  outcome: ShotOutcome;
  landed: boolean;
  /** Live ball position while animating (world). */
  pos: TrajectoryPoint;
  /** Launch direction — the chase/landing cameras look along it. */
  dir: number;
  /** Putts keep the intimate setup camera instead of the chase cam. */
  isPutt: boolean;
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

/**
 * The round orchestrator. Gameplay decisions live in the systems it wires
 * together: TurnManager (turn order + scramble), AimControl (club/aim/putt
 * meter math), PhysicsEngine (shots), SwingMeter (input), AIController
 * (opponents), GameHud + PerspectiveView/OverheadCourse (presentation).
 */
export class GameScene extends Phaser.Scene {
  private hole!: HoleData;
  private engine!: PhysicsEngine;
  private turns!: TurnManager;
  private aim!: AimControl;
  private hud!: GameHud;
  private players: PlayerRt[] = [];
  private currentIdx = 0;
  private meter!: SwingMeter;
  private ai: AIController | null = null;
  private worldLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private persp!: PerspectiveView;
  private camera!: CameraDirector;
  private gridVisible = false;
  private viewMode: ViewMode = 'persp';
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private busy = true;
  private anim: ShotAnim | null = null;
  private trail: TrailDot[] = [];
  private particles: Particle[] = [];
  private baseZoom = 0.8;

  constructor() {
    super('GameScene');
  }

  create(): void {
    fadeIn(this);
    if (!state.golfer || !state.course || !state.scoring) {
      fadeToScene(this, 'TitleScene');
      return;
    }
    this.hole = state.course.holes[state.holeIndex];
    this.engine = new PhysicsEngine(this.hole);
    this.turns = new TurnManager(state.mode, this.hole.pin, this.hole.tee);
    this.aim = new AimControl(this.hole, this.engine);
    this.players = [];
    this.anim = null;
    this.trail = [];
    this.particles = [];
    this.busy = true;
    this.viewMode = 'persp';

    this.worldLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0).setDepth(100);

    const theme = resolveTheme(state.course);
    const courseG = this.add.graphics();
    this.worldLayer.add(courseG);
    drawOverheadCourse(courseG, this.hole, theme);
    this.setupPlayers();
    this.persp = new PerspectiveView(this, this.hole, theme);
    this.camera = new CameraDirector();
    // Frame the tee shot behind the banner while the hole loads in
    this.camera.setSetupTarget(
      this.hole.tee,
      angleTo(this.hole.tee, this.hole.pin),
      false
    );
    this.setupCameras();
    this.hud = new GameHud(this, this.uiLayer, {
      onPrevClub: () => this.cycleClub(-1),
      onNextClub: () => this.cycleClub(1),
      onToggleView: () => this.toggleView()
    });

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
    this.input.on('pointerup', () => this.aim.endDrag());

    this.applyViewMode();
    this.updateHud();
    this.hud.showHoleBanner(this.hole);
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

  // ----------------------------------------------------------- shot context

  /** The current player's hitter context for AimControl. */
  private ctx(idx = this.currentIdx): ShotContext {
    const p = this.players[idx];
    return {
      ball: p.ball,
      lie: p.lie,
      golfer: p.golfer,
      fireBoost: state.fire[idx].statBoost
    };
  }

  private applyViewMode(): void {
    const overhead = this.viewMode === 'overhead';
    this.persp.setVisible(!overhead);
    this.worldLayer.setVisible(overhead);
    this.hud.setAerialLabel(overhead);
    this.updateWindHud();
    if (overhead) this.drawTopDownAim();
  }

  // ---------------------------------------------------------------- HUD

  private updateWindHud(): void {
    // In the shot view the arrow is relative to where you're facing
    const rot =
      this.viewMode === 'persp'
        ? state.wind.angle - this.aim.yaw - Math.PI / 2
        : state.wind.angle;
    this.hud.updateWind(state.wind.speed, rot);
  }

  private updateHud(): void {
    const p = this.players[this.currentIdx];
    const ctx = this.ctx();
    const remainingYds = this.engine.yardsToPin(p.ball);
    const club = this.aim.club;
    const carryYds = this.aim.maxCarryPx(ctx) / PX_PER_YARD;

    let scoreText: string;
    if (state.mode === 'scramble') {
      const toPar = state.scoring!.totalToPar(0, state.holeIndex - 1);
      const sign = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
      scoreText = `Team: ${sign}\nStrokes: ${this.turns.teamStrokes}`;
    } else {
      const parts = this.players.map((pl, i) => {
        const toPar = state.scoring!.totalToPar(i, state.holeIndex - 1);
        const sign = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
        return `${pl.golfer.name}: ${sign}`;
      });
      scoreText = `${parts.join('\n')}\nStrokes: ${p.strokes}`;
    }

    const fire = state.fire[this.currentIdx];
    this.hud.update({
      holeText: `Hole ${this.hole.number} • Par ${this.hole.par}\n${this.hole.yardage} yds`,
      toPinText:
        p.lie === 'green'
          ? `To pin: ${Math.round(remainingYds * 3)} ft`
          : `To pin: ${Math.round(remainingYds)} yds`,
      lieText: `Lie: ${SURFACE_LABEL[p.lie]}`,
      clubName: club.name,
      carryText:
        club.id === 'putter'
          ? `full ${Math.round((this.aim.meterScalePx(ctx) / PX_PER_YARD) * 3)} ft`
          : `~${Math.round(carryYds)} yds`,
      fireText: fire.isOnFire
        ? '🔥 ON FIRE!'
        : fire.currentStreak > 0
          ? `Streak ${'●'.repeat(fire.currentStreak)}`
          : '',
      scoreText,
      windSpeed: state.wind.speed,
      windRotation:
        this.viewMode === 'persp'
          ? state.wind.angle - this.aim.yaw - Math.PI / 2
          : state.wind.angle
    });
  }

  /** Burst of world-space debris (grass chips, sand, spray). */
  private emitBurst(
    at: Point,
    color: number,
    n: number,
    speed: number,
    up: number,
    size = 2.4
  ): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x: at.x,
        y: at.y,
        z: 1,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: up * (0.55 + Math.random() * 0.45),
        age: 0,
        life: 0.45 + Math.random() * 0.35,
        color,
        size
      });
    }
  }

  /** Debris color for the surface being struck. */
  private surfaceChipColor(surface: Surface): number {
    if (surface === 'sand') return 0xe8d9a0;
    if (surface === 'water') return 0xbfe8ff;
    if (surface === 'green' || surface === 'fringe') return 0x9fd489;
    return 0x33652f;
  }

  // ---------------------------------------------------------------- turns

  private startTurn(): void {
    if (this.turns.isScramble) {
      this.startScrambleTurn();
      return;
    }
    for (const i of this.turns.applyPickups(this.players)) {
      this.hud.showFeedback(`${this.players[i].golfer.name} picks up`, '#f0c060');
    }

    const idx = this.turns.nextPlayer(this.players);
    if (idx === null) {
      this.endHole();
      return;
    }
    this.currentIdx = idx;
    this.beginShotSetup(() =>
      this.players[idx].isAI
        ? `${this.players[idx].golfer.name} is thinking...`
        : this.aim.isPutting
          ? 'Read the break — drag to aim'
          : 'Drag to aim'
    );
  }

  /**
   * Scramble: both teammates hit from the team ball, then the better
   * result becomes the new team ball (one stroke per cycle).
   */
  private startScrambleTurn(): void {
    if (this.turns.scrambleFinished) {
      if (!this.turns.teamHoled) this.hud.showFeedback('Team picks up', '#f0c060');
      this.endHole();
      return;
    }

    const idx = this.turns.beginScrambleShot(this.players);
    this.currentIdx = idx;
    const p = this.players[idx];
    p.sprite.setPosition(p.ball.x, p.ball.y);
    p.shadow.setPosition(p.ball.x, p.ball.y);

    this.beginShotSetup(() =>
      p.isAI ? `Partner ${p.golfer.name} is up...` : 'Your shot — best ball counts'
    );
  }

  /**
   * Shared per-turn setup: club, aim, camera, HUD, then meter or AI.
   * `turnText` is lazy so it can depend on the auto-selected club.
   */
  private beginShotSetup(turnText: () => string): void {
    const p = this.players[this.currentIdx];
    this.aim.autoSelectClub(this.ctx());
    this.aim.resetAim(this.ctx());
    this.viewMode = 'persp';
    this.applyViewMode();
    this.refreshShotView();
    this.persp.drawGolfer(p.golfer.look);
    this.updateHud();
    this.hud.setTurnText(turnText());

    if (p.isAI) {
      this.busy = true;
      this.time.delayedCall(1300, () => this.aiShot());
    } else {
      this.busy = false;
      this.armMeter();
    }
  }

  /** Pick the better of the two scramble results and continue from it. */
  private resolveScramble(): void {
    const { chooserIdx, chosen } = this.turns.resolveScramble(this.players);
    for (const p of this.players) {
      p.sprite.setPosition(p.ball.x, p.ball.y);
      p.shadow.setPosition(p.ball.x, p.ball.y);
    }

    let wait = 1200;
    if (chosen.holed) {
      safePlay(this, 'hole');
      this.hud.showFeedback(
        `Team: ${scoreName(this.turns.teamStrokes, this.hole.par)}`,
        '#ffd54f',
        1400
      );
      wait = 1700;
    } else {
      this.hud.showFeedback(
        `Taking ${this.players[chooserIdx].golfer.name}'s ball!`,
        '#9fe8ff',
        1000
      );
    }

    this.time.delayedCall(wait, () => {
      this.busy = false;
      this.startTurn();
    });
  }

  /** Recompute preview + perspective camera + overlays for the current aim. */
  private refreshShotView(): void {
    const p = this.players[this.currentIdx];
    this.gridVisible = this.aim.isPutting;
    this.camera.setSetupTarget(p.ball, this.aim.yaw, this.aim.isPutting);
    this.aim.computePreview(this.ctx(), state.wind);
    if (this.viewMode === 'overhead') this.drawTopDownAim();
    this.updateWindHud();
  }

  private armMeter(): void {
    const p = this.players[this.currentIdx];
    const fire = state.fire[this.currentIdx];
    const { accuracy } = statsForClub(this.aim.club, p.golfer, fire.statBoost);
    this.meter.arm({
      stat: accuracy,
      firePerfectMult: fire.perfectZoneMultiplier,
      onFire: fire.isOnFire,
      isPutt: this.aim.isPutting,
      powerTarget: this.aim.barPowerTarget(this.ctx())
    });
  }

  private cycleClub(dir: number): void {
    if (this.busy || this.meter.isActive) return;
    this.aim.cycleClub(dir, this.ctx());
    this.updateHud();
    this.armMeter();
    this.refreshShotView();
  }

  private toggleView(): void {
    if (this.busy || this.meter.isActive) return;
    this.viewMode = this.viewMode === 'persp' ? 'overhead' : 'persp';
    this.applyViewMode();
  }

  // ---------------------------------------------------------------- input

  private inViewport(p: Phaser.Input.Pointer): boolean {
    return p.y >= VIEW_TOP && p.y <= VIEW_BOTTOM;
  }

  /** Move the aim point to wherever the finger is (overhead mode). */
  private placeAimAtPointer(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.aim.placeAim(this.ctx(), { x: world.x, y: world.y });
    this.armMeter();
    this.refreshShotView();
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.meter.isActive) return;
    if (this.players[this.currentIdx].isAI) return;
    if (!this.inViewport(pointer)) return;
    this.aim.beginDrag({ x: pointer.x, y: pointer.y });
    // Overhead aiming is live: the marker jumps to the finger immediately
    if (this.viewMode === 'overhead') this.placeAimAtPointer(pointer);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.aim.isDragging || !pointer.isDown) return;
    if (this.busy || this.meter.isActive) return;

    if (this.viewMode === 'overhead') {
      // Marker follows the finger
      this.placeAimAtPointer(pointer);
      return;
    }
    if (this.aim.moveDrag(this.ctx(), { x: pointer.x, y: pointer.y })) {
      this.armMeter();
      this.refreshShotView();
    }
  }

  /** Top-down aim overlay (overhead mode). */
  private drawTopDownAim(): void {
    const g = this.aimGraphics;
    g.clear();
    const p = this.players[this.currentIdx];
    if (p.isAI || this.busy) return;

    if (this.aim.previewPath) {
      for (let i = 6; i < this.aim.previewPath.length; i += 7) {
        const pt = this.aim.previewPath[i];
        const frac = i / this.aim.previewPath.length;
        g.fillStyle(0xffffff, 0.75 - frac * 0.3);
        g.fillCircle(pt.x, pt.y - pt.z * 0.4, pt.z > 1 ? 4 : 3);
      }
    }
    const m = this.aim.aimPoint(p.ball);
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
    if (band === 'perfect') this.uiCam.flash(110, 130, 235, 150);
    this.hud.showFeedback(kind === 'power' ? `Power: ${msg}` : `Accuracy: ${msg}`, color, 450);
  }

  private onSwingComplete(swing: SwingResult): void {
    const p = this.players[this.currentIdx];
    // Putts: the bar is scaled to the aim spot; convert to engine power units
    const converted: SwingResult = {
      ...swing,
      power: this.aim.barToPhysicsPower(swing.power, this.ctx())
    };
    this.executeShot(p, this.currentIdx, converted, this.aim.yaw, this.aim.club);
  }

  private aiShot(): void {
    const p = this.players[this.currentIdx];
    if (!this.ai) return;
    const decision = this.ai.decide(p.ball, p.lie, state.wind, this.hole);
    this.aim.setClubById(decision.club.id);
    this.aim.yaw = decision.aimAngle;
    this.aim.distPx = dist(p.ball, decision.aimPoint);
    this.hud.setTurnText(`${p.golfer.name} · ${decision.club.name}`);
    this.gridVisible = decision.club.id === 'putter';
    this.camera.setSetupTarget(p.ball, this.aim.yaw, this.gridVisible);
    this.aim.previewPath = null;
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
    this.aim.previewPath = null;

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
      if (!outcome.holed || outcome.path.length > 6) {
        this.emitBurst(p.ball, this.surfaceChipColor(p.lie), 8, 60, club.launchAngle > 0 ? 130 : 30);
      }
      const anim: ShotAnim = {
        path: outcome.path,
        progress: 0,
        player: p,
        outcome,
        landed: false,
        pos: outcome.path[0],
        dir: aimAngle,
        isPutt: club.launchAngle <= 0,
        onDone: () => this.afterShot(p, idx, outcome, ignited)
      };
      this.anim = anim;
      // The chase cam takes over — hide the screen-fixed golfer figure
      if (!anim.isPutt) {
        this.time.delayedCall(300, () => {
          if (this.anim === anim) this.persp.drawGolfer(null);
        });
      }
    });
  }

  private afterShot(p: PlayerRt, idx: number, outcome: ShotOutcome, ignited: boolean): void {
    const scramble = this.turns.isScramble;
    p.ball = { ...outcome.finalPos };
    p.lie = outcome.surface;
    p.sprite.setPosition(p.ball.x, p.ball.y);
    p.shadow.setPosition(p.ball.x, p.ball.y);
    this.trail = [];

    let wait = 800;
    if (outcome.holed) {
      if (scramble) {
        this.hud.showFeedback(`${p.golfer.name} holed it!`, '#ffd54f', 1000);
        wait = 1200;
      } else {
        p.holed = true;
        this.emitBurst(this.hole.pin, 0xffe28a, 12, 70, 160, 2.6);
        safePlay(this, 'hole');
        this.hud.showFeedback(
          `${p.golfer.name}: ${scoreName(p.strokes, this.hole.par)}`,
          '#ffd54f',
          1400
        );
        wait = 1700;
      }
    } else if (outcome.waterPenalty) {
      safePlay(this, 'splash');
      const entry = outcome.path[Math.max(0, outcome.path.length - 2)];
      this.emitBurst({ x: entry.x, y: entry.y }, 0xbfe8ff, 16, 90, 190, 3);
      this.hud.showFeedback('SPLASH! +1 penalty', '#7ec8e3', 1200);
      wait = 1400;
    } else if (outcome.hitTrees) {
      safePlay(this, 'hit');
      this.hud.showFeedback('Clonk! Off the trees', '#f0c060', 1100);
      wait = 1300;
    } else if (outcome.surface === 'sand') {
      this.hud.showFeedback('In the bunker', '#e8d9a0', 900);
    }

    if (ignited) {
      safePlay(this, 'fire');
      this.time.delayedCall(500, () =>
        this.hud.showFeedback(`${p.golfer.name} is ON FIRE! 🔥`, '#ff8a50', 1300)
      );
      wait += 900;
    }

    if (scramble) {
      const bothHit = this.turns.recordScrambleOutcome(outcome);
      if (bothHit) {
        this.time.delayedCall(wait, () => this.resolveScramble());
      } else {
        this.time.delayedCall(wait, () => this.startScrambleTurn());
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
    this.hud.setTurnText('');
    this.persp.drawGolfer(null);

    if (this.turns.isScramble) {
      state.scoring!.recordHole(0, state.holeIndex, this.turns.teamStrokes);
    } else {
      this.players.forEach((p, i) => {
        state.scoring!.recordHole(i, state.holeIndex, p.strokes);
      });
    }

    const lines: string[] = this.turns.isScramble
      ? [
          `${state.golfer!.name} & ${state.opponent!.name}`,
          `${this.turns.teamStrokes}   ${scoreName(this.turns.teamStrokes, this.hole.par)}`
        ]
      : this.players.map(
          (p) => `${p.golfer.name}   ${p.strokes}   ${scoreName(p.strokes, this.hole.par)}`
        );

    const lastHole = state.holeIndex >= state.course!.holes.length - 1;
    this.hud.showHoleComplete(this.hole.number, lines, lastHole, () => {
      if (lastHole) {
        fadeToScene(this, 'ResultsScene');
      } else {
        state.holeIndex += 1;
        this.scene.restart();
      }
    });
  }

  private viewScratch: ViewParticle[] = [];

  /** Map live particles to the renderer's shape (scratch array reused). */
  private viewParticles(): ViewParticle[] {
    this.viewScratch.length = 0;
    for (const pc of this.particles) {
      this.viewScratch.push({
        x: pc.x,
        y: pc.y,
        z: pc.z,
        age01: pc.age / pc.life,
        color: pc.color,
        size: pc.size
      });
    }
    return this.viewScratch;
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
          if (!a.isPutt) this.camera.setLandingTarget({ x: pt.x, y: pt.y }, a.dir);
          const surf = this.engine.surfaceAt(pt.x, pt.y);
          const big = surf === 'sand' || surf === 'water';
          this.emitBurst(
            { x: pt.x, y: pt.y },
            this.surfaceChipColor(surf),
            big ? 14 : 7,
            big ? 80 : 50,
            big ? 150 : 90,
            surf === 'water' ? 3 : 2.2
          );
        } else if (!a.landed && !a.isPutt) {
          this.camera.setFlightTarget(pt, a.dir);
        }
      }
    }

    // Age out trail dots
    for (const t of this.trail) t.age += delta / 700;
    this.trail = this.trail.filter((t) => t.age < 1);

    // Particle physics: simple ballistic debris that settles and fades
    const dt = delta / 1000;
    for (const pc of this.particles) {
      pc.vz -= 600 * dt;
      pc.z += pc.vz * dt;
      if (pc.z <= 0) {
        pc.z = 0;
        pc.vz = 0;
        pc.vx *= 0.6;
        pc.vy *= 0.6;
      }
      pc.x += pc.vx * dt;
      pc.y += pc.vy * dt;
      pc.age += dt;
    }
    this.particles = this.particles.filter((pc) => pc.age < pc.life);

    // Camera smoothing — the ground only redraws while the camera moves
    if (this.camera) {
      const { cam, moved } = this.camera.tick(delta);
      if (moved) this.persp.applyCamera(cam, this.gridVisible);
    }

    // Perspective frame
    if (this.persp && this.viewMode === 'persp') {
      const balls = this.players
        .filter((pl) => !pl.holed || this.anim?.player === pl)
        .map((pl) => {
          if (this.anim && this.anim.player === pl) {
            return {
              x: this.anim.pos.x,
              y: this.anim.pos.y,
              z: this.anim.pos.z,
              color: pl.golfer.color
            };
          }
          return { x: pl.ball.x, y: pl.ball.y, z: 0, color: pl.golfer.color };
        });
      this.persp.updateDynamic({
        aimPoint: this.busy ? null : this.aim.aimPoint(this.players[this.currentIdx].ball),
        previewPath: this.busy ? null : this.aim.previewPath,
        balls,
        trail: this.trail,
        particles: this.viewParticles(),
        timeSec: time / 1000
      });
    }
  }
}
