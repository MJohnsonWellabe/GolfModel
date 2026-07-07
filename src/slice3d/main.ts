import {
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  FreeCamera,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  TrailMesh,
  TransformNode,
  Vector3
} from '@babylonjs/core';
import { FLIGHT, PHYSICS, PX_PER_YARD, RULES } from '../config';
import { AimControl, ShotContext } from '../core/input/AimControl';
import { resolveTheme } from '../core/rendering/Theme';
import { CourseData, GameMode, Golfer, ShotOutcome, SwingResult, Wind } from '../core/types';
import { GOLFERS } from '../data/golfers';
import amenCorner from '../data/courses/amenCorner.json';
import legends from '../data/courses/legends.json';
import { AIController } from '../systems/AIController';
import { FireSystem } from '../systems/FireSystem';
import { dist } from '../utils/Geometry';
import { PhysicsEngine, statsForClub } from '../systems/PhysicsEngine';
import { scoreName } from '../systems/Scoring';
import { buildCourse, w2b } from './course3d';
import { Golfer3D } from './golfer3d';
import { DomMeter } from './meter3d';

// ------------------------------------------------------------------- boot

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const engine3d = new Engine(canvas, true, { adaptToDeviceRatio: true });

const hudEl = document.getElementById('hud')!;
const msgEl = document.getElementById('msg')!;
const bannerEl = document.getElementById('banner')!;
const promptEl = document.getElementById('prompt')!;
const summaryEl = document.getElementById('summary')!;
const meterEl = document.getElementById('meter')!;
const meter = new DomMeter(meterEl);
const swingBtn = document.getElementById('swingBtn')!;
const clubBar = document.getElementById('clubBar')!;
const clubName = document.getElementById('clubName')!;
const aerialBtn = document.getElementById('aerialBtn')!;

function showMsg(text: string, ms = 1200): void {
  msgEl.textContent = text;
  msgEl.style.opacity = '1';
  setTimeout(() => (msgEl.style.opacity = '0'), ms);
}

const sounds: Record<string, number> = {
  swing: 0.5, 'impact-driver': 0.9, 'impact-iron': 0.8, 'impact-wedge': 0.7,
  putt: 0.7, hole: 0.9, splash: 0.8, chime: 0.75
};
function play(key: string): void {
  try {
    const a = new Audio(`sfx/${key}.wav`);
    a.volume = sounds[key] ?? 0.7;
    void a.play().catch(() => undefined);
  } catch {
    // audio is optional
  }
}
let ambienceStarted = false;
function startAmbience(): void {
  if (ambienceStarted) return;
  ambienceStarted = true;
  try {
    const a = new Audio('sfx/ambience.wav');
    a.loop = true;
    a.volume = 0.2;
    void a.play().catch(() => (ambienceStarted = false));
  } catch {
    ambienceStarted = false;
  }
}

// ------------------------------------------------------------ round state

interface Participant {
  golfer: Golfer;
  isAI: boolean;
  /** Strokes per completed hole. */
  scores: number[];
}

interface RoundState {
  course: CourseData;
  mode: GameMode;
  holeIdx: number;
  players: Participant[];
  /** Which participant is currently playing the active hole. */
  activePlayer: number;
  /** Wind per hole index — generated once so 1v1 players share conditions. */
  holeWinds: Wind[];
}

const COURSES: Record<string, CourseData> = {
  amen: amenCorner as CourseData,
  legends: legends as CourseData
};

interface HoleState {
  ballPos: { x: number; y: number };
  lie: ReturnType<PhysicsEngine['surfaceAt']>;
  strokes: number;
  phase: 'intro' | 'aiming' | 'swinging' | 'flying' | 'done';
  holeIdx: number;
  scores: number[];
}

const round: RoundState = {
  course: COURSES.amen,
  mode: 'solo',
  holeIdx: 0,
  players: [{ golfer: GOLFERS[0], isAI: false, scores: [] }],
  activePlayer: 0,
  holeWinds: []
};

/** Wind for a hole, generated once and shared across players (same roll as 2D). */
function windForHole(idx: number): Wind {
  if (!round.holeWinds[idx]) {
    round.holeWinds[idx] = {
      angle: Math.random() * Math.PI * 2,
      speed: Math.round(2 + Math.random() * (PHYSICS.maxWind - 2))
    };
  }
  return round.holeWinds[idx];
}

/** The participant playing the active hole. */
function active(): Participant {
  return round.players[round.activePlayer];
}

/** Score vs par across a participant's completed holes, broadcast style. */
function scoreToPar(p: Participant): string {
  let diff = 0;
  p.scores.forEach((s, i) => (diff += s - round.course.holes[i].par));
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
}

// ----------------------------------------------------------- hole scene

/** Everything that lives for exactly one hole. Rebuilt between holes. */
class HoleScene {
  readonly scene: Scene;
  readonly state: HoleState;
  readonly aim: AimControl;
  private engine2d: PhysicsEngine;
  private hole = round.course.holes[round.holeIdx];
  private theme = resolveTheme(round.course);
  private golfer: Golfer3D;
  private ball;
  private ballShadow;
  private bsMat: StandardMaterial;
  private camera: FreeCamera;
  private camTarget = { pos: new Vector3(0, 8, 0), look: new Vector3(0, 0, 0), k: 4 };
  private puttGrid;
  private wind: Wind;
  private puff: ParticleSystem;
  private shakeT = 0;
  private aimRoot!: TransformNode;
  private aimDots: Mesh[] = [];
  private aimRing!: Mesh;
  private aerial = false;
  private flight: {
    outcome: ShotOutcome;
    progress: number;
    landIdx: number;
    dir: number;
    isPutt: boolean;
    landed: boolean;
    trail: TrailMesh | null;
  } | null = null;
  private disposed = false;
  private ai: AIController | null = null;
  private static BALL_REST = 0.5;

  constructor(private onHoleComplete: (strokes: number) => void) {
    this.scene = new Scene(engine3d);
    this.engine2d = new PhysicsEngine(this.hole);
    this.aim = new AimControl(this.hole, this.engine2d);
    // Shared per-hole conditions (fair across 1v1 players)
    this.wind = windForHole(round.holeIdx);
    if (active().isAI) this.ai = new AIController(active().golfer, new FireSystem());
    const { shadows, puttGrid } = buildCourse(this.scene, this.hole, this.theme, this.engine2d);
    this.puttGrid = puttGrid;
    this.golfer = new Golfer3D(this.scene, active().golfer.look, shadows);

    this.ball = MeshBuilder.CreateSphere('ball', { diameter: 1.0, segments: 12 }, this.scene);
    const ballMat = new StandardMaterial('ballMat', this.scene);
    ballMat.diffuseColor = new Color3(0.97, 0.97, 0.95);
    ballMat.specularColor = new Color3(0.5, 0.5, 0.5);
    this.ball.material = ballMat;
    shadows.addShadowCaster(this.ball);

    this.ballShadow = MeshBuilder.CreateDisc('ballShadow', { radius: 0.7, tessellation: 16 }, this.scene);
    this.ballShadow.rotation.x = Math.PI / 2;
    this.bsMat = new StandardMaterial('bsMat', this.scene);
    this.bsMat.diffuseColor = new Color3(0, 0, 0);
    this.bsMat.emissiveColor = new Color3(0, 0, 0);
    this.bsMat.disableLighting = true;
    this.bsMat.alpha = 0.3;
    this.ballShadow.material = this.bsMat;

    this.puff = this.makePuff();

    // Aim guide: a row of ground dots from the ball toward the aim point,
    // capped by a target ring — the shot line you're setting up
    const aimMat = new StandardMaterial('aimMat', this.scene);
    aimMat.diffuseColor = new Color3(1, 1, 1);
    aimMat.emissiveColor = new Color3(0.9, 0.9, 0.7);
    aimMat.disableLighting = true;
    this.aimRoot = new TransformNode('aimRoot', this.scene);
    for (let i = 0; i < 10; i++) {
      const dot = MeshBuilder.CreateDisc(`aimDot${i}`, { radius: 0.55, tessellation: 12 }, this.scene);
      dot.rotation.x = Math.PI / 2;
      dot.material = aimMat;
      dot.parent = this.aimRoot;
      this.aimDots.push(dot);
    }
    this.aimRing = MeshBuilder.CreateTorus('aimRing', { diameter: 6, thickness: 0.7, tessellation: 24 }, this.scene);
    this.aimRing.rotation.x = Math.PI / 2;
    this.aimRing.material = aimMat;
    this.aimRing.parent = this.aimRoot;
    this.aimRoot.setEnabled(false);

    this.camera = new FreeCamera('cam', new Vector3(0, 8, 0), this.scene);
    this.camera.minZ = 0.5;
    this.camera.maxZ = 12000;
    // Portrait phones crop the horizontal view hard, so run a wide vertical fov
    this.camera.fov = 1.05;

    this.state = {
      ballPos: { ...this.hole.tee },
      lie: 'tee',
      strokes: 0,
      phase: 'intro',
      holeIdx: round.holeIdx,
      scores: active().scores
    };

    this.wireInput();
    this.scene.onBeforeRenderObservable.add(() => this.tick());
    this.playIntro();
  }

  private makePuff(): ParticleSystem {
    const puffTex = new DynamicTexture('puffTex', { width: 32, height: 32 }, this.scene, true);
    const pfx = puffTex.getContext() as CanvasRenderingContext2D;
    const pg = pfx.createRadialGradient(16, 16, 1, 16, 16, 15);
    pg.addColorStop(0, 'rgba(255,255,250,0.9)');
    pg.addColorStop(1, 'rgba(255,255,250,0)');
    pfx.fillStyle = pg;
    pfx.fillRect(0, 0, 32, 32);
    puffTex.update(false);
    puffTex.hasAlpha = true;
    const puff = new ParticleSystem('puff', 30, this.scene);
    puff.particleTexture = puffTex;
    puff.emitter = new Vector3(0, -100, 0);
    puff.minSize = 0.5;
    puff.maxSize = 1.1;
    puff.minLifeTime = 0.25;
    puff.maxLifeTime = 0.55;
    puff.emitRate = 0;
    puff.direction1 = new Vector3(-1.6, 1.2, -1.6);
    puff.direction2 = new Vector3(1.6, 2.6, 1.6);
    puff.gravity = new Vector3(0, -4, 0);
    puff.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    puff.start();
    return puff;
  }

  private landingPuff(x: number, y: number, sandy: boolean): void {
    (this.puff.emitter as Vector3).copyFrom(w2b(x, y, 0.5));
    const c = sandy ? new Color4(0.93, 0.86, 0.66, 0.85) : new Color4(1, 1, 0.98, 0.7);
    this.puff.color1 = c;
    this.puff.color2 = new Color4(c.r, c.g, c.b, 0.45);
    this.puff.manualEmitCount = 14;
  }

  private ctx(): ShotContext {
    return { ball: this.state.ballPos, lie: this.state.lie, golfer: active().golfer, fireBoost: 0 };
  }

  private fwd3(yaw: number): Vector3 {
    return new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  // ------------------------------------------------------------- cameras

  private setCamSetup(): void {
    const f = this.fwd3(this.aim.yaw);
    const base = w2b(this.state.ballPos.x, this.state.ballPos.y, 0);
    const putt = this.aim.isPutting;
    if (this.aerial && !putt) {
      // Overhead planning view framing the whole ball→pin corridor so the
      // fairway, green and hazards all read from above
      const mx = (this.state.ballPos.x + this.hole.pin.x) / 2;
      const my = (this.state.ballPos.y + this.hole.pin.y) / 2;
      const span = Math.hypot(this.hole.pin.x - this.state.ballPos.x, this.hole.pin.y - this.state.ballPos.y);
      const height = Math.min(760, Math.max(240, span * 0.75));
      const mid = w2b(mx, my, 0);
      // Nudge the eye slightly toward the ball so "up" on screen is downrange
      const toPin = this.fwd3(this.aim.yaw);
      this.camTarget.pos = mid.subtract(toPin.scale(span * 0.18)).add(new Vector3(0, height, 0.01));
      this.camTarget.look = mid;
      this.camTarget.k = 4;
      return;
    }
    // Higher, more pitched-down vantage so the fairway and green read clearly
    this.camTarget.pos = base.subtract(f.scale(putt ? 11 : 30)).add(new Vector3(0, putt ? 4.5 : 22, 0));
    this.camTarget.look = base.add(f.scale(putt ? 24 : 72)).add(new Vector3(0, putt ? 1 : 1, 0));
    this.camTarget.k = 4;
  }

  private setCamFlight(p: { x: number; y: number; z: number }, dir: number): void {
    const f = this.fwd3(dir);
    const pos3 = w2b(p.x, p.y, p.z);
    this.camTarget.pos = pos3.subtract(f.scale(13 + p.z * 0.25)).add(new Vector3(0, 7 + p.z * 0.4, 0));
    this.camTarget.look = pos3.add(f.scale(26)).add(new Vector3(0, 2 + p.z * 0.3, 0));
    this.camTarget.k = 7;
  }

  private setCamLanding(p: { x: number; y: number }, dir: number): void {
    const f = this.fwd3(dir);
    const pos3 = w2b(p.x, p.y, 0);
    this.camTarget.pos = pos3.subtract(f.scale(26)).add(new Vector3(0, 9, 0));
    this.camTarget.look = pos3;
    this.camTarget.k = 4;
  }

  /** Green approaches: 3/4 aerial view that frames the green as a target. */
  private setCamDescent(land: { x: number; y: number }, dir: number): void {
    const f = this.fwd3(dir);
    const pos3 = w2b(land.x, land.y, 0);
    this.camTarget.pos = pos3.subtract(f.scale(30)).add(new Vector3(0, 27, 0));
    this.camTarget.look = pos3.add(f.scale(5));
    this.camTarget.k = 5;
  }

  // ---------------------------------------------------------------- intro

  /** Broadcast-style hole flyover: tee → sweep the hole → settle at the tee. */
  private playIntro(): void {
    const h = this.hole;
    const yards = Math.round(Math.hypot(h.pin.x - h.tee.x, h.pin.y - h.tee.y) / PX_PER_YARD);
    bannerEl.innerHTML =
      `<div class="hole-no">HOLE ${h.number}</div>` +
      `<div class="hole-facts">PAR ${h.par} · ${yards} yds</div>` +
      `<div class="hole-course">${round.course.name}</div>`;
    const badge = document.getElementById('badge');
    if (badge) badge.innerHTML = `${round.course.name}<br />${h.name ?? 'Hole ' + h.number}`;
    bannerEl.style.opacity = '1';
    this.aim.autoSelectClub(this.ctx());
    this.aim.resetAim(this.ctx());

    const toGreen = Math.atan2(h.pin.y - h.tee.y, h.pin.x - h.tee.x);
    const g = this.fwd3(toGreen);
    // Start low behind the tee looking down the hole toward the green
    this.camera.position = w2b(h.tee.x, h.tee.y, 14).subtract(g.scale(24));
    this.camera.setTarget(w2b(h.pin.x, h.pin.y, 0));

    // Waypoint 1: rise and glide out over the fairway toward the green
    const midX = (h.tee.x + h.pin.x) / 2;
    const midY = (h.tee.y + h.pin.y) / 2;
    this.camTarget.pos = w2b(midX, midY, 90).subtract(g.scale(30));
    this.camTarget.look = w2b(h.pin.x, h.pin.y, 0);
    this.camTarget.k = 1.1;

    // Waypoint 2: drift over the green looking down at the pin
    setTimeout(() => {
      if (this.disposed) return;
      this.camTarget.pos = w2b(h.pin.x, h.pin.y, 70).subtract(g.scale(24));
      this.camTarget.look = w2b(h.pin.x, h.pin.y, 0);
      this.camTarget.k = 1.2;
    }, 1500);

    // Waypoint 3: swing back to the tee-shot framing and hand over control
    setTimeout(() => {
      if (this.disposed) return;
      bannerEl.style.opacity = '0';
      this.setCamSetup();
      this.camTarget.k = 1.4;
      setTimeout(() => {
        if (!this.disposed) this.beginTurn();
      }, 900);
    }, 3000);
  }

  // ---------------------------------------------------------------- turns

  beginTurn(): void {
    this.state.phase = 'aiming';
    this.aim.autoSelectClub(this.ctx());
    this.aim.resetAim(this.ctx());
    this.golfer.placeAt(this.state.ballPos.x, this.state.ballPos.y, this.aim.yaw);
    this.golfer.setPose(0);
    this.golfer.aiming = true;
    this.ball.position = w2b(this.state.ballPos.x, this.state.ballPos.y, HoleScene.BALL_REST);
    this.puttGrid.setEnabled(this.aim.isPutting);
    this.setCamSetup();
    this.updateHud();
    promptEl.textContent = this.aim.isPutting
      ? 'Read the roll — tap SWING to putt'
      : 'Drag to aim — tap SWING';
    this.updateAimVisuals();
    if (this.ai) {
      // AI turn: no player meter, no aim guide
      meter.hide();
      meterEl.style.display = 'none';
      this.aimRoot.setEnabled(false);
      clubBar.style.display = 'none';
      aerialBtn.style.display = 'none';
      this.aiTurn();
      return;
    }
    // Human turn: arm the meter and leave it on screen showing the target
    meter.arm({
      stat: statsForClub(this.aim.club, active().golfer, 0).accuracy,
      powerTarget: this.aim.barPowerTarget(this.ctx()),
      isPutt: this.aim.isPutting
    });
    meterEl.style.display = 'block';
    clubBar.style.display = 'flex';
    aerialBtn.style.display = 'block';
    this.refreshClubBar();
  }

  /** Redraw the ground aim guide from the current aim + preview. */
  private updateAimVisuals(): void {
    if (this.state.phase !== 'aiming' || this.ai) {
      this.aimRoot.setEnabled(false);
      return;
    }
    this.aimRoot.setEnabled(true);
    this.aim.computePreview(this.ctx(), this.wind);
    const path = this.aim.previewPath;
    const target = path && path.length ? path[path.length - 1] : this.aim.aimPoint(this.state.ballPos);
    // Dots march from the ball to the landing/aim point along the ground
    const bx = this.state.ballPos.x;
    const by = this.state.ballPos.y;
    this.aimDots.forEach((dot, i) => {
      const f = (i + 1) / (this.aimDots.length + 1);
      dot.position = w2b(bx + (target.x - bx) * f, by + (target.y - by) * f, 0.12);
    });
    this.aimRing.position = w2b(target.x, target.y, 0.12);
  }

  private cycleClub(dir: number): void {
    if (this.state.phase !== 'aiming' || this.ai || meter.isActive) return;
    this.aim.cycleClub(dir, this.ctx());
    this.puttGrid.setEnabled(this.aim.isPutting);
    meter.arm({
      stat: statsForClub(this.aim.club, active().golfer, 0).accuracy,
      powerTarget: this.aim.barPowerTarget(this.ctx()),
      isPutt: this.aim.isPutting
    });
    meterEl.style.display = 'block';
    this.updateAimVisuals();
    this.updateHud();
    this.refreshClubBar();
  }

  private refreshClubBar(): void {
    clubName.textContent = this.aim.club.name;
  }

  private toggleAerial(): void {
    if (this.state.phase !== 'aiming' || this.ai) return;
    this.aerial = !this.aerial;
    aerialBtn.classList.toggle('on', this.aerial);
    this.setCamSetup();
  }

  /** AI opponent: pick a shot with AIController and play it (no meter). */
  private aiTurn(): void {
    promptEl.textContent = `${active().golfer.name} is playing…`;
    const decision = this.ai!.decide(this.state.ballPos, this.state.lie, this.wind, this.hole);
    this.aim.setClubById(decision.club.id);
    this.aim.yaw = decision.aimAngle;
    this.aim.distPx = dist(this.state.ballPos, decision.aimPoint);
    this.golfer.placeAt(this.state.ballPos.x, this.state.ballPos.y, this.aim.yaw);
    this.puttGrid.setEnabled(this.aim.isPutting);
    this.setCamSetup();
    this.updateHud();
    setTimeout(() => {
      if (this.disposed || this.state.phase !== 'aiming') return;
      this.executeShot(decision.swing, true);
    }, 1100);
  }

  private updateHud(): void {
    const toPin = this.engine2d.yardsToPin(this.state.ballPos);
    const club = this.aim.club;
    const carry = Math.round(this.aim.maxCarryPx(this.ctx()) / PX_PER_YARD);
    const distLabel = club.id === 'putter' ? `${Math.round(toPin * 3)} ft` : `${carry} yd`;
    const pinLabel = this.state.lie === 'green' ? `${Math.round(toPin * 3)} ft` : `${Math.round(toPin)} yd`;
    // Wind arrow rendered relative to the aim direction (up = down the line)
    const rel = this.wind.angle - this.aim.yaw - Math.PI / 2;
    hudEl.innerHTML =
      `<div class="row"><span class="chip club">${club.name}</span><span class="chip">${distLabel}</span>` +
      `<span class="chip wind"><span class="arrow" style="transform:rotate(${rel}rad)">➤</span> ${this.wind.speed}</span></div>` +
      `<div class="row"><span class="chip pin">⛳ ${pinLabel}</span><span class="chip">${this.state.lie}</span>` +
      `<span class="chip">H${this.hole.number} · S${this.state.strokes}</span><span class="chip score">${scoreToPar(active())}</span></div>` +
      (round.mode === '1v1'
        ? `<div class="row"><span class="chip player">${active().golfer.name}${active().isAI ? ' (AI)' : ''}</span></div>`
        : '');
  }

  // ---------------------------------------------------------------- shots

  private flightTimescale(): number {
    const fl = this.flight;
    if (!fl) return 1;
    if (fl.isPutt) return FLIGHT.puttTimescale;
    const o = fl.outcome;
    const greenFinish = o.holed || o.surface === 'green' || o.surface === 'fringe';
    if (fl.landed) return greenFinish ? FLIGHT.greenRollTimescale : FLIGHT.rollTimescale;
    if (!greenFinish) return FLIGHT.airTimescale;
    const frac = fl.landIdx > 0 ? fl.progress / fl.landIdx : 1;
    if (frac <= FLIGHT.approachRampFrac) return FLIGHT.airTimescale;
    const t = Math.min(1, (frac - FLIGHT.approachRampFrac) / (1 - FLIGHT.approachRampFrac));
    return FLIGHT.airTimescale + (FLIGHT.greenApproachTimescale - FLIGHT.airTimescale) * t;
  }

  executeShot(swing: SwingResult, powerIsPhysics = false): void {
    this.state.phase = 'swinging';
    this.aimRoot.setEnabled(false);
    this.aerial = false;
    aerialBtn.classList.remove('on');
    clubBar.style.display = 'none';
    aerialBtn.style.display = 'none';
    const club = this.aim.club;
    // The meter reports bar units; the AI already reports physics power.
    const converted: SwingResult = powerIsPhysics
      ? swing
      : { ...swing, power: this.aim.barToPhysicsPower(swing.power, this.ctx()) };
    const outcome = this.engine2d.simulate({
      origin: this.state.ballPos,
      aimAngle: this.aim.yaw,
      swing: converted,
      club,
      golfer: active().golfer,
      fireBoost: 0,
      lie: this.state.lie,
      wind: this.wind,
      hole: this.hole
    });
    this.state.strokes += 1 + (outcome.waterPenalty ? 1 : 0);
    this.updateHud();

    if (club.id !== 'putter') play('swing');
    this.golfer.swing(() => {
      if (this.disposed) return;
      play(
        club.id === 'putter'
          ? 'putt'
          : club.id === 'driver' || club.id === '3w' || club.id === '5w'
            ? 'impact-driver'
            : club.id === 'pw' || club.id === 'sw'
              ? 'impact-wedge'
              : 'impact-iron'
      );
      let landIdx = outcome.path.length - 1;
      for (let i = 5; i < outcome.path.length; i++) {
        if (outcome.path[i].z <= 0.001) {
          landIdx = i;
          break;
        }
      }
      const trail = club.id === 'putter' ? null : new TrailMesh('trail', this.ball, this.scene, 0.12, 46, true);
      if (trail) {
        const tm = new StandardMaterial('trailMat', this.scene);
        tm.emissiveColor = new Color3(1, 1, 1);
        tm.diffuseColor = new Color3(1, 1, 1);
        tm.alpha = 0.35;
        trail.material = tm;
      }
      this.flight = {
        outcome,
        progress: 0,
        landIdx,
        dir: this.aim.yaw,
        isPutt: club.id === 'putter',
        landed: false,
        trail
      };
      this.state.phase = 'flying';
      if (club.id !== 'putter') this.shakeT = 0.18;
    });
  }

  private afterShot(outcome: ShotOutcome): void {
    this.state.ballPos = { ...outcome.finalPos };
    this.state.lie = outcome.surface;
    if (outcome.holed) {
      play('hole');
      showMsg(scoreName(this.state.strokes, this.hole.par), 2200);
      if (this.state.strokes < this.hole.par) setTimeout(() => play('chime'), 450);
      this.golfer.react('celebrate');
      this.state.phase = 'done';
      setTimeout(() => this.onHoleComplete(this.state.strokes), 2600);
      return;
    }
    if (outcome.waterPenalty) {
      play('splash');
      showMsg('SPLASH! +1 penalty', 1400);
      this.golfer.react('deject');
    }
    // Pick up at the stroke cap so a rough hole ends like the 2D game
    if (this.state.strokes >= RULES.maxStrokes) {
      showMsg(`Pick up — max ${RULES.maxStrokes}`, 1600);
      this.state.phase = 'done';
      setTimeout(() => this.onHoleComplete(this.state.strokes), 1800);
      return;
    }
    setTimeout(() => {
      if (!this.disposed) this.beginTurn();
    }, 700);
  }

  // ---------------------------------------------------------------- input

  private wireInput(): void {
    this.onSwingTap = (e: Event): void => {
      e.preventDefault();
      startAmbience();
      if (this.state.phase !== 'aiming') return;
      promptEl.textContent = '';
      meterEl.style.display = 'block';
      if (!meter.isArmed) {
        meter.arm({
          stat: statsForClub(this.aim.club, active().golfer, 0).accuracy,
          powerTarget: this.aim.barPowerTarget(this.ctx()),
          isPutt: this.aim.isPutting
        });
      }
      meter.handleTap();
    };
    swingBtn.addEventListener('pointerdown', this.onSwingTap);

    this.onPointerDown = (e: PointerEvent): void => {
      startAmbience();
      if (this.state.phase !== 'aiming' || meter.isActive) return;
      this.dragX = e.clientX;
    };
    this.onPointerMove = (e: PointerEvent): void => {
      if (this.dragX === null || this.state.phase !== 'aiming' || meter.isActive) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.aim.yaw += dx * 0.0035;
      this.golfer.placeAt(this.state.ballPos.x, this.state.ballPos.y, this.aim.yaw);
      this.setCamSetup();
      this.updateAimVisuals();
      this.updateHud();
    };
    this.onPointerUp = (): void => {
      this.dragX = null;
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.onPrevClub = () => this.cycleClub(-1);
    this.onNextClub = () => this.cycleClub(1);
    this.onAerial = () => this.toggleAerial();
    document.getElementById('prevClub')!.addEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.addEventListener('pointerdown', this.onNextClub);
    aerialBtn.addEventListener('pointerdown', this.onAerial);

    meter.onComplete = (result) => this.executeShot(result);
    meter.onBand = (kind, band) => {
      const label = band === 'perfect' ? 'PERFECT!' : band === 'good' ? 'Good' : 'Miss!';
      showMsg(`${kind === 'power' ? 'Power' : 'Accuracy'}: ${label}`, 500);
    };
  }

  private dragX: number | null = null;
  private onSwingTap!: (e: Event) => void;
  private onPointerDown!: (e: PointerEvent) => void;
  private onPointerMove!: (e: PointerEvent) => void;
  private onPointerUp!: () => void;
  private onPrevClub!: () => void;
  private onNextClub!: () => void;
  private onAerial!: () => void;

  // ----------------------------------------------------------------- loop

  private tick(): void {
    const dt = engine3d.getDeltaTime() / 1000;

    if (this.flight) {
      this.flight.progress += dt * 60 * this.flightTimescale();
      const i = Math.floor(this.flight.progress);
      const path = this.flight.outcome.path;
      if (i >= path.length) {
        const outcome = this.flight.outcome;
        this.flight.trail?.dispose();
        this.flight = null;
        this.afterShot(outcome);
      } else {
        const p = path[i];
        this.ball.position = w2b(p.x, p.y, p.z + HoleScene.BALL_REST);
        if (!this.flight.landed && p.z <= 0.01 && i > 4) {
          this.flight.landed = true;
          if (!this.flight.isPutt) {
            this.setCamLanding({ x: p.x, y: p.y }, this.flight.dir);
            this.landingPuff(p.x, p.y, this.engine2d.surfaceAt(p.x, p.y) === 'sand');
          }
        } else if (!this.flight.landed && !this.flight.isPutt) {
          const o = this.flight.outcome;
          const greenFinish = o.holed || o.surface === 'green' || o.surface === 'fringe';
          const frac = this.flight.landIdx > 0 ? this.flight.progress / this.flight.landIdx : 1;
          if (greenFinish && frac > 0.6) {
            const land = path[this.flight.landIdx];
            this.setCamDescent({ x: land.x, y: land.y }, this.flight.dir);
          } else {
            this.setCamFlight(p, this.flight.dir);
          }
        }
      }
    }

    // Blob shadow tracks the ball's ground point
    const hgt = Math.max(0, this.ball.position.y - HoleScene.BALL_REST);
    this.ballShadow.position.set(this.ball.position.x, 0.07, this.ball.position.z);
    const spread = 1 + Math.min(2.2, hgt * 0.014);
    this.ballShadow.scaling.set(spread, spread, spread);
    this.bsMat.alpha = 0.3 / (1 + hgt * 0.02);

    // Smooth the camera toward its target
    const k = 1 - Math.exp(-dt * this.camTarget.k);
    this.camera.position = Vector3.Lerp(this.camera.position, this.camTarget.pos, k);
    const look = this.camera.getTarget().clone();
    this.camera.setTarget(Vector3.Lerp(look, this.camTarget.look, k));
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const amp = 0.3 * Math.max(0, this.shakeT) / 0.18;
      this.camera.position.addInPlace(
        new Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp)
      );
    }
  }

  render(): void {
    this.scene.render();
  }

  /** Test hook: place the ball anywhere and start a fresh turn there. */
  dropAt(x: number, y: number): void {
    this.state.ballPos = { x, y };
    this.state.lie = this.engine2d.surfaceAt(x, y);
    this.beginTurn();
  }

  dispose(): void {
    this.disposed = true;
    swingBtn.removeEventListener('pointerdown', this.onSwingTap);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    document.getElementById('prevClub')!.removeEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.removeEventListener('pointerdown', this.onNextClub);
    aerialBtn.removeEventListener('pointerdown', this.onAerial);
    meter.onComplete = null;
    meter.hide();
    clubBar.style.display = 'none';
    aerialBtn.style.display = 'none';
    this.scene.dispose();
  }
}

// -------------------------------------------------------- round orchestration

let current: HoleScene | null = null;
const holesThisRound = (): number => Math.min(RULES.holesPerRound, round.course.holes.length);

/** Play the active participant's ball on the current hole. */
function playHole(): void {
  current?.dispose();
  current = new HoleScene((strokes) => {
    active().scores[round.holeIdx] = strokes;
    // In 1v1 both players finish the hole before advancing
    if (round.activePlayer < round.players.length - 1) {
      round.activePlayer += 1;
      playHole();
      return;
    }
    round.activePlayer = 0;
    round.holeIdx += 1;
    if (round.holeIdx < holesThisRound()) {
      playHole();
    } else {
      showSummary();
    }
  });
  exposeDebug();
}

function showSummary(): void {
  current?.dispose();
  current = null;
  const holes = round.course.holes.slice(0, holesThisRound());
  const totalPar = holes.reduce((a, h) => a + h.par, 0);
  const parLabel = (total: number): string => {
    const d = total - totalPar;
    return d === 0 ? 'Even' : d > 0 ? `+${d}` : `${d}`;
  };
  const headCols = round.players.map((p) => `<th>${p.golfer.name}${p.isAI ? ' (AI)' : ''}</th>`).join('');
  const rows = holes
    .map(
      (h, i) =>
        `<tr><td>H${h.number}</td><td>${h.par}</td>` +
        round.players.map((p) => `<td>${p.scores[i] ?? '-'}</td>`).join('') +
        `</tr>`
    )
    .join('');
  const totals = round.players.map((p) => p.scores.reduce((a, s) => a + s, 0));
  const totalRow =
    `<tr class="totrow"><td>Total</td><td>${totalPar}</td>` +
    totals.map((t) => `<td>${t} (${parLabel(t)})</td>`).join('') +
    `</tr>`;
  let headline = 'Round complete';
  if (round.mode === '1v1') {
    const me = totals[0];
    const them = totals[1];
    headline = me < them ? 'You win! 🏆' : me > them ? `${round.players[1].golfer.name} wins` : 'Tied match';
  }
  summaryEl.innerHTML =
    `<h2>${headline}</h2>` +
    `<table><tr><th>Hole</th><th>Par</th>${headCols}</tr>${rows}${totalRow}</table>` +
    `<button id="againBtn">Menu</button>`;
  summaryEl.style.display = 'block';
  document.getElementById('againBtn')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    showSetup();
  });
}

engine3d.runRenderLoop(() => current?.render());
window.addEventListener('resize', () => engine3d.resize());

// Debug/automation handle for the Playwright verification scripts
function exposeDebug(): void {
  (window as unknown as { __slice3d: unknown }).__slice3d = current
    ? {
        meter,
        aim: current.aim,
        state: current.state,
        scene: current.scene,
        mode: round.mode,
        activePlayer: round.activePlayer,
        dropAt: (x: number, y: number) => current?.dropAt(x, y),
        skipIntro: () => {
          bannerEl.style.opacity = '0';
          current?.beginTurn();
        }
      }
    : null;
}

// ------------------------------------------------------------- setup menu

const setupEl = document.getElementById('setup')!;
const sel = { course: 'amen', mode: 'solo' as GameMode, golfer: 0, opponent: 1 };

function buildSetup(): void {
  const courseRow = document.getElementById('pickCourse')!;
  courseRow.innerHTML = Object.entries(COURSES)
    .map(
      ([key, c]) =>
        `<div class="pick${sel.course === key ? ' sel' : ''}" data-course="${key}">${c.name}` +
        `<span class="sub">${Math.min(RULES.holesPerRound, c.holes.length)} holes</span></div>`
    )
    .join('');
  const modeRow = document.getElementById('pickMode')!;
  const modes: Array<[GameMode, string, string]> = [
    ['solo', 'Solo', 'Play your own round'],
    ['1v1', '1v1 vs AI', 'Match play a rival']
  ];
  modeRow.innerHTML = modes
    .map(
      ([m, label, sub]) =>
        `<div class="pick${sel.mode === m ? ' sel' : ''}" data-mode="${m}">${label}<span class="sub">${sub}</span></div>`
    )
    .join('');
  const golferRow = document.getElementById('pickGolfer')!;
  golferRow.innerHTML = GOLFERS.map(
    (g, i) =>
      `<div class="pick${sel.golfer === i ? ' sel' : ''}" data-golfer="${i}">${g.name}` +
      `<span class="sub">PWR ${g.stats.drivingPower} · PUT ${g.stats.putting}</span></div>`
  ).join('');

  courseRow.querySelectorAll('.pick').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.course = (el as HTMLElement).dataset.course!;
      buildSetup();
    })
  );
  modeRow.querySelectorAll('.pick').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.mode = (el as HTMLElement).dataset.mode as GameMode;
      buildSetup();
    })
  );
  golferRow.querySelectorAll('.pick').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.golfer = Number((el as HTMLElement).dataset.golfer);
      buildSetup();
    })
  );
}

function showSetup(): void {
  setupEl.style.display = 'flex';
  buildSetup();
}

function startRound(): void {
  round.course = COURSES[sel.course];
  round.mode = sel.mode;
  round.holeIdx = 0;
  round.activePlayer = 0;
  round.holeWinds = [];
  const me: Participant = { golfer: GOLFERS[sel.golfer], isAI: false, scores: [] };
  if (sel.mode === '1v1') {
    // Rival = a different golfer than the player picked
    const rivalIdx = sel.golfer === 0 ? 1 : 0;
    round.players = [me, { golfer: GOLFERS[rivalIdx], isAI: true, scores: [] }];
  } else {
    round.players = [me];
  }
  setupEl.style.display = 'none';
  playHole();
}

document.getElementById('startBtn')!.addEventListener('pointerdown', startRound);
showSetup();

// Test hook: let Playwright configure + start a round without menu taps
(window as unknown as { __startRound: unknown }).__startRound = (opts?: {
  course?: string;
  mode?: GameMode;
  golfer?: number;
}) => {
  if (opts?.course) sel.course = opts.course;
  if (opts?.mode) sel.mode = opts.mode;
  if (opts?.golfer !== undefined) sel.golfer = opts.golfer;
  startRound();
};
