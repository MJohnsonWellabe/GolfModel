import {
  AbstractMesh,
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
import { FLIGHT, LEADERBOARD_URL, PHYSICS, PUTT_VIEW, PX_PER_YARD, RULES } from '../config';
import { isFrozen, SHOT, ShotCam } from '../core/debugFlags';
import { AimControl, ShotContext } from '../core/input/AimControl';
import { StrikeControl } from '../core/input/StrikeControl';
import { grainPreloadsSettled, preloadGrassGrain } from '../core/rendering/grassTexture';
import { resolveTheme } from '../core/rendering/Theme';
import { ClubSpec, CourseData, GameMode, Golfer, GolferStats, HoleData, Point, ShotOutcome, SwingResult, TrajectoryPoint, Wind } from '../core/types';
import { assembleGolfer } from '../data/golfers';
import { ARCHETYPES, ArchetypeId, archetypeById, StatKey } from '../data/archetypes';
import { CHARACTERS, CharacterKey } from '../data/characters';
import { CourseAuthoring, loadCourse } from '../data/courseLoader';
import { courseOrDefault, DEFAULT_COURSE_ID } from '../data/courseDefaults';
import wildwood from '../data/courses/wildwood.json';
import sablebay from '../data/courses/sablebay.json';
import timberline from '../data/courses/timberline.json';
import portjohnson from '../data/courses/portjohnson.json';
import { bestRounds, clearLocalHistory, fetchAllRounds, loadLocal, isNewRecord, isShared, makeRoundId, RoundRecord, saveRound } from '../firebase/History';
import {
  createTournament,
  fetchTournament,
  submitEntry,
  makeTournamentCode,
  tournamentStandings,
  isEnded,
  isPlausibleEntry,
  Tournament,
  TournamentEntry
} from '../firebase/Tournaments';
import { AiTournamentState, completeRound, createAiTournament, isFinal, purseFor, standings as aiTourStandings } from '../systems/AiTournament';
import { mulberry32 } from '../utils/Random';
import { authConfigured, CloudSaveStatus, cloudEmail, cloudSyncProfile, cloudUid, giftSeasonReward, isSignedIn, linkedAccountName, signInWithGoogle, signOutAccount } from '../firebase/FirebaseClient';
import { isAdminEmail } from '../admin/adminEmails';
import { chargesRemaining, clearLocalProfile, consumeCharge, CosmeticKind, defaultProfile, DeviceSettings, grantConsumable, loadDeviceSettings, loadProfile, mergeProfiles, perkRemaining, PlayerProfile, resetProfileRecords, saveDeviceSettings, saveProfile } from '../profile/Profile';
import { ACHIEVEMENTS, COINS, DAILY_CHALLENGES, DailyChallenge, emptyRoundStats, levelForXp, RoundStats, XP, xpForLevel, dailyChallengeFor } from '../data/progression';
import { applyRound, RewardEvent } from '../systems/ProgressionEngine';
import { Analytics, restTransport } from '../systems/Analytics';
import { dailyOverrideFor, LiveOpsConfig } from '../data/liveOpsConfig';
import { fetchLiveOpsConfigREST } from '../firebase/LiveOpsConfig';
import { applyRoundRecords, RecordEvent } from '../systems/Records';
import { advanceStreak, claimStreakReward, cycleDay, streakRewardFor } from '../systems/Streak';
import { applyHoleMastery, HoleMasteryInput, nextStarHint, starCount } from '../systems/Mastery';
import { MASTERY_CHALLENGES, thirdStarFor } from '../data/masteryChallenges';
import { buyItem, canBuy, equip, equippedColor, isOwned } from '../systems/StoreEngine';
import { addSeasonXp, claimReward, claimState, levelProgress, ownsPass, rewardLabel, rolloverSeason, seasonActive } from '../systems/SeasonPassEngine';
import { salesOpen, SeasonReward, SEASON_1 } from '../data/seasonPass';
import { claimEntitlements, PRODUCTS, purchaseConfigured, startPurchase } from '../firebase/Purchases';
import { applyClubUpgrades, isEquippableKind, STORE_BY_ID, STORE_CATALOG, StoreItem, upgradePerfectZoneMult } from '../data/storeCatalog';
import { palByKey, PalDef } from '../data/pals';
import { PerkDef, perkById, perkEffectLabel, perkPerfectZoneMult } from '../data/perks';
import { TRUE_VISION } from '../data/consumables';
import { Pal3D } from './pal3d';
import { AIOpponent, OPPONENTS } from '../data/opponents';
import { AIController, BALANCED_PERSONALITY } from '../systems/AIController';
import { FireSystem } from '../systems/FireSystem';
import { buildHeightField } from '../systems/HeightField';
import { TurnManager } from '../systems/TurnManager';
import { drawWind } from '../systems/RoundSimulator';
import { shouldShowPuttGrid } from '../core/puttAids';
import { renderPacing } from './renderPacing';
import { dist, randomPinForGreen } from '../utils/Geometry';
import { PhysicsEngine, statsForClub } from '../systems/PhysicsEngine';
import { computeTrueVisionPath } from '../systems/TrueVision';
import { scoreName } from '../systems/Scoring';
import { buildCourse, w2b } from './course3d';
import { ClubTuning, Golfer3D } from './golfer3d';
import { DomMeter } from './meter3d';
import { ShotCapture } from './shotCapture';

// ------------------------------------------------------------------- boot

const canvas = document.getElementById('scene') as HTMLCanvasElement;
// preserveDrawingBuffer keeps the last frame readable for screenshots/share
// captures (and reliable headless verification) at negligible cost here.
const engine3d = new Engine(canvas, true, { adaptToDeviceRatio: true, preserveDrawingBuffer: true });

// Cap the render resolution at 2x CSS pixels. `adaptToDeviceRatio` above backs
// the canvas at the display's FULL pixel ratio (3x on many phones), and every
// full-screen GPU cost — the lit pass, the 1024² shadow map, and the water
// mirror — scales with that pixel count SQUARED. Past ~2x the extra sharpness
// is imperceptible on a hand-held screen while the fill cost keeps climbing, so
// clamping here is the single most universal performance win: on a 3x phone it
// cuts rendered pixels by ~56%. Freeing that frame time is also the real fix
// for the power meter reading slow/jumpy on the heavier courses (WW Glen,
// Timberline) — the meter is delta-time correct, but starves when the render
// thread is pixel-bound. Displays at 1x/2x are untouched; only >2x render less.
const MAX_RENDER_DPR = 2;
const renderDpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
engine3d.setHardwareScalingLevel(1 / renderDpr);
// Nothing here uses Babylon's offline asset DB — the default `true` makes the
// loader probe for a `.manifest` beside every glb/texture and touch IndexedDB
// on load. Off removes that load-time XHR/DB churn (no visual change).
engine3d.enableOfflineSupport = false;


// `value` (optional) carries a numeric metric for the event — used by the input
// latency instrumentation (ADJ-3) to record per-event deltas (ms) alongside the
// absolute timestamp, e.g. the pointerdown→handler DISPATCH latency that surfaces
// the "ignored taps" spike. `ms` is the absolute performance.now() at the mark;
// `deltaMs` the gap since the previous mark. All three let the perf spec compute
// the input-latency chain (pointerdown → state transition → power lock → accuracy
// lock → first meter frame → shot resolution) purely CPU-side.
type PerfSample = { course: string; hole: number; event: string; ms: number; deltaMs: number; value?: number };
const perfSamples: PerfSample[] = [];
let lastPerfMs = performance.now();
function markPerf(course: string, hole: number, event: string, value?: number): void {
  const now = performance.now();
  const sample: PerfSample = { course, hole, event, ms: now, deltaMs: now - lastPerfMs };
  if (value !== undefined) sample.value = value;
  lastPerfMs = now;
  perfSamples.push(sample);
  if (perfSamples.length > 240) perfSamples.shift();
  (globalThis as typeof globalThis & { __golfPerf?: PerfSample[] }).__golfPerf = perfSamples;
  performance.mark?.(`golf:${course}:h${hole}:${event}`);
}

const hudEl = document.getElementById('hud')!;
const msgEl = document.getElementById('msg')!;
const bannerEl = document.getElementById('banner')!;
const promptEl = document.getElementById('prompt')!;
const summaryEl = document.getElementById('summary')!;
const meterEl = document.getElementById('meter')!;
const meter = new DomMeter(meterEl);
meter.onActiveChange = (active) => {
  // The expensive course drain must yield only while the meter cursor is
  // actually sweeping. Keeping it live during idle aiming lets scenery finish
  // filling; switching it off before the next rAF preserves first-swing timing.
  renderPacing.meterActive = active && !isFrozen();
};
const swingBtn = document.getElementById('swingBtn')!;
const clubBar = document.getElementById('clubBar')!;
const clubName = document.getElementById('clubName')!;
const aerialBtn = document.getElementById('aerialBtn')!;
const tourBoardBtn = document.getElementById('tourBoardBtn')!;
const trueVisionBtn = document.getElementById('trueVisionBtn')! as HTMLButtonElement;
const skipBtn = document.getElementById('skipBtn')!;
const captureBtn = document.getElementById('captureBtn') as HTMLButtonElement;
// Rolling ~5s canvas capture so a player can save a clip of a great shot to
// their phone. OPT-IN: MediaRecorder encodes video frames continuously while
// running — real per-frame CPU work that has no business on by default during
// gameplay (perf pass: this was the hidden "video work during gameplay").
// First tap on the clip button switches it on (persisted device-locally);
// after that, taps save the last few seconds. Degrades to a hidden button
// where the browser can't record.
const shotCapture = new ShotCapture(canvas);
if (captureBtn) {
  captureBtn.addEventListener('pointerdown', () => {
    if (!deviceSettings.clipCapture) {
      updateDeviceSettings({ clipCapture: true });
      shotCapture.start();
      captureBtn.textContent = '🎥 REC';
      showMsg('Clip recording ON — tap 🎥 again to save your last shot', 2600);
      return;
    }
    void onSaveShotClip();
  });
}
let savingClip = false;
async function onSaveShotClip(): Promise<void> {
  if (!captureBtn || savingClip) return;
  savingClip = true;
  const original = captureBtn.textContent;
  captureBtn.textContent = '💾 …';
  try {
    const ok = await shotCapture.saveClip();
    captureBtn.textContent = ok ? '✓ SAVED' : '—';
  } catch {
    captureBtn.textContent = '—';
  } finally {
    setTimeout(() => {
      captureBtn.textContent = original ?? (deviceSettings.clipCapture ? '🎥 REC' : '🎥 CLIP');
      savingClip = false;
    }, 1200);
  }
}
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
/** One cached, decoded element per SFX key. `new Audio(...)` on every play
 *  re-fetched and re-decoded the sample inside the shot/impact handlers — a
 *  small but repeated main-thread cost (plus GC churn) paid at the worst
 *  moments. Reuse the cached element when it's free; clone it (clone shares
 *  the already-decoded resource) only when the same key overlaps itself. */
const sfxCache = new Map<string, HTMLAudioElement>();
function play(key: string): void {
  try {
    // Compute the volume FIRST so a muted player never allocates any element.
    const vol = Math.max(0, Math.min(1, (sounds[key] ?? 0.7) * profile.settings.sound));
    if (vol <= 0) return;
    let a = sfxCache.get(key);
    if (!a) {
      a = new Audio(`sfx/${key}.wav`);
      sfxCache.set(key, a);
    } else if (!a.paused && !a.ended) {
      a = a.cloneNode(true) as HTMLAudioElement; // overlapping play of same key
    } else {
      a.currentTime = 0;
    }
    a.volume = vol;
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
  /** Randomized cup position per hole index — generated once (seeded for
   *  tournaments so every entrant plays the same pins, fresh for casual). */
  holePins: Point[];
  /** Shared RNG seed for tournament rounds → identical conditions for every
   *  entrant (undefined for casual rounds, which roll fresh wind). */
  seed?: number;
  /** Active tournament this round counts toward (submits an entry at the end). */
  tournament?: { code: string; name: string } | null;
}

const COURSES: Record<string, CourseData> = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring),
  portjohnson: loadCourse(portjohnson as unknown as CourseAuthoring)
};

/** Resolve a course id (or absent/invalid one) to CourseData, defaulting to
 *  Sable Bay. Thin binding of the shared roster to courseDefaults' helper. */
const courseFallback = (id?: string | null): CourseData => courseOrDefault(id, COURSES);

// Fire the real-turf-grain preloads at boot, well before any round can start
// (the menu is always shown first) — the ground bake is synchronous and
// falls back to procedural noise if a key hasn't resolved yet. Harmless
// no-ops on courses that don't opt into either key (decoded but unread).
preloadGrassGrain('textures/turf_grain.jpg');
preloadGrassGrain('textures/turf_grain_rough.jpg');
preloadGrassGrain('textures/sand_ripple.jpg');

/** Course roster for the picker (id → display + one-line character). */
const COURSE_LIST: Array<{ id: string; name: string; tag: string; icon: string; art: string; difficulty: string }> = [
  { id: 'wildwood', name: 'Wildwood Glen', tag: 'Parkland · creeks & ponds, tight woods, wildflower beds', icon: '🌳', art: 'marketing/img/wildwood-cherry.png', difficulty: 'Balanced' },
  { id: 'sablebay', name: 'Sable Bay', tag: 'Coastal · water everywhere, waste sand, a true island green', icon: '🌊', art: 'marketing/img/sablebay-island.png', difficulty: 'Daring' },
  { id: 'timberline', name: 'Timberline', tag: 'Forest · tight spruce corridors, a fairway dogleg', icon: '🌲', art: 'marketing/img/timberline-pond.png', difficulty: 'Tight' },
  { id: 'portjohnson', name: 'Port Johnson Links', tag: 'Links · treeless, windy, revetted pots by the sea', icon: '🏴', art: 'marketing/img/portjohnson-bunker.png', difficulty: 'Windy' }
];

/** Resolve a course by its display name (tournament entries carry the name). */
function courseIdByName(name: string): string {
  return COURSE_LIST.find((c) => COURSES[c.id]?.name === name)?.id ?? DEFAULT_COURSE_ID;
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
  course: COURSES[DEFAULT_COURSE_ID],
  mode: 'solo',
  holeIdx: 0,
  players: [{ golfer: assembleGolfer('Player', CHARACTERS[0].key, ARCHETYPES[0].id), isAI: false, scores: [] }],
  activePlayer: 0,
  holeWinds: [],
  holePins: []
};

/** Shot-based round stats accumulated for the HUMAN player during play
 *  (score-based stats are derived at the summary). Feeds ProgressionEngine. */
/** Per-hole facts the mastery third-star challenges inspect (Part 5) —
 *  captured during play, folded into HoleMasteryInput at hole completion. */
interface HoleFacts {
  water: boolean;
  sand: boolean;
  fairway: boolean;
  usedTrueVision: boolean;
  longestPuttFt: number;
  /** Approach finish distance from the pin (ft) when the green was hit. */
  approachFt: number | null;
  onFire: boolean;
  windSpeed: number;
}
function freshHoleFacts(): HoleFacts {
  return {
    water: false,
    sand: false,
    fairway: false,
    usedTrueVision: false,
    longestPuttFt: 0,
    approachFt: null,
    onFire: false,
    windSpeed: 0
  };
}

interface ShotAcc {
  fairwaysHit: number;
  fairwaysPossible: number;
  gir: number;
  puttsMade: number;
  /** Putts TAKEN per hole number (puttsMade above counts only holed putts). */
  holePutts: Record<number, number>;
  longestDriveYds: number;
  longestPuttMadeFt: number;
  chipIns: number;
  girHoles: Set<number>;
  /** Per-hole mastery facts for the HUMAN player, keyed by hole number. */
  holeFacts: Record<number, HoleFacts>;
  /** Closest approach (ft) that finished on the green this round, if any. */
  closestApproachFt: number | null;
  /** Longest fire streak (consecutive swings while on fire) this round. */
  fireStreakBest: number;
}
function freshShotAcc(): ShotAcc {
  return {
    fairwaysHit: 0,
    fairwaysPossible: 0,
    gir: 0,
    puttsMade: 0,
    holePutts: {},
    longestDriveYds: 0,
    longestPuttMadeFt: 0,
    chipIns: 0,
    girHoles: new Set(),
    holeFacts: {},
    closestApproachFt: null,
    fireStreakBest: 0
  };
}
let shotAcc: ShotAcc = freshShotAcc();
/** The current hole's fact sheet (lazily created). */
function holeFactsFor(holeNumber: number): HoleFacts {
  return (shotAcc.holeFacts[holeNumber] ??= freshHoleFacts());
}

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
    round.holeWinds[idx] = drawWind(
      rng,
      round.course.minWind ?? 2,
      round.course.maxWind ?? PHYSICS.maxWind
    );
  }
  return round.holeWinds[idx];
}

/** Randomized cup for a hole index — generated once per round and cached (like
 *  wind). Seeded off the tournament seed so every entrant plays IDENTICAL pins
 *  (the promise the tournaments UI already makes); a fresh random pin for
 *  casual rounds. Kept clear of the green's rim by randomPinForGreen. */
function pinForHole(idx: number): Point {
  if (!round.holePins[idx]) {
    const h = round.course.holes[idx];
    const rng = round.seed !== undefined ? mulberry32(round.seed * 2003 + idx * 97 + 7) : Math.random;
    round.holePins[idx] = randomPinForGreen(h.green, h.green2, rng);
  }
  return round.holePins[idx];
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
  // Shallow-clone the hole with a randomized cup so every consumer (physics,
  // AI, aim, flag/cup mesh, HUD) reads the SAME pin — without mutating the
  // shared COURSES singleton. The authored `pin` is the fallback.
  private hole: HoleData = { ...round.course.holes[round.holeIdx], pin: pinForHole(round.holeIdx) };
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
  /** The human player's equipped pal, if any — decorative, never load-bearing. */
  private pal: Pal3D | null = null;
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
  /** True Vision's red dashed line — a second, independent dot pool (never
   *  touched by updateAimVisuals' per-frame redraw): populated once on tap
   *  and left alone until the putt is struck or the turn ends. */
  private trueVisionRoot!: TransformNode;
  private trueVisionDots: Mesh[] = [];
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
    /** Where the ball first touched down — the roll-tracking camera measures
     *  how far the rollout has traveled from here. */
    landPos: { x: number; y: number } | null;
    trail: TrailMesh | null;
    /** Resolved launch + live spin so swipes can re-shape the flight. */
    launch: import('../systems/PhysicsEngine').ResolvedLaunch | null;
    spin: { side: number; top: number };
  } | null = null;
  private disposed = false;
  /** Reused each frame for the tree-occlusion golfer-head point (no per-frame alloc). */
  private _golferHead = new Vector3();
  /** Scratch objects for the per-frame aim-readout projection (no per-frame alloc). */
  private _readoutViewport = new Viewport(0, 0, 1, 1);
  private _identity = Matrix.Identity();
  /** Pending intro-flyover timers so skipIntro can cancel the camera sweep. */
  private introTimers: ReturnType<typeof setTimeout>[] = [];
  /** Set by skipIntro so the natureReady-gated travel schedule (a Promise
   *  chain, not a plain timer skipIntro's clearTimeout can reach) bails out
   *  instead of moving the camera after the player already has control. */
  private introSkipped = false;
  /** True once the scatter drain + ship swap have fully settled — the point
   *  where scene resource counts are meaningful (read by the soak spec). */
  natureSettled = false;
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

  constructor(private onHoleComplete: (scores: number[]) => void) {
    markPerf(round.course.name, this.hole.number, 'hole-constructor-start');
    this.scene = new Scene(engine3d);
    // All input is raw DOM listeners on the canvas — there are no Babylon
    // ActionManagers, onPointerObservable subscribers, or scene.pick calls — so
    // the default per-pointer-move mesh pick serves nothing. Skip it.
    this.scene.skipPointerMovePicking = true;
    const heightT0 = performance.now();
    this.engine2d = new PhysicsEngine(this.hole, buildHeightField(this.hole, this.theme.bunkerDepthScale ?? 1));
    markPerf(round.course.name, this.hole.number, `heightfield-ready:${Math.round(performance.now() - heightT0)}ms`);
    // Aim/preview run on a flat, no-slope engine so the aim line never
    // reveals wind or slope — the player estimates hold-off (FB1/FB2). The
    // real shot uses engine2d (terrain + wind).
    this.previewEngine = new PhysicsEngine({ ...this.hole, slope: { angle: 0, strength: 0 } }, null);
    // Aim LINE/preview AND the putt PACE both run on the flat previewEngine: the
    // normal aim is a dumb, flat model that never reveals or compensates for the
    // break (slope/elevation/fringe/green speed). Reading the green — or using
    // True Vision, which simulates the complete shot — is the player's job.
    this.aim = new AimControl(this.hole, this.previewEngine);
    // Shared per-hole conditions (fair across competitors)
    this.wind = windForHole(round.holeIdx);
    const buildT0 = performance.now();
    this.course3d = buildCourse(this.scene, this.hole, this.theme, this.engine2d);
    markPerf(round.course.name, this.hole.number, `build-course-returned:${Math.round(performance.now() - buildT0)}ms`);
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
    this.bodiesReady = Promise.all(this.golfers.map((g) => g.ready)).then(() => {
      markPerf(round.course.name, this.hole.number, 'golfer-bodies-ready');
      return undefined;
    });

    // The human player's equipped pal pads along for the round (AI opponents
    // never bring one). Deliberately NOT part of bodiesReady: a slow or failed
    // pal fetch must never hold up the shot.
    const equippedPal: PalDef | undefined = round.players[0].isAI
      ? undefined
      : palByKey(STORE_BY_ID.get(profile.cosmetics.equipped.pal ?? '')?.pal);
    if (equippedPal) this.pal = new Pal3D(this.scene, shadows, equippedPal, (x, y) => this.gh(x, y));

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

    // True Vision: a second, red dot pool showing the REVEALED putt line — a
    // separate mesh/material from the white aim guide so it can be populated
    // once on tap and left untouched while the ordinary aim line keeps
    // redrawing every frame as the player adjusts pace.
    const trueVisionMat = new StandardMaterial('trueVisionMat', this.scene);
    trueVisionMat.diffuseColor = new Color3(1, 0.15, 0.15);
    trueVisionMat.emissiveColor = new Color3(0.9, 0.1, 0.1);
    trueVisionMat.disableLighting = true;
    this.trueVisionRoot = new TransformNode('trueVisionRoot', this.scene);
    for (let i = 0; i < 24; i++) {
      const dot = MeshBuilder.CreateDisc(`trueVisionDot${i}`, { radius: 0.45, tessellation: 10 }, this.scene);
      dot.rotation.x = Math.PI / 2;
      dot.material = trueVisionMat;
      dot.parent = this.trueVisionRoot;
      this.trueVisionDots.push(dot);
    }
    this.trueVisionRoot.setEnabled(false);

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
    // Compile the address-time shaders DURING the flyover so the first shot is
    // smooth (the old "hole 1 lags on the first shot"). Best-effort, never blocks.
    void this.warmupShaders();
    markPerf(round.course.name, this.hole.number, 'intro-start');
    this.playIntro();
  }

  /**
   * Warm the shader programs for everything that first APPEARS at address — the
   * golfer, the aim guide, the ball + its shadow — while the intro flyover is
   * still playing. Those StandardMaterials compile lazily on first render, and
   * on the FIRST hole nothing is cached yet, so that compile landed on the first
   * swing as a visible hitch ("hole 1 lags on the first shot"). Holes 2+ already
   * reused the engine-level program cache, which is why only hole 1 stuttered.
   * Compiling here moves the cost into the flyover window. Purely a warm-up:
   * wrapped so a failure (or an early skipIntro) can never block or break a shot.
   */
  private async warmupShaders(): Promise<void> {
    try {
      const warmT0 = performance.now();
      await this.bodiesReady;
      if (this.disposed) return;
      const warm = (m: AbstractMesh | null | undefined): Promise<void> | null => {
        const mat = m?.material as
          | { forceCompilationAsync?: (mesh: AbstractMesh) => Promise<void> }
          | null
          | undefined;
        return m && mat?.forceCompilationAsync ? mat.forceCompilationAsync(m).catch(() => undefined) : null;
      };
      const jobs: Array<Promise<void> | null> = [];
      this.golfers.forEach((g) => g.root.getChildMeshes().forEach((m) => jobs.push(warm(m))));
      this.aimDots.forEach((d) => jobs.push(warm(d)));
      jobs.push(warm(this.aimRing), warm(this.ballShadow));
      this.balls.forEach((b) => jobs.push(warm(b)));
      await Promise.all(jobs.filter(Boolean));
      markPerf(round.course.name, this.hole.number, `address-shaders-warm:${Math.round(performance.now() - warmT0)}ms`);
    } catch {
      /* best-effort warm-up — a shot must never depend on it */
    }
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
      fireBoost: this.fires[this.turnIdx].statBoost,
      strokes: this.state.strokes
    };
  }

  /** Arm (or re-arm) the swing meter for the current aim/club/fire state.
   *  `fromAimDrag` marks the per-pointermove re-arm during a drag-to-aim: that
   *  path must NOT force a fresh parked-RTT capture per move (see below). */
  private armMeter(fromAimDrag = false): void {
    markPerf(round.course.name, this.hole.number, 'meter-armed');
    // The golfer holds the right stick for the shot: real putter on the green,
    // the wood driver when the driver's in hand, the iron everywhere else (all
    // from the uploaded club models).
    this.golfer.setClubKind(
      this.aim.isPutting ? 'putter' : this.aim.club.id === 'driver' ? 'driver' : 'swing'
    );
    const fire = this.fires[this.turnIdx];
    // A purchased iron/wedge/putter upgrade widens the perfect zone; fire LAYERS
    // over it (multiplied), so an on-fire upgraded club reads an even wider band.
    // An equipped iron/wedge/putter PERK layers on top of both, same widening.
    const upgradeZone = upgradePerfectZoneMult(this.aim.club.id, this.curPart().golfer.clubUpgrades ?? {});
    const perkZone = perkPerfectZoneMult(this.aim.club.id, this.curPart().golfer.perk);
    meter.arm({
      stat: statsForClub(this.aim.club, this.curPart().golfer, fire.statBoost).accuracy,
      powerTarget: this.aim.barPowerTarget(this.ctx()),
      isPutt: this.aim.isPutting,
      perfectMult: fire.perfectZoneMultiplier * upgradeZone * perkZone,
      difficultyMult: this.swingDifficulty()
    });
    meterEl.style.display = 'block';
    meterEl.classList.toggle('onFire', fire.isOnFire);
    // The meter owns renderPacing.meterActive only while its cursor is actually
    // sweeping, so idle aiming stays unblocked and background scenery keeps
    // filling. But the camera is now PARKED at address: freeze the two dominant
    // per-frame GPU costs (water mirror + shadow map) from this instant so the
    // FIRST tap and every armed-idle frame are cheap — the fix for the heavy-hole
    // first-shot hitch. cameraParked is cleared when the ball is struck
    // (executeShot) or the turn tears down (beginTurn); the scatter drain (gated
    // on meterActive) keeps running through this window.
    renderPacing.meterActive = false;
    renderPacing.cameraParked = true;
    // armMeter is re-called on every drag-to-aim move (the camera reframes down
    // the new aim line). Forcing a fresh RENDER_ONCE capture of BOTH parked
    // RTTs per pointermove re-rendered the water mirror + shadow map at input
    // frequency (often faster than the frame rate) — the aiming-drag frame
    // pacing regression on the water holes. During a drag the RTTs instead run
    // at the normal live cadence (aimDragRTTs(true), set by the pointermove
    // handler); the single fresh-capture-then-freeze happens only on the
    // non-drag arms (turn start, club change, cancel) and again at drag end.
    if (!fromAimDrag) this.course3d.refreshParkedRTTs();
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

  /** Test-only: current refresh rates of the two per-frame RTTs the perf pacing
   *  freezes while the meter is live (0 = frozen). Lets the perf spec assert the
   *  freeze mechanism engages/disengages with the meter deterministically. */
  perfRefreshRates(): { shadow: number | null; mirror: number | null } {
    return {
      shadow: this.course3d.shadows.getShadowMap()?.refreshRate ?? null,
      mirror: this.course3d.waterMirror?.refreshRate ?? null
    };
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
    if (this.aerial) {
      // Overhead planning view that ALWAYS frames the whole ball→pin corridor
      // (FB3): height scales with the span with no upper cap so the green is
      // in frame even on the longest holes. With the ~1.05 vertical fov the
      // ground coverage ≈ height, so height ≈ span·1.25 fits both ends + margin.
      // Works while PUTTING too (playtest: "aerial doesn't work when putting") —
      // there the span is short, so it drops to a tight overhead that frames the
      // green + the ball→cup line + the break grid instead of a sky-high view.
      const mx = (this.state.ballPos.x + this.hole.pin.x) / 2;
      const my = (this.state.ballPos.y + this.hole.pin.y) / 2;
      const span = Math.hypot(this.hole.pin.x - this.state.ballPos.x, this.hole.pin.y - this.state.ballPos.y);
      const greenR = Math.max(this.hole.green.rx, this.hole.green.ry);
      const height = putt ? Math.max(90, span * 1.6 + greenR * 0.9) : Math.max(300, span * 1.25);
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
      // Lower vantage (was 5 + d*0.24) — like the driving view, a flatter eye
      // line lifts the ball higher in the portrait frame so it clears the power
      // meter/swing bar at the bottom (playtest: "meter should be below the ball").
      const rise = 2.6 + d * 0.16;
      this.camTarget.pos = base.subtract(f.scale(back)).add(new Vector3(0, rise, 0));
      // Look most of the way to the cup so it sits high in the portrait frame,
      // with the whole ball→cup line below it.
      this.camTarget.look = base.add(f.scale(d * 0.72)).add(new Vector3(0, 0.35, 0));
      this.camTarget.k = 4;
      this.camTarget.fov = PUTT_VIEW.fov;
      return;
    }
    // Pitched-down vantage; pulled in a touch from behind/above the golfer so
    // the (larger) golfer reads clearly while the fairway still shows. Look
    // lead 50 (was 70): a nearer look point raises the ball/club in the
    // portrait frame so the swing meter (pinned above the SWING button, which
    // caps how low it can sit) no longer covers the club at address (playtest:
    // "power meter blocks out the club").
    // Camera dropped from +18 to +15: a lower, flatter vantage lifts the ball
    // higher in the portrait frame so it clears the swing bar/meter at the
    // bottom of the screen (playtest: "bar is still blocking address").
    this.camTarget.pos = base.subtract(f.scale(26)).add(new Vector3(0, 15, 0));
    this.camTarget.look = base.add(f.scale(50)).add(new Vector3(0, 1, 0));
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
    // Open LOW and tight right behind the tee, looking just down the line (not at
    // mid-hole) so the first frame unmistakably reads "at the tee" before the
    // camera glides downrange. (At the honest scale, the old high/mid-hole aim
    // read as an overview.)
    this.camera.position = w2b(h.tee.x, h.tee.y, 9 + teeH).subtract(g.scale(20));
    this.camera.setTarget(w2b(h.tee.x, h.tee.y, teeH + 2).add(g.scale(42)));

    // Hold AT the tee first: point camTarget at the same tee framing with a
    // gentle gain so the opening frames unmistakably sit at the tee (the banner
    // is up for ~0.5s and the smoothing lerp was drifting the camera downrange
    // before the player even looked). The travel waypoint fires shortly after.
    const TEE_HOLD_MS = 500;
    this.camTarget.pos = this.camera.position.clone();
    this.camTarget.look = w2b(h.tee.x, h.tee.y, teeH + 2).add(g.scale(42));
    this.camTarget.k = 0.4;

    // Travel waypoints follow the AUTHORED fairway. When the loader kept the
    // ribbon centerlines, fly the actual route station-by-station so a dogleg
    // is flown leg → corner → leg (not cut straight over the corner woods);
    // otherwise fall back to one stop per fairway-polygon centroid. Both finish
    // over the green.
    const distTee = (p: { x: number; y: number }): number => Math.hypot(p.x - h.tee.x, p.y - h.tee.y);
    let stops: { x: number; y: number }[];
    if (h.fairwayCenterlines && h.fairwayCenterlines.length) {
      // Order the ribbons tee-first, then walk each one keeping every ~2nd
      // control point plus the leg's final station so corners are always hit.
      const ribbons = [...h.fairwayCenterlines].sort(
        (a, b) => distTee({ x: a[0][0], y: a[0][1] }) - distTee({ x: b[0][0], y: b[0][1] })
      );
      stops = [];
      for (const line of ribbons) {
        // A ribbon authored green→tee (its first point is nearer the pin) is
        // walked in reverse so travel always runs toward the green.
        const ordered =
          distTee({ x: line[0][0], y: line[0][1] }) <= distTee({ x: line[line.length - 1][0], y: line[line.length - 1][1] })
            ? line
            : [...line].reverse();
        ordered.forEach((pt, i) => {
          if (i % 2 === 0 || i === ordered.length - 1) stops.push({ x: pt[0], y: pt[1] });
        });
      }
    } else {
      const centroid = (poly: ReadonlyArray<ReadonlyArray<number>>): { x: number; y: number } => ({
        x: poly.reduce((a, p) => a + p[0], 0) / poly.length,
        y: poly.reduce((a, p) => a + p[1], 0) / poly.length
      });
      stops = h.fairway.map(centroid).sort((a, b) => distTee(a) - distTee(b));
    }
    stops.push({ x: h.pin.x, y: h.pin.y });
    const TRAVEL_MS = 3600;

    // The travel sweep is what actually shows off the hole, so it must not
    // start until the scatter (trees/bushes/flowers/grass) has finished
    // planting — otherwise the camera glides over a course that's still
    // filling in underneath it (playtest: "wasn't rendered until halfway
    // through the flyover"). Scheduled relative to "now" (whenever that
    // turns out to be) rather than a fixed offset from playIntro()'s call
    // time; a MAX_NATURE_WAIT_MS cap keeps a stalled/failed load from
    // hanging the flyover forever.
    // 6s cap: a cold cache on a slow connection needs longer than the old
    // 2.6s to fetch + plant the full scatter (Sable Bay h1 regressed into
    // popping in mid-sweep); the tee-hold shot keeps the screen composed
    // while we wait, and a stalled/failed load still can't hang the intro.
    const MAX_NATURE_WAIT_MS = 6000;
    let travelStarted = false;
    const beginTravel = (): void => {
      if (travelStarted || this.disposed || this.introSkipped) return;
      travelStarted = true;
      let from = { x: h.tee.x, y: h.tee.y };
      stops.forEach((stop, i) => {
        const last = i === stops.length - 1;
        const leg = this.fwd3(Math.atan2(stop.y - from.y, stop.x - from.x));
        from = stop;
        // Look ahead down the CURRENT leg (the next stop), not always at the
        // pin — on a dogleg the pin sits behind the corner woods until the turn.
        const ahead = last ? { x: h.pin.x, y: h.pin.y } : stops[i + 1];
        this.introTimers.push(
          setTimeout(
            () => {
              if (this.disposed) return;
              this.camTarget.pos = w2b(stop.x, stop.y, last ? 82 : 52).subtract(leg.scale(last ? 26 : 30));
              this.camTarget.look = w2b(ahead.x, ahead.y, this.gh(ahead.x, ahead.y));
              this.camTarget.k = last ? 0.85 : 0.9;
            },
            (i * TRAVEL_MS) / stops.length
          )
        );
      });

      // Final waypoint: pull back to the tee-shot framing and hand over control.
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
        }, TRAVEL_MS)
      );
    };
    const teeHoldDone = new Promise<void>((resolve) => {
      this.introTimers.push(setTimeout(resolve, TEE_HOLD_MS));
    });
    const natureReadyOrTimeout = Promise.race([
      this.course3d.natureReady,
      new Promise<void>((resolve) => {
        this.introTimers.push(setTimeout(resolve, MAX_NATURE_WAIT_MS));
      })
    ]);
    void this.course3d.natureReady.then(() => {
      markPerf(round.course.name, this.hole.number, 'nature-ready');
      this.natureSettled = true; // soak/perf specs poll this for true steady state
    });
    void Promise.all([teeHoldDone, natureReadyOrTimeout]).then(() => {
      markPerf(round.course.name, this.hole.number, 'intro-travel-start');
      beginTravel();
    });
  }

  /** Cancel the intro flyover and hand control over immediately. */
  skipIntro(): void {
    this.introSkipped = true;
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
    } else if (cam === 'club') {
      // Golfer/club close-up: side-on view of the golfer at address so the whole
      // club (grip to head) reads against the sky (equipment QA).
      const f = this.fwd3(this.aim.yaw);
      const side = new Vector3(-f.z, 0, f.x);
      const base = w2b(h.tee.x, h.tee.y, this.gh(h.tee.x, h.tee.y));
      this.camTarget.pos = base.add(f.scale(7.5)).add(side.scale(3.2)).add(new Vector3(0, 2.4, 0));
      this.camTarget.look = base.add(f.scale(0.6)).add(new Vector3(0, 1.2, 0));
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

  /** Club-lab hook (tests/visual/clublab.spec.ts): swap the active golfer's
   *  procedural clubs for a ClubTuning variant and pick which one is in hand,
   *  so equipment proportions can be reviewed without touching defaults. */
  clubLab(tuning: Partial<ClubTuning> | undefined, kind: 'swing' | 'driver' | 'putter'): void {
    this.golfer.rebuildClubs(tuning);
    this.golfer.setClubKind(kind);
  }

  /** Club-lab camera: equipment close-ups around the addressed ball. 'hero'
   *  frames the whole golfer + club; 'face' is a tight front view of the
   *  head; 'edge' looks in from the ball side; 'top' looks straight down so
   *  the head's front-to-back depth reads against the shaft and ball.
   *  Close-ups shoot from the golfer→ball side, which is never occluded. */
  clubLabView(view: 'hero' | 'face' | 'edge' | 'top'): void {
    const b = this.ball.position;
    const g = this.golfer.root.position;
    const f = this.fwd3(this.aim.yaw);
    let ax = b.x - g.x;
    let az = b.z - g.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    if (view === 'hero') {
      this.camera.position.set(b.x + f.x * 14 + ax * 5.5, b.y + 4.2, b.z + f.z * 14 + az * 5.5);
      this.camera.setTarget(new Vector3(g.x, g.y + 3.0, g.z));
    } else if (view === 'face') {
      this.camera.position.set(b.x + f.x * 4.2 + ax * 1.2, b.y + 1.3, b.z + f.z * 4.2 + az * 1.2);
      this.camera.setTarget(new Vector3(b.x, b.y + 0.3, b.z));
    } else if (view === 'edge') {
      this.camera.position.set(b.x + ax * 4.4 + f.x * 0.5, b.y + 1.2, b.z + az * 4.4 + f.z * 0.5);
      this.camera.setTarget(new Vector3(b.x, b.y + 0.3, b.z));
    } else {
      // Near-vertical (a hair off plumb so the up-vector never degenerates).
      this.camera.position.set(b.x + f.x * 1.2, b.y + 5.2, b.z + f.z * 1.2);
      this.camera.setTarget(new Vector3(b.x, b.y, b.z));
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
    this.pal?.setSizeMult(putting ? HoleScene.PUTT_GOLFER_SCALE : 1);
    this.ballScale = putting ? HoleScene.PUTT_BALL_SCALE : 1;
    this.balls.forEach((b) => b.scaling.setAll(this.ballScale));
  }

  /** Perch the human player's pal for this shot: beside the ball on a full
   *  shot, or over by the cup when putting. AI turns get no pal. */
  private perchPal(): void {
    if (this.turnIdx !== 0 || !this.pal) return;
    const bp = this.state.ballPos;
    if (this.aim.isPutting) this.pal.setCupTarget(this.hole.pin.x, this.hole.pin.y, bp.x, bp.y);
    // On the tee shot, send the pal further out into the fairway (the wide open
    // view has room and it reads better ahead of the golfer).
    else this.pal.setTarget(bp.x, bp.y, this.aim.yaw, this.state.lie === 'tee' ? 14 : 0);
  }

  /** Show/hide the putt grid, and when putting re-point it (and the break
   *  dots) down the golfer→hole line so break reads along/across your putt.
   *  Also shown on a SHORT chip (ball close to the pin, off the tee) so you can
   *  read the green you're pitching onto (playtest: "chipping from really close
   *  I want to see the putting grid"). */
  private syncPuttGrid(): void {
    const toPinYds =
      Math.hypot(this.hole.pin.x - this.state.ballPos.x, this.hole.pin.y - this.state.ballPos.y) /
      PX_PER_YARD;
    const on = shouldShowPuttGrid({
      isPutting: this.aim.isPutting,
      isAI: !!this.ai,
      lie: this.state.lie,
      toPinYds
    });
    this.puttGrid.setEnabled(on);
    if (on) this.course3d.orientPuttAids(this.state.ballPos.x, this.state.ballPos.y);
  }

  beginTurn(): void {
    markPerf(round.course.name, this.hole.number, 'begin-turn');
    // Default the scatter drain back on; armMeter re-pauses it for a human's
    // live meter. AI/gimme turns never arm, so the scatter keeps filling fast.
    // Un-park the camera here too: a human turn re-parks it in armMeter (below),
    // while an AI/flyover turn leaves it un-parked so the mirror + shadow map
    // animate live under the moving camera.
    renderPacing.meterActive = false;
    renderPacing.cameraParked = false;
    shotCapture.setRotationPaused(false);
    skipBtn.style.display = 'none'; // the flyover is over (skipped or finished)
    this.hideTrueVision(); // clear any stale reveal from the previous shot
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
    // The pal trots over to its perch (beside the ball, or by the cup when
    // putting) and does its little address dance (their turn only).
    this.perchPal();
    this.pal?.setAiming(this.turnIdx === 0 && !this.ai);
    this.golfer.setPose(0);
    this.golfer.aiming = true;
    this.ball.position = w2b(bp.x, bp.y, this.ballRestH() + this.gh(bp.x, bp.y));
    this.syncPuttGrid();
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
      tourBoardBtn.style.display = 'none';
      trueVisionBtn.style.display = 'none';
      this.aiTurn();
      return;
    }
    // Human turn: arm the meter and leave it on screen showing the target
    this.armMeter();
    clubBar.style.display = 'flex';
    aerialBtn.style.display = 'block';
    // Tournament rounds keep the live leaderboard one tap away (🏆).
    tourBoardBtn.style.display = aiTour ? 'block' : 'none';
    this.refreshTrueVisionBtn();
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

  /** Shared aim-dot scale: putting keeps a fine string of dots (a touch
   *  larger overhead so it still reads from the higher camera); a full shot
   *  only grows its dots in the aerial view, scaled to the shot's span so a
   *  long drive's dots don't vanish at that altitude. Shared by the white
   *  aim guide and the True Vision reveal so both read consistently. */
  private aimDotScale(span: number): number {
    return this.aim.isPutting
      ? this.aerial
        ? 0.7
        : 0.42
      : this.aerial
        ? Math.min(9, Math.max(4, span / 120))
        : 1;
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
    // Putting: shrink the ball→cup aiming dots (and target ring) so the line is
    // a fine string of dots, not fat discs that hide the read (playtest). The
    // moving break-flow dots (breakDots.ts) are a separate mesh, unaffected.
    // Putting keeps its fine aim dots even in the overhead view (a touch larger
    // there so they read from the higher camera); only a FULL-shot aerial uses
    // the big span-scaled dots.
    const dotScale = this.aimDotScale(span);
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
    // Interpolate the true touchdown between the discrete 1/60s path samples:
    // a driver covers ~2-3yd per sample near landing, so snapping the readout/
    // ring to whole samples made the aim number hop ~5yd at a time while
    // dragging (playtest). The z-crossing fraction pins the exact ground point.
    let target: { x: number; y: number };
    if (this.aim.isPutting || landIdx < 0) {
      target = this.aim.aimPoint(this.state.ballPos);
    } else if (landIdx > 0 && path![landIdx - 1].z > 0.01) {
      const a = path![landIdx - 1];
      const b = path![landIdx];
      const t = (a.z - 0.01) / Math.max(1e-6, a.z - b.z);
      target = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    } else {
      target = path![landIdx];
    }
    const curved = !this.aim.isPutting && landIdx > 4;
    this.aimDots.forEach((dot, i) => {
      const f = (i + 1) / (this.aimDots.length + 1);
      let dx: number;
      let dy: number;
      if (curved) {
        // The strike shape curves the AIR path, so tracing to carry-landing
        // shows the draw/fade bend directly.
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
      // Read up/downhill from the SAME slope field the ball actually rolls
      // through (slopeAccelAlong — what breakAccel integrates and the AI paces
      // off), not a loose geometric projection, so the read is CONSISTENT with
      // what the putt does. Measured along ball→CUP at the cup distance — a
      // stable terrain read that doesn't change as the player drags the aim
      // marker (dragging used to inflate the shown rise, FB feedback "putting
      // distance on hills seems off"). Sized so the player's rule of thumb —
      // "aim ~1 ft longer for every 2 in uphill" — holes the putt for any
      // length or slope: the shown rise is 2× the extra aim the pace model
      // needs (extra fraction = -aPar/μ, μ = green friction), which is why
      // 2 in → +1 ft, 4 in → +2 ft, 2 ft → +12 ft.
      const pdx = this.hole.pin.x - bx;
      const pdy = this.hole.pin.y - by;
      const cupLen = Math.hypot(pdx, pdy) || 1;
      const aPar = this.engine2d.slopeAccelAlong(this.state.ballPos, Math.atan2(pdy, pdx), cupLen);
      const extraAimFt = cupLen * (-aPar / PHYSICS.friction.green) * 1.5; // +uphill ⇒ aim longer
      elevFt = extraAimFt / 6; // rise(ft) = 2·extraAim(in) → shown as inches below
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
    this.syncPuttGrid();
    this.setPinPulled(this.aim.isPutting);
    this.armMeter();
    this.updateStrikeUI();
    this.updateAimVisuals();
    this.updateHud();
    this.refreshClubBar();
    // A stale reveal no longer matches the new club's flight — hide it the
    // moment the player cycles clubs.
    this.hideTrueVision();
    this.refreshTrueVisionBtn();
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
    // The overhead swap is a big camera move; re-capture the frozen reflection +
    // shadow map so they match the new vantage instead of holding the tee pose.
    this.course3d.refreshParkedRTTs();
  }

  /** Show/hide/relabel the True Vision button for the current turn — only
   *  while a human is putting and still has charges. */
  private refreshTrueVisionBtn(): void {
    const remaining = chargesRemaining(profile, TRUE_VISION.id) + roundTrueVisionBonus;
    const show = this.state.phase === 'aiming' && !this.ai && this.aim.isPutting && remaining > 0;
    trueVisionBtn.style.display = show ? 'block' : 'none';
    trueVisionBtn.textContent = `${TRUE_VISION.icon} TRUE VISION (${remaining})`;
  }

  /** Arc-length-resample a path into exactly `n` evenly spaced points, so
   *  dash spacing along the True Vision line stays even even where the ball
   *  is slowing down (samples bunch up near the end of a real putt path). */
  private resamplePathByArcLength(path: TrajectoryPoint[], n: number): TrajectoryPoint[] {
    if (path.length < 2) return path.length ? Array(n).fill(path[0]) : [];
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    const total = cum[cum.length - 1];
    const out: TrajectoryPoint[] = [];
    for (let k = 0; k < n; k++) {
      const target = total * (k / Math.max(1, n - 1));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
      const a = path[i - 1];
      const b = path[i];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 });
    }
    return out;
  }

  /** Populate the red dot pool along the revealed putt line — a "dashed" line
   *  falls out of spacing every other pooled dot farther apart than its own
   *  radius (same trick the plan calls for, no new geometry). Populated once
   *  on tap; NOT touched by the per-frame updateAimVisuals() redraw. `scale`
   *  matches the white aim guide's own putt-dot scale (aimDotScale) so the
   *  reveal stays legible in the overhead putt view the same way. */
  private showTrueVisionPath(path: TrajectoryPoint[], scale: number): void {
    const pts = this.resamplePathByArcLength(path, this.trueVisionDots.length);
    this.trueVisionDots.forEach((dot, i) => {
      if (i % 2 === 1) {
        dot.scaling.setAll(0); // the "dash" gaps
        return;
      }
      const p = pts[i] ?? pts[pts.length - 1];
      dot.position = w2b(p.x, p.y, 0.12 + this.gh(p.x, p.y));
      dot.scaling.setAll(scale);
    });
    this.trueVisionRoot.setEnabled(true);
  }

  private hideTrueVision(): void {
    this.trueVisionRoot.setEnabled(false);
  }

  /** Tap handler (putting only): consume one charge, simulate the putt the
   *  player is CURRENTLY AIMED AT on the real, slope-aware engine2d
   *  (deliberately NOT the flat previewEngine the ordinary white aim line
   *  uses), and show the true result as a red dashed line — where the ball
   *  actually rolls and ends up — that stays up until the aim changes or the
   *  putt is struck. */
  private revealTrueVision(): void {
    if (this.state.phase !== 'aiming' || this.ai || !this.aim.isPutting) return;
    // Spend the free round bonus first (ephemeral, nothing to persist); only
    // touch the player's owned/persisted charges once the bonus is gone.
    holeFactsFor(this.hole.number).usedTrueVision = true; // mastery: "without True Vision" stars
    if (roundTrueVisionBonus > 0) {
      roundTrueVisionBonus -= 1;
    } else if (consumeCharge(profile, TRUE_VISION.id)) {
      // Persist OFF the pointerdown path: the localStorage write + Firebase
      // sync used to run synchronously inside this tap handler, right before
      // the slope-aware putt simulation — a visible hitch on the True Vision
      // tap. The charge is already consumed in memory; a ~300ms deferral
      // changes nothing about correctness (the same persist runs at
      // end-of-round anyway) and keeps the tap frame clean.
      setTimeout(() => {
        persistProfile();
        if (signedIn)
          void cloudSyncProfile(profile).then((res) => {
            applyCloudMerge(profile, res.profile);
            showCloudStatus(res.status, true);
          });
      }, 300);
    } else {
      return;
    }
    const ctx = this.ctx();
    const path = computeTrueVisionPath(this.engine2d, this.hole, ctx, {
      aimAngle: this.aim.yaw,
      power: this.aim.barToPhysicsPower(this.aim.barPowerTarget(ctx), ctx),
      club: this.aim.club,
      wind: this.wind,
      spin: this.strike.shapeSpin,
      launchMult: this.strike.launchMult
    });
    const end = path[path.length - 1] ?? ctx.ball;
    const span = Math.hypot(end.x - ctx.ball.x, end.y - ctx.ball.y);
    this.showTrueVisionPath(path, this.aimDotScale(span));
    this.refreshTrueVisionBtn();
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
    this.syncPuttGrid();
    this.setPinPulled(this.aim.isPutting);
    this.setCamSetup();
    this.updateHud();
    setTimeout(() => {
      if (this.disposed || this.state.phase !== 'aiming') return;
      this.executeShot(decision.swing, true);
    }, 1100);
  }

  /** Last HUD markup written — skip the innerHTML write (style/layout work)
   *  when a drag-to-aim pointermove didn't actually change what's shown. */
  private lastHudHtml = '';

  private updateHud(): void {
    const toPin = this.engine2d.yardsToPin(this.state.ballPos);
    const club = this.aim.club;
    const carry = Math.round(this.aim.maxCarryPx(this.ctx()) / PX_PER_YARD);
    const distLabel = club.id === 'putter' ? `${Math.round(toPin * 3)} ft` : `${carry} yd`;
    const pinLabel = this.state.lie === 'green' ? `${Math.round(toPin * 3)} ft` : `${Math.round(toPin)} yd`;
    // Wind arrow rendered relative to the aim direction (up = down the line).
    // Quantized to ~1.8° so a tiny aim wiggle doesn't defeat the HUD write
    // cache below — visually indistinguishable, but most drag moves skip the
    // innerHTML rebuild entirely.
    const rel = Math.round((this.wind.angle - this.aim.yaw - Math.PI / 2) * 32) / 32;
    const html =
      `<div class="row"><span class="chip club">${club.name}</span><span class="chip">${distLabel}</span>` +
      `<span class="chip wind"><span class="arrow" style="transform:rotate(${rel}rad)">➤</span> ${this.wind.speed}</span></div>` +
      `<div class="row"><span class="chip pin">⛳ ${pinLabel}</span><span class="chip">${this.state.lie}</span>` +
      `<span class="chip">H${this.hole.number} · S${this.state.strokes}</span><span class="chip score">${scoreToPar(this.curPart())}</span></div>` +
      (round.mode !== 'solo'
        ? `<div class="row"><span class="chip player">${this.curPart().golfer.name}${this.curPart().isAI ? ' (to play)' : ' (you)'}</span></div>`
        : '');
    if (html !== this.lastHudHtml) {
      this.lastHudHtml = html;
      hudEl.innerHTML = html;
    }
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
    markPerf(round.course.name, this.hole.number, 'shot-resolved');
    this.state.phase = 'swinging';
    // Meter's done and the flight camera is about to take over: let the scatter
    // finish filling AND release the mirror/shadow freeze so they animate live
    // through the flight.
    renderPacing.meterActive = false;
    renderPacing.cameraParked = false;
    shotCapture.setRotationPaused(false);
    this.pal?.setAiming(false); // stop the address dance once the swing starts
    this.aimRoot.setEnabled(false);
    this.hideTrueVision(); // "stays up until the shot is struck" ends here
    this.aerial = false;
    aerialBtn.classList.remove('on');
    clubBar.style.display = 'none';
    aerialBtn.style.display = 'none';
    tourBoardBtn.style.display = 'none';
    trueVisionBtn.style.display = 'none';
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
    // pre-shot SHAPE (strike-pad draw/fade) rides ON the launch and curves the
    // ball in the air; the live spin channel starts empty and carries only the
    // in-flight SWIPE (which kicks on landing) plus any top spin.
    const shaping = !this.aim.isPutting;
    const shape = !shaping
      ? { side: 0, top: 0 }
      : this.ai
        ? { ...(this.aiSpin ?? { side: 0, top: 0 }) }
        : { ...this.strike.shapeSpin };
    const launchMult = !shaping ? 1 : this.ai ? 1 - shape.top * 0.18 : this.strike.launchMult;
    const spin = { side: 0, top: shape.top };
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
      spin: shape,
      launchMult,
      riskMult: shaping && !this.ai ? this.strike.riskMult : 1,
      // Pre-shot stroke count (0 = tee shot) → recovery shots get a more
      // forgiving tree hitbox.
      stroke: this.state.strokes
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
        const isDefaultTrail = tint === 0xffffff;
        // Unlit: the trail glows its own tint instead of being washed toward
        // white by the sun's diffuse term, so Comet reads blue, Ember orange,
        // etc. (playtest: "trails all look like the white default").
        tmat.disableLighting = true;
        // An equipped trail colour ALWAYS wins — a hot streak only recolours the
        // plain default trail to a fiery orange; a chosen colour (e.g. blue
        // Comet) keeps its hue and simply burns brighter, so a paid cosmetic is
        // never overridden (playtest: "my blue comet trail shows up as red").
        const base = onFire && isDefaultTrail ? new Color3(1, 0.55, 0.15) : c3(tint);
        tmat.emissiveColor = onFire && !isDefaultTrail ? base.scale(1.4) : base;
        tmat.diffuseColor = new Color3(0, 0, 0);
        tmat.alpha = onFire ? 0.62 : 0.55;
        trail.material = tmat;
      }
      this.flight = {
        outcome,
        progress: 0,
        landIdx,
        dir: this.aim.yaw,
        isPutt: club.id === 'putter',
        landed: false,
        landPos: null,
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
    const facts = holeFactsFor(this.hole.number);
    facts.windSpeed = this.wind.speed;
    const teeShot = dist(origin, this.hole.tee) < 3;
    if (teeShot && this.hole.par >= 4) {
      shotAcc.fairwaysPossible++;
      if (['fairway', 'green', 'fringe'].includes(outcome.surface)) {
        shotAcc.fairwaysHit++;
        facts.fairway = true;
      }
    }
    if (teeShot && (club.id === 'driver' || club.id === '3w' || club.id === '5w')) {
      shotAcc.longestDriveYds = Math.max(shotAcc.longestDriveYds, dist(origin, outcome.finalPos) / PX_PER_YARD);
    }
    // Hazard contact for the hole's mastery facts (water counts even after
    // the drop; sand counts when the ball FINISHES in it).
    if (outcome.waterPenalty) facts.water = true;
    if (outcome.surface === 'sand') facts.sand = true;
    if (this.fires[this.turnIdx].isOnFire) {
      facts.onFire = true;
      shotAcc.fireStreakBest = Math.max(shotAcc.fireStreakBest, this.fires[this.turnIdx].currentStreak);
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
    // Approach quality: a non-putt that finishes ON the green records its
    // distance to the pin (closest-approach record + "stick it close" star).
    if (club.id !== 'putter' && outcome.surface === 'green' && !outcome.holed) {
      const ft = (dist(outcome.finalPos, this.hole.pin) / PX_PER_YARD) * 3;
      facts.approachFt = facts.approachFt === null ? ft : Math.min(facts.approachFt, ft);
      shotAcc.closestApproachFt =
        shotAcc.closestApproachFt === null ? ft : Math.min(shotAcc.closestApproachFt, ft);
    }
    if (club.id === 'putter') {
      shotAcc.holePutts[this.hole.number] = (shotAcc.holePutts[this.hole.number] ?? 0) + 1;
    }
    if (outcome.holed && club.id === 'putter') {
      shotAcc.puttsMade++;
      const puttFt = (dist(origin, this.hole.pin) / PX_PER_YARD) * 3;
      shotAcc.longestPuttMadeFt = Math.max(shotAcc.longestPuttMadeFt, puttFt);
      facts.longestPuttFt = Math.max(facts.longestPuttFt, puttFt);
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
      // ADJ-3 input-latency: the "ignored taps" complaint is event DISPATCH
      // latency — a pointerdown queued behind a long render frame runs late.
      // e.timeStamp is the input's creation time (same epoch as performance.now),
      // so `now - timeStamp` is the true CPU-side tap latency, immune to the
      // headless rAF throttle. Record it before any work in the handler.
      const tapLatency = performance.now() - (e.timeStamp || performance.now());
      markPerf(round.course.name, this.hole.number, 'tap-received', tapLatency);
      startAmbience();
      if (this.state.phase !== 'aiming') return;
      promptEl.textContent = '';
      if (!meter.isArmed) this.armMeter();
      meterEl.style.display = 'block';
      // Defer the shot-capture recorder's segment swap only across the brief
      // mid-swing tap sequence (a couple seconds) — NOT the whole addressing/
      // aiming window before it. Pausing from armMeter() onward let rotation
      // stay deferred for however long a deliberate player spent aiming, so a
      // segment (and therefore a saved clip) could balloon to 30-40+ seconds
      // (bug report: "one clip was 43 seconds") and land the boundary right
      // at the swing instead of a fixed ~10s cadence. Un-paused on shot
      // execution and on cancel below.
      shotCapture.setRotationPaused(!isFrozen());
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
      // After the ball is down, a tap skips the rest of a long roll-out
      // (slopey greens can trickle for many seconds — playtest): jumping the
      // playback to the end makes the next tick land on the existing terminal
      // branch, which places the ball at rest and hands the turn over.
      if (this.state.phase === 'flying' && this.flight?.landed) {
        this.flight.progress = this.flight.outcome.path.length;
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
      // While the drag lasts, let the parked water mirror + shadow map track
      // the reframing camera at their normal live cadence instead of forcing a
      // full fresh capture per pointermove (see armMeter).
      this.course3d.aimDragRTTs(true);
      this.golfer.placeAt(this.state.ballPos.x, this.state.ballPos.y, this.aim.yaw, this.gh(this.state.ballPos.x, this.state.ballPos.y));
      this.perchPal();
      this.setCamSetup();
      this.updateAimVisuals();
      this.updateHud();
      // A stale reveal no longer matches the new aim — hide it the moment the
      // player drags to a different direction/distance.
      this.hideTrueVision();
      // Distance changed → the meter's power target moved; re-arm so the target
      // line (and putt scaling) track the new aim.
      if (meter.isArmed) this.armMeter(true);
    };
    this.onPointerUp = (): void => {
      this.swipeLast = null;
      const wasAiming = this.aim.isDragging;
      this.aim.endDrag();
      // Drag over: capture one final fresh frame of each parked RTT, then hold
      // it frozen so armed-idle frames go back to being cheap.
      if (wasAiming) this.course3d.aimDragRTTs(false);
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.onPrevClub = () => this.cycleClub(-1);
    this.onNextClub = () => this.cycleClub(1);
    this.onAerial = () => this.toggleAerial();
    this.onTrueVision = () => this.revealTrueVision();
    this.onSkip = (e) => {
      e.preventDefault();
      this.skipIntro();
    };
    document.getElementById('prevClub')!.addEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.addEventListener('pointerdown', this.onNextClub);
    aerialBtn.addEventListener('pointerdown', this.onAerial);
    trueVisionBtn.addEventListener('pointerdown', this.onTrueVision);
    skipBtn.addEventListener('pointerdown', this.onSkip);
    // Roll the shot-capture buffer for the whole time this hole is on screen so
    // "save my last shot" always has the recent seconds ready — but ONLY when
    // the player has opted in (continuous MediaRecorder encode is real
    // per-frame work; see the capture button wiring).
    if (deviceSettings.clipCapture) shotCapture.start();
    if (captureBtn) {
      captureBtn.style.display = shotCapture.supported ? 'block' : 'none';
      captureBtn.textContent = deviceSettings.clipCapture ? '🎥 REC' : '🎥 CLIP';
    }

    meter.onComplete = (result) => this.executeShot(result);
    // ADJ-3: route each meter phase transition into the perf ring so the spec can
    // reconstruct the pointerdown→state→power-lock→accuracy-lock→first-frame chain.
    meter.onPhaseMark = (phase) => markPerf(round.course.name, this.hole.number, `meter:${phase}`);
    meter.onBand = (kind, band) => {
      const label = band === 'perfect' ? 'PERFECT!' : band === 'good' ? 'Good' : 'Miss!';
      showMsg(`${kind === 'power' ? 'Power' : 'Accuracy'}: ${label}`, 500);
    };
    // Letting the accuracy cursor run back to the start (no tap) bails out of
    // the shot entirely — no stroke, no swing. Re-arm immediately so the bar
    // is right back up ready to go, and the player can drag to re-aim.
    meter.onCancel = () => {
      shotCapture.setRotationPaused(false);
      if (this.state.phase !== 'aiming' || this.ai) return;
      showMsg('Cancelled — re-aim', 700);
      this.armMeter();
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
    // The swipe window closes at the TRUE bounce sample, not the playback-
    // detected landing (which lags it by a few samples): re-integrating with
    // new spin re-shapes the bounce, and re-shaping a bounce the player has
    // ALREADY WATCHED teleports the ball ("spun just as it landed and it
    // ended up 48ft away" — the spin retroactively rewrote the landing).
    if (Math.floor(fl.progress) >= fl.landIdx - 2) return;
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
  private onTrueVision!: () => void;
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
    // tracks the smoothing camera). Scratch objects reused per frame — this
    // block runs every aiming frame and used to allocate a Vector3 + identity
    // Matrix + Viewport each time (GC churn during the aim/idle window).
    if (this.aimReadoutWorld && this.state.phase === 'aiming' && !this.ai) {
      const wp = w2b(this.aimReadoutWorld.x, this.aimReadoutWorld.y, this.gh(this.aimReadoutWorld.x, this.aimReadoutWorld.y) + 4);
      this._readoutViewport.width = engine3d.getRenderWidth();
      this._readoutViewport.height = engine3d.getRenderHeight();
      const s = Vector3.Project(
        wp,
        this._identity,
        this.scene.getTransformMatrix(),
        this._readoutViewport
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
        // Dispose the trail's material + textures with it — each shot creates a
        // fresh StandardMaterial, and plain dispose() leaves it registered on
        // the scene until hole teardown (materials accumulated per shot).
        this.flight.trail?.dispose(false, true);
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
          this.flight.landPos = { x: p.x, y: p.y };
          if (!this.flight.isPutt) {
            this.setCamLanding({ x: p.x, y: p.y }, this.flight.dir);
            this.landingPuff(p.x, p.y, this.engine2d.surfaceAt(p.x, p.y) === 'sand');
            // A long slopey-green trickle can play out for many seconds — offer
            // the skip (a tap jumps to the resting spot) when there's a real
            // roll left to watch.
            if (this.flight.outcome.path.length - i > 70 && !this.flight.outcome.holed) {
              promptEl.textContent = 'tap to skip the roll ⏩';
            }
          }
        } else if (this.flight.landed && !this.flight.isPutt && this.flight.landPos) {
          // Track the ROLLING ball, not the landing spot: a checked-up wedge
          // stays framed, but a spun/topspin rollout used to run clean out of
          // the landing camera's frame (playtest: "the camera should track
          // where the ball goes, not where it lands"). Look always follows the
          // ball; once the roll travels meaningfully past the touchdown, the
          // camera body starts trailing it too (same offset as setCamLanding,
          // smoothed by the normal camera lerp so short rolls never jitter).
          const rollDist = Math.hypot(bx - this.flight.landPos.x, by - this.flight.landPos.y);
          this.camTarget.look = w2b(bx, by, this.gh(bx, by));
          if (rollDist > 22) {
            const f = this.fwd3(this.flight.dir);
            this.camTarget.pos = w2b(bx, by, this.gh(bx, by)).subtract(f.scale(26)).add(new Vector3(0, 9, 0));
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

    // Fade any tree canopy standing between the camera and the golfer (a torso-
    // height point above the root, since the root sits at ground level) so the
    // character never vanishes behind foliage the camera is looking through.
    // Scratch vector reused each frame (this runs every frame; updateTreeOcclusion
    // itself only recomputes 1 frame in 4) — avoids a per-frame Vector3 alloc.
    this._golferHead.copyFrom(this.golfer.root.getAbsolutePosition());
    this._golferHead.y += 3;
    this.course3d.updateTreeOcclusion(this.camera.position, this._golferHead);
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

  /** Test hook: force the tree-occlusion fade with a synthetic camera position
   *  and report how many ghost (translucent stand-in) meshes are currently
   *  showing — lets Playwright verify the fade without needing the real
   *  camera to be looking through a tree (Playwright verification). */
  debugTreeOcclusion(camX: number, camY: number, camZ: number): number {
    const gp = this.golfer.root.getAbsolutePosition();
    const golferHead = new Vector3(gp.x, gp.y + 3, gp.z);
    const cam = new Vector3(camX, camY, camZ);
    for (let i = 0; i < 8; i++) this.course3d.updateTreeOcclusion(cam, golferHead);
    return this.scene.meshes.filter((m) => m.name.startsWith('ghost')).length;
  }

  /** Read-only occlusion diagnostics for the Playwright fade guard. */
  golferAbs(): { x: number; y: number; z: number } {
    const p = this.golfer.root.getAbsolutePosition();
    return { x: p.x, y: p.y, z: p.z };
  }
  occlusionCandidates(): Array<{ x: number; y: number; r: number; parts: number }> {
    return this.course3d.occlusionCandidates();
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

  /** Test hook: feed two synthetic all-perfect swings into the current
   *  competitor's streak so the "on fire" ignite message fires deterministically
   *  (real timed input can't be scripted precisely enough for capture tooling). */
  debugIgniteFire(): void {
    const fire = this.fires[this.turnIdx];
    const perfect: SwingResult = { power: 1, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' };
    fire.recordSwing(perfect);
    if (fire.recordSwing(perfect)) {
      // Long-held banner (vs. the real 1600ms) — screenshot capture tooling
      // needs the message to still be up after page.screenshot()'s own
      // (non-trivial, GPU-render-dependent) capture latency.
      showMsg(`🔥 ${this.curPart().golfer.name} is ON FIRE!`, 8000);
    }
  }

  dispose(): void {
    this.disposed = true;
    // Cancel any still-pending intro-flyover timers outright (they were only
    // no-op'd by the disposed guard before — harmless, but the timers
    // lingered past scene teardown).
    for (const t of this.introTimers) clearTimeout(t);
    this.introTimers.length = 0;
    swingBtn.removeEventListener('pointerdown', this.onSwingTap);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    document.getElementById('prevClub')!.removeEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.removeEventListener('pointerdown', this.onNextClub);
    aerialBtn.removeEventListener('pointerdown', this.onAerial);
    trueVisionBtn.removeEventListener('pointerdown', this.onTrueVision);
    skipBtn.removeEventListener('pointerdown', this.onSkip);
    skipBtn.style.display = 'none';
    strikePadEl.removeEventListener('pointerdown', this.onStrikeDown);
    window.removeEventListener('pointermove', this.onStrikeMove);
    window.removeEventListener('pointerup', this.onStrikeUp);
    meter.onComplete = null;
    meter.onCancel = null;
    meter.hide();
    clubBar.style.display = 'none';
    aerialBtn.style.display = 'none';
    trueVisionBtn.style.display = 'none';
    shotShapeEl.style.display = 'none';
    shotCapture.stop();
    if (captureBtn) captureBtn.style.display = 'none';
    this.scene.dispose();
  }
}

// -------------------------------------------------------- round orchestration

let current: HoleScene | null = null;
const holesThisRound = (): number => Math.min(RULES.holesPerRound, round.course.holes.length);

/** Play one hole. Every competitor plays it in a single scene (alternating
 *  turns for 1v1/scramble); the callback returns each competitor's strokes. */
const loadingEl = document.getElementById('loading');
function showLoading(msg = 'Loading course…'): void {
  const txt = document.getElementById('loadingTxt');
  if (txt) txt.textContent = msg;
  loadingEl?.classList.add('on');
}
function hideLoading(): void {
  loadingEl?.classList.remove('on');
}
/** Show the loading veil, wait for it to actually PAINT, then run a heavy,
 *  main-thread-blocking build — so tapping "Tee off" gives instant feedback
 *  instead of a frozen menu while the course bakes. A double rAF guarantees the
 *  browser has committed a frame with the veil up before we block; a short
 *  setTimeout fallback still runs the build where rAF is throttled (headless /
 *  backgrounded tabs). The veil lifts one frame after the build so the fresh
 *  course paints first. Runs `build` exactly once. */
function buildWithLoading(build: () => void): void {
  showLoading();
  let ran = false;
  const go = (): void => {
    if (ran) return;
    ran = true;
    try {
      build();
    } finally {
      requestAnimationFrame(() => requestAnimationFrame(() => hideLoading()));
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 150);
}

/** Stars newly earned this round (hole → star tiers), for the results screen.
 *  Reset wherever shotAcc resets (round start paths). */
let roundNewStars: Array<{ hole: number; star: 1 | 2 | 3 }> = [];

/** Common per-round-start bookkeeping shared by every entry point (menu
 *  start, tournament entry, AI-tour round): reset the round-scoped retention
 *  accumulators and emit round_started. */
function beginRoundTracking(): void {
  roundNewStars = [];
  roundStartedAt = Date.now();
  analytics.track('round_started', {
    course: courseIdByName(round.course.name),
    mode: round.mode
  });
}

/** Fold the HUMAN player's completed hole into the permanent mastery state
 *  (Part 5). Runs at hole completion, off the input path; duplicate stars are
 *  structurally impossible (bitmask OR). */
function applyHoleMasteryForHuman(holeIdx: number, strokes: number): void {
  const hole = round.course.holes[holeIdx];
  if (!hole || !strokes) return;
  const courseId = courseIdByName(round.course.name);
  const facts = shotAcc.holeFacts[hole.number] ?? freshHoleFacts();
  const input: HoleMasteryInput = {
    courseId,
    holeNumber: hole.number,
    par: hole.par,
    strokes,
    usedTrueVision: facts.usedTrueVision,
    fairwayHit: facts.fairway,
    gir: shotAcc.girHoles.has(hole.number),
    waterHit: facts.water,
    sandHit: facts.sand,
    longestPuttFt: facts.longestPuttFt,
    approachFt: facts.approachFt,
    onFire: facts.onFire,
    windSpeed: facts.windSpeed
  };
  const res = applyHoleMastery(profile.retention.mastery, input, thirdStarFor(courseId, hole.number));
  for (const star of res.newStars) {
    roundNewStars.push({ hole: hole.number, star });
    analytics.track('mastery_star_earned', { mastery_star_id: `${courseId}:${hole.number}:${star}`, course: courseId });
  }
}

function playHole(): void {
  current?.dispose();
  // Restore the gameplay chrome the results screen hid.
  swingBtn.style.display = '';
  hudEl.style.display = '';
  current = new HoleScene((scores) => {
    round.players.forEach((p, i) => {
      p.scores[round.holeIdx] = scores[i] ?? 0;
    });
    applyHoleMasteryForHuman(round.holeIdx, scores[0] ?? 0);
    round.holeIdx += 1;
    if (round.holeIdx < holesThisRound()) {
      playHole();
    } else {
      showSummary();
    }
  });
  exposeDebug();
}

/** The canonical Play Next rotation (Part 1): a simple, predictable order the
 *  player can learn. Unavailable courses are skipped safely. */
const PLAY_NEXT_ROTATION = ['sablebay', 'wildwood', 'timberline', 'portjohnson'];
function nextCourseIdAfter(cur: string): string {
  const i = PLAY_NEXT_ROTATION.indexOf(cur);
  for (let step = 1; step <= PLAY_NEXT_ROTATION.length; step++) {
    const cand = PLAY_NEXT_ROTATION[((i < 0 ? 0 : i) + step) % PLAY_NEXT_ROTATION.length];
    if (COURSES[cand]) return cand;
  }
  return DEFAULT_COURSE_ID;
}

/**
 * ONE contextual next objective (Part 1) — deterministic priority: daily
 * challenge open → nearby mastery star → personal best within 1–2 → Season
 * Pass level nearly reached → next-course suggestion. Only one line, ever.
 */
function nextObjectiveLine(courseId: string, total: number, prevBestTotal: number | null): string {
  const key = todayKey();
  const dailyDone = profile.daily.date === key && profile.daily.done;
  if (!dailyDone) {
    return `Today's challenge: ${effectiveDailyChallenge(key).name} (+${COINS.daily} 🪙 +${XP.daily} XP)`;
  }
  const holes = round.course.holes.slice(0, holesThisRound()).map((h) => ({ number: h.number, par: h.par }));
  const hint = nextStarHint(profile.retention.mastery, courseId, holes, MASTERY_CHALLENGES);
  if (hint) return `⭐ ${hint.label}`;
  if (prevBestTotal !== null && total > prevBestTotal && total - prevBestTotal <= 2) {
    return `${total - prevBestTotal === 1 ? 'One stroke' : 'Two strokes'} from your ${round.course.name} best`;
  }
  if (seasonActive(SEASON_1, Date.now())) {
    const lp = levelProgress(SEASON_1, profile.season.id === SEASON_1.id ? profile.season.xp : 0);
    const toNext = lp.levelCost - lp.intoLevel;
    if (lp.level < SEASON_1.levels && toNext <= 120) return `${toNext} XP to your next Season Pass reward`;
  }
  const next = nextCourseIdAfter(courseId);
  return `Play ${COURSES[next].name} next to improve your course record`;
}

function showSummary(): void {
  current?.dispose();
  current = null;
  // Take the gameplay chrome down with the scene — the results card is the
  // whole screen's purpose now (leftover HUD/aim-readout/SWING read as noise
  // around the card). playHole() restores them for the next round.
  swingBtn.style.display = 'none';
  hudEl.style.display = 'none';
  promptEl.textContent = '';
  aimReadoutEl.style.display = 'none';
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
  // Progression runs BEFORE building the record so the round can carry the
  // post-round lifetime XP total (record.xp) — the admin surfaces per-account
  // XP from the public /rounds node off this field, no private-profile read.
  const rstats = buildRoundStats(holes, me.scores, totals, totalPar);
  const events = applyRound(profile, rstats, todayKey(), effectiveDailyChallenge(todayKey()));

  // ---- Retention layer (Part 1/2): records, 7-day streak, analytics -------
  const courseId = courseIdByName(round.course.name);
  // Previous course best BEFORE this round folds in (PB comparison line).
  const prevBest = profile.retention.records.bestByCourse[courseId]?.total ?? null;
  const recEvents: RecordEvent[] = applyRoundRecords(profile.retention.records, {
    courseId,
    courseName: round.course.name,
    total: totals[0],
    stats: rstats,
    fireStreakBest: shotAcc.fireStreakBest,
    closestApproachFt: shotAcc.closestApproachFt,
    now: Date.now()
  });
  // Streak: consecutive days with a completed round, with the once-per-cycle
  // protection token. profile.dailyStreak mirrors it for the legacy UI spots.
  const adv = advanceStreak(profile.retention.streak, todayKey());
  profile.retention.streak = adv.state;
  profile.dailyStreak = adv.state.current;
  if (adv.advanced) analytics.track('streak_advanced', { streak_length: adv.state.current });
  if (adv.usedProtection) analytics.track('streak_protection_used', { streak_length: adv.state.current });
  // Daily challenge completed this round → the day's streak reward (claimable
  // exactly once per date; cross-device claims union so it can never re-pay).
  const dailyEvent = events.find((e) => e.kind === 'daily');
  let streakRewardLine = '';
  if (dailyEvent) {
    analytics.track('daily_completed', { course: courseId, streak_length: adv.state.current });
    const claim = claimStreakReward(profile.retention.streak, todayKey());
    profile.retention.streak = claim.state;
    if (claim.reward) {
      profile.coins += claim.reward.coins;
      profile.coinsEarned += claim.reward.coins;
      profile.xp += claim.reward.xp;
      profile.level = levelForXp(profile.xp);
      const day = cycleDay(adv.state.current);
      streakRewardLine =
        `<div class="rwLine daily">🔥 Streak day ${day}: ` +
        `${claim.reward.coins ? `+${claim.reward.coins} 🪙 ` : ''}` +
        `${claim.reward.xp ? `+${claim.reward.xp} XP` : ''}` +
        `${claim.reward.milestone ? ' · week complete! 🏆' : ''}</div>`;
    }
  }
  const protectionLine = adv.usedProtection
    ? `<div class="rwLine daily">🛡 Streak protected — you missed a day, the weekly token covered it</div>`
    : '';
  analytics.track('round_completed', {
    course: courseId,
    mode: round.mode,
    score_to_par: totals[0] - totalPar,
    round_duration: roundStartedAt ? Math.round((Date.now() - roundStartedAt) / 1000) : 0
  });

  const record: RoundRecord = {
    id: makeRoundId(),
    d: Date.now(),
    course: round.course.name,
    mode: round.mode,
    names: round.players.map((p) => p.golfer.name).join(' & '),
    golferId: me.golfer.id,
    total: totals[0],
    toPar: totals[0] - totalPar,
    holes: me.scores.slice(0, holes.length),
    putts: holes.reduce((a, h) => a + (shotAcc.holePutts[h.number] ?? 0), 0),
    hputts: holes.map((h) => shotAcc.holePutts[h.number] ?? 0),
    uid: profile.id,
    xp: profile.xp
  };
  // Records/coins only persist for a signed-in account (account-gated model):
  // a signed-out round still plays and shows its rewards, but nothing is saved.
  // signedIn gates this, so profile.id is always the real Firebase uid here
  // (never the pre-sign-in "guest-…" id) — see adoptCloudAccount.
  if (signedIn) saveRound(record);
  // Season pass: the round's XP also advances the pass track (accrues for
  // everyone while the season runs; claiming needs the pass).
  const roundXp = events.find((e): e is Extract<RewardEvent, { kind: 'xp' }> => e.kind === 'xp');
  if (roundXp) {
    addSeasonXp(profile, SEASON_1, roundXp.amount, Date.now());
    updateSeasonLink();
  }
  // Burn one charge of the equipped perk (it applied to this round); unequip it
  // once spent. Runs once per completed round (all modes flow through here).
  if (profile.equippedPerk) {
    const entry = profile.perks.find((p) => p.id === profile.equippedPerk);
    if (entry && perkRemaining(entry) > 0) {
      entry.used += 1;
      if (perkRemaining(entry) <= 0) profile.equippedPerk = null;
    } else {
      profile.equippedPerk = null; // stale/exhausted reference
    }
  }
  persistProfile();
  if (signedIn)
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status);
    });

  // AI tournament round: fold this score in, simulate the field's rounds on
  // the same course, and show the updated standings. On the final round the
  // headline becomes the placement and the purse pays out.
  let aiTourBlock = '';
  let aiTourPurse = 0;
  if (aiTour) {
    completeRound(aiTour, COURSES, totals[0], totals[0] - totalPar);
    aiTourBlock = aiTourStandingsHtml(aiTour);
    if (isFinal(aiTour)) {
      const rank = aiTourStandings(aiTour).findIndex((r) => r.isPlayer) + 1;
      headline = rank === 1 ? '🏆 Tournament champion!' : `Tournament: ${ordinal(rank)} place`;
      aiTourPurse = purseFor(rank);
      profile.coins += aiTourPurse;
      persistProfile();
      if (signedIn)
        void cloudSyncProfile(profile).then((res) => {
          applyCloudMerge(profile, res.profile);
          showCloudStatus(res.status, true);
        });
    } else {
      headline = `Round ${aiTour.played}/${aiTour.courseIds.length} complete`;
    }
  }
  const tourBlock = round.tournament ? `<div id="tourResult" class="tourResult">Submitting to ${escapeHtml(round.tournament.name)}…</div>` : '';
  // Account-gated: signed-out rewards are shown but not kept — nudge to sign in.
  const signInNudge =
    !signedIn && authConfigured()
      ? `<div class="signInNudge">Sign in to keep these coins & save your progress.</div>`
      : '';
  const purseLine = aiTourPurse ? `<div class="rwLine ach">💰 Tournament purse: +${aiTourPurse} 🪙</div>` : '';
  // Mid-tournament the primary button advances the tournament, not the menu.
  const midTour = aiTour && !isFinal(aiTour);

  // ---- Compact results card (Part 1): score + PB, records, ONE objective,
  // expandable details, and the two primary actions (Replay / Play Next) ----
  const pbLabel =
    prevBest === null ? 'First round here' : totals[0] < prevBest ? '🏆 New best!' : `Best: ${prevBest}`;
  // Records broken / near-missed — cap at two lines so the card stays calm.
  const recLines = recEvents
    .slice(0, 2)
    .map((e) => `<div class="recLine">${e.kind === 'broken' ? '🏅' : '✨'} ${escapeHtml(e.label)}</div>`)
    .join('');
  const starLine = roundNewStars.length
    ? `<div class="starLine">${'⭐'.repeat(Math.min(3, roundNewStars.length))} ` +
      `${roundNewStars.length} new star${roundNewStars.length > 1 ? 's' : ''} · ` +
      `${starCount(profile.retention.mastery, courseId)}/9 on ${escapeHtml(round.course.name)}</div>`
    : '';
  const objective = nextObjectiveLine(courseId, totals[0], prevBest);
  const nextId = nextCourseIdAfter(courseId);
  const nextName = COURSES[nextId].name;
  // A finished AI tournament's "replay" starts a fresh tournament (the rota is
  // drawn anew); an ordinary round replays the exact same setup.
  const finishedTour = aiTour && isFinal(aiTour);
  const replayLabel = finishedTour ? '↻ New Tournament' : '↻ Replay';

  summaryEl.innerHTML =
    `<h2>${headline}</h2>` +
    `<div id="recBanner" class="recBanner"></div>` +
    `<div class="scoreHead"><span class="big">${totals[0]}</span>` +
    `<span class="toPar">${parLabel(totals[0])}</span>` +
    `<span class="pb">${pbLabel}</span></div>` +
    starLine +
    recLines +
    rewardStripHtml(events) +
    streakRewardLine +
    protectionLine +
    aiTourBlock +
    tourBlock +
    purseLine +
    signInNudge +
    `<div class="objLine">🎯 ${escapeHtml(objective)}</div>` +
    `<details class="roundDetails"><summary>Round details</summary>` +
    `<table><tr><th>Hole</th><th>Par</th>${headCols}</tr>${rows}${totalRow}${teamRow}</table>` +
    `</details>` +
    (midTour
      ? `<div class="primaryRow"><button id="againBtn">Next Round →</button></div>` +
        `<div class="btnRow"><button id="recBtn" class="ghostBtn">Records</button>` +
        `<button id="profBtn" class="ghostBtn">Profile</button>` +
        `<button id="quitTourBtn" class="ghostBtn">Quit</button></div>`
      : `<div class="primaryRow"><button id="replayBtn">${replayLabel}</button>` +
        `<button id="playNextBtn">Play Next: ${escapeHtml(nextName)} →</button></div>` +
        `<div class="btnRow"><button id="recBtn" class="ghostBtn">Records</button>` +
        `<button id="profBtn" class="ghostBtn">Profile</button>` +
        `<button id="againBtn" class="ghostBtn">Menu</button></div>`);
  summaryEl.style.display = 'block';
  // Tournament: submit this round as the player's entry (first score stands)
  // and show the live standings (Phase 8).
  if (round.tournament) void submitTournamentRound(round.tournament.code, record, holes.length);
  document.getElementById('profBtn')!.addEventListener('pointerdown', () => renderProfile());
  // Replay: the SAME setup (course/mode/character/pal/perk all ride sel +
  // profile), back to the first tee with one tap. Play Next: the rotation's
  // next course, same mode/loadout, no course-select menu.
  document.getElementById('replayBtn')?.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    aiTour = null;
    sel.courseId = courseId;
    analytics.track('replay_selected', { course: courseId, mode: round.mode });
    startRound(0);
  });
  document.getElementById('playNextBtn')?.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    aiTour = null;
    if (sel.mode === 'aitour') sel.mode = 'solo'; // a course pick isn't a new tournament
    sel.courseId = nextId;
    analytics.track('play_next_selected', { course: courseId, destination_course: nextId, mode: sel.mode });
    startRound(0);
    analytics.track('next_course_started', { course: nextId, mode: sel.mode });
  });
  document.getElementById('againBtn')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    if (midTour) {
      startAiTourRound();
    } else {
      aiTour = null; // a finished tournament is done — Menu starts fresh
      showSetup();
    }
  });
  document.getElementById('quitTourBtn')?.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    aiTour = null;
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
  // The daily's coin bounty is inside the round's coin total; call it out so
  // completing the challenge visibly PAYS (playtest: "they should give you
  // j-coins when you complete" — they did, invisibly).
  if (daily) html += `<div class="rwLine daily">✅ Daily done: ${daily.name} (+${COINS.daily} 🪙) · 🔥 ${daily.streak}-day streak</div>`;
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
    statCell(p.dailyStreak > 0 ? `🔥 ${p.dailyStreak}` : '—', 'Daily streak') +
    statCell(`⭐ ${starCount(p.retention.mastery)}`, 'Mastery stars') +
    `</div>` +
    // Compact course-by-course mastery totals (Part 5): totals only, the
    // hole-level drill-down lives on the course cards / results screen.
    `<div class="profMastery">` +
    COURSE_LIST.map((c) => `<span class="chip">${c.icon} ${starCount(p.retention.mastery, c.id)}/9</span>`).join('') +
    `</div>` +
    // Achievements: earned first, then a FEW useful next targets — never the
    // whole locked wall (Part 6).
    `<div class="achList">` +
    (() => {
      const earned = ACHIEVEMENTS.filter((a) => p.achievements.includes(a.id));
      const next = ACHIEVEMENTS.filter((a) => !p.achievements.includes(a.id)).slice(0, 3);
      const hidden = ACHIEVEMENTS.length - earned.length - next.length;
      return (
        earned.map((a) => `<div class="achRow got">🏅 <b>${a.name}</b> <span>${a.desc}</span></div>`).join('') +
        next.map((a) => `<div class="achRow">🎯 <b>${a.name}</b> <span>${a.desc}</span></div>`).join('') +
        (hidden > 0 ? `<div class="achRow"><span>… ${hidden} more to discover</span></div>` : '')
      );
    })() +
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
    (shotCapture.supported
      ? `<label class="setRow"><span>Record shot clips</span>` +
        `<input id="setClipCapture" type="checkbox" ${deviceSettings.clipCapture ? 'checked' : ''} /></label>`
      : '') +
    `<div id="resetZone" class="resetZone">` +
    `<button id="resetRecords" class="dangerBtn">Reset Records</button></div>` +
    `</div>` +
    `<div id="profAdminZone"></div>` +
    `<button id="profBack">Back</button></div>`;
  // 'click' (not 'pointerdown') — see the #lkLock comment in renderLockerRoom:
  // hiding this full-screen overlay on the down-stroke lets the release land
  // on whatever's exposed underneath instead.
  document.getElementById('profBack')!.addEventListener('click', () => (recordsEl.style.display = 'none'));
  // Settings write through updateDeviceSettings — persisted device-locally for
  // EVERYONE (guests included), applied live, and mirrored into the profile
  // (which persistProfile syncs to the account when signed in).
  document.getElementById('setSound')!.addEventListener('input', (e) => {
    updateDeviceSettings({ sound: parseFloat((e.target as HTMLInputElement).value) });
    persistProfile();
  });
  document.getElementById('setAmbience')!.addEventListener('input', (e) => {
    updateDeviceSettings({ ambience: parseFloat((e.target as HTMLInputElement).value) });
    persistProfile();
  });
  document.getElementById('setReducedMotion')!.addEventListener('change', (e) => {
    updateDeviceSettings({ reducedMotion: (e.target as HTMLInputElement).checked });
    persistProfile();
  });
  document.getElementById('setClipCapture')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    updateDeviceSettings({ clipCapture: on });
    // Take effect immediately: start the rolling recorder if a hole is live,
    // stop + release the stream outright when switched off.
    if (on && current) shotCapture.start();
    else if (!on) shotCapture.stop();
    if (captureBtn) captureBtn.textContent = on ? '🎥 REC' : '🎥 CLIP';
  });
  // Destructive: fire on a deliberate tap (down+up on the button), not on
  // finger-down — a scroll flick that starts on this button used to open the
  // reset dialog by accident (the "too touchy" report).
  document.getElementById('resetRecords')!.addEventListener('click', confirmResetRecords);
  wireAccountRow();
  refreshProfileAdminZone();
}

/** Admin-only zone inside the Profile screen (moved here from the main menu
 *  so it's no longer a permanent line item every player sees) — the Admin
 *  Dashboard link, the debug True Vision grant, and the gift-to-another-
 *  account form, all gated behind the same allow-listed email check
 *  refreshAdminLink() used to gate the old menu buttons with. */
function refreshProfileAdminZone(): void {
  const zone = document.getElementById('profAdminZone');
  if (!zone) return;
  zone.innerHTML = '';
  if (!authConfigured() || !signedIn) return;
  void cloudEmail().then((email) => {
    if (!isAdminEmail(email)) return;
    zone.innerHTML =
      `<div class="profAdminSection"><div class="profAdminTitle">Admin</div>` +
      `<button id="profAdminLink" class="ghostBtn">🔑 Admin Dashboard</button>` +
      `<button id="profAdminGrantTV" class="ghostBtn">🎁 Grant 3 True Vision (debug)</button>` +
      `</div>` +
      `<div class="profAdminGift">` +
      `<div class="profAdminTitle">Gift Season XP / True Vision</div>` +
      `<input id="giftEmail" type="email" placeholder="player@email.com" class="giftInput" />` +
      `<input id="giftXp" type="number" min="0" placeholder="Season XP" value="0" class="giftInput" />` +
      `<input id="giftTV" type="number" min="0" placeholder="True Vision charges" value="0" class="giftInput" />` +
      `<button id="giftSend" class="ghostBtn">Send Gift</button>` +
      `<div id="giftStatus" class="acctHint"></div>` +
      `</div>`;
    document.getElementById('profAdminLink')!.addEventListener('pointerdown', () => (window.location.href = 'admin.html'));
    document.getElementById('profAdminGrantTV')!.addEventListener('pointerdown', () => {
      grantConsumable(profile, TRUE_VISION.id, 3);
      persistProfile();
      if (signedIn)
        void cloudSyncProfile(profile).then((res) => {
          applyCloudMerge(profile, res.profile);
          showCloudStatus(res.status, true);
        });
      showMsg('Granted 3 True Vision charges', 1400);
    });
    document.getElementById('giftSend')!.addEventListener('pointerdown', () => {
      const targetEmail = (document.getElementById('giftEmail') as HTMLInputElement).value.trim();
      const xp = parseInt((document.getElementById('giftXp') as HTMLInputElement).value, 10) || 0;
      const tv = parseInt((document.getElementById('giftTV') as HTMLInputElement).value, 10) || 0;
      const status = document.getElementById('giftStatus')!;
      status.textContent = 'Sending…';
      void giftSeasonReward(targetEmail, xp, tv).then((res) => {
        status.textContent = res.ok
          ? `✅ Sent ${res.grantedXp ?? xp} XP + ${res.grantedTrueVision ?? tv} True Vision to ${targetEmail}`
          : `❌ ${res.error}`;
      });
    });
  });
}

/** Reset Records: a centered "Are you sure?" modal (same style as the store
 *  purchase confirm) so a destructive wipe can't happen on a single tap.
 *  Clears stats/scores, keeps coins + purchases. */
function confirmResetRecords(): void {
  const sharedNote = isShared() ? ` Scores already posted to the shared leaderboard stay there.` : '';
  const modal = document.createElement('div');
  modal.className = 'storeConfirm';
  // The profile overlay it sits over is z-index 25; .storeConfirm's own 5 only
  // works inside the store's stacking context, so lift it above the overlay.
  modal.style.zIndex = '30';
  const close = (): void => modal.remove();
  modal.innerHTML =
    `<div class="storeConfirmBox"><div class="scTitle">Reset Records?</div>` +
    `<div class="scAsk">Clear career stats, achievements, XP and local scores? ` +
    `Coins and unlocked items are kept.${sharedNote}</div>` +
    `<div class="btnRow"><button id="resetYes" class="dangerBtn">Yes, reset</button>` +
    `<button id="resetNo" class="ghostBtn">Cancel</button></div></div>`;
  // Tap the dimmed backdrop (outside the box) to cancel. Use `click` (not
  // pointerdown) so a scroll/drag that merely starts on the backdrop doesn't
  // dismiss it, matching the deliberate-tap semantics of the buttons below.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.body.appendChild(modal);
  // Guard against a carried-through press: the tap that opened this dialog
  // must not also count as a confirm if the finger happens to land where
  // "Yes, reset" renders. Ignore confirm taps for a short arming window.
  const armedAt = Date.now();
  const RESET_ARM_MS = 350;
  modal.querySelector<HTMLButtonElement>('#resetNo')!.addEventListener('click', close);
  modal.querySelector<HTMLButtonElement>('#resetYes')!.addEventListener('click', () => {
    if (Date.now() - armedAt < RESET_ARM_MS) return;
    resetProfileRecords(profile, Date.now());
    persistProfile();
    clearLocalHistory();
    if (signedIn)
      void cloudSyncProfile(profile).then((res) => {
        applyCloudMerge(profile, res.profile);
        showCloudStatus(res.status, true);
      });
    updateDailyBanner();
    // Confirm in place, then close both the modal and the profile overlay —
    // the cleared stats show next time Profile is opened (avoids a jarring
    // full re-render of the profile screen).
    modal.querySelector('.storeConfirmBox')!.innerHTML =
      `<div class="scTitle">✓ Records cleared</div>` +
      `<div class="btnRow"><button id="resetDone">Done</button></div>`;
    modal.querySelector<HTMLButtonElement>('#resetDone')!.addEventListener('click', () => {
      close();
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

/** Distance (px) a pointer may drift between down and up and still count as a
 *  tap rather than a scroll — mirrors AimControl's DRAG_DEAD_ZONE. */
const TAP_SLOP = 12;

/** Bind a scroll-safe tap: fires `fn` only when the pointer is released near
 *  where it went down. A drag to scroll a list that happens to start on a card
 *  moves past TAP_SLOP (or cancels the pointer for a native pan), so it no
 *  longer buys/equips — the store's #1 playtest annoyance (batch 2). */
function onTap(el: Element, fn: () => void): void {
  let sx = 0;
  let sy = 0;
  let armed = false;
  el.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    sx = pe.clientX;
    sy = pe.clientY;
    armed = true;
  });
  el.addEventListener('pointerup', (e) => {
    if (!armed) return;
    armed = false;
    const pe = e as PointerEvent;
    if (Math.hypot(pe.clientX - sx, pe.clientY - sy) <= TAP_SLOP) fn();
  });
  el.addEventListener('pointercancel', () => {
    armed = false;
  });
}

const seasonEl = document.getElementById('seasonPass')!;

/** Throttle so overlay opens don't hammer the entitlements node. */
let entitlementCheckAt = 0;

/** Pull + apply any real-money purchases delivered by the Stripe webhook
 *  (firebase/Purchases). Fire-and-forget: re-renders whichever overlay is
 *  open when something new landed. */
function refreshEntitlements(): void {
  if (!signedIn) return;
  const now = Date.now();
  if (now - entitlementCheckAt < 15000) return;
  entitlementCheckAt = now;
  void claimEntitlements(profile).then((applied) => {
    if (!applied.length) return;
    persistProfile();
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status, true);
    });
    showMsg(`Purchase applied: ${applied.join(', ')} ✅`, 2600);
    updateSeasonLink();
    if (storeEl.style.display === 'flex') renderStore();
    if (seasonEl.style.display === 'flex') renderSeasonPass();
  });
}

/** The Characters store section starts collapsed to two rows (playtest FB9). */
let storeCharsExpanded = false;
/** Character cards shown before "See more" (two rows of the 3-wide grid). */
const STORE_CHAR_PREVIEW = 6;
/** Item id awaiting the "Spend X coins?" confirmation (null = no popup). */
let pendingBuy: string | null = null;

/** Store overlay (Phase 7): buy/equip cosmetics + club upgrades with coins. */
function renderStore(): void {
  const p = profile;
  refreshEntitlements();
  const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  const card = (item: StoreItem): string => {
    const owned = isOwned(p, item);
    const equipped = isEquippableKind(item.kind) && p.cosmetics.equipped[item.kind as CosmeticKind] === item.id;
    const affordable = canBuy(p, item).ok;
    const cls = equipped ? 'equipped' : owned ? 'owned' : affordable ? '' : 'locked';
    const swatch =
      item.color !== undefined ? `<div class="swatch" style="background:${hex(item.color)}"></div>` : `<div class="swatch" style="background:#2b6b41">⬆️</div>`;
    const label =
      item.kind === 'character'
        ? `<img src="ui/characters/${item.character}.png" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;object-position:50% 22%;border-radius:8px" />`
        : item.kind === 'pal'
          ? `<div class="swatch palSwatch">${palByKey(item.pal)?.icon ?? '🐾'}</div>`
          : swatch;
    const price = equipped ? 'Equipped' : owned ? (isEquippableKind(item.kind) ? 'Tap to equip' : 'Owned') : `${item.price} 🪙`;
    return `<div class="storeCard ${cls}" data-item="${item.id}">${label}<div class="sName">${item.name}</div><div class="sPrice">${price}</div></div>`;
  };
  // Season-pass exclusives never appear in the store (claim-only).
  const forSale = STORE_CATALOG.filter((i) => !i.season);
  const section = (title: string, kind: StoreItem['kind']): string =>
    `<div class="storeTab">${title}</div><div class="storeGrid">${forSale.filter((i) => i.kind === kind).map(card).join('')}</div>`;
  // Pals for sale only — the free starter pair lives in the Pals menu. Nothing
  // is priced yet, so this renders the coming-soon shelf.
  const palsSection = (): string => {
    const priced = forSale.filter((i) => i.kind === 'pal' && i.price > 0);
    return (
      `<div class="storeTab">Pals</div>` +
      (priced.length
        ? `<div class="storeGrid">${priced.map(card).join('')}</div>`
        : `<div class="storeEmpty">New pals coming soon 🐾</div>`)
    );
  };
  // Characters collapse to two rows with a See-more toggle (there are 20+),
  // so the other categories stay reachable without a long scroll (FB9).
  const charItems = forSale.filter((i) => i.kind === 'character');
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
  // Real-money coin top-up — signed-in + Stripe link configured. Held (like the
  // Season Pass) until sales open (see SEASON_1.salesOpenAt): before then, show
  // a "coming soon" tag.
  const topUpSection =
    signedIn && purchaseConfigured('coins1000')
      ? salesOpen(SEASON_1, Date.now())
        ? `<div class="storeTab">Top Up</div><button id="topUpCoins" class="topUpCard">` +
          `<span class="tuIcon">🪙</span><span class="tuName">${PRODUCTS.coins1000.name}</span>` +
          `<span class="tuPrice">$${PRODUCTS.coins1000.usd}</span></button>`
        : `<div class="storeTab">Top Up</div><div class="topUpCard" style="opacity:.6;cursor:default">` +
          `<span class="tuIcon">🪙</span><span class="tuName">${PRODUCTS.coins1000.name}</span>` +
          `<span class="tuPrice">Coming soon</span></div>`
      : '';
  storeEl.style.display = 'flex';
  storeEl.innerHTML =
    `<div class="storeInner"><h2>Store</h2><div class="storeCoins">${p.coins} 🪙</div>` +
    (!signedIn && authConfigured() ? `<div class="signInNudge">Sign in to earn coins & keep purchases.</div>` : '') +
    `<div class="storeScroll">` +
    topUpSection +
    charactersSection +
    section('Outfit Colorways', 'outfit') +
    section('Ball Colors', 'ball') +
    section('Ball Trails', 'trail') +
    section('Club Skins', 'clubskin') +
    section('Club Upgrades', 'clubUpgrade') +
    palsSection() +
    `</div><button id="storeBack">Back</button>${confirmPanel}</div>`;
  const seeMoreBtn = document.getElementById('charSeeMore');
  if (seeMoreBtn)
    seeMoreBtn.addEventListener('pointerdown', () => {
      storeCharsExpanded = !storeCharsExpanded;
      renderStore();
    });
  const topUpBtn = document.getElementById('topUpCoins');
  if (topUpBtn)
    onTap(topUpBtn, () => {
      void cloudUid().then((uid) => {
        if (uid) startPurchase('coins1000', uid);
        else showMsg('Sign in first to buy coins', 1600);
      });
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
    onTap(el, () => {
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
  // 'click' — see the #lkLock comment in renderLockerRoom for why overlay
  // Back buttons must not hide the overlay on 'pointerdown'.
  document.getElementById('storeBack')!.addEventListener('click', () => {
    pendingBuy = null;
    storeEl.style.display = 'none';
  });
}

// ------------------------------------------------------ Season Pass (S1)

/** Reward page (0-9) the pass viewer shows; -1 = jump to current progress. */
let spPage = -1;

/** Keep the main-menu button honest: a plain "see the rewards" link before
 *  purchase, a live progress tracker once the pass is owned. */
/** The equipped perk's def, but only if it still has charges left. */
function equippedPerkDef(): PerkDef | undefined {
  const id = profile.equippedPerk;
  if (!id) return undefined;
  const entry = profile.perks.find((p) => p.id === id);
  if (!entry || perkRemaining(entry) <= 0) return undefined;
  return perkById(id);
}

/** Build the human golfer for a round. If the player has locked a loadout in
 *  the Locker Room, use it; otherwise roll a random OWNED loadout for THIS
 *  round (character + style + a random owned pal) — "if they don't choose, it
 *  just randomizes from what they own". */
function roundGolfer(): Golfer {
  let character = profile.character as CharacterKey;
  let archetype = profile.archetype as ArchetypeId;
  if (!profile.loadoutLocked) {
    const owned = CHARACTERS.filter((c) => profile.cosmetics.owned.includes(`char_${c.key}`));
    character = (owned.length ? randomOf(owned) : CHARACTERS[0]).key as CharacterKey;
    archetype = randomOf(ARCHETYPES).id as ArchetypeId;
    const ownedPals = STORE_CATALOG.filter((i) => i.kind === 'pal' && isOwned(profile, i));
    if (ownedPals.length) equip(profile, randomOf(ownedPals).id); // a random companion for the round
  }
  return assembleGolfer(profile.name || 'Player', character, archetype, profile.clubUpgrades, equippedPerkDef());
}

function updateSeasonLink(): void {
  const btn = document.getElementById('seasonBanner');
  if (!btn) return;
  const { level: lvl, intoLevel: into, levelCost } = levelProgress(SEASON_1, profile.season.xp);
  if (profile.season.owned) {
    const pct = lvl >= SEASON_1.levels ? 100 : Math.round((into / levelCost) * 100);
    btn.innerHTML =
      `<span class="sbIcon">🎫</span>` +
      `<span class="sbMain"><span class="sbTitle">Season Pass · Level ${lvl}</span>` +
      `<span class="sbBar"><i style="width:${pct}%"></i></span></span>` +
      `<span class="sbGo">Track ›</span>`;
  } else {
    btn.innerHTML =
      `<span class="sbIcon">🎫</span>` +
      `<span class="sbMain"><span class="sbTitle">Season Pass — 50 Rewards</span>` +
      `<span class="sbSub">See the rewards · you're Level ${lvl}/${SEASON_1.levels}</span></span>` +
      `<span class="sbGo">See ›</span>`;
  }
}

function updateStoreBanner(): void {
  const btn = document.getElementById('storeBanner');
  if (!btn) return;
  btn.innerHTML =
    `<span class="sbIcon">🛍️</span>` +
    `<span class="sbMain"><span class="sbTitle">The Store</span>` +
    `<span class="sbSub">Balls, trails, characters &amp; more</span></span>` +
    `<span class="sbGo">Shop ›</span>`;
}

/** Season-pass overlay: 10 pages × 5 reward levels, progress bar, claim
 *  buttons, and the purchase footer. Modeled on renderStore/renderRecords. */
function renderSeasonPass(): void {
  const p = profile;
  const def = SEASON_1;
  // If a new season has gone live since this profile last synced, reset the
  // season sub-object (fresh XP/claims, owned:false) so last season's owners can
  // buy the new pass. No-op while the ids match.
  rolloverSeason(p, def);
  refreshEntitlements();
  const { level: lvl, intoLevel, levelCost } = levelProgress(def, p.season.xp);
  const active = seasonActive(def, Date.now());
  if (spPage < 0) spPage = Math.min(9, Math.floor(Math.max(0, Math.min(lvl, def.levels - 1)) / 5));
  const tabs = Array.from(
    { length: def.levels / 5 },
    (_, i) => `<button class="recTab spTab${i === spPage ? ' sel' : ''}" data-page="${i}">${i * 5 + 1}–${i * 5 + 5}</button>`
  ).join('');
  const pct = lvl >= def.levels ? 100 : Math.round((intoLevel / levelCost) * 100);
  const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  // Icons are rendered EXACTLY like the Store's card icons — a flat color swatch
  // for tints, the character portrait, the pal emoji swatch (owner: "make the
  // icons look exactly like the store. nothing more").
  const rewardIcon = (reward: SeasonReward): string => {
    if ('coins' in reward) return `<div class="swatch" style="background:#caa63a">🪙</div>`;
    if ('xp' in reward) return `<div class="swatch" style="background:#3a6ec2">✨</div>`;
    if ('perk' in reward) return `<div class="swatch" style="background:#7a4ec2">⚡</div>`;
    if ('trueVision' in reward) return `<div class="swatch" style="background:#c23a5c">${TRUE_VISION.icon}</div>`;
    const item = STORE_BY_ID.get(reward.item);
    if (!item) return `<div class="swatch" style="background:#2b6b41">🎁</div>`;
    if (item.kind === 'character')
      return `<img src="ui/characters/${item.character}.png" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;object-position:50% 22%;border-radius:8px" />`;
    // Pals show their FULL rendered portrait (the marquee cards closing pages
    // 6-10 — levels 30/35/40/45/50), not an emoji — the whole companion reads
    // on a transparent card.
    if (item.kind === 'pal')
      return `<img src="${palByKey(item.pal)?.image ?? ''}" alt="" class="spPalImg" />`;
    if (item.color !== undefined) return `<div class="swatch" style="background:${hex(item.color)}"></div>`;
    return `<div class="swatch" style="background:#2b6b41">🎁</div>`;
  };
  // A pal reward (the last card of pages 6-10: levels 30/35/40/45/50) lays out
  // as a bigger full-width "hero" card so its full render is prominent among
  // the page's other four small swatch cards.
  const isPal = (r: SeasonReward): boolean => 'item' in r && STORE_BY_ID.get(r.item)?.kind === 'pal';
  const cards = Array.from({ length: 5 }, (_, i) => {
    const level = spPage * 5 + i + 1;
    const reward = def.rewards[level - 1];
    const { name } = rewardLabel(reward);
    const state = claimState(p, def, level);
    const cls = state === 'claimed' ? 'owned' : state === 'claimable' ? '' : 'locked';
    const hero = isPal(reward) ? ' spHero' : '';
    const line =
      state === 'claimed' ? '✓ Claimed'
      : state === 'claimable' ? 'Tap to claim'
      : state === 'needsPass' ? `Lv ${level} · pass`
      : `🔒 Lv ${level}`;
    return `<div class="storeCard${hero} ${cls}" data-level="${level}" data-claim="${state === 'claimable' ? '1' : ''}">${rewardIcon(reward)}<div class="sName">${name}</div><div class="sPrice">${line}</div></div>`;
  }).join('');
  const footer = ownsPass(p, def)
    ? `<div class="spOwned">🎫 Season Pass owned — rewards unlock as you play</div>`
    : !salesOpen(def, Date.now())
      ? `<div class="spNote">🔒 Season Pass purchases coming soon — every round already counts toward the track.</div>`
      : purchaseConfigured('seasonpass_s1')
        ? `<button id="spBuy" class="spBuy">Get the Season Pass · $${def.priceUsd}</button>` +
          (!signedIn && authConfigured()
            ? `<div class="spNote">Sign in with Google first so the pass sticks to your account.</div>`
            : '')
        : `<div class="spNote">Pass purchases open soon — every round already counts toward the track.</div>`;
  seasonEl.style.display = 'flex';
  seasonEl.innerHTML =
    `<div class="recInner"><h2>🎫 ${def.name}</h2>` +
    // Player wallet readout (coins + profile XP/level). The season-track bar
    // below reflects season.xp; this line reflects the account totals that a
    // coin/XP reward actually credits, so a claim shows a visible increment.
    `<div class="spWallet">Level ${p.level} · <b>${p.coins}</b> 🪙 · <b>${p.xp}</b> XP</div>` +
    `<div class="spSub">${active ? 'Runs through Nov 30 · play rounds to level the track' : 'Season over — earned rewards stay claimable'}</div>` +
    `<div class="spProgress"><span class="spLvlBig">Lv ${lvl}<i>/${def.levels}</i></span>` +
    `<div class="xpBar"><i style="width:${pct}%"></i></div>` +
    `<span class="spXp">${lvl >= def.levels ? 'Track complete!' : `${intoLevel} / ${levelCost} XP`}</span></div>` +
    `<div class="recTabs spTabs">${tabs}</div>` +
    `<div class="storeGrid spStoreGrid">${cards}</div>` +
    footer +
    `<button id="spBack">Back</button></div>`;
  seasonEl.querySelectorAll('.spTab').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      spPage = Number((el as HTMLElement).dataset.page);
      renderSeasonPass();
    })
  );
  seasonEl.querySelectorAll('.storeCard[data-claim="1"]').forEach((el) =>
    onTap(el, () => {
      const level = Number((el as HTMLElement).dataset.level);
      const r = claimReward(p, def, level);
      if (!r.ok) {
        showMsg(r.reason, 1400);
        return;
      }
      persistProfile();
      if (signedIn)
        void cloudSyncProfile(p).then((res) => {
          applyCloudMerge(p, res.profile);
          showCloudStatus(res.status, true);
        });
      updateSeasonLink();
      renderSeasonPass();
    })
  );
  const buyBtn = document.getElementById('spBuy');
  if (buyBtn)
    onTap(buyBtn, () => {
      // Defensive re-check at tap time: the button is only rendered when the
      // pass isn't owned, but a stale render or the raw Stripe link must never
      // let an owner pay twice for the same season.
      if (ownsPass(profile, def)) {
        showMsg("You already own this season's pass", 1800);
        return;
      }
      void cloudUid().then((uid) => {
        if (uid) startPurchase('seasonpass_s1', uid);
        else showMsg('Sign in first — the pass attaches to your account', 1800);
      });
    });
  // 'click' — see the #lkLock comment in renderLockerRoom.
  document.getElementById('spBack')!.addEventListener('click', () => {
    spPage = -1;
    seasonEl.style.display = 'none';
  });
}

/** Pals wizard step (right after Character): choose the companion that follows
 *  you around the course. Selecting equips it immediately (persist + cloud). */
/** Compact date for a record row ("Jul 11 '26"). */
function fmtRecordDate(epochMs: number): string {
  const dt = new Date(epochMs);
  const mon = dt.toLocaleDateString(undefined, { month: 'short' });
  return `${mon} ${dt.getDate()} '${String(dt.getFullYear()).slice(-2)}`;
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
  // 'click' — see the #lkLock comment in renderLockerRoom.
  document.getElementById('recBack')!.addEventListener('click', () => {
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
              `<span class="recDate">${fmtRecordDate(r.d)}</span>` +
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

function tournamentsEl(): HTMLElement {
  return document.getElementById('tournaments')!;
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
      `<div class="recInner"><h2>Online Tournaments</h2>` +
      `<div class="recEmpty">Online tournaments play over the shared leaderboard, which isn't configured on this build yet. ` +
      `See docs/FIREBASE_SETUP.md to connect one.</div>` +
      `<button id="tourBack">Back</button></div>`;
    // 'click' — see the #lkLock comment in renderLockerRoom.
    document.getElementById('tourBack')!.addEventListener('click', () => closeOverlay(el));
    return;
  }
  el.innerHTML =
    `<div class="recInner"><h2>🌐 Online Tournaments</h2>` +
    `<div class="recSub">Challenge real players: everyone plays identical wind &amp; pins. Lowest total wins.</div>` +
    `<button id="tourCreate" class="tourAction">➕ Create a tournament</button>` +
    `<div class="tourJoin"><input id="tourCode" type="text" maxlength="9" placeholder="JG-XXXXXX" ` +
    `autocomplete="off" autocapitalize="characters" value="${preCode ? escapeHtml(preCode) : ''}" />` +
    `<button id="tourJoinBtn">Join</button></div>` +
    myTournamentsHtml() +
    `<div id="tourBody" class="tourBody"></div>` +
    `<button id="tourBack">Back</button></div>`;
  // 'click' — see the #lkLock comment in renderLockerRoom.
  document.getElementById('tourBack')!.addEventListener('click', () => closeOverlay(el));
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

/** Step 1 of creating a tournament: let the creator pick the course everyone
 *  will play (it's fixed for all entrants), then hand off to the PUT. */
function createTournamentFlow(): void {
  const body = document.getElementById('tourBody');
  if (!body) return;
  const cards = COURSE_LIST.map(
    (c) =>
      `<div class="archCard modeCard" data-course="${c.id}">` +
      `<span class="modeIcon">${c.icon}</span><span class="modeName">${escapeHtml(c.name)}</span>` +
      `<span class="modeTag">${escapeHtml(c.tag)}</span></div>`
  ).join('');
  body.innerHTML = `<div class="recSub">Pick the course — everyone who joins plays it.</div><div class="modeGrid">${cards}</div>`;
  body.querySelectorAll('.modeCard').forEach((el) =>
    el.addEventListener('pointerdown', () => void createTournamentWithCourse((el as HTMLElement).dataset.course!))
  );
}

/** Step 2: PUT the 7-day tournament on the chosen course and surface the code. */
async function createTournamentWithCourse(courseId: string): Promise<void> {
  const body = document.getElementById('tourBody');
  if (body) body.innerHTML = `<div class="recEmpty">Creating…</div>`;
  const now = Date.now();
  const course = courseFallback(courseId);
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
  document.getElementById('tourPlay')!.addEventListener('pointerdown', () => playTournament(meta));
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
  if (pb) pb.addEventListener('pointerdown', () => playTournament(data.meta));
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
  const ended = isEnded(meta, Date.now());
  const status = ended ? 'Final' : 'In progress';
  const rank = myRank > 0 ? ` · You: ${myRank}/${standings.length}` : '';
  // Surface the fixed facts every entrant plays under: which course (the
  // creator's pick — everyone plays it), and when it locks. Lowest total wins,
  // one entry each, first score stands (see the lifecycle note in the header).
  const endTxt = new Date(meta.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const meta2 = `<div class="recSub tourMeta">⛳ ${escapeHtml(meta.course)} · ${meta.holes} holes · ` +
    `${ended ? 'ended' : 'ends'} ${endTxt} · lowest total wins · one entry each</div>`;
  return `<div class="tourHeadRow">🏁 ${escapeHtml(meta.name)} — ${status}${rank}</div>${meta2}${rows}`;
}

/** A tournament the player has chosen to enter, held while they go through the
 *  setup wizard (Name/Character/Pals/Style). Mode + course are locked to the
 *  tournament; on "Tee off" the wizard starts the round for this meta with the
 *  freshly-picked golfer, style, and equipped pal (not the last-used ones). */
let pendingTournament: Tournament | null = null;

/** Enter a tournament: lock the mode + course, then send the player through the
 *  setup wizard so they pick their own golfer, pal, and style before teeing off
 *  (the round itself still runs under the tournament's shared seed). */
function playTournament(meta: Tournament): void {
  pendingTournament = meta;
  sel.mode = 'solo';
  sel.courseId = courseIdByName(meta.course);
  closeOverlay(tournamentsEl());
  setupEl.style.display = 'flex';
  updateDailyBanner();
  goStep(0);
}

/** Start a solo round under a tournament's shared seed (Phase 8), with the
 *  golfer/style picked in the wizard just now. */
function startTournamentRound(meta: Tournament): void {
  rememberTournament(meta.code, meta.name);
  round.course = COURSES[courseIdByName(meta.course)];
  round.mode = 'solo';
  round.holeIdx = 0;
  round.activePlayer = 0;
  round.holeWinds = [];
  round.holePins = [];
  round.seed = meta.seed;
  round.tournament = { code: meta.code, name: meta.name };
  shotAcc = freshShotAcc();
  beginRoundTracking();
  grantRoundTrueVision();
  // Persist the wizard's picks like a normal round so they stick next launch.
  persistProfile();
  const golfer = roundGolfer();
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

// ----- AI Tournament: three rounds, three courses, an AI field you only ever
// meet on the leaderboard (replaced the Ace Challenge). The player plays
// normal solo rounds; after each one the field's scores for the same course
// come from the real round simulator and the standings update.

let aiTour: AiTournamentState | null = null;

function startAiTournament(): void {
  aiTour = createAiTournament(
    COURSE_LIST.map((c) => c.id),
    OPPONENTS,
    Math.floor(Math.random() * 1e9)
  );
  startAiTourRound();
}

/** Play the tournament's next round as a normal solo round (round.mode stays
 *  'solo', like online-tournament rounds) — finishRound spots the active
 *  tournament and swaps the summary's footer for standings + Next Round. */
function startAiTourRound(): void {
  if (!aiTour) return;
  round.course = courseFallback(aiTour.courseIds[aiTour.played]);
  round.mode = 'solo';
  round.holeIdx = 0;
  round.activePlayer = 0;
  round.holeWinds = [];
  round.holePins = [];
  round.seed = undefined;
  round.tournament = null;
  shotAcc = freshShotAcc();
  beginRoundTracking();
  grantRoundTrueVision();
  const golfer = roundGolfer();
  round.players = [{ golfer, isAI: false, scores: [] }];
  setupEl.style.display = 'none';
  playHole();
}

/** Standings table for the summary screen and the mid-round leaderboard:
 *  cumulative to-par, player row highlighted. Names only — the field's
 *  Easy/Hard/Legend tiers stay off the board (playtest: a leaderboard
 *  lists golfers, not difficulty settings). */
function aiTourStandingsHtml(t: AiTournamentState): string {
  const rows = aiTourStandings(t)
    .map((r, i) => {
      const sign = r.toPar === 0 ? 'E' : r.toPar > 0 ? `+${r.toPar}` : `${r.toPar}`;
      const rank = i === 0 ? '🏆' : `${i + 1}.`;
      return (
        `<div class="recRow${r.isPlayer ? ' you' : ''}"><span class="recRk">${rank}</span>` +
        `<span class="recNm">${escapeHtml(r.name)}</span>` +
        `<span class="recTot">${r.total} (${sign})</span></div>`
      );
    })
    .join('');
  const head = isFinal(t)
    ? `🏆 Final standings`
    : `🏆 Tournament — after round ${t.played}/${t.courseIds.length}`;
  const nextCourse = isFinal(t) ? '' : `<div class="recSub">Next round: ${escapeHtml(COURSES[t.courseIds[t.played]]?.name ?? '')}</div>`;
  return `<div class="tourResult"><div class="tourHeadRow">${head}</div>${rows}${nextCourse}</div>`;
}

/** Mid-round leaderboard overlay (the 🏆 HUD button during tournament play):
 *  standings through the completed rounds, plus where the player currently
 *  sits in round N. Dismisses on any tap. */
function showAiTourBoard(): void {
  if (!aiTour) return;
  const modal = document.createElement('div');
  modal.className = 'storeConfirm';
  modal.style.zIndex = '30';
  const roundNo = Math.min(aiTour.played + 1, aiTour.courseIds.length);
  modal.innerHTML =
    `<div class="storeConfirmBox">` +
    aiTourStandingsHtml(aiTour) +
    `<div class="recSub">You're playing round ${roundNo} of ${aiTour.courseIds.length} — scores post when the round ends.</div>` +
    `<div class="btnRow"><button id="tourBoardClose">Close</button></div></div>`;
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
  modal.querySelector<HTMLButtonElement>('#tourBoardClose')!.addEventListener('pointerdown', () => modal.remove());
}

engine3d.runRenderLoop(() => current?.render());
window.addEventListener('resize', () => engine3d.resize());

// Perf probe for the Playwright FPS baseline (Phase 9).
(window as unknown as { __fps: () => number }).__fps = () => engine3d.getFps();

/** Repeat-round soak probe: a snapshot of every resource class that could
 *  accumulate across Replay / Play Next scene rebuilds. The soak spec starts
 *  round after round and asserts these counts return to the same level for the
 *  same course — any monotonic growth is a leak (retained observers, meshes,
 *  materials, textures, timers). Heap is best-effort (Chrome only). */
(window as unknown as { __golfSoak: unknown }).__golfSoak = () => {
  const scene = current?.scene ?? null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    hasScene: !!scene,
    course: round.course.name,
    natureSettled: current?.natureSettled ?? false,
    meshes: scene ? scene.meshes.length : 0,
    materials: scene ? scene.materials.length : 0,
    textures: scene ? scene.textures.length : 0,
    particleSystems: scene ? scene.particleSystems.length : 0,
    beforeRenderObservers: scene ? scene.onBeforeRenderObservable.observers.length : 0,
    engineScenes: engine3d.scenes.length,
    sfxCacheSize: sfxCache.size,
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null
  };
};

// Debug/automation handle for the Playwright verification scripts
/** Monotonic scene build counter — lets a spec that starts a NEW round tell
 *  the fresh scene's handle apart from the previous one (buildWithLoading
 *  defers the build a frame, so polling __slice3d right after __startRound
 *  otherwise races onto the OLD scene, whose phase may already be 'aiming'). */
let sceneSeq = 0;
function exposeDebug(): void {
  sceneSeq += 1;
  (window as unknown as { __slice3d: unknown }).__slice3d = current
    ? {
        seq: sceneSeq,
        meter,
        aim: current.aim,
        state: current.state,
        scene: current.scene,
        mode: round.mode,
        renderPacing,
        perfRefreshRates: () => current?.perfRefreshRates(),
        bodiesReady: current.bodiesReady,
        dropAt: (x: number, y: number) => current?.dropAt(x, y),
        debugIgniteFire: () => current?.debugIgniteFire(),
        poseActive: (p: number) => current?.poseActive(p),
        swingActive: () => current?.swingActive(),
        skipIntro: () => current?.skipIntro(),
        clubLab: (tuning: Partial<ClubTuning> | undefined, kind: 'swing' | 'driver' | 'putter') =>
          current?.clubLab(tuning, kind),
        clubLabView: (view: 'hero' | 'face' | 'edge') => current?.clubLabView(view),
        debugTreeOcclusion: (x: number, y: number, z: number) => current?.debugTreeOcclusion(x, y, z),
        golferAbs: () => current?.golferAbs(),
        occlusionCandidates: () => current?.occlusionCandidates()
      }
    : null;
}

// ------------------------------------------------------------- setup menu

const landingEl = document.getElementById('landing')!;
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
  // The merge may have taken the other copy's settings (newer updatedAt) —
  // this device's audio/motion preferences always win locally.
  applyDeviceSettings();
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

/**
 * Device-local preferences — the single source of truth for sound/ambience/
 * reduced-motion (and the clip-recorder opt-in) ON THIS DEVICE. Persisted for
 * everyone, guests included (the account-gated rule covers PROGRESS, not
 * accessibility/audio preferences: muting the game and having it come back
 * loud after a refresh was the persistent-sound bug). Re-asserted over the
 * profile after every cloud merge so a sync from another device never flips
 * this device's audio state.
 */
const deviceSettings: DeviceSettings = loadDeviceSettings() ?? {
  sound: profile.settings.sound,
  ambience: profile.settings.ambience,
  reducedMotion: profile.settings.reducedMotion,
  clipCapture: false
};

/** Push the device preferences into the live profile + live audio. Call after
 *  boot and after ANY wholesale profile replacement (cloud merge, sign-out). */
function applyDeviceSettings(): void {
  profile.settings.sound = deviceSettings.sound;
  profile.settings.ambience = deviceSettings.ambience;
  profile.settings.reducedMotion = deviceSettings.reducedMotion;
  applyAmbienceVolume();
}

/** Update + persist device preferences (guests included), then apply live. */
function updateDeviceSettings(patch: Partial<DeviceSettings>): void {
  Object.assign(deviceSettings, patch);
  saveDeviceSettings(deviceSettings);
  applyDeviceSettings();
}
applyDeviceSettings();

let signedIn = false;
/** Guard so the one-time legacy→account merge runs at most once per session. */
let legacyMerged = false;

// ------------------------------------------------------------- analytics
/**
 * Retention analytics (Part 13): batched + non-blocking (see
 * systems/Analytics.ts). track() is an O(1) enqueue — safe from menu/summary
 * flows; NOTHING here runs on the swing-meter path or in the render loop.
 */
const analytics = new Analytics(restTransport(LEADERBOARD_URL));
analytics.track('app_open', {
  returning_player: legacyLocal.stats.rounds > 0,
  app_version: '2.0'
});
// Best-effort delivery of anything still queued when the tab hides/closes.
window.addEventListener('pagehide', () => analytics.flushBeacon());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') analytics.flushBeacon();
});
/** Epoch ms the current round started (round_duration property). */
let roundStartedAt = 0;

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
  applyDeviceSettings(); // this device's audio/motion prefs win over the cloud copy
  saveProfile(profile); // cache the account locally for offline/reload
  showCloudStatus(res.status);
  syncSelFromProfile();
  // Attribute this device's guest activity to the account WITHOUT
  // double-counting: subsequent events carry uid+gid, and the linked event
  // lets the dashboard fold earlier guest sessions into this player.
  analytics.setUid(profile.id);
  analytics.track('identity_linked');
  refreshEntitlements(); // deliver purchases made while away / on other devices
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
  applyDeviceSettings(); // device audio/motion prefs survive sign-out
  analytics.setUid(null);
  syncSelFromProfile();
}

/** Re-prefill the setup wizard from the live profile (after a cloud adopt or a
 *  sign-out reset) so name/character/style reflect the current account. */
function syncSelFromProfile(): void {
  sel.name = profile.name;
  sel.character = (profile.character as CharacterKey) || (CHARACTERS[0].key as CharacterKey);
  sel.archetype = (profile.archetype as ArchetypeId) || (ARCHETYPES[0].id as ArchetypeId);
  updateSeasonLink();
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
    // Stripe's success URL lands back here with ?purchase=success — the
    // adopt above already kicked off the entitlement claim.
    if (new URLSearchParams(window.location.search).get('purchase') === 'success') {
      showMsg('Thanks! Applying your purchase…', 2200);
      history.replaceState(null, '', window.location.pathname);
    }
  }
  renderAcctMenu();
  // First visit / fresh guest with no name yet — ask once (editable later in
  // the Locker Room / Profile). Gated on the account check above resolving
  // first: profile.name starts empty for EVERY boot (defaultProfile()) and
  // only gets the cloud value once adoptCloudAccount finishes, so checking
  // synchronously at load used to pop the modal for a signed-in player on
  // every reload, right before their name loaded in underneath it. Skipped in
  // the screenshot-harness boot.
  if (!profile.name.trim() && !SHOT.hole) promptName(false);
})();

/** The setup choices, prefilled from the profile so returning players jump
 *  straight to "Tee off". */
const sel = {
  step: 0,
  mode: 'solo' as GameMode,
  courseId: DEFAULT_COURSE_ID,
  name: profile.name,
  character: (profile.character as CharacterKey) || (CHARACTERS[0].key as CharacterKey),
  archetype: (profile.archetype as ArchetypeId) || (ARCHETYPES[0].id as ArchetypeId),
  opponentId: OPPONENTS[1].id
};

/** Solo rounds skip the rival step; 1v1/scramble add it at the end. The AI
 *  Tournament also skips the Course step — its three-course rota is drawn
 *  when the tournament starts. */
function stepLabels(): string[] {
  // Loadout (character/style/pal/perk) lives in the Locker Room now, so the
  // round flow is just the per-round choices.
  // Entering an online tournament: mode + course are locked, so just confirm.
  if (pendingTournament) return ['Ready'];
  if (sel.mode === 'aitour') return ['Mode'];
  return sel.mode === 'solo'
    ? ['Mode', 'Course']
    : ['Mode', 'Course', sel.mode === '1v1' ? 'Rival' : 'Partner'];
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

/** Which purchased club-upgrade family a stat row belongs to, so the card can
 *  badge a boosted club. The driver upgrade still lifts the driving stats; the
 *  iron/wedge/putter upgrades no longer touch stats at all (they widen the
 *  swing-meter perfect zone), so a "+N" delta can't show them — the badge is
 *  how the player sees those purchases on the select screen. */
const STAT_UPGRADE_FAMILY: Record<string, string> = {
  drivingPower: 'driver',
  drivingAccuracy: 'driver',
  approach: 'irons',
  chipping: 'wedges',
  putting: 'putter'
};

/** `clubUpgrades`, when given, badges each boosted stat with "+" (tier 1) or
 *  "++" (tier 2) so a purchase is visible on the screen where the player picks
 *  their build — including the iron/wedge/putter upgrades, which lift no stat
 *  (playtest: "my putter/iron/wedge +3 aren't showing up in my stats"). The bar
 *  always shows the true (capped) width. */
function statBars(stats: GolferStats, signature?: StatKey, clubUpgrades?: Record<string, number>): string {
  return (
    `<div class="stats">` +
    STAT_KEYS.map(([k, label]) => {
      const tier = clubUpgrades ? clubUpgrades[STAT_UPGRADE_FAMILY[k]] ?? 0 : 0;
      const badge = tier > 0 ? `<span class="svup">${'+'.repeat(Math.min(2, tier))}</span>` : '';
      const shown = Math.min(100, stats[k]);
      return (
        `<div class="stat${k === signature ? ' sig' : ''}"><span class="sl">${label}</span>` +
        `<span class="sbar"><i style="width:${shown}%"></i></span>` +
        `<span class="sv">${shown}${badge}</span></div>`
      );
    }).join('') +
    `</div>`
  );
}

function renderSteps(): void {
  stepsEl.innerHTML = stepLabels()
    .map(
      (label, i) =>
        `<div class="sdot${i === sel.step ? ' on' : i < sel.step ? ' done' : ''}">` +
        `<span class="num">${i < sel.step ? '✓' : i + 1}</span><span class="lbl">${label}</span></div>`
    )
    .join('');
}

const MODES: Array<{ id: GameMode; name: string; desc: string; icon: string }> = [
  { id: 'solo', name: 'Solo Round', desc: 'Three holes, you against the course.', icon: '⛳' },
  { id: '1v1', name: '1 vs 1', desc: 'Match an AI rival, lowest total wins.', icon: '⚔️' },
  { id: 'scramble', name: 'Scramble', desc: 'Team up with an AI partner — best ball counts.', icon: '🤝' },
  { id: 'aitour', name: 'AI Tournament', desc: 'Three rounds, three courses, a field of AI pros. Top the board.', icon: '🏆' }
];

function randomOf<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

/** Warm the browser HTTP cache for a course's heaviest GLB assets the instant
 *  the picker settles on it — well before hole 1's buildCourse() needs them — so
 *  EVERY course gets the smooth-cold-cache first load Wildwood already had (this
 *  generalizes the old Wildwood-only sakura prefetch; Wildwood was the only
 *  course that pre-warmed, a large part of why it felt smoothest to load).
 *  Derived from the course's own theme: tree species (treeKeys), heather
 *  variants, the sea-backdrop sailboat, plus Wildwood's blossom-only tree_sakura
 *  (not in treeKeys). Fetch-only (no Babylon scene exists at course-select
 *  time), fire-and-forget — a missing file just 404s harmlessly and a shot never
 *  depends on it. */
const DEFAULT_TREE_KEYS = ['tree_oak', 'tree_maple', 'tree_birch', 'tree_aspen'];
const prefetchedCourses = new Set<string>();
function prefetchCourseAssets(courseId: string): void {
  if (prefetchedCourses.has(courseId)) return;
  prefetchedCourses.add(courseId);
  const course = COURSES[courseId];
  if (!course) return;
  const theme = resolveTheme(course);
  const keys = new Set<string>([...(theme.treeKeys ?? DEFAULT_TREE_KEYS), ...(theme.heatherKeys ?? [])]);
  if (courseId === 'wildwood') keys.add('tree_sakura'); // blossom overlay, not in treeKeys
  keys.forEach((k) => void fetch(`models/nature/${k}.glb`).catch(() => {}));
  if (theme.backdrop === 'sea') void fetch('models/nature/ship.glb').catch(() => {});
}

function bestCourseScore(courseId: string): string {
  const course = COURSES[courseId];
  const rounds: RoundRecord[] = loadLocal().filter((r: RoundRecord) => r.course === course?.name && r.mode === 'solo');
  if (!rounds.length) return '—';
  return String(Math.min(...rounds.map((r) => r.total)));
}

function renderCourse(): void {
  prefetchCourseAssets(sel.courseId);
  stepBodyEl.innerHTML =
    `<div class="stepTitle">Choose your course</div>` +
    `<div class="modeGrid modeGrid--courses">` +
    COURSE_LIST.map((c) => {
      const course = COURSES[c.id];
      const tag = `Par ${course.holes.slice(0, Math.min(RULES.holesPerRound, course.holes.length)).reduce((a, h) => a + h.par, 0)}`;
      const sub = c.tag;
      // Compact cards fit a phone without scrolling: name + a color-coded
      // difficulty chip, then a tight Par/Best line. The full identity sentence
      // is revealed ONLY on the selected card (the one the player is weighing),
      // so the grid stays short until you commit to a course.
      const selected = sel.courseId === c.id;
      const diff = c.difficulty.toLowerCase();
      return (
        `<div class="archCard modeCard courseCard${selected ? ' sel' : ''}" style="--course-art:url('${c.art}')" data-course="${c.id}">` +
        `<div class="ahead"><span class="an">${c.icon} ${c.name}</span></div>` +
        `<div class="courseMeta">` +
        `<span class="diff diff-${diff}">${c.difficulty}</span>` +
        `<span>${tag}</span><span>Best ${bestCourseScore(c.id)}</span>` +
        `<span>⭐ ${starCount(profile.retention.mastery, c.id)}/9</span></div>` +
        (selected ? `<div class="stepHint courseTag">${sub}</div>` : '') +
        `</div>`
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

// ---------------------------------------------------------- Locker Room
const lockerEl = document.getElementById('lockerRoom')!;
/** Active Locker Room tab. */
let lkTab: 'char' | 'style' | 'pal' | 'perk' | 'outfit' | 'ball' | 'trail' | 'clubskin' | 'upgrades' =
  'char';
/** Club-upgrade item id awaiting the Locker's own "Spend X coins?"
 *  confirmation — separate from the Store's `pendingBuy` so the two overlays
 *  never share (and can't cross-contaminate) confirmation state. */
let lkPendingBuy: string | null = null;

/** Persist the current loadout to the profile + cloud (called after any Locker
 *  Room change). Keeps `sel` in step so the round builders pick it up. */
function syncLoadout(): void {
  profile.character = sel.character;
  profile.archetype = sel.archetype;
  persistProfile();
  if (signedIn)
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status, true);
    });
}

/** The Locker Room: character, golfer style, pal and perk — chosen once and
 *  kept across rounds (so the round flow is just Mode → Course). */
function renderLockerRoom(): void {
  const p = profile;
  const ownedChars = CHARACTERS.filter((ch) => p.cosmetics.owned.includes(`char_${ch.key}`));
  if (!ownedChars.some((c) => c.key === sel.character)) sel.character = ownedChars[0]?.key ?? CHARACTERS[0].key;
  const charCards = ownedChars
    .map(
      (ch) =>
        `<div class="charCard${sel.character === ch.key ? ' sel' : ''}" data-ch="${ch.key}">` +
        `<img src="ui/characters/${ch.key}.png" alt="${ch.name}" loading="lazy" />` +
        `<div class="cn">${ch.name}</div></div>`
    )
    .join('');
  const archCards = ARCHETYPES.map((a) => {
    const hx = `#${(a.color & 0xffffff).toString(16).padStart(6, '0')}`;
    const upgraded = applyClubUpgrades(a.stats, p.clubUpgrades);
    return (
      `<div class="archCard${sel.archetype === a.id ? ' sel' : ''}" data-arch="${a.id}" style="--accent:${hx}">` +
      `<div class="ahead"><span class="an">${a.name}</span>` +
      `<span class="atag">${a.tagline}</span>` +
      `<span class="aovr">OVR ${ovr(upgraded)}</span></div>` +
      statBars(upgraded, a.signature, p.clubUpgrades) +
      `</div>`
    );
  }).join('');
  const ownedPals = STORE_CATALOG.filter((i) => i.kind === 'pal' && isOwned(p, i));
  const palCard = (id: string | null, name: string, icon: string): string => {
    const selected = id === null ? !p.cosmetics.equipped.pal : p.cosmetics.equipped.pal === id;
    return (
      `<div class="charCard palPick${selected ? ' sel' : ''}" data-pal="${id ?? ''}">` +
      `<div class="palPickIcon">${icon}</div><div class="cn">${name}</div></div>`
    );
  };
  const palCards = palCard(null, 'No Pal', '❌') + ownedPals.map((i) => palCard(i.id, i.name, palByKey(i.pal)?.icon ?? '🐾')).join('');
  const ownedPerks = p.perks.filter((ps) => perkRemaining(ps) > 0);
  const perkCard = (id: string | null): string => {
    const selected = id === null ? !p.equippedPerk : p.equippedPerk === id;
    if (id === null) return `<div class="charCard palPick${selected ? ' sel' : ''}" data-perk=""><div class="palPickIcon">🚫</div><div class="cn">No Perk</div></div>`;
    const def = perkById(id);
    const rem = perkRemaining(p.perks.find((ps) => ps.id === id)!);
    return (
      `<div class="charCard palPick perkCard${selected ? ' sel' : ''}" data-perk="${id}">` +
      `<div class="palPickIcon">⚡</div><div class="cn">${def?.name ?? id}</div>` +
      `<div class="perkEff">${def ? perkEffectLabel(def) : ''}</div>` +
      `<div class="perkRem">${rem} round${rem === 1 ? '' : 's'} left</div></div>`
    );
  };
  // Ball/trail/clubskin: pre-round cosmetic choices, equip-only-if-owned —
  // same one-tap pattern as the Pal tab (StoreEngine.equip, no buy affordance
  // here; that stays in the Store). Always has at least one owned entry
  // (DEFAULT_OWNED), so no "None" card is needed like Pal/Perk have.
  const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  const cosmeticTabs: Record<'outfit' | 'ball' | 'trail' | 'clubskin', StoreItem[]> = {
    outfit: STORE_CATALOG.filter((i) => i.kind === 'outfit' && isOwned(p, i)),
    ball: STORE_CATALOG.filter((i) => i.kind === 'ball' && isOwned(p, i)),
    trail: STORE_CATALOG.filter((i) => i.kind === 'trail' && isOwned(p, i)),
    clubskin: STORE_CATALOG.filter((i) => i.kind === 'clubskin' && isOwned(p, i))
  };
  const cosmeticCard = (kind: 'outfit' | 'ball' | 'trail' | 'clubskin', item: StoreItem): string => {
    const selected = p.cosmetics.equipped[kind] === item.id;
    const bg = item.color !== undefined ? hex(item.color) : '#2b6b41';
    return (
      `<div class="charCard palPick${selected ? ' sel' : ''}" data-cosmetic="${kind}:${item.id}">` +
      `<div class="palPickIcon" style="background:${bg}"></div><div class="cn">${item.name}</div></div>`
    );
  };
  // Club upgrades: not equippable (StoreEngine rejects it) — buying the next
  // tier IS the pre-round choice, so this tab needs the Store's buy-card
  // pattern (owned/affordable/locked), not the equip-only Pal/ball pattern.
  const upgradeItems = STORE_CATALOG.filter((i) => i.kind === 'clubUpgrade');
  const upgradeCard = (item: StoreItem): string => {
    const owned = isOwned(p, item);
    const affordable = canBuy(p, item).ok;
    const cls = owned ? 'owned' : affordable ? '' : 'locked';
    const price = owned ? 'Owned' : `${item.price} 🪙`;
    return (
      `<div class="storeCard ${cls}" data-upgrade="${item.id}">` +
      `<div class="swatch" style="background:#2b6b41">⬆️</div>` +
      `<div class="sName">${item.name}</div><div class="sPrice">${price}</div></div>`
    );
  };
  const pendingUpgrade = lkPendingBuy ? upgradeItems.find((i) => i.id === lkPendingBuy) : undefined;
  const upgradeConfirmPanel = pendingUpgrade
    ? `<div class="storeConfirm"><div class="storeConfirmBox">` +
      `<div class="scTitle">${pendingUpgrade.name}</div>` +
      `<div class="scAsk">Spend <b>${pendingUpgrade.price} 🪙</b> now?</div>` +
      `<div class="btnRow"><button id="lkUpBuyYes">Buy · ${pendingUpgrade.price} 🪙</button>` +
      `<button id="lkUpBuyNo" class="ghostBtn">Cancel</button></div></div></div>`
    : '';
  // Tabbed content (only the active tab renders in the scroll area) so the
  // screen is short and the top of the character cards is never clipped.
  const tabs: Array<[typeof lkTab, string]> = [
    ['char', 'Character'],
    ['style', 'Style'],
    ['pal', 'Pal'],
    ['perk', 'Perk'],
    ['outfit', 'Outfit'],
    ['ball', 'Ball'],
    ['trail', 'Trail'],
    ['clubskin', 'Skin'],
    ['upgrades', 'Upgrades']
  ];
  const tabBar = tabs
    .map(([id, label]) => `<button class="recTab lkTab${lkTab === id ? ' sel' : ''}" data-tab="${id}">${label}</button>`)
    .join('');
  const body =
    lkTab === 'char'
      ? `<div class="charGrid">${charCards}</div>`
      : lkTab === 'style'
        ? `<div class="archGrid">${archCards}</div>`
        : lkTab === 'pal'
          ? `<div class="charGrid">${palCards}</div>`
          : lkTab === 'perk'
            ? ownedPerks.length
              ? `<div class="charGrid">${perkCard(null)}${ownedPerks.map((ps) => perkCard(ps.id)).join('')}</div>`
              : `<div class="lkEmpty">Earn perks on the Season Pass — a one-round skill boost you equip here.</div>`
            : lkTab === 'upgrades'
              ? `<div class="storeGrid">${upgradeItems.map(upgradeCard).join('')}</div>${upgradeConfirmPanel}`
              : (() => {
                  const kind = lkTab as 'outfit' | 'ball' | 'trail' | 'clubskin';
                  return `<div class="charGrid">${cosmeticTabs[kind].map((i) => cosmeticCard(kind, i)).join('')}</div>`;
                })();

  lockerEl.style.display = 'flex';
  lockerEl.innerHTML =
    `<div class="storeInner lockerInner">` +
    `<div class="lkTop"><h2>🎽 Locker Room</h2><button id="lkBack" class="ghostBtn">Done</button></div>` +
    `<div class="lkName">Golfer: <b>${escapeHtml(p.name || 'Player')}</b> <button id="lkEditName" class="ghostBtn">Edit</button></div>` +
    `<div class="recTabs lkTabs">${tabBar}</div>` +
    `<div class="storeScroll lkScroll">${body}</div>` +
    `<div class="lkFooter"><button id="lkRandom" class="lkFootBtn">🎲 Randomize</button>` +
    `<button id="lkLock" class="lkFootBtn primary">${p.loadoutLocked ? '✓ Locked in' : 'Lock it in'}</button></div>` +
    `</div>`;

  lockerEl.querySelectorAll('.lkTab').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      lkTab = (el as HTMLElement).dataset.tab as typeof lkTab;
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.charCard[data-ch]').forEach((el) =>
    onTap(el, () => {
      sel.character = (el as HTMLElement).dataset.ch as CharacterKey;
      syncLoadout();
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.archCard[data-arch]').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.archetype = (el as HTMLElement).dataset.arch as ArchetypeId;
      syncLoadout();
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.palPick[data-pal]').forEach((el) =>
    onTap(el, () => {
      const id = (el as HTMLElement).dataset.pal!;
      if (id) equip(p, id);
      else delete p.cosmetics.equipped.pal;
      persistProfile();
      if (signedIn) void cloudSyncProfile(p).then((res) => { applyCloudMerge(p, res.profile); showCloudStatus(res.status, true); });
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.palPick[data-perk]').forEach((el) =>
    onTap(el, () => {
      const id = (el as HTMLElement).dataset.perk!;
      p.equippedPerk = id || null;
      persistProfile();
      if (signedIn) void cloudSyncProfile(p).then((res) => { applyCloudMerge(p, res.profile); showCloudStatus(res.status, true); });
      updateSeasonLink();
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.charCard[data-cosmetic]').forEach((el) =>
    onTap(el, () => {
      const [, id] = (el as HTMLElement).dataset.cosmetic!.split(':');
      equip(p, id);
      persistProfile();
      if (signedIn) void cloudSyncProfile(p).then((res) => { applyCloudMerge(p, res.profile); showCloudStatus(res.status, true); });
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.storeCard[data-upgrade]').forEach((el) =>
    onTap(el, () => {
      const id = (el as HTMLElement).dataset.upgrade!;
      const item = upgradeItems.find((i) => i.id === id)!;
      if (isOwned(p, item)) return; // upgrades apply automatically once owned
      const can = canBuy(p, item);
      if (!can.ok) {
        showMsg(can.reason, 1200);
        return;
      }
      lkPendingBuy = id;
      renderLockerRoom();
    })
  );
  if (pendingUpgrade) {
    document.getElementById('lkUpBuyYes')!.addEventListener('pointerdown', () => {
      lkPendingBuy = null;
      const r = buyItem(p, pendingUpgrade.id);
      if (!r.ok) {
        showMsg(r.reason, 1200);
        renderLockerRoom();
        return;
      }
      persistProfile();
      if (signedIn) void cloudSyncProfile(p).then((res) => { applyCloudMerge(p, res.profile); showCloudStatus(res.status, true); });
      renderLockerRoom();
    });
    document.getElementById('lkUpBuyNo')!.addEventListener('pointerdown', () => {
      lkPendingBuy = null;
      renderLockerRoom();
    });
  }
  document.getElementById('lkRandom')!.addEventListener('pointerdown', () => {
    sel.character = (ownedChars.length ? randomOf(ownedChars) : CHARACTERS[0]).key as CharacterKey;
    sel.archetype = randomOf(ARCHETYPES).id as ArchetypeId;
    if (ownedPals.length) equip(p, randomOf(ownedPals).id);
    syncLoadout();
    renderLockerRoom();
  });
  // "Lock it in" marks the loadout as chosen (so tee-off stops auto-randomizing)
  // and closes the locker.
  // Lock it in / Done use 'click' (not 'pointerdown') deliberately: both hide
  // this full-screen overlay (inset:0, z-index:25) synchronously. Hiding it on
  // the down-stroke opens a window — between touchstart and touchend — where
  // the overlay is already gone and the finger's release/synthesized click
  // hit-tests against whatever is now exposed underneath (e.g. the main
  // menu's "Log out" button), firing THAT element's click handler instead.
  // On iOS Safari this reliably read as "locking in a loadout logs me out."
  // 'click' only fires once the down+up pair has resolved against this same
  // button, so the overlay is still on top for the whole gesture and there is
  // no intermediate frame where a lower element can catch the release.
  document.getElementById('lkLock')!.addEventListener('click', () => {
    p.loadoutLocked = true;
    syncLoadout();
    lkPendingBuy = null;
    lockerEl.style.display = 'none';
  });
  document.getElementById('lkEditName')!.addEventListener('pointerdown', () => promptName(true));
  document.getElementById('lkBack')!.addEventListener('click', () => {
    lkPendingBuy = null;
    lockerEl.style.display = 'none';
  });
}

/** One-time (and editable) name entry. Not part of the round flow or locker
 *  loadout — a name is an account/guest-level identity. Shows a small modal;
 *  on a fresh profile it's shown once before the menu is usable. */
function promptName(editing = false): void {
  const modal = document.getElementById('nameModal')!;
  modal.style.display = 'flex';
  modal.innerHTML =
    `<div class="nameBox"><div class="stepTitle">${editing ? 'Edit your name' : "Welcome! What's your name?"}</div>` +
    `<div class="stepHint">Shown on your scorecard.</div>` +
    `<input id="nmInput" type="text" maxlength="16" placeholder="Your name" autocomplete="off" autocapitalize="words" value="${escapeHtml(profile.name)}" />` +
    `<button id="nmSave" class="spBuy">Save</button></div>`;
  const input = document.getElementById('nmInput') as HTMLInputElement;
  const save = (): void => {
    const v = input.value.trim();
    if (!v) return;
    profile.name = v;
    sel.name = v;
    persistProfile();
    if (signedIn) void cloudSyncProfile(profile).then((res) => { applyCloudMerge(profile, res.profile); showCloudStatus(res.status, true); });
    modal.style.display = 'none';
    if (lockerEl.style.display === 'flex') renderLockerRoom();
  };
  document.getElementById('nmSave')!.addEventListener('pointerdown', save);
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') save();
  });
  setTimeout(() => input.focus(), 30);
}

function renderStepBody(): void {
  const label = stepLabels()[sel.step];
  if (label === 'Mode') renderMode();
  else if (label === 'Course') renderCourse();
  else if (label === 'Ready') renderTournamentReady();
  else renderOpponent();
}

function updateNav(): void {
  // On step 0 the Back button stays visible as an explicit "Home" control that
  // returns to the landing screen (the handler already routes home when
  // step <= 0); on later steps it walks back one wizard step. Keeping it in the
  // row means Home/Locker/Next fill the three slots evenly instead of leaving a
  // dead gap.
  backBtn.style.display = '';
  backBtn.textContent = sel.step === 0 ? '🏠 Home' : 'Back';
  nextBtn.textContent = sel.step === stepLabels().length - 1 ? 'Tee off' : 'Next';
  nextBtn.disabled = false;
}

/** Tournament entry: mode + course are fixed by the tournament and the loadout
 *  comes from the Locker Room, so this is a one-tap confirmation. */
function renderTournamentReady(): void {
  const name = pendingTournament?.name ?? 'Tournament';
  stepBodyEl.innerHTML =
    `<div class="stepTitle">Ready to play</div>` +
    `<div class="stepHint">🏁 ${escapeHtml(name)} — same wind & pins for everyone. Tee off when ready.</div>` +
    `<div class="stepHint" style="margin-top:10px">Your golfer: <b>${escapeHtml(profile.name || 'Player')}</b> · ` +
    `${escapeHtml(archetypeById(profile.archetype).name)}. Change your loadout in the Locker Room.</div>`;
}

function goStep(n: number): void {
  sel.step = Math.max(0, Math.min(stepLabels().length - 1, n));
  renderSteps();
  renderStepBody();
  updateNav();
}

function showLanding(): void {
  pendingTournament = null;
  setupEl.style.display = 'none';
  landingEl.classList.add('on');
  updateDailyBanner();
  updateLandingProfileButton();
}

function showSetup(): void {
  pendingTournament = null; // a normal Play Now open is not a tournament entry
  landingEl.classList.remove('on');
  setupEl.style.display = 'flex';
  updateDailyBanner();
  goStep(0);
}

/**
 * Live-ops overrides (data/liveOpsConfig): fetched once at boot, non-blocking
 * (REST with a deterministic local fallback) — never touched during gameplay.
 */
let liveOps: LiveOpsConfig | null = null;
void fetchLiveOpsConfigREST(LEADERBOARD_URL).then((cfg) => {
  if (!cfg) return;
  liveOps = cfg;
  updateDailyBanner(); // today's challenge may have been overridden
});

/** Today's effective daily challenge: the live-ops override when one is
 *  published for the date, else the deterministic hash pick. */
function effectiveDailyChallenge(dateKey: string): DailyChallenge {
  const overrideId = dailyOverrideFor(liveOps, dateKey);
  return DAILY_CHALLENGES.find((c) => c.id === overrideId) ?? dailyChallengeFor(dateKey);
}

/** Today's daily challenge + streak: the SETUP banner and the landing's ONE
 *  concise Daily card (objective · progress · reward · streak — Part 3). */
function updateDailyBanner(): void {
  const key = todayKey();
  const ch = effectiveDailyChallenge(key);
  const doneToday = profile.daily.date === key && profile.daily.done;
  const banner = document.getElementById('dailyBanner');
  if (banner) {
    const streak = profile.dailyStreak > 0 ? ` · 🔥 ${profile.dailyStreak}` : '';
    banner.innerHTML = `<span class="dcLabel">DAILY${streak}</span><span class="dcName">${doneToday ? '✅ ' : ''}${escapeHtml(ch.name)}</span>`;
  }
  const card = document.getElementById('dailyCard');
  if (card) {
    const s = profile.retention.streak;
    const streakBit =
      s.current > 0
        ? `<span class="dcStreak">🔥 ${s.current} day${s.current > 1 ? 's' : ''} · day ${cycleDay(s.current)}/7${s.protectionAvailable ? ' 🛡' : ''}</span>`
        : `<span class="dcStreak">Start a streak today</span>`;
    const reward = streakRewardFor(Math.max(1, s.lastDate === key ? s.current : s.current + 1));
    const rewardBits = [
      `+${COINS.daily} 🪙 +${XP.daily} XP`,
      reward.coins ? `+${reward.coins} 🪙 streak` : '',
      reward.xp ? `+${reward.xp} XP streak` : ''
    ]
      .filter(Boolean)
      .join(' · ');
    card.innerHTML =
      `<div class="dcTop"><span class="dcLabel">DAILY CHALLENGE</span>${streakBit}</div>` +
      `<div class="dcName">${doneToday ? '✅ Done: ' : ''}${escapeHtml(ch.name)}</div>` +
      `<div class="dcReward">${doneToday ? 'Come back tomorrow to keep the streak' : rewardBits}</div>`;
  }
}

/** The one free True Vision charge every round starts with. This is EPHEMERAL
 *  — in-memory only, never written into profile.consumables — so it combines
 *  with whatever the player already owns for THIS round (owning 3 means 4
 *  available) but is discarded, not stacked, if unused by the time the round
 *  ends or the next one starts (see refreshTrueVisionBtn/revealTrueVision,
 *  which spend this before dipping into the persisted/owned charges). Called
 *  from every round-start entry point (solo/versus, online tournament, AI
 *  tournament) so it's never missed. */
let roundTrueVisionBonus = 0;
function grantRoundTrueVision(): void {
  roundTrueVisionBonus = 1;
}

function startRound(startHoleIdx = 0): void {
  // A fresh start from the menu abandons any half-finished AI tournament.
  aiTour = null;
  round.course = courseFallback(sel.courseId);
  round.mode = sel.mode;
  // Normal play always opens on hole 1; the perf/verification hooks can boot a
  // later hole directly (WW3/TL3 are the heavy first-tee-shot cases).
  round.holeIdx = Math.min(Math.max(0, startHoleIdx), round.course.holes.length - 1);
  round.activePlayer = 0;
  round.holeWinds = [];
  round.holePins = [];
  round.seed = undefined;
  round.tournament = null;
  shotAcc = freshShotAcc();
  // Remember the selections for next launch (persisted only when signed in)
  persistProfile();
  // The AI Tournament is a mode: hand off to the three-round loop instead of
  // a single three-hole round. startAiTourRound() grants this round's True
  // Vision itself — granting here too would double it on tournament round 1
  // (and it runs its own beginRoundTracking, so tracking here would
  // double-count round 1 too).
  if (sel.mode === 'aitour') {
    setupEl.style.display = 'none';
    buildWithLoading(() => startAiTournament());
    return;
  }
  beginRoundTracking();
  grantRoundTrueVision();
  const golfer = roundGolfer();
  round.players = [{ golfer, isAI: false, scores: [] }];
  if (round.mode !== 'solo') {
    const opp = OPPONENTS.find((o) => o.id === sel.opponentId) ?? OPPONENTS[1];
    round.players.push({ golfer: opp, isAI: true, scores: [] });
  }
  setupEl.style.display = 'none';
  buildWithLoading(() => playHole());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 1 → "1st", 2 → "2nd" … for tournament placements (field is tiny — no
 *  need for the 11th/12th/13th special cases, but they're correct anyway). */
function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * Prominent main-menu account control (playtest FB9): a green Link-Google button
 * (styled like the wizard's Next button) when signed out; a "✓ Signed in as …"
 * row with a Log out button once linked. Surfaces account linking where it's
 * obvious and reflects the real, persistent state. The profile overlay keeps its
 * own copy of the control too.
 */
function updateLandingProfileButton(name?: string): void {
  const btn = document.getElementById('landingProfile');
  if (!btn) return;
  if (signedIn) {
    const label = name || profile.name || 'your account';
    btn.textContent = `Profile — ${label}`;
  } else {
    btn.textContent = 'Log In / Profile';
  }
}

function renderAcctMenu(): void {
  const el = document.getElementById('acctMenu');
  updateLandingProfileButton();
  if (!el) return;
  if (!authConfigured()) {
    el.innerHTML = '';
    return;
  }
  // Signed-out: a prominent sign-in button with a "save your progress" subtitle
  // so the account's purpose is obvious, plus a small ghost link into Profile
  // (guests still have local settings/stats worth reaching). Signed-in: a
  // "Signed in as …" row that IS the Profile entry point (tap to open) with a
  // Log out button. State is driven by the `signedIn` flag (set by
  // adopt/sign-out).
  const showSignInButton = (): void => {
    el.innerHTML =
      `<button id="acctLinkBtn" class="acctBtn">🔑 Sign in with Google</button>` +
      `<div class="acctHint">Sign in to save your coins &amp; progress</div>` +
      `<button id="acctProfileLinkOut" class="ghostLink">👤 Profile &amp; Settings</button>`;
    document.getElementById('acctProfileLinkOut')!.addEventListener('pointerdown', () => renderProfile());
    const btn = document.getElementById('acctLinkBtn') as HTMLButtonElement;
    // iOS Safari only honors signInWithPopup's window.open as a trusted user
    // gesture inside a 'click' event — pointerdown gets silently blocked with
    // no catchable error, unlike wireAccountRow's onclick handler which works.
    btn.onclick = () => {
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
    };
  };
  const showSignedIn = (name: string): void => {
    el.innerHTML =
      `<div class="acctSignedIn">` +
      `<span class="acctWho">✓ Signed in as <b>${escapeHtml(name)}</b></span>` +
      `<button id="acctProfileRow" class="acctProfileBtn">👤 Profile</button>` +
      `<button id="acctLogout" class="acctLogout">Log out</button></div>`;
    document.getElementById('acctProfileRow')!.addEventListener('pointerdown', () => renderProfile());
    (document.getElementById('acctLogout') as HTMLButtonElement).onclick = () => {
      void doSignOut().then(() => {
        showSignInButton();
        refreshWizardIfVisible();
      });
    };
  };
  if (signedIn) {
    void linkedAccountName().then((name) => {
      updateLandingProfileButton(name ?? undefined);
      showSignedIn(name ?? 'your account');
    });
  } else {
    updateLandingProfileButton();
    showSignInButton();
  }
}

document.getElementById('landingPlay')!.addEventListener('pointerdown', () => showSetup());
document.getElementById('landingSeason')!.addEventListener('pointerdown', () => renderSeasonPass());
document.getElementById('landingStore')!.addEventListener('pointerdown', () => renderStore());
document.getElementById('landingProfile')!.addEventListener('pointerdown', () => renderProfile());
document.getElementById('navLocker')!.addEventListener('pointerdown', () => renderLockerRoom());
document.getElementById('recordsLink')!.addEventListener('pointerdown', () => renderRecords());
document.getElementById('storeBanner')?.addEventListener('pointerdown', () => renderStore());
document.getElementById('seasonBanner')?.addEventListener('pointerdown', () => renderSeasonPass());
document.getElementById('tournyLink')!.addEventListener('pointerdown', () => renderTournaments());
updateSeasonLink();
updateStoreBanner();
updateLandingProfileButton();
tourBoardBtn.addEventListener('pointerdown', () => showAiTourBoard());
renderAcctMenu();
backBtn.addEventListener('pointerdown', () => {
  if (sel.step <= 0) showLanding();
  else goStep(sel.step - 1);
});
nextBtn.addEventListener('pointerdown', () => {
  if (sel.step < stepLabels().length - 1) goStep(sel.step + 1);
  else if (pendingTournament) {
    const t = pendingTournament;
    pendingTournament = null;
    startTournamentRound(t);
  } else startRound();
});

/**
 * Screenshot-harness boot (`?hole=N&cam=…&freeze=1`): skip the wizard, load
 * the requested hole in a fixed pose with fixed wind, and raise __shotReady
 * once the scene (course, character, textures) is fully renderable.
 */
async function startShotCapture(): Promise<void> {
  grantRoundTrueVision();
  round.course = courseFallback(SHOT.course);
  round.mode = 'solo';
  round.holeIdx = Math.min((SHOT.hole ?? 1) - 1, round.course.holes.length - 1);
  round.activePlayer = 0;
  // Fixed wind so the HUD chip (and any wind-driven visuals) never varies
  round.holeWinds = round.course.holes.map(() => ({ angle: 0.9, speed: 8 }));
  round.holePins = round.course.holes.map((h) => ({ ...h.pin }));
  round.players = [
    { golfer: assembleGolfer('Shot', CHARACTERS[0].key, ARCHETYPES[0].id), isAI: false, scores: [] }
  ];
  setupEl.style.display = 'none';
  // Real play always passes through the menu, giving the grain images time to
  // decode before the first synchronous bake; this direct boot must wait for
  // them or every capture shows the procedural fallback players never see.
  await grainPreloadsSettled();
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

if (SHOT.hole) void startShotCapture();
else {
  showLanding();
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
  /** 1-based hole to boot directly (perf spec: WW3/TL3 heavy first tee shots). */
  hole?: number;
}) => {
  if (opts?.name !== undefined) {
    sel.name = opts.name;
    profile.name = opts.name; // roundGolfer() reads profile.name, not sel.name
  }
  if (opts?.character) sel.character = opts.character;
  if (opts?.archetype) sel.archetype = opts.archetype;
  if (opts?.mode) sel.mode = opts.mode;
  if (opts?.opponentId) sel.opponentId = opts.opponentId;
  if (opts?.courseId && COURSES[opts.courseId]) sel.courseId = opts.courseId;
  // Mirror the real Play flow: the landing overlay comes down before the
  // round starts (a hook-started round otherwise leaves it covering the game).
  landingEl.classList.remove('on');
  startRound(opts?.hole ? opts.hole - 1 : 0);
};

// Test hook: complete the current round instantly with the given (or par)
// hole scores and show the results screen — lets the Replay / Play Next /
// records specs exercise the real end-of-round flow without playing three
// holes of meter golf under software GL.
(window as unknown as { __finishRound: unknown }).__finishRound = (scores?: number[]) => {
  const holeCount = holesThisRound();
  const s =
    scores && scores.length === holeCount
      ? scores
      : round.course.holes.slice(0, holeCount).map((h) => h.par);
  current?.dispose();
  current = null;
  round.players.forEach((p) => {
    p.scores = p.isAI ? s.map((v) => v + 1) : [...s];
  });
  round.holeIdx = holeCount;
  showSummary();
};

// Test hook: expose the live AI-tournament state so specs can assert the
// rota/standings without scraping the DOM (read-only snapshot).
(window as unknown as { __aiTour: unknown }).__aiTour = () => (aiTour ? { courseIds: [...aiTour.courseIds], played: aiTour.played } : null);

// Test hook: read the player's current True Vision charge count (owned +
// this round's ephemeral bonus, matching what the in-round button shows), so
// specs can assert every round grants at least one without scraping the DOM.
(window as unknown as { __trueVisionCharges: unknown }).__trueVisionCharges = () =>
  chargesRemaining(profile, TRUE_VISION.id) + roundTrueVisionBonus;

// Test hook: grant session coins so specs can exercise the purchase flow
// (signed-out play is ephemeral — nothing here persists or reaches the cloud).
(window as unknown as { __grantCoins: unknown }).__grantCoins = (n: number) => {
  profile.coins += n;
};

// Test hook: grant owned consumable charges (e.g. True Vision) directly, so
// specs can assert the free round bonus correctly combines with owned
// charges without driving the season pass/store flow.
(window as unknown as { __grantConsumable: unknown }).__grantConsumable = (id: string, qty: number) => {
  grantConsumable(profile, id, qty);
};

// Test hook: set a club-upgrade tier directly (bypassing the store UI) and
// re-render the current setup step, so specs can verify the archetype
// screen reflects a purchased upgrade without driving the full store flow.
(window as unknown as { __setClubUpgrade: unknown }).__setClubUpgrade = (family: string, tier: number) => {
  profile.clubUpgrades[family] = tier;
  renderStepBody();
};

// Test hook: jump the setup menu straight to the Style step.
(window as unknown as { __gotoStyleStep: unknown }).__gotoStyleStep = () => {
  sel.step = stepLabels().indexOf('Style');
  renderStepBody();
};
