import {
  Color3,
  Engine,
  FreeCamera,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TrailMesh,
  Vector3
} from '@babylonjs/core';
import { FLIGHT, PX_PER_YARD } from '../config';
import { AimControl, ShotContext } from '../core/input/AimControl';
import { resolveTheme } from '../core/rendering/Theme';
import { CourseData, ShotOutcome, SwingResult } from '../core/types';
import { GOLFERS } from '../data/golfers';
import amenCorner from '../data/courses/amenCorner.json';
import { PhysicsEngine, statsForClub } from '../systems/PhysicsEngine';
import { scoreName } from '../systems/Scoring';
import { buildCourse, w2b } from './course3d';
import { Golfer3D } from './golfer3d';
import { DomMeter } from './meter3d';

// ------------------------------------------------------------------- setup

const course = amenCorner as CourseData;
const hole = course.holes[0]; // White Dogwood
const theme = resolveTheme(course);
const engine2d = new PhysicsEngine(hole);
const aim = new AimControl(hole, engine2d);
const golferData = GOLFERS[0]; // Zac
const wind = { angle: 0, speed: 0 }; // stillness keeps the slice readable

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const engine3d = new Engine(canvas, true, { adaptToDeviceRatio: true });
const scene = new Scene(engine3d);
const { shadows } = buildCourse(scene, hole, theme, engine2d);
const golfer = new Golfer3D(scene, golferData.look, shadows);

const ball = MeshBuilder.CreateSphere('ball', { diameter: 1.3, segments: 12 }, scene);
const ballMat = new StandardMaterial('ballMat', scene);
ballMat.diffuseColor = new Color3(0.97, 0.97, 0.95);
ballMat.specularColor = new Color3(0.5, 0.5, 0.5);
ball.material = ballMat;
shadows.addShadowCaster(ball);

const camera = new FreeCamera('cam', new Vector3(0, 8, 0), scene);
camera.minZ = 0.5;
camera.maxZ = 12000;
// Portrait phones crop the horizontal view hard (h-fov ≈ v-fov × aspect), so
// run a wide vertical fov to keep the flanking tree lines in the tee framing.
camera.fov = 1.05;

// -------------------------------------------------------------------- HUD

const hudEl = document.getElementById('hud')!;
const msgEl = document.getElementById('msg')!;
const promptEl = document.getElementById('prompt')!;
const meter = new DomMeter(document.getElementById('meter')!);
const swingBtn = document.getElementById('swingBtn')!;

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

// ------------------------------------------------------------- game state

interface SliceState {
  ballPos: { x: number; y: number };
  lie: ReturnType<PhysicsEngine['surfaceAt']>;
  strokes: number;
  phase: 'aiming' | 'swinging' | 'flying' | 'done';
}
const st: SliceState = { ballPos: { ...hole.tee }, lie: 'tee', strokes: 0, phase: 'aiming' };

const ctx = (): ShotContext => ({
  ball: st.ballPos,
  lie: st.lie,
  golfer: golferData,
  fireBoost: 0
});

const fwd3 = (yaw: number): Vector3 => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

// Camera director: exponential smoothing toward a per-phase target
const camTarget = { pos: new Vector3(0, 8, 0), look: new Vector3(0, 0, 0), k: 4 };
function setCamSetup(): void {
  const f = fwd3(aim.yaw);
  const base = w2b(st.ballPos.x, st.ballPos.y, 0);
  const putt = aim.isPutting;
  camTarget.pos = base.subtract(f.scale(putt ? 17 : 24)).add(new Vector3(0, putt ? 7 : 11, 0));
  camTarget.look = base.add(f.scale(putt ? 32 : 60)).add(new Vector3(0, putt ? 0.5 : 3, 0));
  camTarget.k = 4;
}
function setCamFlight(p: { x: number; y: number; z: number }, dir: number): void {
  const f = fwd3(dir);
  const pos3 = w2b(p.x, p.y, p.z);
  camTarget.pos = pos3.subtract(f.scale(13 + p.z * 0.25)).add(new Vector3(0, 7 + p.z * 0.4, 0));
  camTarget.look = pos3.add(f.scale(26)).add(new Vector3(0, 2 + p.z * 0.3, 0));
  camTarget.k = 7;
}
function setCamLanding(p: { x: number; y: number }, dir: number): void {
  const f = fwd3(dir);
  const pos3 = w2b(p.x, p.y, 0);
  camTarget.pos = pos3.subtract(f.scale(26)).add(new Vector3(0, 9, 0));
  camTarget.look = pos3;
  camTarget.k = 4;
}

function updateHud(): void {
  const toPin = engine2d.yardsToPin(st.ballPos);
  const club = aim.club;
  const carry = Math.round(aim.maxCarryPx(ctx()) / PX_PER_YARD);
  hudEl.innerHTML =
    `<b>${club.name}</b> ~${club.id === 'putter' ? Math.round(toPin * 3) + 'ft' : carry + 'y'}<br />` +
    `To pin: ${st.lie === 'green' ? Math.round(toPin * 3) + ' ft' : Math.round(toPin) + ' yds'}<br />` +
    `Lie: ${st.lie} &nbsp;•&nbsp; Strokes: ${st.strokes}`;
}

function beginTurn(): void {
  st.phase = 'aiming';
  aim.autoSelectClub(ctx());
  aim.resetAim(ctx());
  golfer.placeAt(st.ballPos.x, st.ballPos.y, aim.yaw);
  golfer.setPose(0);
  ball.position = w2b(st.ballPos.x, st.ballPos.y, 0.65);
  setCamSetup();
  updateHud();
  promptEl.textContent = aim.isPutting
    ? 'Read the roll — tap SWING to putt'
    : 'Drag to aim — tap SWING to start the meter';
  meter.arm({
    stat: statsForClub(aim.club, golferData, 0).accuracy,
    powerTarget: aim.barPowerTarget(ctx()),
    isPutt: aim.isPutting
  });
  meter.hide(); // armed but hidden until first tap
  document.getElementById('meter')!.style.display = 'none';
}

// ------------------------------------------------------------- shot flow

let flight: {
  outcome: ShotOutcome;
  progress: number;
  landIdx: number;
  dir: number;
  isPutt: boolean;
  landed: boolean;
  trail: TrailMesh | null;
} | null = null;

function flightTimescale(): number {
  if (!flight) return 1;
  if (flight.isPutt) return FLIGHT.puttTimescale;
  const o = flight.outcome;
  const greenFinish = o.holed || o.surface === 'green' || o.surface === 'fringe';
  if (flight.landed) return greenFinish ? FLIGHT.greenRollTimescale : FLIGHT.rollTimescale;
  if (!greenFinish) return FLIGHT.airTimescale;
  const frac = flight.landIdx > 0 ? flight.progress / flight.landIdx : 1;
  if (frac <= FLIGHT.approachRampFrac) return FLIGHT.airTimescale;
  const t = Math.min(1, (frac - FLIGHT.approachRampFrac) / (1 - FLIGHT.approachRampFrac));
  return FLIGHT.airTimescale + (FLIGHT.greenApproachTimescale - FLIGHT.airTimescale) * t;
}

function executeShot(swing: SwingResult): void {
  st.phase = 'swinging';
  const club = aim.club;
  const converted: SwingResult = { ...swing, power: aim.barToPhysicsPower(swing.power, ctx()) };
  const outcome = engine2d.simulate({
    origin: st.ballPos,
    aimAngle: aim.yaw,
    swing: converted,
    club,
    golfer: golferData,
    fireBoost: 0,
    lie: st.lie,
    wind,
    hole
  });
  st.strokes += 1 + (outcome.waterPenalty ? 1 : 0);
  updateHud();

  if (club.id !== 'putter') play('swing');
  golfer.swing(() => {
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
    const trail =
      club.id === 'putter'
        ? null
        : new TrailMesh('trail', ball, scene, 0.22, 46, true);
    if (trail) {
      const tm = new StandardMaterial('trailMat', scene);
      tm.emissiveColor = new Color3(1, 1, 1);
      tm.diffuseColor = new Color3(1, 1, 1);
      tm.alpha = 0.5;
      trail.material = tm;
    }
    flight = { outcome, progress: 0, landIdx, dir: aim.yaw, isPutt: club.id === 'putter', landed: false, trail };
    st.phase = 'flying';
  });
}

function afterShot(outcome: ShotOutcome): void {
  st.ballPos = { ...outcome.finalPos };
  st.lie = outcome.surface;
  if (outcome.holed) {
    // Drop the ball into the cup rather than leaving it beside the pole
    ball.position = w2b(hole.pin.x, hole.pin.y, -0.35);
    play('hole');
    showMsg(scoreName(st.strokes, hole.par), 2200);
    if (st.strokes < hole.par) setTimeout(() => play('chime'), 450);
    st.phase = 'done';
    setTimeout(() => {
      st.ballPos = { ...hole.tee };
      st.lie = 'tee';
      st.strokes = 0;
      beginTurn();
    }, 2600);
    return;
  }
  if (outcome.waterPenalty) {
    play('splash');
    showMsg('SPLASH! +1 penalty', 1400);
  }
  setTimeout(beginTurn, 700);
}

// ---------------------------------------------------------------- input

swingBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  startAmbience();
  if (st.phase !== 'aiming') return;
  document.getElementById('meter')!.style.display = 'block';
  if (!meter.isArmed) {
    meter.arm({
      stat: statsForClub(aim.club, golferData, 0).accuracy,
      powerTarget: aim.barPowerTarget(ctx()),
      isPutt: aim.isPutting
    });
  }
  meter.handleTap();
});

let dragX: number | null = null;
canvas.addEventListener('pointerdown', (e) => {
  startAmbience();
  if (st.phase !== 'aiming' || meter.isActive) return;
  dragX = e.clientX;
});
canvas.addEventListener('pointermove', (e) => {
  if (dragX === null || st.phase !== 'aiming' || meter.isActive) return;
  const dx = e.clientX - dragX;
  dragX = e.clientX;
  aim.yaw += dx * 0.0035;
  golfer.placeAt(st.ballPos.x, st.ballPos.y, aim.yaw);
  setCamSetup();
});
canvas.addEventListener('pointerup', () => (dragX = null));

meter.onComplete = (result) => executeShot(result);
meter.onBand = (kind, band) => {
  const label = band === 'perfect' ? 'PERFECT!' : band === 'good' ? 'Good' : 'Miss!';
  showMsg(`${kind === 'power' ? 'Power' : 'Accuracy'}: ${label}`, 500);
};

// ------------------------------------------------------------- main loop

scene.onBeforeRenderObservable.add(() => {
  const dt = engine3d.getDeltaTime() / 1000;

  if (flight) {
    flight.progress += dt * 60 * flightTimescale();
    const i = Math.floor(flight.progress);
    const path = flight.outcome.path;
    if (i >= path.length) {
      const outcome = flight.outcome;
      flight.trail?.dispose();
      flight = null;
      afterShot(outcome);
    } else {
      const p = path[i];
      ball.position = w2b(p.x, p.y, p.z + 0.65);
      if (!flight.landed && p.z <= 0.01 && i > 4) {
        flight.landed = true;
        if (!flight.isPutt) setCamLanding({ x: p.x, y: p.y }, flight.dir);
      } else if (!flight.landed && !flight.isPutt) {
        setCamFlight(p, flight.dir);
      }
    }
  }

  // Smooth the camera toward its target
  const k = 1 - Math.exp(-dt * camTarget.k);
  camera.position = Vector3.Lerp(camera.position, camTarget.pos, k);
  const look = camera.getTarget().clone();
  camera.setTarget(Vector3.Lerp(look, camTarget.look, k));
});

engine3d.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine3d.resize());

beginTurn();
camera.position = camTarget.pos.clone();
camera.setTarget(camTarget.look);

// Debug/automation handle for the Playwright verification scripts
(window as unknown as { __slice3d: unknown }).__slice3d = {
  meter,
  aim,
  state: st,
  scene
};
