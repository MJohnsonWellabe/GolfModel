import {
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  FreeCamera,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  TrailMesh,
  TransformNode,
  Vector3,
  Viewport
} from '@babylonjs/core';
import { FLIGHT, PHYSICS, PUTT_VIEW, PX_PER_YARD, RULES } from '../config';
import { isFrozen, SHOT, ShotCam } from '../core/debugFlags';
import { AimControl, ShotContext } from '../core/input/AimControl';
import { StrikeControl } from '../core/input/StrikeControl';
import { preloadGrassGrain } from '../core/rendering/grassTexture';
import { resolveTheme } from '../core/rendering/Theme';
import { ClubSpec, CourseData, GameMode, Golfer, GolferStats, HoleData, ShotOutcome, SwingResult, Wind } from '../core/types';
import { assembleGolfer } from '../data/golfers';
import { ARCHETYPES, ArchetypeId, StatKey } from '../data/archetypes';
import { CHARACTERS, CharacterKey } from '../data/characters';
import { CourseAuthoring, loadCourse } from '../data/courseLoader';
import wildwood from '../data/courses/wildwood.json';
import sablebay from '../data/courses/sablebay.json';
import timberline from '../data/courses/timberline.json';
import { bestRounds, clearLocalHistory, fetchAllRounds, isNewRecord, isShared, makeRoundId, RoundRecord, saveRound } from '../firebase/History';
import {
  createTournament,
  fetchTournament,
  submitEntry,
  submitAces,
  fetchAces,
  makeTournamentCode,
  tournamentStandings,
  isEnded,
  isPlausibleEntry,
  Tournament,
  TournamentEntry
} from '../firebase/Tournaments';
import { mulberry32 } from '../utils/Random';
import { authConfigured, CloudSaveStatus, cloudSyncProfile, isSignedIn, linkedAccountName, signInWithGoogle, signOutAccount } from '../firebase/FirebaseClient';
import { clearLocalProfile, CosmeticKind, defaultProfile, loadProfile, mergeProfiles, PlayerProfile, resetProfileRecords, saveProfile } from '../profile/Profile';
import { ACHIEVEMENTS, emptyRoundStats, RoundStats, xpForLevel, dailyChallengeFor } from '../data/progression';
import { applyRound, RewardEvent } from '../systems/ProgressionEngine';
import { buyItem, canBuy, equip, equippedColor, isOwned } from '../systems/StoreEngine';
import { isEquippableKind, STORE_CATALOG, StoreItem } from '../data/storeCatalog';
import { AIOpponent, OPPONENTS } from '../data/opponents';
import { AIController, BALANCED_PERSONALITY } from '../systems/AIController';
import { FireSystem } from '../systems/FireSystem';
import { buildHeightField } from '../systems/HeightField';
import { TurnManager } from '../systems/TurnManager';
import { dist } from '../utils/Geometry';
import { PhysicsEngine, statsForClub } from '../systems/PhysicsEngine';
import { scoreName } from '../systems/Scoring';
import { buildCourse, w2b } from './course3d';
import { Golfer3D } from './golfer3d';
import { DomMeter } from './meter3d';

// ------------------------------------------------------------------- boot

const canvas = document.getElementById('scene') as HTMLCanvasElement;
// preserveDrawingBuffer keeps the last frame readable for screenshots/share
// captures (and reliable headless verification) at negligible cost here.
const engine3d = new Engine(canvas, true, { adaptToDeviceRatio: true, preserveDrawingBuffer: true });

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
const skipBtn = document.getElementById('skipBtn')!;
const shotShapeEl = document.getElementById('shotShape')!;
const strikePadEl = document.getElementById('strikePad')!;
const strikeDotEl = document.getElementById('strikeDot')!;
const aimReadoutEl = document.getElementById('aimReadout')!;

/** RGB hex → Babylon Color3. */
function c3(hex: number): Color3 {
  return new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

function showMsg(text: string, ms = 1200): void {
  msgEl.textContent = text;
  msgEl.style.opacity = '1';
  setTimeout(() => (msgEl.style.opacity = '0'), ms);
}

/** Last cloud-save outcome, so the account UI can flag a persistent failure. */
let lastCloudStatus: CloudSaveStatus = 'skipped';

/**
 * Reflect a cloud-sync outcome to the player so a failed save is visible instead
 * of looking like vanished coins. `quiet` suppresses the reassuring "saved"
 * toast for frequent actions (store taps) but never hides a failure.
 */
function showCloudStatus(status: CloudSaveStatus, quiet = false): void {
  lastCloudStatus = status;
  if (status === 'denied') {
    showMsg('⚠ Cloud save failed — publish the database rules (FIREBASE_SETUP.md)', 3200);
  } else if (status === 'offline') {
    showMsg('⚠ Offline — progress will sync when you reconnect', 2200);
  } else if (status === 'saved' && !quiet) {
    showMsg('✓ Saved to your account', 1100);
  }
}

const sounds: Record<string, number> = {
  swing: 0.5, 'impact-driver': 0.9, 'impact-iron': 0.8, 'impact-wedge': 0.7,
  putt: 0.7, hole: 0.9, splash: 0.8, chime: 0.75
};
function play(key: string): void {
  try {
    const a = new Audio(`sfx/${key}.wav`);
    // Scale by the player's SFX volume setting (accessibility).
    a.volume = Math.max(0, Math.min(1, (sounds[key] ?? 0.7) * profile.settings.sound));
    if (a.volume <= 0) return;
    void a.play().catch(() => undefined);
  } catch {
    // audio is optional
  }
}
let ambienceStarted = false;
let ambienceEl: HTMLAudioElement | null = null;
function startAmbience(): void {
  if (ambienceStarted) return;
  ambienceStarted = true;
  try {
    const a = new Audio('sfx/ambience.wav');
    a.loop = true;
    a.volume = Math.max(0, Math.min(1, profile.settings.ambience));
    ambienceEl = a;
    void a.play().catch(() => (ambienceStarted = false));
  } catch {
    ambienceStarted = false;
  }
}
/** Push the current ambience-volume setting to the live loop (slider drag). */
function applyAmbienceVolume(): void {
  if (ambienceEl) ambienceEl.volume = Math.max(0, Math.min(1, profile.settings.ambience));
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
  /** Shared RNG seed for tournament rounds → identical conditions for every
   *  entrant (undefined for casual rounds, which roll fresh wind). */
  seed?: number;
  /** Active tournament this round counts toward (submits an entry at the end). */
  tournament?: { code: string; name: string } | null;
}

const COURSES: Record<string, CourseData> = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring)
};

// Fire the real-turf-grain preloads at boot, well before any round can start
// (the menu is always shown first) — the ground bake is synchronous and
// falls back to procedural noise if a key hasn't resolved yet. Harmless
// no-ops on courses that don't opt into either key (decoded but unread).
preloadGrassGrain('textures/turf_grain.jpg');
preloadGrassGrain('textures/turf_grain_rough.jpg');

/** Course roster for the picker (id → display + one-line character). */
const COURSE_LIST: Array<{ id: string; name: string; tag: string; icon: string }> = [
  { id: 'wildwood', name: 'Wildwood Glen', tag: 'Parkland · a gentle, welcoming opener', icon: '🌳' },
  { id: 'sablebay', name: 'Sable Bay', tag: 'Coastal · water in play on every hole, island par 3', icon: '🌊' },
  { id: 'timberline', name: 'Timberline', tag: 'Forest · tight, tree-lined and demanding', icon: '🌲' }
];

/** Resolve a course by its display name (tournament entries carry the name). */
function courseIdByName(name: string): string {
  return COURSE_LIST.find((c) => COURSES[c.id]?.name === name)?.id ?? 'wildwood';
}

interface HoleState {
  ballPos: { x: number; y: number };
  lie: ReturnType<PhysicsEngine['surfaceAt']>;
  strokes: number;
  phase: 'intro' | 'aiming' | 'swinging' | 'flying' | 'done';
  holeIdx: number;
  scores: number[];
}

const round: RoundState = {
  course: COURSES.wildwood,
  mode: 'solo',
  holeIdx: 0,
  players: [{ golfer: assembleGolfer('Player', CHARACTERS[0].key, ARCHETYPES[0].id), isAI: false, scores: [] }],
  activePlayer: 0,
  holeWinds: []
};

/** Shot-based round stats accumulated for the HUMAN player during play
 *  (score-based stats are derived at the summary). Feeds ProgressionEngine. */
interface ShotAcc {
  fairwaysHit: number;
  fairwaysPossible: number;
  gir: number;
  puttsMade: number;
  longestDriveYds: number;
  longestPuttMadeFt: number;
  chipIns: number;
  girHoles: Set<number>;
}
function freshShotAcc(): ShotAcc {
  return {
    fairwaysHit: 0,
    fairwaysPossible: 0,
    gir: 0,
    puttsMade: 0,
    longestDriveYds: 0,
    longestPuttMadeFt: 0,
    chipIns: 0,
    girHoles: new Set()
  };
}
let shotAcc: ShotAcc = freshShotAcc();

/** Today's day key (YYYY-MM-DD) for the daily challenge. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Wind for a hole, generated once and shared across players (same roll as 2D).
 *  Tournament rounds seed the roll off the shared tournament seed so every
 *  entrant plays identical conditions (Phase 8). */
function windForHole(idx: number): Wind {
  if (!round.holeWinds[idx]) {
    const rng = round.seed !== undefined ? mulberry32(round.seed * 1000 + idx) : Math.random;
    round.holeWinds[idx] = {
      angle: rng() * Math.PI * 2,
      speed: Math.round(2 + rng() * (PHYSICS.maxWind - 2))
    };
  }
  return round.holeWinds[idx];
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
  /** Resolves once every competitor's body (model-backed or procedural) has
   * finished loading — mainly for deterministic test/verification waits. */
  readonly bodiesReady: Promise<void>;
  private engine2d: PhysicsEngine;
  /** Flat, no-slope, windless engine that backs the aim preview (FB1). */
  private previewEngine: PhysicsEngine;
  private hole = round.course.holes[round.holeIdx];
  private theme = resolveTheme(round.course);
  private golfers: Golfer3D[] = [];
  private balls: Mesh[] = [];
  private ais: (AIController | null)[] = [];
  /** Per-competitor state for this hole (1 for solo, 2 for 1v1/scramble). */
  private comps: Array<{
    ball: { x: number; y: number };
    lie: HoleState['lie'];
    strokes: number;
    holed: boolean;
    isAI: boolean;
    part: Participant;
  }> = [];
  private turnIdx = 0;
  /** Turn order + scramble team state (systems/TurnManager). */
  private tm: TurnManager;
  /** One fire streak per competitor — the AI's brain shares its instance. */
  private fires: FireSystem[] = [];
  private get golfer(): Golfer3D {
    return this.golfers[this.turnIdx];
  }
  private get ball(): Mesh {
    return this.balls[this.turnIdx];
  }
  private get ai(): AIController | null {
    return this.ais[this.turnIdx];
  }
  private course3d!: ReturnType<typeof buildCourse>;
  private ballShadow;
  private bsMat: StandardMaterial;
  private camera: FreeCamera;
  private camTarget = { pos: new Vector3(0, 8, 0), look: new Vector3(0, 0, 0), k: 4, fov: 1.05 };
  private puttGrid;
  private wind: Wind;
  private puff: ParticleSystem;
  private shakeT = 0;
  private aimRoot!: TransformNode;
  private aimDots: Mesh[] = [];
  private aimRing!: Mesh;
  /** World point the aim-distance/elevation readout floats over (FB2/FB4). */
  private aimReadoutWorld: { x: number; y: number } | null = null;
  private aerial = false;
  /** Pre-shot shot SHAPE (strike dot), per turn. */
  private strike = new StrikeControl();
  private strikeDragging = false;
  /** Mid-flight swipe-spin state (Phase 4 aerial spin). */
  private swipeLast: { x: number; y: number } | null = null;
  private flight: {
    outcome: ShotOutcome;
    progress: number;
    landIdx: number;
    dir: number;
    isPutt: boolean;
    landed: boolean;
    trail: TrailMesh | null;
    /** Resolved launch + live spin so swipes can re-shape the flight. */
    launch: import('../systems/PhysicsEngine').ResolvedLaunch | null;
    spin: { side: number; top: number };
  } | null = null;
  private disposed = false;
  /** Pending intro-flyover timers so skipIntro can cancel the camera sweep. */
  private introTimers: ReturnType<typeof setTimeout>[] = [];
  private static BALL_REST = 0.5;
  /** Putting view uses honest, consistent real-world scale (config PUTT_VIEW):
   *  a ~6ft golfer and a ball sized to the cup (~2.5× the ball), so nothing on
   *  the green looks oversized. Only the putt view changes — every other camera
   *  keeps the readable big scale. */
  private static PUTT_GOLFER_SCALE = PUTT_VIEW.golferScale;
  private static PUTT_BALL_SCALE = PUTT_VIEW.ballScale;
  /** Current ball-mesh size multiplier (1 off the green, PUTT_BALL_SCALE on it)
   *  so the ball rests on the surface at either size. */
  private ballScale = 1;

  constructor(
    private onHoleComplete: (scores: number[]) => void,
    /** Ace-challenge hook: when set, the attempt ends the instant the tee shot
     *  comes to rest and reports whether it was holed (Phase 8). */
    private onFirstShot?: (holed: boolean) => void
  ) {
    this.scene = new Scene(engine3d);
    this.engine2d = new PhysicsEngine(this.hole, buildHeightField(this.hole));
    // Aim/preview run on a flat, no-slope engine so the aim line never
    // reveals wind or slope — the player estimates hold-off (FB1/FB2). The
    // real shot uses engine2d (terrain + wind).
    this.previewEngine = new PhysicsEngine({ ...this.hole, slope: { angle: 0, strength: 0 } }, null);
    this.aim = new AimControl(this.hole, this.previewEngine);
    // Shared per-hole conditions (fair across competitors)
    this.wind = windForHole(round.holeIdx);
    this.course3d = buildCourse(this.scene, this.hole, this.theme, this.engine2d);
    const { shadows, puttGrid } = this.course3d;
    this.puttGrid = puttGrid;

    this.tm = new TurnManager(round.mode, this.hole.pin, this.hole.tee);

    // One golfer, ball, fire streak and (for AI) brain per competitor. In
    // solo that's one; in 1v1/scramble two play the hole together.
    round.players.forEach((part, i) => {
      const g = new Golfer3D(this.scene, shadows, part.golfer.character, part.golfer.look);
      g.root.setEnabled(false);
      // The human player wears their equipped apparel (outfit colorway + club
      // skin); AI opponents keep the defaults (Phase 7 store — playtest FB9).
      if (!part.isAI) {
        g.setOutfitTint(equippedColor(profile, 'outfit', 0xffffff));
        g.setClubSkin(equippedColor(profile, 'clubskin', 0x9aa6b2));
      }
      this.golfers.push(g);
      const b = MeshBuilder.CreateSphere(`ball${i}`, { diameter: 1.0, segments: 12 }, this.scene);
      const bm = new StandardMaterial(`ballMat${i}`, this.scene);
      // The human player's ball wears the equipped tint (Phase 7 store).
      bm.diffuseColor = part.isAI ? new Color3(0.97, 0.97, 0.95) : c3(equippedColor(profile, 'ball', 0xf7f7f2));
      bm.specularColor = new Color3(0.5, 0.5, 0.5);
      b.material = bm;
      shadows.addShadowCaster(b);
      this.balls.push(b);
      const fire = new FireSystem();
      this.fires.push(fire);
      const personality = (part.golfer as AIOpponent).personality ?? BALANCED_PERSONALITY;
      this.ais.push(
        part.isAI ? new AIController(part.golfer, fire, this.engine2d, undefined, personality) : null
      );
      this.comps.push({ ball: { ...this.hole.tee }, lie: 'tee', strokes: 0, holed: false, isAI: part.isAI, part });
    });
    this.bodiesReady = Promise.all(this.golfers.map((g) => g.ready)).then(() => undefined);

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
    // Small near-plane so the now-smaller on-green ball never near-clips at the
    // low, close putting vantage.
    this.camera.minZ = 0.1;
    this.camera.maxZ = 12000;
    // Portrait phones crop the horizontal view hard, so run a wide vertical fov
    this.camera.fov = 1.05;

    this.state = {
      ballPos: { ...this.hole.tee },
      lie: 'tee',
      strokes: 0,
      phase: 'intro',
      holeIdx: round.holeIdx,
      scores: this.curPart().scores
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
    (this.puff.emitter as Vector3).copyFrom(w2b(x, y, 0.5 + this.gh(x, y)));
    const c = sandy ? new Color4(0.93, 0.86, 0.66, 0.85) : new Color4(1, 1, 0.98, 0.7);
    this.puff.color1 = c;
    this.puff.color2 = new Color4(c.r, c.g, c.b, 0.45);
    this.puff.manualEmitCount = 14;
  }

  private ctx(): ShotContext {
    return {
      ball: this.state.ballPos,
      lie: this.state.lie,
      golfer: this.curPart().golfer,
      fireBoost: this.fires[this.turnIdx].statBoost
    };
  }

  /** Arm (or re-arm) the swing meter for the current aim/club/fire state. */
  private armMeter(): void {
    const fire = this.fires[this.turnIdx];
    meter.arm({
      stat: statsForClub(this.aim.club, this.curPart().golfer, fire.statBoost).accuracy,
      powerTarget: this.aim.barPowerTarget(this.ctx()),
      isPutt: this.aim.isPutting,
      perfectMult: fire.perfectZoneMultiplier,
      difficultyMult: this.swingDifficulty()
    });
    meterEl.style.display = 'block';
    meterEl.classList.toggle('onFire', fire.isOnFire);
  }

  /**
   * Perfect-zone difficulty from the lie and the club (FB5): bad lies are
   * harder, and longer clubs are harder to strike cleanly — EXCEPT off the
   * tee, where a teed driver is no harder than any other tee shot.
   */
  private swingDifficulty(): number {
    if (this.aim.isPutting) return 1;
    const lie = this.state.lie;
    let d = lie === 'sand' ? 0.62 : lie === 'trees' ? 0.68 : lie === 'rough' ? 0.8 : lie === 'fringe' ? 0.92 : 1;
    if (lie !== 'tee') {
      // Longer clubs shrink the zone; wedges are the most forgiving.
      const byClub: Record<string, number> = {
        driver: 0.68, '3w': 0.74, '5w': 0.8, '3i': 0.82, '4h': 0.85, '5i': 0.88, '7i': 0.93, '9i': 0.97, pw: 1, sw: 1
      };
      d *= byClub[this.aim.club.id] ?? 1;
    }
    return d;
  }

  /** The competitor whose turn it is. */
  private curPart(): Participant {
    return this.comps[this.turnIdx].part;
  }

  /** Cosmetic ground height (green plateau / tee platform) under a world point. */
  private gh(x: number, y: number): number {
    return this.course3d.groundHeightAt(x, y);
  }

  /** A competitor is finished on the hole when holed or at the stroke cap. */
  private compDone(c: (typeof this.comps)[number]): boolean {
    return c.holed || c.strokes >= RULES.maxStrokes;
  }

  /** Copy the current competitor's stored ball/lie/strokes into this.state. */
  private syncStateFromComp(): void {
    const c = this.comps[this.turnIdx];
    this.state.ballPos = { ...c.ball };
    this.state.lie = c.lie;
    this.state.strokes = c.strokes;
  }

  /**
   * Choose who plays next via TurnManager ("away plays first" with
   * hysteresis, stroke-cap pickups). Returns false when the hole is over.
   */
  private advanceTurn(): boolean {
    const picked = this.tm.applyPickups(this.comps);
    if (round.mode !== 'solo') {
      picked.forEach((i) => showMsg(`${this.comps[i].part.golfer.name} picks up`, 1200));
    }
    const idx = this.tm.nextPlayer(this.comps);
    if (idx === null) return false;
    this.turnIdx = idx;
    this.showActiveCompetitor();
    this.syncStateFromComp();
    return true;
  }

  /** Show only the active golfer; park each ball at its stored lie. */
  private showActiveCompetitor(): void {
    this.golfers.forEach((g, i) => g.root.setEnabled(i === this.turnIdx));
    this.balls.forEach((b, i) => {
      const c = this.comps[i];
      b.position = w2b(c.ball.x, c.ball.y, this.ballRestH() + this.gh(c.ball.x, c.ball.y));
      b.setEnabled(!c.holed && (!this.tm.isScramble || i === this.turnIdx));
    });
  }

  private fwd3(yaw: number): Vector3 {
    return new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  // ------------------------------------------------------------- cameras

  private setCamSetup(): void {
    const f = this.fwd3(this.aim.yaw);
    const base = w2b(this.state.ballPos.x, this.state.ballPos.y, this.gh(this.state.ballPos.x, this.state.ballPos.y));
    const putt = this.aim.isPutting;
    if (this.aerial && !putt) {
      // Overhead planning view that ALWAYS frames the whole ball→pin corridor
      // (FB3): height scales with the span with no upper cap so the green is
      // in frame even on the longest holes. With the ~1.05 vertical fov the
      // ground coverage ≈ height, so height ≈ span·1.25 fits both ends + margin.
      const mx = (this.state.ballPos.x + this.hole.pin.x) / 2;
      const my = (this.state.ballPos.y + this.hole.pin.y) / 2;
      const span = Math.hypot(this.hole.pin.x - this.state.ballPos.x, this.hole.pin.y - this.state.ballPos.y);
      const height = Math.max(300, span * 1.25);
      const mid = w2b(mx, my, 0);
      // Aim the eye straight down the corridor from just behind the ball end.
      const toPin = this.fwd3(this.aim.yaw);
      this.camTarget.pos = mid.subtract(toPin.scale(span * 0.08)).add(new Vector3(0, height, 0.01));
      this.camTarget.look = mid;
      this.camTarget.k = 4;
      this.camTarget.fov = 1.05;
      return;
    }
    if (putt) {
      // Putting: a LOW, pulled-back, gently-telephoto vantage (behind the golfer,
      // near green level) so the roll stretches out and reads long instead of
      // foreshortening. Everything on the green is at honest scale — a ~6ft
      // golfer, a small ball, a ~2ft cup — so a 30-ft putt looks like 30 ft.
      const d = Math.hypot(this.hole.pin.x - this.state.ballPos.x, this.hole.pin.y - this.state.ballPos.y);
      const back = 8 + d * 0.34;
      const rise = 5 + d * 0.24;
      this.camTarget.pos = base.subtract(f.scale(back)).add(new Vector3(0, rise, 0));
      // Look most of the way to the cup so it sits high in the portrait frame,
      // with the whole ball→cup line below it.
      this.camTarget.look = base.add(f.scale(d * 0.72)).add(new Vector3(0, 0.35, 0));
      this.camTarget.k = 4;
      this.camTarget.fov = PUTT_VIEW.fov;
      return;
    }
    // Pitched-down vantage; pulled in a touch from behind/above the golfer so
    // the (larger) golfer reads clearly while the fairway still shows.
    this.camTarget.pos = base.subtract(f.scale(26)).add(new Vector3(0, 18, 0));
    this.camTarget.look = base.add(f.scale(70)).add(new Vector3(0, 1, 0));
    this.camTarget.k = 4;
    this.camTarget.fov = 1.05;
  }

  private setCamFlight(p: { x: number; y: number; z: number }, dir: number): void {
    const f = this.fwd3(dir);
    const pos3 = w2b(p.x, p.y, p.z + this.gh(p.x, p.y));
    // Sit a stable distance behind the ball and look AT it (only a short lead),
    // with a snappier follow gain — the old +26 look offset aimed far
    // down-range, which made the camera drift ahead of the ball, and the softer
    // gain trailed the ball so it read as laggy (playtest FB9).
    this.camTarget.pos = pos3.subtract(f.scale(15 + p.z * 0.22)).add(new Vector3(0, 8 + p.z * 0.4, 0));
    this.camTarget.look = pos3.add(f.scale(10)).add(new Vector3(0, 2 + p.z * 0.25, 0));
    this.camTarget.k = 9;
    this.camTarget.fov = 1.05;
  }

  private setCamLanding(p: { x: number; y: number }, dir: number): void {
    const f = this.fwd3(dir);
    const pos3 = w2b(p.x, p.y, this.gh(p.x, p.y));
    this.camTarget.pos = pos3.subtract(f.scale(26)).add(new Vector3(0, 9, 0));
    this.camTarget.look = pos3;
    this.camTarget.k = 4;
    this.camTarget.fov = 1.05;
  }

  /** Green approaches: 3/4 aerial view that frames the green as a target. */
  private setCamDescent(land: { x: number; y: number }, dir: number): void {
    const f = this.fwd3(dir);
    const pos3 = w2b(land.x, land.y, this.gh(land.x, land.y));
    this.camTarget.pos = pos3.subtract(f.scale(30)).add(new Vector3(0, 27, 0));
    this.camTarget.look = pos3.add(f.scale(5));
    this.camTarget.k = 5;
    this.camTarget.fov = 1.05;
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
    skipBtn.style.display = 'block'; // let the player skip the flyover
    this.aim.autoSelectClub(this.ctx());
    this.aim.resetAim(this.ctx());

    // A clean flyover that visibly TRAVELS from the TEE to the GREEN (FB9).
    // Staged waypoints (tee → mid-fairway → over the green) with gentle follow
    // gains so the whole length of the hole is seen — the old single fast lerp
    // reached the green within the first second, so it looked like it started
    // there.
    const toGreen = Math.atan2(h.pin.y - h.tee.y, h.pin.x - h.tee.x);
    const g = this.fwd3(toGreen);
    const teeH = this.gh(h.tee.x, h.tee.y);
    const midX = (h.tee.x + h.pin.x) / 2;
    const midY = (h.tee.y + h.pin.y) / 2;
    // Open LOW and tight right behind the tee, looking just down the line (not at
    // mid-hole) so the first frame unmistakably reads "at the tee" before the
    // camera glides downrange. (At the honest scale, the old high/mid-hole aim
    // read as an overview.)
    this.camera.position = w2b(h.tee.x, h.tee.y, 9 + teeH).subtract(g.scale(20));
    this.camera.setTarget(w2b(h.tee.x, h.tee.y, teeH + 2).add(g.scale(42)));

    // Waypoint 1: rise off the tee and glide down the fairway toward mid-hole.
    this.camTarget.pos = w2b(midX, midY, 52).subtract(g.scale(30));
    this.camTarget.look = w2b(h.pin.x, h.pin.y, this.gh(h.pin.x, h.pin.y));
    this.camTarget.k = 0.9;

    // Waypoint 2: continue up and over the green, looking down at the pin.
    this.introTimers.push(
      setTimeout(() => {
        if (this.disposed) return;
        this.camTarget.pos = w2b(h.pin.x, h.pin.y, 82).subtract(g.scale(26));
        this.camTarget.look = w2b(h.pin.x, h.pin.y, this.gh(h.pin.x, h.pin.y));
        this.camTarget.k = 0.85;
      }, 1600)
    );

    // Waypoint 3: pull back to the tee-shot framing and hand over control.
    this.introTimers.push(
      setTimeout(() => {
        if (this.disposed) return;
        bannerEl.style.opacity = '0';
        this.setCamSetup();
        this.camTarget.k = 1.3;
        this.introTimers.push(
          setTimeout(() => {
            if (!this.disposed) this.beginTurn();
          }, 900)
        );
      }, 3600)
    );
  }

  /** Cancel the intro flyover and hand control over immediately. */
  skipIntro(): void {
    this.introTimers.forEach((t) => clearTimeout(t));
    this.introTimers = [];
    bannerEl.style.opacity = '0';
    this.beginTurn();
  }

  /**
   * Screenshot-harness pose: put the hole into one of four fixed, reproducible
   * framings and snap the camera there (no lerp). See core/debugFlags.ts.
   */
  enterShotPose(cam: ShotCam): void {
    this.skipIntro();
    const h = this.hole;
    if (cam === 'green') {
      // Putting framing: ball on the green a comfortable putt from the cup
      const ang = Math.atan2(h.tee.y - h.pin.y, h.tee.x - h.pin.x);
      this.dropAt(h.pin.x + Math.cos(ang) * 22, h.pin.y + Math.sin(ang) * 22);
    } else if (cam === 'approach') {
      // Approach framing: ball in the fairway ~150yd out, then a raised 3/4
      // view that frames the whole green complex as the target
      const ang = Math.atan2(h.tee.y - h.pin.y, h.tee.x - h.pin.x);
      this.dropAt(h.pin.x + Math.cos(ang) * 300, h.pin.y + Math.sin(ang) * 300);
      const dir = Math.atan2(h.pin.y - this.state.ballPos.y, h.pin.x - this.state.ballPos.x);
      const f = this.fwd3(dir);
      const pin3 = w2b(h.pin.x, h.pin.y, this.gh(h.pin.x, h.pin.y));
      this.camTarget.pos = pin3.subtract(f.scale(210)).add(new Vector3(0, 100, 0));
      this.camTarget.look = pin3;
    } else if (cam === 'aerial') {
      this.aerial = true;
      this.setCamSetup();
    }
    // 'tee' keeps the default post-intro framing from beginTurn/dropAt.
    this.camera.position.copyFrom(this.camTarget.pos);
    this.camera.setTarget(this.camTarget.look.clone());
    if (isFrozen()) {
      // Hold character idle animation still for pixel-stable captures
      void this.bodiesReady.then(() => {
        this.scene.animationGroups.forEach((g) => g.pause());
      });
    }
  }

  // ---------------------------------------------------------------- turns

  /** Resting-ball centre height above the ground, tracking the current ball
   *  size so a shrunk putting ball still sits on the surface. */
  private ballRestH(): number {
    return HoleScene.BALL_REST * this.ballScale;
  }

  /** Apply the honest putting scale (or restore the readable big scale) to the
   *  active golfer and every ball mesh for this turn. */
  private applyViewScale(putting: boolean): void {
    this.golfer.setSizeMult(putting ? HoleScene.PUTT_GOLFER_SCALE : 1);
    this.ballScale = putting ? HoleScene.PUTT_BALL_SCALE : 1;
    this.balls.forEach((b) => b.scaling.setAll(this.ballScale));
  }

  beginTurn(): void {
    skipBtn.style.display = 'none'; // the flyover is over (skipped or finished)
    if (this.tm.isScramble) {
      // Scramble: both teammates attempt from the shared team ball; the
      // better result becomes the new team ball (TurnManager owns the state).
      if (this.tm.scrambleFinished) {
        this.finishHole();
        return;
      }
      this.turnIdx = this.tm.beginScrambleShot(this.comps);
      this.showActiveCompetitor();
      this.syncStateFromComp();
      this.state.strokes = this.tm.teamStrokes;
      showMsg(`${this.curPart().golfer.name} plays the team ball`, 1000);
    } else if (!this.advanceTurn()) {
      // Stroke play: pick who's away; if everyone has finished, hole's over.
      this.finishHole();
      return;
    }
    this.state.phase = 'aiming';
    // Anything inside gimme range is conceded before we ever arm the meter.
    if (this.tryGimme()) return;
    if (round.mode === '1v1') {
      showMsg(`${this.curPart().golfer.name} to play`, 900);
    }
    this.aim.autoSelectClub(this.ctx());
    this.aim.resetAim(this.ctx());
    this.applyViewScale(this.aim.isPutting);
    const bp = this.state.ballPos;
    this.golfer.placeAt(bp.x, bp.y, this.aim.yaw, this.gh(bp.x, bp.y));
    this.golfer.setPose(0);
    this.golfer.aiming = true;
    this.ball.position = w2b(bp.x, bp.y, this.ballRestH() + this.gh(bp.x, bp.y));
    this.puttGrid.setEnabled(this.aim.isPutting);
    this.course3d.greenRing.setEnabled(!this.ai && !this.aim.isPutting);
    this.setPinPulled(this.aim.isPutting);
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
    this.armMeter();
    clubBar.style.display = 'flex';
    aerialBtn.style.display = 'block';
    this.updateStrikeUI();
    this.refreshClubBar();
  }

  /** Show/refresh the strike pad for the current turn. */
  private updateStrikeUI(): void {
    const show = this.state.phase === 'aiming' && !this.ai && !this.aim.isPutting;
    shotShapeEl.style.display = show ? 'flex' : 'none';
    strikeDotEl.style.left = `${50 + this.strike.x * 38}%`;
    strikeDotEl.style.top = `${50 - this.strike.y * 38}%`;
  }

  /** Redraw the ground aim guide from the current aim + preview. */
  private updateAimVisuals(): void {
    if (this.state.phase !== 'aiming' || this.ai) {
      this.aimRoot.setEnabled(false);
      return;
    }
    this.aimRoot.setEnabled(true);
    // Preview shows the chosen SHAPE (curved draw/fade), on a flat windless
    // engine — the line never reveals wind/slope (FB1).
    this.aim.computePreview(this.ctx(), this.strike.shapeSpin, this.strike.launchMult);
    const path = this.aim.previewPath;
    const bx = this.state.ballPos.x;
    const by = this.state.ballPos.y;
    const span = Math.hypot(this.hole.pin.x - bx, this.hole.pin.y - by);
    const dotScale = this.aerial ? Math.min(9, Math.max(4, span / 120)) : 1;
    // Full shots: the dots/ring/readout mark the CARRY-LANDING (where the ball
    // first touches down, ~320yd for a big-hitter driver) — not the post-rollout
    // resting spot. So the number reads as carry (matches the GDD/expectation)
    // and the ball visibly rolls out past the ring; the player judges the roll.
    // Putts: a straight aim/pace line to the chosen spot (read break yourself).
    let landIdx = -1;
    if (path && path.length) {
      landIdx = path.findIndex((p, i) => i > 0 && p.z <= 0.01);
      if (landIdx < 0) landIdx = path.length - 1;
    }
    const target =
      this.aim.isPutting || landIdx < 0 ? this.aim.aimPoint(this.state.ballPos) : path![landIdx];
    const curved = !this.aim.isPutting && landIdx > 4;
    this.aimDots.forEach((dot, i) => {
      const f = (i + 1) / (this.aimDots.length + 1);
      let dx: number;
      let dy: number;
      if (curved) {
        const p = path![Math.min(landIdx, Math.round(f * landIdx))];
        dx = p.x;
        dy = p.y;
      } else {
        dx = bx + (target.x - bx) * f;
        dy = by + (target.y - by) * f;
      }
      dot.position = w2b(dx, dy, 0.12 + this.gh(dx, dy));
      dot.scaling.setAll(dotScale);
    });
    this.aimRing.position = w2b(target.x, target.y, 0.12 + this.gh(target.x, target.y));
    this.aimRing.scaling.setAll(dotScale);
    this.updateAimReadout(target);
  }

  /**
   * Tiger-style readout floating at the aim point: distance to the target
   * plus the elevation change (up/down arrow, in/ft) — the terrain info the
   * aim line deliberately hides, so the player can judge pace/club (FB2/FB4).
   */
  private updateAimReadout(target: { x: number; y: number }): void {
    const bx = this.state.ballPos.x;
    const by = this.state.ballPos.y;
    const dxp = target.x - bx;
    const dyp = target.y - by;
    const yd = Math.hypot(dxp, dyp) / PX_PER_YARD;
    const distLabel = this.aim.isPutting ? `${Math.round(yd * 3)} ft` : `${Math.round(yd)} yd`;
    let elevFt: number;
    if (this.aim.isPutting) {
      // Greens are flat-topped plateaus, so the terrain heightfield reads level
      // on the green — derive uphill/downhill from the authored green break
      // instead (slope.angle points DOWNHILL). Playtest FB9: the putt readout
      // must show up/down.
      const s = this.hole.slope;
      const len = Math.hypot(dxp, dyp) || 1;
      const distFt = (len / PX_PER_YARD) * 3;
      const downhill = (dxp * Math.cos(s.angle) + dyp * Math.sin(s.angle)) / len;
      elevFt = -downhill * distFt * s.strength * 0.09; // strength 1.0 ≈ a 9% grade
    } else {
      // Full shots: real terrain (world units → feet: 1 unit = 1.5 ft)
      elevFt = (this.engine2d.groundAt(target.x, target.y) - this.engine2d.groundAt(bx, by)) * 1.5;
    }
    let elevLabel = '';
    const shows = this.aim.isPutting ? Math.abs(elevFt) >= 0.08 : Math.abs(elevFt) >= 0.5;
    if (shows) {
      const mag = Math.abs(elevFt);
      const amount = mag < 1 ? `${Math.round(mag * 12)}"` : `${mag.toFixed(1)} ft`;
      elevLabel = `<span class="elev">${elevFt > 0 ? '▲ uphill' : '▼ downhill'} ${amount}</span>`;
    } else if (this.aim.isPutting) {
      elevLabel = `<span class="elev">• level</span>`;
    }
    aimReadoutEl.innerHTML = `<span>${distLabel}</span>${elevLabel}`;
    this.aimReadoutWorld = { x: target.x, y: target.y };
    aimReadoutEl.style.display = 'flex';
  }

  private cycleClub(dir: number): void {
    if (this.state.phase !== 'aiming' || this.ai || meter.isActive) return;
    this.aim.cycleClub(dir, this.ctx());
    this.puttGrid.setEnabled(this.aim.isPutting);
    this.course3d.greenRing.setEnabled(!this.aim.isPutting);
    this.setPinPulled(this.aim.isPutting);
    this.armMeter();
    this.updateStrikeUI();
    this.updateAimVisuals();
    this.updateHud();
    this.refreshClubBar();
  }

  private refreshClubBar(): void {
    clubName.textContent = this.aim.club.name;
  }

  /** Pull (hide) the flagstick while putting so a putt can't clatter the flag
   *  or hang up on the pin (playtest FB9). The open cup ring marks the hole. */
  private setPinPulled(pulled: boolean): void {
    this.course3d.pin.forEach((m) => m.setEnabled(!pulled));
  }

  /** Feet inside which a putt is conceded automatically (playtest FB9). */
  private static readonly GIMME_FEET = 3;

  /**
   * Concede anything inside GIMME range: the ball is picked up and counted as
   * holed with a single tap-in stroke — no putt required. Runs at the start of
   * a turn when the player is already on the green within range. Returns true
   * when the turn was consumed by the concession.
   */
  private tryGimme(): boolean {
    if (this.onFirstShot) return false; // ace challenge is a single shot — never conceded
    if (this.state.lie !== 'green') return false;
    const ft = (dist(this.state.ballPos, this.hole.pin) / PX_PER_YARD) * 3;
    if (ft > HoleScene.GIMME_FEET) return false;
    const origin = { ...this.state.ballPos };
    this.state.strokes += 1;
    const outcome: ShotOutcome = {
      path: [
        { x: origin.x, y: origin.y, z: 0 },
        { x: this.hole.pin.x, y: this.hole.pin.y, z: 0 }
      ],
      finalPos: { x: this.hole.pin.x, y: this.hole.pin.y },
      surface: 'green',
      waterPenalty: false,
      hitTrees: false,
      holed: true
    };
    this.ball.position = w2b(
      this.hole.pin.x,
      this.hole.pin.y,
      this.ballRestH() + this.gh(this.hole.pin.x, this.hole.pin.y)
    );
    play('putt');
    showMsg('Gimme — good!', 1100);
    this.updateHud();
    if (this.tm.isScramble) this.afterScrambleShot(outcome);
    else this.afterShot(outcome);
    return true;
  }

  private toggleAerial(): void {
    if (this.state.phase !== 'aiming' || this.ai) return;
    this.aerial = !this.aerial;
    aerialBtn.classList.toggle('on', this.aerial);
    this.setCamSetup();
    this.updateAimVisuals(); // rescale the aim dots/ring for the new altitude
  }

  /** The AI's chosen spin for its current shot (null = flat). */
  private aiSpin: { side: number; top: number } | null = null;

  /** AI opponent: pick a shot with AIController and play it (no meter). */
  private aiTurn(): void {
    promptEl.textContent = `${this.curPart().golfer.name} is playing…`;
    const decision = this.ai!.decide(this.state.ballPos, this.state.lie, this.wind, this.hole);
    this.aiSpin = decision.spin ?? null;
    this.aim.setClubById(decision.club.id);
    this.aim.yaw = decision.aimAngle;
    this.aim.distPx = dist(this.state.ballPos, decision.aimPoint);
    this.golfer.placeAt(this.state.ballPos.x, this.state.ballPos.y, this.aim.yaw, this.gh(this.state.ballPos.x, this.state.ballPos.y));
    this.puttGrid.setEnabled(this.aim.isPutting);
    this.setPinPulled(this.aim.isPutting);
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
      `<span class="chip">H${this.hole.number} · S${this.state.strokes}</span><span class="chip score">${scoreToPar(this.curPart())}</span></div>` +
      (round.mode !== 'solo'
        ? `<div class="row"><span class="chip player">${this.curPart().golfer.name}${this.curPart().isAI ? ' (to play)' : ' (you)'}</span></div>`
        : '');
  }

  // ---------------------------------------------------------------- shots

  private flightTimescale(): number {
    const fl = this.flight;
    if (!fl) return 1;
    const o = fl.outcome;
    // Dramatic slow-mo as a hole-out / ace approaches from distance: the last
    // stretch toward the cup crawls (and the screen shakes, see tick) — the
    // Tiger-Woods "is it going in?!" beat (FB6).
    const holingOut = o.holed && fl.landIdx > 20;
    if (fl.isPutt) {
      // Putts crawl as they near the cup so the read pays off (FB2)
      const p = fl.outcome.path[Math.min(Math.floor(fl.progress), fl.outcome.path.length - 1)];
      const dCup = Math.hypot(p.x - this.hole.pin.x, p.y - this.hole.pin.y);
      if (dCup < 14) return FLIGHT.puttTimescale * (holingOut ? 0.28 : 0.5);
      return FLIGHT.puttTimescale;
    }
    const greenFinish = o.holed || o.surface === 'green' || o.surface === 'fringe';
    if (fl.landed) {
      if (holingOut) {
        const p = fl.outcome.path[Math.min(Math.floor(fl.progress), fl.outcome.path.length - 1)];
        const dCup = Math.hypot(p.x - this.hole.pin.x, p.y - this.hole.pin.y);
        if (dCup < 20) return FLIGHT.greenRollTimescale * 0.35; // creeping to the cup
      }
      return greenFinish ? FLIGHT.greenRollTimescale : FLIGHT.rollTimescale;
    }
    if (!greenFinish) return FLIGHT.airTimescale;
    const frac = fl.landIdx > 0 ? fl.progress / fl.landIdx : 1;
    if (frac <= FLIGHT.approachRampFrac) return FLIGHT.airTimescale;
    const t = Math.min(1, (frac - FLIGHT.approachRampFrac) / (1 - FLIGHT.approachRampFrac));
    return FLIGHT.airTimescale + (FLIGHT.greenApproachTimescale - FLIGHT.airTimescale) * t;
  }

  executeShot(swing: SwingResult, powerIsPhysics = false): void {
    this.state.phase = 'swinging';
    this.aimRoot.setEnabled(false);
    this.course3d.greenRing.setEnabled(false);
    this.aerial = false;
    aerialBtn.classList.remove('on');
    clubBar.style.display = 'none';
    aerialBtn.style.display = 'none';
    shotShapeEl.style.display = 'none';
    aimReadoutEl.style.display = 'none';
    this.aimReadoutWorld = null;
    const club = this.aim.club;
    const fire = this.fires[this.turnIdx];
    // The meter reports bar units; the AI already reports physics power.
    const converted: SwingResult = powerIsPhysics
      ? swing
      : { ...swing, power: this.aim.barToPhysicsPower(swing.power, this.ctx()) };
    // Shot shaping applies to full shots only; resolve + integrate separately
    // so mid-flight swipes can re-shape the same resolved launch. The player's
    // pre-shot spin is the strike SHAPE (a fixed draw/fade); more spin is
    // added in-flight by swiping. The AI's spin comes from its decision.
    const shaping = !this.aim.isPutting;
    const spin = !shaping
      ? { side: 0, top: 0 }
      : this.ai
        ? { ...(this.aiSpin ?? { side: 0, top: 0 }) }
        : { ...this.strike.shapeSpin };
    const launchMult = !shaping ? 1 : this.ai ? 1 - spin.top * 0.18 : this.strike.launchMult;
    const launch = this.engine2d.resolveLaunch({
      origin: this.state.ballPos,
      aimAngle: this.aim.yaw,
      swing: converted,
      club,
      golfer: this.curPart().golfer,
      fireBoost: fire.statBoost,
      lie: this.state.lie,
      wind: this.wind,
      hole: this.hole,
      launchMult,
      riskMult: shaping && !this.ai ? this.strike.riskMult : 1
    });
    const outcome = this.engine2d.integrateLaunch(launch, spin, 0);
    this.strike.resetDot();
    // Feed the streak AFTER the shot resolves with the pre-shot boost
    if (fire.recordSwing(converted)) {
      showMsg(`🔥 ${this.curPart().golfer.name} is ON FIRE!`, 1600);
      play('fire');
    }
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
        const tmat = new StandardMaterial('trailMat', this.scene);
        // On-fire shots streak orange; otherwise the human's equipped trail
        // tint (AI keeps plain white). Phase 6 fire + Phase 7 store.
        const onFire = this.fires[this.turnIdx].isOnFire;
        const tint = this.comps[this.turnIdx].isAI ? 0xffffff : equippedColor(profile, 'trail', 0xffffff);
        tmat.emissiveColor = onFire ? new Color3(1, 0.55, 0.15) : c3(tint);
        tmat.diffuseColor = tmat.emissiveColor;
        tmat.alpha = onFire ? 0.55 : 0.35;
        trail.material = tmat;
      }
      this.flight = {
        outcome,
        progress: 0,
        landIdx,
        dir: this.aim.yaw,
        isPutt: club.id === 'putter',
        landed: false,
        trail,
        launch: shaping ? launch : null,
        spin
      };
      this.state.phase = 'flying';
      if (club.id !== 'putter') this.shakeT = 0.18;
    });
  }

  private afterShot(outcome: ShotOutcome): void {
    if (this.tm.isScramble) {
      this.afterScrambleShot(outcome);
      return;
    }
    const origin = { ...this.state.ballPos };
    const club = this.aim.club;
    const preLie = this.state.lie;
    if (!this.comps[this.turnIdx].isAI) this.accumulateShotStats(origin, preLie, club, outcome);
    this.state.ballPos = { ...outcome.finalPos };
    this.state.lie = outcome.surface;
    // Persist this shot's result back onto the competitor who played it
    const c = this.comps[this.turnIdx];
    c.ball = { ...outcome.finalPos };
    c.lie = outcome.surface;
    c.strokes = this.state.strokes;

    if (outcome.holed) {
      play('hole');
      c.holed = true;
      showMsg(`${this.curPart().golfer.name}: ${scoreName(this.state.strokes, this.hole.par)}`, 2200);
      if (this.state.strokes < this.hole.par) setTimeout(() => play('chime'), 450);
      // Per-hole reaction reflects the SCORE: happy at par or better, sad
      // over par (FB7). Eagles+ get the big Song Jump.
      this.golfer.react(this.holeReaction(this.state.strokes));
    } else if (outcome.waterPenalty) {
      play('splash');
      showMsg('SPLASH! +1 penalty', 1400);
      this.golfer.react('deject');
    } else if (!c.isAI) {
      this.showShotReadout(origin, outcome, club);
    }
    if (this.state.strokes >= RULES.maxStrokes && !c.holed) {
      showMsg(`Pick up — max ${RULES.maxStrokes}`, 1600);
      this.golfer.react('deject');
    }

    // Ace challenge: one tee shot per attempt — report the result and end the
    // attempt as soon as the ball settles, holed or not (Phase 8).
    if (this.onFirstShot) {
      this.state.phase = 'done';
      const holed = outcome.holed;
      setTimeout(() => {
        if (!this.disposed) this.onFirstShot!(holed);
      }, holed ? 2400 : 900);
      return;
    }

    // Hole over when every competitor has holed / picked up; otherwise the
    // away player plays next (which alternates naturally in a 1v1).
    const allDone = this.comps.every((cc) => this.compDone(cc));
    const delay = outcome.holed ? 2400 : 700;
    this.state.phase = allDone ? 'done' : this.state.phase;
    setTimeout(() => {
      if (this.disposed) return;
      if (allDone) this.finishHole();
      else this.beginTurn();
    }, delay);
  }

  /** Accumulate the human's shot-based round stats for progression (Phase 6). */
  private accumulateShotStats(
    origin: { x: number; y: number },
    preLie: HoleState['lie'],
    club: ClubSpec,
    outcome: ShotOutcome
  ): void {
    const teeShot = dist(origin, this.hole.tee) < 3;
    if (teeShot && this.hole.par >= 4) {
      shotAcc.fairwaysPossible++;
      if (['fairway', 'green', 'fringe'].includes(outcome.surface)) shotAcc.fairwaysHit++;
    }
    if (teeShot && (club.id === 'driver' || club.id === '3w' || club.id === '5w')) {
      shotAcc.longestDriveYds = Math.max(shotAcc.longestDriveYds, dist(origin, outcome.finalPos) / PX_PER_YARD);
    }
    // Green in regulation: reached the green with (par − 2) strokes or fewer
    if (
      (outcome.surface === 'green' || outcome.holed) &&
      this.state.strokes <= this.hole.par - 2 &&
      !shotAcc.girHoles.has(this.hole.number)
    ) {
      shotAcc.girHoles.add(this.hole.number);
      shotAcc.gir++;
    }
    if (outcome.holed && club.id === 'putter') {
      shotAcc.puttsMade++;
      shotAcc.longestPuttMadeFt = Math.max(shotAcc.longestPuttMadeFt, (dist(origin, this.hole.pin) / PX_PER_YARD) * 3);
    }
    if (outcome.holed && club.id !== 'putter' && preLie !== 'green') shotAcc.chipIns++;
  }

  /** Per-hole reaction from the score vs par (FB7). */
  private holeReaction(strokes: number): 'epic' | 'celebrate' | 'deject' {
    if (strokes <= this.hole.par - 2) return 'epic';
    if (strokes <= this.hole.par) return 'celebrate';
    return 'deject';
  }

  /**
   * Post-shot popup (FB4): a drive shows carry yards; an approach shows how
   * far it finished from the hole; a shot on/near the green shows feet to the
   * cup. Shown briefly for the human player's non-holed, dry shots.
   */
  private showShotReadout(origin: { x: number; y: number }, outcome: ShotOutcome, club: ClubSpec): void {
    const carryYd = Math.round(dist(origin, outcome.finalPos) / PX_PER_YARD);
    const toPinYd = this.engine2d.yardsToPin(outcome.finalPos);
    const onGreen = outcome.surface === 'green' || outcome.surface === 'fringe';
    const isDrive = (club.id === 'driver' || club.id === '3w' || club.id === '5w') && origin && this.state.strokes === 1;
    let msg: string;
    if (onGreen) {
      msg = `${Math.round(toPinYd * 3)} ft from the hole`;
    } else if (isDrive) {
      msg = `${carryYd} yd drive`;
    } else {
      msg = toPinYd < 30 ? `${Math.round(toPinYd * 3)} ft to the hole` : `${Math.round(toPinYd)} yd to the hole`;
    }
    showMsg(msg, 1600);
  }

  /** Scramble: collect both teammates' attempts, keep the better ball. */
  private afterScrambleShot(outcome: ShotOutcome): void {
    if (outcome.waterPenalty) {
      play('splash');
      showMsg(`${this.curPart().golfer.name} finds water`, 1200);
    }
    const bothIn = this.tm.recordScrambleOutcome(outcome);
    if (!bothIn) {
      // Teammate 2 plays from the same team ball
      setTimeout(() => {
        if (!this.disposed) this.beginTurn();
      }, outcome.holed ? 1600 : 800);
      return;
    }
    const { chooserIdx, chosen } = this.tm.resolveScramble(this.comps);
    this.comps.forEach((c) => {
      c.lie = this.tm.teamLie;
      c.strokes = this.tm.teamStrokes;
      c.holed = this.tm.teamHoled;
    });
    this.state.ballPos = { ...this.tm.teamBall };
    this.state.lie = this.tm.teamLie;
    this.state.strokes = this.tm.teamStrokes;
    if (chosen.holed) {
      play('hole');
      showMsg(`Team: ${scoreName(this.tm.teamStrokes, this.hole.par)}!`, 2200);
      this.golfers[chooserIdx].react(this.holeReaction(this.tm.teamStrokes));
    } else {
      showMsg(`Using ${this.comps[chooserIdx].part.golfer.name}'s ball`, 1300);
    }
    setTimeout(() => {
      if (this.disposed) return;
      if (this.tm.scrambleFinished) this.finishHole();
      else this.beginTurn();
    }, chosen.holed ? 2400 : 1000);
  }

  private finishHole(): void {
    this.state.phase = 'done';
    this.onHoleComplete(
      this.comps.map((c) => (this.tm.isScramble ? this.tm.teamStrokes : c.strokes))
    );
  }

  // ---------------------------------------------------------------- input

  private wireInput(): void {
    this.onSwingTap = (e: Event): void => {
      e.preventDefault();
      startAmbience();
      if (this.state.phase !== 'aiming') return;
      promptEl.textContent = '';
      if (!meter.isArmed) this.armMeter();
      meterEl.style.display = 'block';
      meter.handleTap();
    };
    swingBtn.addEventListener('pointerdown', this.onSwingTap);

    this.onPointerDown = (e: PointerEvent): void => {
      startAmbience();
      // Mid-flight: start a spin swipe (aerial spin window while the slowed
      // ball is still airborne — GDD Phase 4)
      if (this.state.phase === 'flying' && this.flight?.launch && !this.flight.landed && !this.flight.isPutt) {
        this.swipeLast = { x: e.clientX, y: e.clientY };
        return;
      }
      if (this.state.phase !== 'aiming' || meter.isActive) return;
      this.aim.beginDrag({ x: e.clientX, y: e.clientY });
    };
    this.onPointerMove = (e: PointerEvent): void => {
      if (this.swipeLast) {
        this.applySwipeSpin(e);
        return;
      }
      if (!this.aim.isDragging || this.state.phase !== 'aiming' || meter.isActive) return;
      // Horizontal rotates the aim; vertical moves it nearer/farther.
      if (!this.aim.moveDrag(this.ctx(), { x: e.clientX, y: e.clientY })) return;
      this.golfer.placeAt(this.state.ballPos.x, this.state.ballPos.y, this.aim.yaw, this.gh(this.state.ballPos.x, this.state.ballPos.y));
      this.setCamSetup();
      this.updateAimVisuals();
      this.updateHud();
      // Distance changed → the meter's power target moved; re-arm so the target
      // line (and putt scaling) track the new aim.
      if (meter.isArmed) this.armMeter();
    };
    this.onPointerUp = (): void => {
      this.swipeLast = null;
      this.aim.endDrag();
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.onPrevClub = () => this.cycleClub(-1);
    this.onNextClub = () => this.cycleClub(1);
    this.onAerial = () => this.toggleAerial();
    this.onSkip = (e) => {
      e.preventDefault();
      this.skipIntro();
    };
    document.getElementById('prevClub')!.addEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.addEventListener('pointerdown', this.onNextClub);
    aerialBtn.addEventListener('pointerdown', this.onAerial);
    skipBtn.addEventListener('pointerdown', this.onSkip);

    meter.onComplete = (result) => this.executeShot(result);
    meter.onBand = (kind, band) => {
      const label = band === 'perfect' ? 'PERFECT!' : band === 'good' ? 'Good' : 'Miss!';
      showMsg(`${kind === 'power' ? 'Power' : 'Accuracy'}: ${label}`, 500);
    };

    // Strike pad: drag the dot around the ball face
    this.onStrikeDown = (e: PointerEvent) => {
      e.stopPropagation();
      this.strikeDragging = true;
      this.moveStrike(e);
    };
    this.onStrikeMove = (e: PointerEvent) => {
      if (this.strikeDragging) this.moveStrike(e);
    };
    this.onStrikeUp = () => (this.strikeDragging = false);
    strikePadEl.addEventListener('pointerdown', this.onStrikeDown);
    window.addEventListener('pointermove', this.onStrikeMove);
    window.addEventListener('pointerup', this.onStrikeUp);
  }

  private moveStrike(e: PointerEvent): void {
    const r = strikePadEl.getBoundingClientRect();
    this.strike.setFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2);
    this.updateStrikeUI();
    // Recompute the aim preview so the dots curve with the chosen shape and the
    // launch height — previously the strike dot moved but the trajectory never
    // updated (playtest FB9).
    this.updateAimVisuals();
  }

  /** Mid-flight swipe: accumulate spin and re-shape the resolved launch. */
  private applySwipeSpin(e: PointerEvent): void {
    const fl = this.flight;
    if (!fl || !fl.launch || fl.landed || fl.isPutt || !this.swipeLast) {
      this.swipeLast = null;
      return;
    }
    const dx = e.clientX - this.swipeLast.x;
    const dy = e.clientY - this.swipeLast.y;
    this.swipeLast = { x: e.clientX, y: e.clientY };
    // Swipe sideways = curve; swipe down = backspin, up = topspin. CAPPED so a
    // hard topspin swipe can't turn a drive into a 440-yd runaway roll-out —
    // top ±1.5 still gives a strong run / backspin-check, side ±2.5 keeps
    // aggressive draw/fade shaping.
    const cap = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
    const ns = {
      side: cap(fl.spin.side + dx * 0.006, 2.5),
      top: cap(fl.spin.top - dy * 0.006, 1.5)
    };
    if (ns.side === fl.spin.side && ns.top === fl.spin.top) return;
    fl.spin = ns;
    const cur = Math.min(Math.floor(fl.progress), fl.outcome.path.length - 1);
    const reshaped = this.engine2d.integrateLaunch(fl.launch, ns, cur);
    fl.outcome = reshaped;
    let landIdx = reshaped.path.length - 1;
    for (let i = 5; i < reshaped.path.length; i++) {
      if (reshaped.path[i].z <= 0.001) {
        landIdx = i;
        break;
      }
    }
    fl.landIdx = landIdx;
    promptEl.textContent = `✨ spin ${ns.side >= 0 ? '→' : '←'}${Math.abs(ns.side).toFixed(1)} ${ns.top >= 0 ? '↟' : '↡'}${Math.abs(ns.top).toFixed(1)}`;
  }

  private onSwingTap!: (e: Event) => void;
  private onPointerDown!: (e: PointerEvent) => void;
  private onPointerMove!: (e: PointerEvent) => void;
  private onPointerUp!: () => void;
  private onPrevClub!: () => void;
  private onNextClub!: () => void;
  private onAerial!: () => void;
  private onSkip!: (e: Event) => void;
  private onStrikeDown!: (e: PointerEvent) => void;
  private onStrikeMove!: (e: PointerEvent) => void;
  private onStrikeUp!: () => void;

  // ----------------------------------------------------------------- loop

  private tick(): void {
    // Clamp the frame delta: a hitch (screen transition, GC, tab refocus) can
    // report a multi-hundred-ms delta that snaps every exponential-lerp toward
    // its target in one frame — that's what made the flyover appear to start
    // mid-fairway and jolted the ball. Cap at ~3 frames' worth.
    const dt = Math.min(0.05, engine3d.getDeltaTime() / 1000);

    // Float the aim readout over its world anchor (projected each frame so it
    // tracks the smoothing camera).
    if (this.aimReadoutWorld && this.state.phase === 'aiming' && !this.ai) {
      const wp = w2b(this.aimReadoutWorld.x, this.aimReadoutWorld.y, this.gh(this.aimReadoutWorld.x, this.aimReadoutWorld.y) + 4);
      const s = Vector3.Project(
        wp,
        Matrix.Identity(),
        this.scene.getTransformMatrix(),
        new Viewport(0, 0, engine3d.getRenderWidth(), engine3d.getRenderHeight())
      );
      const w = engine3d.getRenderWidth();
      const h = engine3d.getRenderHeight();
      // Show the readout whenever the aim point is IN FRONT of the camera. When
      // it projects outside the viewport (common — the pin often sits above the
      // top edge in the shot view), clamp the label to a screen-edge margin
      // instead of hiding it. Previously it vanished off-screen, which read as
      // "the readout only appears sometimes" (playtest FB9).
      if (s.z > 0 && s.z < 1) {
        aimReadoutEl.style.display = 'flex';
        const cx = Math.min(Math.max(s.x, w * 0.06), w * 0.94);
        const cy = Math.min(Math.max(s.y, h * 0.1), h * 0.9);
        aimReadoutEl.style.left = `${(cx / w) * 100}%`;
        aimReadoutEl.style.top = `${(cy / h) * 100}%`;
      } else {
        aimReadoutEl.style.display = 'none';
      }
    }

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
        // The physics path is sampled at a fixed 1/60s but playback advances
        // by a fractional index per rendered frame (slow-mo air = ~0.26/frame),
        // so snapping the mesh to the integer sample froze it for several frames
        // then hopped — the "laggy ball". Lerp to the next sample by the
        // fractional part for smooth motion. (Landing/camera logic below still
        // keys off the discrete sample `p`, which is what those thresholds want.)
        const pn = path[Math.min(i + 1, path.length - 1)];
        const frac = this.flight.progress - i;
        const bx = p.x + (pn.x - p.x) * frac;
        const by = p.y + (pn.y - p.y) * frac;
        const bz = p.z + (pn.z - p.z) * frac;
        this.ball.position = w2b(bx, by, bz + this.ballRestH() + this.gh(bx, by));
        const dCup = Math.hypot(p.x - this.hole.pin.x, p.y - this.hole.pin.y);
        // Putts: zoom the camera in tight as the ball nears the cup (FB2).
        if (this.flight.isPutt && dCup < 46) {
          const f = this.fwd3(this.flight.dir);
          const pos3 = w2b(p.x, p.y, this.gh(p.x, p.y));
          // Low, gently-telephoto tuck (matching the putt setup view) so the
          // roll's true length still reads while the ball creeps to the cup.
          this.camTarget.pos = pos3.subtract(f.scale(13)).add(new Vector3(0, 6, 0));
          this.camTarget.look = w2b(this.hole.pin.x, this.hole.pin.y, this.gh(this.hole.pin.x, this.hole.pin.y));
          this.camTarget.k = 6;
          this.camTarget.fov = PUTT_VIEW.fov;
        }
        // Building drama: as a hole-out/ace from distance creeps to the cup,
        // rumble the camera (FB6). Refreshed each frame → continuous shake.
        if (this.flight.outcome.holed && this.flight.landIdx > 20 && dCup < 26) {
          this.shakeT = Math.max(this.shakeT, 0.14);
        }
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
          // Only swap to the green-framing view in the final stretch, so the
          // camera keeps following the ball instead of jumping ahead to the
          // landing zone mid-flight (playtest FB9).
          if (greenFinish && frac > 0.8) {
            const land = path[this.flight.landIdx];
            this.setCamDescent({ x: land.x, y: land.y }, this.flight.dir);
          } else {
            this.setCamFlight(p, this.flight.dir);
          }
        }
      }
    }

    // Blob shadow tracks the ball's ground point (on the local built surface)
    const groundH = this.gh(this.ball.position.x, -this.ball.position.z);
    const hgt = Math.max(0, this.ball.position.y - this.ballRestH() - groundH);
    this.ballShadow.position.set(this.ball.position.x, groundH + 0.07, this.ball.position.z);
    // Track the ball size (smaller on the green) so the shadow never dwarfs the
    // now real-scale putting ball; it still grows with flight height.
    const spread = this.ballScale * (1 + Math.min(2.2, hgt * 0.014));
    this.ballShadow.scaling.set(spread, spread, spread);
    this.bsMat.alpha = 0.3 / (1 + hgt * 0.02);

    // Smooth the camera toward its target
    const k = 1 - Math.exp(-dt * this.camTarget.k);
    this.camera.position = Vector3.Lerp(this.camera.position, this.camTarget.pos, k);
    const look = this.camera.getTarget().clone();
    this.camera.setTarget(Vector3.Lerp(look, this.camTarget.look, k));
    // Lerp the field of view too — the putting view zooms in telephoto so the
    // real-scale (small) ball and cup stay readable while distances read long.
    this.camera.fov += (this.camTarget.fov - this.camera.fov) * k;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      // Reduced-motion players keep the slow-mo drama but not the camera rumble.
      if (!profile.settings.reducedMotion) {
        const amp = 0.3 * Math.max(0, this.shakeT) / 0.18;
        this.camera.position.addInPlace(
          new Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp)
        );
      }
    }
  }

  render(): void {
    this.scene.render();
  }

  /** Test hooks: drive the active golfer's swing pose / full swing directly. */
  poseActive(p: number): void {
    this.golfer.setPose(p);
  }
  swingActive(): void {
    this.golfer.swing();
  }

  /** Test hook: place the current competitor's ball anywhere and re-tee. */
  dropAt(x: number, y: number): void {
    const c = this.comps[this.turnIdx];
    c.ball = { x, y };
    c.lie = this.engine2d.surfaceAt(x, y);
    c.holed = false;
    c.strokes = 0;
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
    skipBtn.removeEventListener('pointerdown', this.onSkip);
    skipBtn.style.display = 'none';
    strikePadEl.removeEventListener('pointerdown', this.onStrikeDown);
    window.removeEventListener('pointermove', this.onStrikeMove);
    window.removeEventListener('pointerup', this.onStrikeUp);
    meter.onComplete = null;
    meter.hide();
    clubBar.style.display = 'none';
    aerialBtn.style.display = 'none';
    shotShapeEl.style.display = 'none';
    this.scene.dispose();
  }
}

// -------------------------------------------------------- round orchestration

let current: HoleScene | null = null;
const holesThisRound = (): number => Math.min(RULES.holesPerRound, round.course.holes.length);

/** Play one hole. Every competitor plays it in a single scene (alternating
 *  turns for 1v1/scramble); the callback returns each competitor's strokes. */
function playHole(): void {
  current?.dispose();
  current = new HoleScene((scores) => {
    round.players.forEach((p, i) => {
      p.scores[round.holeIdx] = scores[i] ?? 0;
    });
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
  const teamRow = '';
  if (round.mode === '1v1') {
    const me = totals[0];
    const them = totals[1];
    headline = me < them ? 'You win! 🏆' : me > them ? `${round.players[1].golfer.name} wins` : 'Tied match';
  } else if (round.mode === 'scramble') {
    // True scramble: both columns already carry the shared team score
    headline = `Team ${parLabel(totals[0])} 🤝`;
  }
  // Persist the round (local + shared leaderboard) — the human is player 0.
  const me = round.players[0];
  const record: RoundRecord = {
    id: makeRoundId(),
    d: Date.now(),
    course: round.course.name,
    mode: round.mode,
    names: round.players.map((p) => p.golfer.name).join(' & '),
    golferId: me.golfer.id,
    total: totals[0],
    toPar: totals[0] - totalPar,
    holes: me.scores.slice(0, holes.length)
  };
  // Records/coins only persist for a signed-in account (account-gated model):
  // a signed-out round still plays and shows its rewards, but nothing is saved.
  if (signedIn) saveRound(record);

  // Progression: build the round stats, award XP/coins/achievements/daily.
  const rstats = buildRoundStats(holes, me.scores, totals, totalPar);
  const events = applyRound(profile, rstats, todayKey());
  persistProfile();
  if (signedIn)
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status);
    });

  const tourBlock = round.tournament ? `<div id="tourResult" class="tourResult">Submitting to ${escapeHtml(round.tournament.name)}…</div>` : '';
  // Account-gated: signed-out rewards are shown but not kept — nudge to sign in.
  const signInNudge =
    !signedIn && authConfigured()
      ? `<div class="signInNudge">Sign in to keep these coins & save your progress.</div>`
      : '';
  summaryEl.innerHTML =
    `<h2>${headline}</h2>` +
    `<div id="recBanner" class="recBanner"></div>` +
    `<table><tr><th>Hole</th><th>Par</th>${headCols}</tr>${rows}${totalRow}${teamRow}</table>` +
    tourBlock +
    rewardStripHtml(events) +
    signInNudge +
    `<div class="btnRow"><button id="recBtn" class="ghostBtn">Records</button>` +
    `<button id="profBtn" class="ghostBtn">Profile</button>` +
    `<button id="againBtn">Menu</button></div>`;
  summaryEl.style.display = 'block';
  // Tournament: submit this round as the player's entry (first score stands)
  // and show the live standings (Phase 8).
  if (round.tournament) void submitTournamentRound(round.tournament.code, record, holes.length);
  document.getElementById('profBtn')!.addEventListener('pointerdown', () => renderProfile());
  document.getElementById('againBtn')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    showSetup();
  });
  document.getElementById('recBtn')!.addEventListener('pointerdown', () => renderRecords());
  // A new course record is confirmed against the merged (local+shared) list.
  fetchAllRounds().then(({ rounds }) => {
    const banner = document.getElementById('recBanner');
    if (banner && isNewRecord(rounds, record)) banner.textContent = '🏆 New course record!';
  });
}

/** Build the human player's round stats for progression (score + shot data). */
function buildRoundStats(holes: HoleData[], scores: number[], totals: number[], totalPar: number): RoundStats {
  const r = emptyRoundStats();
  let strokes = 0;
  holes.forEach((h, i) => {
    const s = scores[i] ?? h.par;
    strokes += s;
    const d = s - h.par;
    if (s === 1) r.holeInOnes++;
    else if (d <= -2) r.eagles++;
    else if (d === -1) r.birdies++;
    else if (d === 0) r.pars++;
    else r.bogeys++;
  });
  r.strokes = strokes;
  r.toPar = totals[0] - totalPar;
  r.fairwaysHit = shotAcc.fairwaysHit;
  r.fairwaysPossible = shotAcc.fairwaysPossible;
  r.greensInRegulation = shotAcc.gir;
  r.puttsMade = shotAcc.puttsMade;
  r.longestDriveYds = Math.round(shotAcc.longestDriveYds);
  r.longestPuttMadeFt = Math.round(shotAcc.longestPuttMadeFt);
  r.chipIns = shotAcc.chipIns;
  r.won = round.mode === '1v1' && totals.length > 1 && totals[0] < totals[1];
  return r;
}

/** The XP/coins/daily/achievement/level rewards strip for the summary. */
function rewardStripHtml(events: RewardEvent[]): string {
  const sum = (k: 'xp' | 'coins'): number =>
    events.filter((e): e is Extract<RewardEvent, { kind: 'xp' | 'coins' }> => e.kind === k).reduce((a, e) => a + e.amount, 0);
  let html =
    `<div class="rewardStrip"><span class="rw xp">+${sum('xp')} XP</span>` +
    `<span class="rw coin">+${sum('coins')} 🪙</span></div>`;
  const levels = events.filter((e) => e.kind === 'levelUp');
  if (levels.length) html += `<div class="rwLine level">⭐ Level ${(levels[levels.length - 1] as { level: number }).level}!</div>`;
  const daily = events.find((e) => e.kind === 'daily') as { name: string; streak: number } | undefined;
  if (daily) html += `<div class="rwLine daily">✅ Daily done: ${daily.name} · 🔥 ${daily.streak}-day streak</div>`;
  for (const a of events.filter((e): e is Extract<RewardEvent, { kind: 'achievement' }> => e.kind === 'achievement')) {
    html += `<div class="rwLine ach">🏅 ${a.name} — ${a.desc}</div>`;
  }
  return html;
}

/** Profile overlay: level ring, career stats and achievements (Phase 6). */
function renderProfile(): void {
  const p = profile;
  const s = p.stats;
  const cur = xpForLevel(p.level);
  const next = xpForLevel(p.level + 1);
  const pct = next > cur ? Math.round(((p.xp - cur) / (next - cur)) * 100) : 100;
  recordsEl.style.display = 'flex';
  recordsEl.innerHTML =
    `<div class="recInner"><h2>${escapeHtml(p.name || 'Golfer')}</h2>` +
    `<div class="profLvl">Level ${p.level} · ${p.coins} 🪙 · ${p.xp} XP</div>` +
    `<div class="xpBar"><i style="width:${pct}%"></i></div>` +
    `<div class="profStats">` +
    statCell(s.rounds, 'Rounds') +
    statCell(s.birdies, 'Birdies') +
    statCell(s.eagles, 'Eagles') +
    statCell(s.holeInOnes, 'Aces') +
    statCell(s.bestRoundToPar === null ? '—' : s.bestRoundToPar, 'Best') +
    statCell(Math.round(s.longestDriveYds), 'Long drive') +
    statCell(s.chipIns, 'Chip-ins') +
    statCell(s.wins, 'Wins') +
    `</div>` +
    `<div class="achList">` +
    ACHIEVEMENTS.map((a) => {
      const got = p.achievements.includes(a.id);
      return `<div class="achRow${got ? ' got' : ''}">${got ? '🏅' : '🔒'} <b>${a.name}</b> <span>${a.desc}</span></div>`;
    }).join('') +
    `</div>` +
    `<div class="profSettings">` +
    (authConfigured()
      ? `<div class="acctRow"><span id="acctStatus" class="acctStatus">Checking account…</span>` +
        `<button id="linkGoogle" class="ghostBtn">Sign in with Google</button></div>`
      : '') +
    `<label class="setRow"><span>Sound</span>` +
    `<input id="setSound" type="range" min="0" max="1" step="0.05" value="${p.settings.sound}" /></label>` +
    `<label class="setRow"><span>Ambience</span>` +
    `<input id="setAmbience" type="range" min="0" max="1" step="0.05" value="${p.settings.ambience}" /></label>` +
    `<label class="setRow"><span>Reduced motion</span>` +
    `<input id="setReducedMotion" type="checkbox" ${p.settings.reducedMotion ? 'checked' : ''} /></label>` +
    `<div id="resetZone" class="resetZone">` +
    `<button id="resetRecords" class="dangerBtn">Reset Records</button></div>` +
    `</div>` +
    `<button id="profBack">Back</button></div>`;
  document.getElementById('profBack')!.addEventListener('pointerdown', () => (recordsEl.style.display = 'none'));
  document.getElementById('setSound')!.addEventListener('input', (e) => {
    p.settings.sound = parseFloat((e.target as HTMLInputElement).value);
    persistProfile();
  });
  document.getElementById('setAmbience')!.addEventListener('input', (e) => {
    p.settings.ambience = parseFloat((e.target as HTMLInputElement).value);
    applyAmbienceVolume();
    persistProfile();
  });
  document.getElementById('setReducedMotion')!.addEventListener('change', (e) => {
    p.settings.reducedMotion = (e.target as HTMLInputElement).checked;
    persistProfile();
  });
  document.getElementById('resetRecords')!.addEventListener('pointerdown', confirmResetRecords);
  wireAccountRow();
}

/** Two-step Reset Records: the button swaps to an explicit confirm/cancel so a
 *  destructive wipe can't happen on a single tap (Phase 9; restored after the
 *  profile rework dropped it). Clears stats/scores, keeps coins + purchases. */
function confirmResetRecords(): void {
  const zone = document.getElementById('resetZone');
  if (!zone) return;
  const sharedNote = isShared() ? ` Scores already posted to the shared leaderboard stay there.` : '';
  zone.innerHTML =
    `<div class="resetWarn">Clear career stats, achievements, XP and local scores? ` +
    `Coins and unlocked items are kept.${sharedNote}</div>` +
    `<div class="btnRow"><button id="resetYes" class="dangerBtn">Yes, reset</button>` +
    `<button id="resetNo" class="ghostBtn">Cancel</button></div>`;
  document.getElementById('resetNo')!.addEventListener('pointerdown', () => renderProfile());
  document.getElementById('resetYes')!.addEventListener('pointerdown', () => {
    resetProfileRecords(profile, Date.now());
    persistProfile();
    clearLocalHistory();
    if (signedIn)
      void cloudSyncProfile(profile).then((res) => {
        applyCloudMerge(profile, res.profile);
        showCloudStatus(res.status, true);
      });
    updateDailyBanner();
    // Confirm in place and let the player close out. Re-rendering the whole
    // profile here used to tear down and rebuild the overlay (scroll jumped to
    // top), which read as being unexpectedly thrown back into the profile
    // screen — the cleared stats are shown next time Profile is opened.
    zone.innerHTML =
      `<div class="resetWarn">✓ Career records cleared.</div>` +
      `<div class="btnRow"><button id="resetDone" class="ghostBtn">Done</button></div>`;
    document.getElementById('resetDone')!.addEventListener('pointerdown', () => {
      recordsEl.style.display = 'none';
    });
  });
}

/** Cloud-account status + sign-in/out on the Profile overlay (account-gated).
 *  Only present when Firebase is configured; degrades quietly otherwise. */
function wireAccountRow(): void {
  const status = document.getElementById('acctStatus');
  const btn = document.getElementById('linkGoogle') as HTMLButtonElement | null;
  if (!status || !btn) return;
  if (signedIn) {
    void linkedAccountName().then((name) => {
      status.textContent =
        lastCloudStatus === 'denied'
          ? `✓ Signed in as ${name ?? 'your account'} — ⚠ cloud saves are FAILING (publish the DB rules, FIREBASE_SETUP.md)`
          : `✓ Signed in as ${name ?? 'your account'} — progress syncs across devices`;
    });
    btn.textContent = 'Log out';
    btn.onclick = () => {
      btn.disabled = true;
      void doSignOut().then(() => {
        renderAcctMenu();
        refreshWizardIfVisible();
        renderProfile(); // reopen the overlay reflecting the empty signed-out state
      });
    };
    return;
  }
  status.textContent = 'Sign in to save your coins & progress across devices.';
  btn.textContent = 'Sign in with Google';
  btn.onclick = () => {
    btn.disabled = true;
    status.textContent = 'Opening Google sign-in…';
    void signInWithGoogle().then((name) => {
      if (!name) {
        status.textContent = 'Sign-in was cancelled or unavailable.';
        btn.disabled = false;
        return;
      }
      if (name === 'redirect') {
        status.textContent = 'Redirecting to Google…';
        return;
      }
      void adoptCloudAccount().then(() => {
        renderAcctMenu();
        refreshWizardIfVisible();
        renderProfile(); // re-render with the account's coins/records now loaded
      });
    });
  };
}

function statCell(value: number | string, label: string): string {
  return `<div><b>${value}</b><span>${label}</span></div>`;
}

const storeEl = document.getElementById('store')!;
/** The Characters store section starts collapsed to two rows (playtest FB9). */
let storeCharsExpanded = false;
/** Character cards shown before "See more" (two rows of the 3-wide grid). */
const STORE_CHAR_PREVIEW = 6;
/** Item id awaiting the "Spend X coins?" confirmation (null = no popup). */
let pendingBuy: string | null = null;

/** Store overlay (Phase 7): buy/equip cosmetics + club upgrades with coins. */
function renderStore(): void {
  const p = profile;
  const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  const card = (item: StoreItem): string => {
    const owned = isOwned(p, item);
    const equipped = isEquippableKind(item.kind) && p.cosmetics.equipped[item.kind as CosmeticKind] === item.id;
    const affordable = canBuy(p, item).ok;
    const cls = equipped ? 'equipped' : owned ? 'owned' : affordable ? '' : 'locked';
    const swatch =
      item.color !== undefined ? `<div class="swatch" style="background:${hex(item.color)}"></div>` : `<div class="swatch" style="background:#2b6b41">⬆️</div>`;
    const label = item.kind === 'character' ? `<img src="ui/characters/${item.character}.png" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;object-position:50% 22%;border-radius:8px" />` : swatch;
    const price = equipped ? 'Equipped' : owned ? (isEquippableKind(item.kind) ? 'Tap to equip' : 'Owned') : `${item.price} 🪙`;
    return `<div class="storeCard ${cls}" data-item="${item.id}">${label}<div class="sName">${item.name}</div><div class="sPrice">${price}</div></div>`;
  };
  const section = (title: string, kind: StoreItem['kind']): string =>
    `<div class="storeTab">${title}</div><div class="storeGrid">${STORE_CATALOG.filter((i) => i.kind === kind).map(card).join('')}</div>`;
  // Characters collapse to two rows with a See-more toggle (there are 20+),
  // so the other categories stay reachable without a long scroll (FB9).
  const charItems = STORE_CATALOG.filter((i) => i.kind === 'character');
  const shownChars = storeCharsExpanded ? charItems : charItems.slice(0, STORE_CHAR_PREVIEW);
  const seeMore =
    charItems.length > STORE_CHAR_PREVIEW
      ? `<button id="charSeeMore" class="storeSeeMore">${storeCharsExpanded ? 'Show fewer ▴' : `See more (${charItems.length - STORE_CHAR_PREVIEW}) ▾`}</button>`
      : '';
  const charactersSection = `<div class="storeTab">Characters</div><div class="storeGrid">${shownChars.map(card).join('')}</div>${seeMore}`;
  // Purchases go through an explicit "Spend X coins?" confirmation so a
  // stray tap can never drain coins (equipping owned items stays one-tap).
  const pending = pendingBuy ? STORE_CATALOG.find((i) => i.id === pendingBuy) : undefined;
  const confirmPanel = pending
    ? `<div class="storeConfirm"><div class="storeConfirmBox">` +
      `<div class="scTitle">${pending.name}</div>` +
      `<div class="scAsk">Spend <b>${pending.price} 🪙</b> now?</div>` +
      `<div class="btnRow"><button id="buyYes">Buy · ${pending.price} 🪙</button>` +
      `<button id="buyNo" class="ghostBtn">Cancel</button></div></div></div>`
    : '';
  storeEl.style.display = 'flex';
  storeEl.innerHTML =
    `<div class="storeInner"><h2>Store</h2><div class="storeCoins">${p.coins} 🪙</div>` +
    (!signedIn && authConfigured() ? `<div class="signInNudge">Sign in to earn coins & keep purchases.</div>` : '') +
    `<div class="storeScroll">` +
    charactersSection +
    section('Outfit Colorways', 'outfit') +
    section('Ball Colors', 'ball') +
    section('Ball Trails', 'trail') +
    section('Club Skins', 'clubskin') +
    section('Club Upgrades', 'clubUpgrade') +
    `</div><button id="storeBack">Back</button>${confirmPanel}</div>`;
  const seeMoreBtn = document.getElementById('charSeeMore');
  if (seeMoreBtn)
    seeMoreBtn.addEventListener('pointerdown', () => {
      storeCharsExpanded = !storeCharsExpanded;
      renderStore();
    });
  const syncAfterChange = (): void => {
    persistProfile();
    if (signedIn)
      void cloudSyncProfile(p).then((res) => {
        applyCloudMerge(p, res.profile);
        showCloudStatus(res.status, true); // quiet on success — store taps are frequent
      });
    renderStore();
  };
  storeEl.querySelectorAll('.storeCard').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      const id = (el as HTMLElement).dataset.item!;
      const item = STORE_CATALOG.find((i) => i.id === id)!;
      if (isOwned(p, item)) {
        if (!isEquippableKind(item.kind)) return;
        equip(p, id);
        syncAfterChange();
        return;
      }
      // Not owned: arm the confirmation instead of buying outright. Items
      // that can't be bought keep the transient reason message.
      const can = canBuy(p, item);
      if (!can.ok) {
        showMsg(can.reason, 1200);
        return;
      }
      pendingBuy = id;
      renderStore();
    })
  );
  const buyYes = document.getElementById('buyYes');
  if (buyYes && pending) {
    buyYes.addEventListener('pointerdown', () => {
      pendingBuy = null;
      const r = buyItem(p, pending.id);
      if (!r.ok) {
        showMsg(r.reason, 1200);
        renderStore();
        return;
      }
      syncAfterChange();
    });
    document.getElementById('buyNo')!.addEventListener('pointerdown', () => {
      pendingBuy = null;
      renderStore();
    });
  }
  document.getElementById('storeBack')!.addEventListener('pointerdown', () => {
    pendingBuy = null;
    storeEl.style.display = 'none';
  });
}

/** Course whose records are open in the overlay (defaults to the round's). */
let recCourseId: string | null = null;

/** Records / leaderboard overlay: top rounds per course (tabs) + mode. */
async function renderRecords(): Promise<void> {
  recordsEl.style.display = 'flex';
  if (!recCourseId || !COURSES[recCourseId]) recCourseId = courseIdByName(round.course.name);
  const tabs = COURSE_LIST.map(
    (c) =>
      `<button class="recTab${c.id === recCourseId ? ' sel' : ''}" data-course="${c.id}">` +
      `${c.icon} ${COURSES[c.id].name}</button>`
  ).join('');
  recordsEl.innerHTML =
    `<div class="recInner"><h2>Records</h2>` +
    `<div class="recTabs">${tabs}</div>` +
    `<div id="recList" class="recList">Loading…</div>` +
    `<div id="recFoot" class="recFoot"></div>` +
    `<button id="recBack">Back</button></div>`;
  document.getElementById('recBack')!.addEventListener('pointerdown', () => {
    recordsEl.style.display = 'none';
  });
  // One fetch covers every course; the tabs just re-filter the list. Tabs are
  // live immediately — while the fetch is in flight they show "Loading…".
  let data: Awaited<ReturnType<typeof fetchAllRounds>>['rounds'] | null = null;
  const fill = (): void => {
    const listEl = document.getElementById('recList');
    if (!listEl) return;
    if (!data) {
      listEl.innerHTML = 'Loading…';
      return;
    }
    const best = bestRounds(data, COURSES[recCourseId!].name, round.mode, 5);
    listEl.innerHTML = best.length
      ? best
          .map((r, i) => {
            const sign = r.toPar === 0 ? 'E' : r.toPar > 0 ? `+${r.toPar}` : `${r.toPar}`;
            const rank = i === 0 ? '🏆' : `${i + 1}.`;
            return (
              `<div class="recRow"><span class="recRk">${rank}</span>` +
              `<span class="recNm">${r.names}</span>` +
              `<span class="recTot">${r.total} (${sign})</span>` +
              `<span class="recHoles">${r.holes.join('-')}</span></div>`
            );
          })
          .join('')
      : `<div class="recEmpty">No rounds yet — play one!</div>`;
  };
  recordsEl.querySelectorAll('.recTab').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      recCourseId = (el as HTMLElement).dataset.course!;
      recordsEl.querySelectorAll('.recTab').forEach((t) => t.classList.toggle('sel', t === el));
      fill();
    })
  );
  const { rounds, shared } = await fetchAllRounds();
  data = rounds;
  fill();
  const foot = document.getElementById('recFoot');
  if (foot) foot.textContent = shared ? '🌐 Shared leaderboard' : '📱 This device only';
}

// ------------------------------------------------ Phase 8: tournaments + aces

/** Index of a course's par 3 — the hole the Ace Challenge tees off. */
function par3Index(course: CourseData): number {
  return course.holes.findIndex((h) => h.par === 3);
}

function tournamentsEl(): HTMLElement {
  return document.getElementById('tournaments')!;
}
function acesEl(): HTMLElement {
  return document.getElementById('aces')!;
}
function closeOverlay(el: HTMLElement): void {
  el.style.display = 'none';
}

/** Tournament hub: create a new one or join by code. `preCode` boots straight
 *  into a shared `?t=CODE` link. */
/** Record a tournament in the player's history (newest first, deduped). */
function rememberTournament(code: string, name: string): void {
  profile.tournaments = [{ code, name }, ...profile.tournaments.filter((t) => t.code !== code)].slice(0, 30);
  persistProfile();
  if (signedIn)
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status, true);
    });
}

/** "My Tournaments" list: the events this player created or played, tap to reopen. */
function myTournamentsHtml(): string {
  if (!profile.tournaments.length) return '';
  const rows = profile.tournaments
    .slice(0, 8)
    .map(
      (t) =>
        `<button class="tourMineRow" data-code="${escapeHtml(t.code)}">` +
        `<span class="tourMineNm">🏁 ${escapeHtml(t.name)}</span>` +
        `<span class="tourMineCode">${escapeHtml(t.code)}</span></button>`
    )
    .join('');
  return `<div class="tourHeadRow">My Tournaments</div><div class="tourMineList">${rows}</div>`;
}

function renderTournaments(preCode?: string): void {
  const el = tournamentsEl();
  el.style.display = 'flex';
  if (!isShared()) {
    el.innerHTML =
      `<div class="recInner"><h2>Tournaments</h2>` +
      `<div class="recEmpty">Tournaments play over the shared leaderboard, which isn't configured on this build yet. ` +
      `See docs/FIREBASE_SETUP.md to connect one.</div>` +
      `<button id="tourBack">Back</button></div>`;
    document.getElementById('tourBack')!.addEventListener('pointerdown', () => closeOverlay(el));
    return;
  }
  el.innerHTML =
    `<div class="recInner"><h2>🏁 Tournaments</h2>` +
    `<div class="recSub">Everyone plays identical wind & pins. Lowest total wins.</div>` +
    `<button id="tourCreate" class="tourAction">➕ Create a tournament</button>` +
    `<div class="tourJoin"><input id="tourCode" type="text" maxlength="9" placeholder="JG-XXXXXX" ` +
    `autocomplete="off" autocapitalize="characters" value="${preCode ? escapeHtml(preCode) : ''}" />` +
    `<button id="tourJoinBtn">Join</button></div>` +
    myTournamentsHtml() +
    `<div id="tourBody" class="tourBody"></div>` +
    `<button id="tourBack">Back</button></div>`;
  document.getElementById('tourBack')!.addEventListener('pointerdown', () => closeOverlay(el));
  document.getElementById('tourCreate')!.addEventListener('pointerdown', () => createTournamentFlow());
  const codeInput = document.getElementById('tourCode') as HTMLInputElement;
  const join = (): void => {
    const code = codeInput.value.trim().toUpperCase();
    if (code) void openTournament(code);
  };
  document.getElementById('tourJoinBtn')!.addEventListener('pointerdown', join);
  el.querySelectorAll('.tourMineRow').forEach((row) =>
    row.addEventListener('pointerdown', () => {
      const code = (row as HTMLElement).dataset.code;
      if (code) void openTournament(code);
    })
  );
  codeInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') join();
  });
  if (preCode) void openTournament(preCode.toUpperCase());
}

/** Create a 7-day tournament, PUT it, and surface the shareable code. */
async function createTournamentFlow(): Promise<void> {
  const body = document.getElementById('tourBody');
  if (body) body.innerHTML = `<div class="recEmpty">Creating…</div>`;
  const now = Date.now();
  const course = COURSES[sel.courseId] ?? COURSES.wildwood;
  const meta: Tournament = {
    code: makeTournamentCode(),
    name: `${(profile.name || 'Player')}'s Cup`,
    course: course.name,
    holes: Math.min(RULES.holesPerRound, course.holes.length),
    createdBy: { id: profile.id, name: profile.name || 'Player' },
    createdAt: now,
    endsAt: now + 7 * 24 * 60 * 60 * 1000,
    seed: Math.floor(Math.random() * 1e9)
  };
  const ok = await createTournament(meta);
  if (!body) return;
  if (!ok) {
    body.innerHTML = `<div class="recEmpty">Couldn't create the tournament — check your connection.</div>`;
    return;
  }
  rememberTournament(meta.code, meta.name);
  const shareUrl = `${location.origin}${location.pathname}?t=${meta.code}`;
  body.innerHTML =
    `<div class="tourCode">${meta.code}</div>` +
    `<div class="recSub">Share this link — friends who open it join automatically.</div>` +
    `<div class="tourShare">${escapeHtml(shareUrl)}</div>` +
    `<button id="tourPlay" class="tourAction">Play my round →</button>`;
  document.getElementById('tourPlay')!.addEventListener('pointerdown', () => startTournamentRound(meta));
}

/** Fetch a tournament and show its standings + a Play button. */
async function openTournament(code: string): Promise<void> {
  const body = document.getElementById('tourBody');
  if (body) body.innerHTML = `<div class="recEmpty">Loading ${escapeHtml(code)}…</div>`;
  const data = await fetchTournament(code);
  if (!body) return;
  if (!data) {
    body.innerHTML = `<div class="recEmpty">No tournament found for ${escapeHtml(code)}.</div>`;
    return;
  }
  const standings = tournamentStandings(data.entries);
  const alreadyEntered = data.entries.some((e) => e.playerId === profile.id);
  const ended = isEnded(data.meta, Date.now());
  const myRank = standings.findIndex((e) => e.playerId === profile.id) + 1;
  const playBtn = !ended && !alreadyEntered ? `<button id="tourPlay" class="tourAction">Play my round →</button>` : '';
  const note = ended ? `<div class="recSub">This tournament has ended.</div>` : alreadyEntered ? `<div class="recSub">You've already posted a score.</div>` : '';
  body.innerHTML = renderStandingsHtml(data.meta, standings, myRank) + note + playBtn;
  const pb = document.getElementById('tourPlay');
  if (pb) pb.addEventListener('pointerdown', () => startTournamentRound(data.meta));
}

function renderStandingsHtml(meta: Tournament, standings: TournamentEntry[], myRank: number): string {
  const rows = standings.length
    ? standings
        .slice(0, 10)
        .map((e, i) => {
          const sign = e.toPar === 0 ? 'E' : e.toPar > 0 ? `+${e.toPar}` : `${e.toPar}`;
          const you = e.playerId === profile.id ? ' you' : '';
          const rank = i === 0 ? '🏆' : `${i + 1}.`;
          return (
            `<div class="recRow${you}"><span class="recRk">${rank}</span>` +
            `<span class="recNm">${escapeHtml(e.name)}</span>` +
            `<span class="recTot">${e.total} (${sign})</span></div>`
          );
        })
        .join('')
    : `<div class="recEmpty">No scores yet — be the first!</div>`;
  const status = isEnded(meta, Date.now()) ? 'Final' : 'In progress';
  const rank = myRank > 0 ? ` · You: ${myRank}/${standings.length}` : '';
  return `<div class="tourHeadRow">🏁 ${escapeHtml(meta.name)} — ${status}${rank}</div>${rows}`;
}

/** Start a solo round under a tournament's shared seed (Phase 8). */
function startTournamentRound(meta: Tournament): void {
  rememberTournament(meta.code, meta.name);
  round.course = COURSES[courseIdByName(meta.course)];
  round.mode = 'solo';
  round.holeIdx = 0;
  round.activePlayer = 0;
  round.holeWinds = [];
  round.seed = meta.seed;
  round.tournament = { code: meta.code, name: meta.name };
  shotAcc = freshShotAcc();
  const golfer = assembleGolfer(profile.name || 'Player', sel.character, sel.archetype, profile.clubUpgrades);
  round.players = [{ golfer, isAI: false, scores: [] }];
  closeOverlay(tournamentsEl());
  setupEl.style.display = 'none';
  playHole();
}

/** Submit the finished round as a tournament entry and show live standings. */
async function submitTournamentRound(code: string, record: RoundRecord, holeCount: number): Promise<void> {
  const el = document.getElementById('tourResult');
  const entry: TournamentEntry = {
    playerId: profile.id,
    name: profile.name || 'Player',
    golferId: record.golferId,
    total: record.total,
    toPar: record.toPar,
    holes: record.holes.slice(0, holeCount),
    submittedAt: Date.now()
  };
  if (!isShared()) {
    if (el) el.textContent = 'Tournament scores need an online connection.';
    return;
  }
  if (!isPlausibleEntry(entry, holeCount, RULES.maxStrokes)) {
    if (el) el.textContent = 'Score could not be submitted.';
    return;
  }
  await submitEntry(code, entry);
  const data = await fetchTournament(code);
  if (!el) return;
  if (!data) {
    el.textContent = 'Standings unavailable right now.';
    return;
  }
  const standings = tournamentStandings(data.entries);
  const myRank = standings.findIndex((e) => e.playerId === profile.id) + 1;
  el.innerHTML = renderStandingsHtml(data.meta, standings, myRank);
}

// ----- Ace challenge: tee off a par 3 on repeat, chase all-time hole-in-ones.

let acesSession: { attempts: number; aces: number } | null = null;

async function renderAcesMenu(): Promise<void> {
  const el = acesEl();
  el.style.display = 'flex';
  const par3 = round.course.holes.find((h) => h.par === 3);
  el.innerHTML =
    `<div class="recInner"><h2>🎯 Ace Challenge</h2>` +
    `<div class="recSub">Tee off ${par3?.name ?? 'a par 3'} again and again. ` +
    `Every hole-in-one counts toward the all-time board.</div>` +
    `<button id="aceStart" class="tourAction">Start teeing off →</button>` +
    `<div class="tourHeadRow">All-time aces</div>` +
    `<div id="aceBoard" class="recList">${isShared() ? 'Loading…' : '📱 Connect online to compete on the global board.'}</div>` +
    `<button id="aceBack">Back</button></div>`;
  document.getElementById('aceBack')!.addEventListener('pointerdown', () => closeOverlay(el));
  document.getElementById('aceStart')!.addEventListener('pointerdown', () => startAces());
  if (isShared()) {
    const recs = await fetchAces();
    const board = document.getElementById('aceBoard');
    if (board) {
      board.innerHTML = recs.length
        ? recs
            .slice(0, 10)
            .map((r, i) => {
              const you = r.playerId === profile.id ? ' you' : '';
              const rank = i === 0 ? '🏆' : `${i + 1}.`;
              return `<div class="recRow${you}"><span class="recRk">${rank}</span><span class="recNm">${escapeHtml(r.name)}</span><span class="recTot">${r.aces} 🕳️</span></div>`;
            })
            .join('')
        : `<div class="recEmpty">No aces recorded yet — go make history.</div>`;
    }
  }
}

function startAces(): void {
  // Tee off the selected course's par 3 (chosen on the wizard's Course step);
  // falls back to Wildwood so the results-screen "tee off again" always works.
  const course = COURSES[sel.courseId] ?? COURSES.wildwood;
  const holeIdx = par3Index(course);
  if (holeIdx < 0) return;
  acesSession = { attempts: 0, aces: 0 };
  round.course = course;
  round.mode = 'solo'; // an ace attempt runs as a single solo hole internally
  round.holeIdx = holeIdx;
  round.activePlayer = 0;
  round.holeWinds = [];
  round.seed = undefined;
  round.tournament = null;
  shotAcc = freshShotAcc();
  const golfer = assembleGolfer(sel.name || profile.name || 'Player', sel.character, sel.archetype, profile.clubUpgrades);
  round.players = [{ golfer, isAI: false, scores: [] }];
  closeOverlay(acesEl());
  setupEl.style.display = 'none';
  playAceAttempt();
}

function playAceAttempt(): void {
  current?.dispose();
  // Fresh wind each attempt for variety.
  round.holeWinds = [];
  current = new HoleScene(
    () => undefined,
    (holed) => {
      if (!acesSession) return;
      acesSession.attempts++;
      if (holed) {
        acesSession.aces++;
        profile.stats.holeInOnes++;
        persistProfile();
      }
      showAceInterstitial(holed);
    }
  );
  exposeDebug();
}

function showAceInterstitial(holed: boolean): void {
  const s = acesSession!;
  summaryEl.innerHTML =
    `<h2>${holed ? '🕳️ ACE! 🎉' : 'No luck that time'}</h2>` +
    `<div class="aceTally">Attempts: <b>${s.attempts}</b> · Aces: <b>${s.aces}</b></div>` +
    `<div class="btnRow"><button id="aceAgain">Tee off again</button>` +
    `<button id="aceDone" class="ghostBtn">Done</button></div>`;
  summaryEl.style.display = 'block';
  document.getElementById('aceAgain')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    playAceAttempt();
  });
  document.getElementById('aceDone')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    void endAces();
  });
}

async function endAces(): Promise<void> {
  const s = acesSession;
  acesSession = null;
  current?.dispose();
  current = null;
  if (s && s.aces > 0 && isShared()) {
    await submitAces({ playerId: profile.id, name: profile.name || 'Player', aces: profile.stats.holeInOnes, updatedAt: Date.now() });
  }
  void renderAcesMenu();
}

engine3d.runRenderLoop(() => current?.render());
window.addEventListener('resize', () => engine3d.resize());

// Perf probe for the Playwright FPS baseline (Phase 9).
(window as unknown as { __fps: () => number }).__fps = () => engine3d.getFps();

// Debug/automation handle for the Playwright verification scripts
function exposeDebug(): void {
  (window as unknown as { __slice3d: unknown }).__slice3d = current
    ? {
        meter,
        aim: current.aim,
        state: current.state,
        scene: current.scene,
        mode: round.mode,
        bodiesReady: current.bodiesReady,
        dropAt: (x: number, y: number) => current?.dropAt(x, y),
        poseActive: (p: number) => current?.poseActive(p),
        swingActive: () => current?.swingActive(),
        skipIntro: () => current?.skipIntro()
      }
    : null;
}

// ------------------------------------------------------------- setup menu

const setupEl = document.getElementById('setup')!;
const recordsEl = document.getElementById('records')!;
const stepsEl = document.getElementById('steps')!;
const stepBodyEl = document.getElementById('stepBody')!;
const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;

/**
 * Fold a resolved cloud-sync result back into a LIVE profile object. Because
 * cloudSyncProfile is async, the local profile can change (a coin spend, a
 * finished round) between a sync starting and its promise resolving — a blind
 * Object.assign would then clobber that fresh local change with the stale
 * pre-sync snapshot the cloud round-tripped. Re-merging with mergeProfiles
 * keeps whichever copy is newer for spendable fields (coins) while still
 * unioning collections, so late-resolving syncs can't undo a recent spend.
 */
function applyCloudMerge(live: PlayerProfile, cloud: PlayerProfile): void {
  Object.assign(live, mergeProfiles(live, cloud));
  persistProfile();
}

/** Persistent player profile — selections, currency, progression, stats. */
/**
 * Account-gated progression (docs 08). The LIVE profile starts EMPTY: signed-out
 * play shows no coins/records and persists nothing. Progress only exists once the
 * player signs in with Google, at which point the cloud account becomes live.
 *
 *  - `legacyLocal` holds any pre-existing local progress (from before accounts
 *    were gated, or a prior signed-in session's cache). It is NOT shown while
 *    signed out; it's kept aside for a one-time merge into the account on the
 *    first sign-in, so switching to an account never loses current coins.
 *  - `signedIn` gates every local persist and cloud write.
 */
const legacyLocal: PlayerProfile = loadProfile();
const profile: PlayerProfile = defaultProfile();
let signedIn = false;
/** Guard so the one-time legacy→account merge runs at most once per session. */
let legacyMerged = false;

/** Persist the profile locally ONLY when signed in — a signed-out session is
 *  ephemeral and must write nothing (account-gated model). */
function persistProfile(): void {
  if (signedIn) saveProfile(profile);
}

/**
 * Adopt the signed-in player's cloud account as the live profile. On the first
 * sign-in this device, fold any pre-existing local progress up first (grow-only
 * merge, nothing lost), then pull+merge+push the cloud copy.
 */
async function adoptCloudAccount(): Promise<void> {
  if (!legacyMerged) {
    Object.assign(profile, mergeProfiles(profile, legacyLocal));
    legacyMerged = true;
  }
  signedIn = true; // enable persistence before the sync writes back
  const res = await cloudSyncProfile(profile);
  Object.assign(profile, res.profile);
  saveProfile(profile); // cache the account locally for offline/reload
  showCloudStatus(res.status);
  syncSelFromProfile();
}

/** Sign out: return to a clean slate. Wipe the local view + persisted data so a
 *  signed-out browser shows no coins/records; the account stays safe in the
 *  cloud under its uid and returns on next sign-in. */
async function doSignOut(): Promise<void> {
  await signOutAccount();
  signedIn = false;
  // Don't resurrect the previous account's local data into a later sign-in.
  legacyMerged = true;
  clearLocalProfile();
  clearLocalHistory();
  Object.assign(profile, defaultProfile());
  syncSelFromProfile();
}

/** Re-prefill the setup wizard from the live profile (after a cloud adopt or a
 *  sign-out reset) so name/character/style reflect the current account. */
function syncSelFromProfile(): void {
  sel.name = profile.name;
  sel.character = (profile.character as CharacterKey) || (CHARACTERS[0].key as CharacterKey);
  sel.archetype = (profile.archetype as ArchetypeId) || (ARCHETYPES[0].id as ArchetypeId);
}

/** Re-render the visible setup wizard so a sign-in/sign-out actually clears (or
 *  loads) the on-screen name/character — not just the account button. Without
 *  this the wizard's Name field keeps showing the previous account's name. */
function refreshWizardIfVisible(): void {
  if (setupEl.style.display !== 'none') goStep(sel.step);
}

// On boot, adopt the account only if a real Google session persists; otherwise
// stay on the empty guest view and prompt the player to sign in.
void (async () => {
  if (authConfigured() && (await isSignedIn())) {
    await adoptCloudAccount();
  }
  renderAcctMenu();
})();

/** The setup choices, prefilled from the profile so returning players jump
 *  straight to "Tee off". */
const sel = {
  step: 0,
  mode: 'solo' as GameMode,
  courseId: 'wildwood',
  name: profile.name,
  character: (profile.character as CharacterKey) || (CHARACTERS[0].key as CharacterKey),
  archetype: (profile.archetype as ArchetypeId) || (ARCHETYPES[0].id as ArchetypeId),
  opponentId: OPPONENTS[1].id
};

/** Solo & Ace rounds skip the rival step; 1v1/scramble add it at the end. On
 *  the Ace Challenge the Course step chooses which course's par 3 you tee off. */
function stepLabels(): string[] {
  return sel.mode === 'solo' || sel.mode === 'aces'
    ? ['Mode', 'Course', 'Name', 'Character', 'Style']
    : ['Mode', 'Course', 'Name', 'Character', 'Style', sel.mode === '1v1' ? 'Rival' : 'Partner'];
}

const STAT_KEYS: Array<[StatKey, string]> = [
  ['drivingPower', 'PWR'],
  ['drivingAccuracy', 'ACC'],
  ['approach', 'APP'],
  ['chipping', 'CHP'],
  ['putting', 'PUT']
];

function ovr(s: GolferStats): number {
  return Math.round((s.drivingPower + s.drivingAccuracy + s.approach + s.chipping + s.putting) / 5);
}

function statBars(stats: GolferStats, signature?: StatKey): string {
  return (
    `<div class="stats">` +
    STAT_KEYS.map(
      ([k, label]) =>
        `<div class="stat${k === signature ? ' sig' : ''}"><span class="sl">${label}</span>` +
        `<span class="sbar"><i style="width:${stats[k]}%"></i></span>` +
        `<span class="sv">${stats[k]}</span></div>`
    ).join('') +
    `</div>`
  );
}

function renderSteps(): void {
  stepsEl.innerHTML = stepLabels()
    .map(
      (label, i) =>
        `<div class="sdot${i === sel.step ? ' on' : i < sel.step ? ' done' : ''}">` +
        `<span class="num">${i < sel.step ? '✓' : i + 1}</span>${label}</div>`
    )
    .join('');
}

const MODES: Array<{ id: GameMode; name: string; desc: string; icon: string }> = [
  { id: 'solo', name: 'Solo Round', desc: 'Three holes, you against the course.', icon: '⛳' },
  { id: '1v1', name: '1 vs 1', desc: 'Match an AI rival, lowest total wins.', icon: '⚔️' },
  { id: 'scramble', name: 'Scramble', desc: 'Team up with an AI partner — best ball counts.', icon: '🤝' },
  { id: 'aces', name: 'Ace Challenge', desc: 'Tee off a par 3 over and over — chase a hole-in-one.', icon: '🎯' }
];

function renderMode(): void {
  stepBodyEl.innerHTML =
    `<div class="stepTitle">How do you want to play?</div>` +
    `<div class="modeGrid">` +
    MODES.map(
      (m) =>
        `<div class="archCard modeCard${sel.mode === m.id ? ' sel' : ''}" data-mode="${m.id}">` +
        `<div class="ahead"><span class="an">${m.icon} ${m.name}</span></div>` +
        `<div class="stepHint" style="margin:6px 0 0">${m.desc}</div></div>`
    ).join('') +
    `</div>`;
  stepBodyEl.querySelectorAll('.modeCard').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.mode = (el as HTMLElement).dataset.mode as GameMode;
      renderSteps();
      renderMode();
      updateNav();
    })
  );
}

function renderCourse(): void {
  const aces = sel.mode === 'aces';
  stepBodyEl.innerHTML =
    `<div class="stepTitle">${aces ? 'Pick a par 3 to attack' : 'Choose your course'}</div>` +
    `<div class="modeGrid">` +
    COURSE_LIST.map((c) => {
      const course = COURSES[c.id];
      const par3 = course.holes.find((h) => h.par === 3);
      // Ace mode: the card names the course's par 3 (the hole you'll tee off);
      // otherwise it shows the 3-hole par as usual.
      const tag = aces ? `Par 3 · ${par3?.yardage ?? ''}yd` : `Par ${course.holes.slice(0, Math.min(RULES.holesPerRound, course.holes.length)).reduce((a, h) => a + h.par, 0)}`;
      const sub = aces ? `${par3?.name ?? 'Par 3'} — ${c.name}` : c.tag;
      return (
        `<div class="archCard modeCard${sel.courseId === c.id ? ' sel' : ''}" data-course="${c.id}">` +
        `<div class="ahead"><span class="an">${c.icon} ${c.name}</span>` +
        `<span class="atag">${tag}</span></div>` +
        `<div class="stepHint" style="margin:6px 0 0">${sub}</div></div>`
      );
    }).join('') +
    `</div>`;
  stepBodyEl.querySelectorAll('.modeCard').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.courseId = (el as HTMLElement).dataset.course!;
      // The menu subtitle stays "3 Hole Challenge" (playtest FB9) — it no longer
      // echoes the selected course name.
      renderCourse();
    })
  );
}

function renderOpponent(): void {
  const role = sel.mode === '1v1' ? 'rival' : 'partner';
  stepBodyEl.innerHTML =
    `<div class="stepTitle">Choose your ${role}</div>` +
    `<div class="stepHint">Each attacks the course differently.</div>` +
    `<div class="archGrid">` +
    OPPONENTS.map((o) => {
      const hx = `#${(o.color & 0xffffff).toString(16).padStart(6, '0')}`;
      return (
        `<div class="archCard oppCard${sel.opponentId === o.id ? ' sel' : ''}" data-opp="${o.id}" style="--accent:${hx}">` +
        `<div class="ahead"><span class="an">${o.name}</span>` +
        `<span class="atag">${o.difficulty}</span>` +
        `<span class="aovr">OVR ${ovr(o.stats)}</span></div>` +
        `<div class="stepHint" style="margin:4px 0 6px">${o.tagline}</div>` +
        statBars(o.stats) +
        `</div>`
      );
    }).join('') +
    `</div>`;
  stepBodyEl.querySelectorAll('.oppCard').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.opponentId = (el as HTMLElement).dataset.opp!;
      renderOpponent();
    })
  );
}

function renderName(): void {
  stepBodyEl.innerHTML =
    `<div class="stepTitle">Who's playing?</div>` +
    `<div class="stepHint">Enter your name for the scorecard.</div>` +
    `<input id="nameInput" type="text" maxlength="16" placeholder="Your name"
       autocomplete="off" autocapitalize="words" value="${escapeHtml(sel.name)}" />`;
  const input = document.getElementById('nameInput') as HTMLInputElement;
  input.addEventListener('input', () => {
    sel.name = input.value;
    updateNav();
  });
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && sel.name.trim()) goStep(sel.step + 1);
  });
  setTimeout(() => input.focus(), 30);
}

function renderCharacter(): void {
  // Only OWNED characters here (playtest FB9): showing locked cards that routed
  // to the Store on tap made the grid feel touchy while scrolling. Unlock more
  // in the Store; a purchased character then appears here.
  const owned = CHARACTERS.filter((ch) => profile.cosmetics.owned.includes(`char_${ch.key}`));
  if (!owned.some((c) => c.key === sel.character)) sel.character = owned[0]?.key ?? CHARACTERS[0].key;
  stepBodyEl.innerHTML =
    `<div class="stepTitle">Pick your character</div>` +
    `<div class="stepHint">Just for looks — unlock more in the Store.</div>` +
    `<div class="charGrid">` +
    owned
      .map(
        (ch) =>
          `<div class="charCard${sel.character === ch.key ? ' sel' : ''}" data-ch="${ch.key}">` +
          `<img src="ui/characters/${ch.key}.png" alt="${ch.name}" />` +
          `<div class="cn">${ch.name}</div></div>`
      )
      .join('') +
    `</div>`;
  stepBodyEl.querySelectorAll('.charCard').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.character = (el as HTMLElement).dataset.ch as CharacterKey;
      renderCharacter();
    })
  );
}

function renderArchetype(): void {
  stepBodyEl.innerHTML =
    `<div class="stepTitle">Choose your style</div>` +
    `<div class="stepHint">Each is elite in one area, solid everywhere else.</div>` +
    `<div class="archGrid">` +
    ARCHETYPES.map((a) => {
      const hx = `#${(a.color & 0xffffff).toString(16).padStart(6, '0')}`;
      return (
        `<div class="archCard${sel.archetype === a.id ? ' sel' : ''}" data-arch="${a.id}" style="--accent:${hx}">` +
        `<div class="ahead"><span class="an">${a.name}</span>` +
        `<span class="atag">${a.tagline}</span>` +
        `<span class="aovr">OVR ${ovr(a.stats)}</span></div>` +
        statBars(a.stats, a.signature) +
        `</div>`
      );
    }).join('') +
    `</div>`;
  stepBodyEl.querySelectorAll('.archCard').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.archetype = (el as HTMLElement).dataset.arch as ArchetypeId;
      renderArchetype();
    })
  );
}

function renderStepBody(): void {
  const label = stepLabels()[sel.step];
  if (label === 'Mode') renderMode();
  else if (label === 'Course') renderCourse();
  else if (label === 'Name') renderName();
  else if (label === 'Character') renderCharacter();
  else if (label === 'Style') renderArchetype();
  else renderOpponent();
}

function updateNav(): void {
  backBtn.style.visibility = sel.step === 0 ? 'hidden' : 'visible';
  nextBtn.textContent = sel.step === stepLabels().length - 1 ? 'Tee off' : 'Next';
  nextBtn.disabled = stepLabels()[sel.step] === 'Name' && sel.name.trim().length === 0;
}

function goStep(n: number): void {
  sel.step = Math.max(0, Math.min(stepLabels().length - 1, n));
  renderSteps();
  renderStepBody();
  updateNav();
}

function showSetup(): void {
  setupEl.style.display = 'flex';
  updateDailyBanner();
  goStep(0);
}

/** Today's daily challenge + streak, shown on the menu (Phase 6). */
function updateDailyBanner(): void {
  const el = document.getElementById('dailyBanner');
  if (!el) return;
  const key = todayKey();
  const ch = dailyChallengeFor(key);
  const doneToday = profile.daily.date === key && profile.daily.done;
  const streak = profile.dailyStreak > 0 ? ` · 🔥 ${profile.dailyStreak}` : '';
  el.innerHTML = `<span class="dcLabel">DAILY${streak}</span><span class="dcName">${doneToday ? '✅ ' : ''}${ch.name}</span>`;
}

function startRound(): void {
  round.course = COURSES[sel.courseId] ?? COURSES.wildwood;
  round.mode = sel.mode;
  round.holeIdx = 0;
  round.activePlayer = 0;
  round.holeWinds = [];
  round.seed = undefined;
  round.tournament = null;
  shotAcc = freshShotAcc();
  // Remember the selections for next launch (persisted only when signed in)
  profile.name = sel.name;
  profile.character = sel.character;
  profile.archetype = sel.archetype;
  persistProfile();
  // Ace Challenge is a mode: hand off to the repeat-a-par-3 loop instead of a
  // normal three-hole round (playtest FB9).
  if (sel.mode === 'aces') {
    startAces();
    return;
  }
  const golfer = assembleGolfer(sel.name, sel.character, sel.archetype, profile.clubUpgrades);
  round.players = [{ golfer, isAI: false, scores: [] }];
  if (round.mode !== 'solo') {
    const opp = OPPONENTS.find((o) => o.id === sel.opponentId) ?? OPPONENTS[1];
    round.players.push({ golfer: opp, isAI: true, scores: [] });
  }
  setupEl.style.display = 'none';
  playHole();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Prominent main-menu account control (playtest FB9): a green Link-Google button
 * (styled like the wizard's Next button) when signed out; a "✓ Signed in as …"
 * row with a Log out button once linked. Surfaces account linking where it's
 * obvious and reflects the real, persistent state. The profile overlay keeps its
 * own copy of the control too.
 */
function renderAcctMenu(): void {
  const el = document.getElementById('acctMenu');
  if (!el) return;
  if (!authConfigured()) {
    el.innerHTML = '';
    return;
  }
  // Signed-out: a prominent sign-in button with a "save your progress" subtitle
  // so the account's purpose is obvious. Signed-in: a "Signed in as …" row with
  // Log out. State is driven by the `signedIn` flag (set by adopt/sign-out).
  const showSignInButton = (): void => {
    el.innerHTML =
      `<button id="acctLinkBtn" class="acctBtn">🔑 Sign in with Google</button>` +
      `<div class="acctHint">Sign in to save your coins &amp; progress</div>`;
    const btn = document.getElementById('acctLinkBtn') as HTMLButtonElement;
    btn.addEventListener('pointerdown', () => {
      btn.disabled = true;
      btn.textContent = '🔑 Opening Google…';
      void signInWithGoogle().then((name) => {
        if (!name) {
          btn.disabled = false;
          btn.textContent = '🔑 Sign in with Google';
          return;
        }
        if (name === 'redirect') {
          btn.textContent = '🔑 Redirecting…';
          return;
        }
        void adoptCloudAccount().then(() => {
          showSignedIn(name);
          refreshWizardIfVisible();
        });
      });
    });
  };
  const showSignedIn = (name: string): void => {
    el.innerHTML =
      `<div class="acctSignedIn"><span class="acctWho">✓ Signed in as <b>${escapeHtml(name)}</b></span>` +
      `<button id="acctLogout" class="acctLogout">Log out</button></div>`;
    document.getElementById('acctLogout')!.addEventListener('pointerdown', () => {
      void doSignOut().then(() => {
        showSignInButton();
        refreshWizardIfVisible();
      });
    });
  };
  if (signedIn) {
    void linkedAccountName().then((name) => showSignedIn(name ?? 'your account'));
  } else {
    showSignInButton();
  }
}

document.getElementById('recordsLink')!.addEventListener('pointerdown', () => renderRecords());
document.getElementById('storeLink')!.addEventListener('pointerdown', () => renderStore());
document.getElementById('profileLink')!.addEventListener('pointerdown', () => renderProfile());
document.getElementById('tournyLink')!.addEventListener('pointerdown', () => renderTournaments());
renderAcctMenu();
backBtn.addEventListener('pointerdown', () => goStep(sel.step - 1));
nextBtn.addEventListener('pointerdown', () => {
  if (sel.step < stepLabels().length - 1) goStep(sel.step + 1);
  else startRound();
});

/**
 * Screenshot-harness boot (`?hole=N&cam=…&freeze=1`): skip the wizard, load
 * the requested hole in a fixed pose with fixed wind, and raise __shotReady
 * once the scene (course, character, textures) is fully renderable.
 */
function startShotCapture(): void {
  round.course = (SHOT.course && COURSES[SHOT.course]) || COURSES.wildwood;
  round.mode = 'solo';
  round.holeIdx = Math.min((SHOT.hole ?? 1) - 1, round.course.holes.length - 1);
  round.activePlayer = 0;
  // Fixed wind so the HUD chip (and any wind-driven visuals) never varies
  round.holeWinds = round.course.holes.map(() => ({ angle: 0.9, speed: 8 }));
  round.players = [
    { golfer: assembleGolfer('Shot', CHARACTERS[0].key, ARCHETYPES[0].id), isAI: false, scores: [] }
  ];
  setupEl.style.display = 'none';
  playHole();
  const scene = current!;
  scene.enterShotPose(SHOT.cam);
  void Promise.all([
    scene.bodiesReady,
    new Promise((resolve) => scene.scene.executeWhenReady(() => resolve(null)))
  ]).then(() => {
    // Settle window for async prop glbs (trees/grass) instancing in
    setTimeout(() => {
      (window as unknown as { __shotReady: boolean }).__shotReady = true;
    }, 1500);
  });
}

if (SHOT.hole) startShotCapture();
else {
  showSetup();
  // A shared ?t=CODE link boots straight into the tournament's join screen.
  try {
    const tcode = new URLSearchParams(window.location.search).get('t');
    if (tcode) renderTournaments(tcode.toUpperCase());
  } catch {
    /* no query string (e.g. non-browser test host) */
  }
}

// Test hook: let Playwright configure + start a round without menu taps
(window as unknown as { __startRound: unknown }).__startRound = (opts?: {
  name?: string;
  character?: CharacterKey;
  archetype?: ArchetypeId;
  mode?: GameMode;
  opponentId?: string;
  courseId?: string;
}) => {
  if (opts?.name !== undefined) sel.name = opts.name;
  if (opts?.character) sel.character = opts.character;
  if (opts?.archetype) sel.archetype = opts.archetype;
  if (opts?.mode) sel.mode = opts.mode;
  if (opts?.opponentId) sel.opponentId = opts.opponentId;
  if (opts?.courseId && COURSES[opts.courseId]) sel.courseId = opts.courseId;
  startRound();
};

// Test hook: boot the ace challenge (Phase 8) without menu taps.
(window as unknown as { __startAces: unknown }).__startAces = () => {
  setupEl.style.display = 'none';
  startAces();
};

// Test hook: grant session coins so specs can exercise the purchase flow
// (signed-out play is ephemeral — nothing here persists or reaches the cloud).
(window as unknown as { __grantCoins: unknown }).__grantCoins = (n: number) => {
  profile.coins += n;
};
