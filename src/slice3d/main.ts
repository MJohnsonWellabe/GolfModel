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
  Quaternion,
  Scene,
  StandardMaterial,
  TrailMesh,
  TransformNode,
  Vector3,
  Viewport
} from '../core/rendering/babylon';
import { FLIGHT, LEADERBOARD_URL, PHYSICS, PUTT_VIEW, PX_PER_YARD, RULES, SWING } from '../config';
import { activeBedKind, BedKind, COURSE_BEDS, startBed } from '../core/audio/beds';
import { setAmbienceMasterVolume } from '../core/audio/engine';
import { playBuffer } from '../core/audio/sfx';
import { LANDING_THUMP, variedParams } from '../core/audio/variation';
import { ENV } from '../config/env';
import { countUpValue } from '../core/countUp';
import { devDateOverride, devNow, devToolsActive, setDevDateOverride } from '../core/devTools';
import { isFrozen, SHOT, ShotCam } from '../core/debugFlags';
import { mountEnvBadge } from '../core/envBadge';
import { allFlags, enableFlagOverrides, flag, setFlagOverride } from '../core/flags';
import { adminUnlocked, clearSignInHint, readSignInHint, writeSignInHint } from '../core/signInHint';
import { AimControl, ShotContext } from '../core/input/AimControl';
import { StrikeControl } from '../core/input/StrikeControl';
import { grainPreloadsSettled, preloadGrassGrain } from '../core/rendering/grassTexture';
import { resolveTheme } from '../core/rendering/Theme';
import { ClubSpec, CourseData, GameMode, Golfer, GolferStats, HoleData, Point, ShotOutcome, Surface, SwingResult, TrajectoryPoint, Wind } from '../core/types';
import { assembleGolfer } from '../data/golfers';
import { ARCHETYPES, ArchetypeId, archetypeById, StatKey } from '../data/archetypes';
import { CHARACTERS, CharacterKey } from '../data/characters';
import { personalityFor } from '../data/characterPersonality';
import { courseIdOrDefault, courseOrDefault, DEFAULT_COURSE_ID } from '../data/courseDefaults';
import { coursesFor, rosterFor } from '../data/courseRoster';
import { loadCourse } from '../data/courseLoader';
import { checkpointFor, clearCheckpoint, loadCheckpoint, markResumeAttempt, RoundCheckpoint, saveCheckpoint, toParLabel } from '../systems/RoundCheckpoint';
import { RoundRecorder, RoundRecording } from '../systems/RoundRecording';
import { ReplayOptions } from '../systems/RoundReplay';
import { GhostRun } from '../systems/GhostRun';
import { pinForSeed, shotRngSeed } from '../systems/RoundConditions';
import { recordBoards } from '../systems/RecordBoards';
import { dailyHole, shareText } from '../systems/DailyHoleService';
import { ARCHETYPE_NAMES } from '../systems/DailyHole';
import { loadDailyPlay, saveDailyPlay } from '../systems/DailyHoleStore';
import { verifyRecording } from '../systems/RoundVerify';
import { bestRecordingFor, saveRecording } from '../systems/RecordingStore';
import { bestRounds, clearLocalHistory, fetchAllRounds, loadLocal, isNewRecord, isShared, makeRoundId, RoundRecord, saveRound } from '../firebase/History';
import { AiTournamentState, completeRound, createAiTournament, hotStreakAt, isFinal, purseFor, standings as aiTourStandings } from '../systems/AiTournament';
import { activeTour, archiveTour, canAddSeason, clearActiveTour, LIVE_SEASON_CAP, nextSeasonNo, putTour, selectTour, applyCoopSnapshot, completeTourPlayoffHole, completeTourRound, coopSeasonSettled, coopSeasonStandings, currentEvent, quitSeason, eventBoardRows, eventRoundsPlayed, eventRowsFor, finishSeason, hasGrandSlam, MAJOR_NAMES, MAX_PLAYOFF_HOLES, newSeason, playoffPending, pointsForStandings, proRetired, recordTourEventWin, recordTourSeasonFinish, recomputeSeasonPoints, rolloverSeason as rolloverTourSeason, TOUR_POINTS, seasonStandings, SEASON_LIMIT, TourCoopPartner, TourEventResult, TourSeasonState, TourEventDef, TourRoundOutcome, tourSchedule, TOUR_EVENTS, TOUR_MAJOR_IDXS } from '../systems/TourSeason';
import { TOUR_RIVALS } from '../data/tourRivals';
import { CoopSeasonDoc, coopUrl, createCoopSeason, fetchCoopSeason, joinCoopSeason, makeCoopId, parseCoopParam, postCoopResult } from '../firebase/CoopSeason';
import { majorCourseForRound } from '../systems/TourMajorSetup';
import { applyTeeVariants } from '../systems/Layouts';
import { mulberry32 } from '../utils/Random';
import { authConfigured, authState, CloudSaveStatus, cloudEmail, cloudSyncProfile, cloudUid, giftSeasonReward, linkedAccountName, onAccountAppeared, signInWithGoogle, signOutAccount, submitRoundForVerification } from '../firebase/FirebaseClient';
import { isAdminEmail } from '../admin/adminEmails';
import { chargesRemaining, CRASH_LOG_MAX, CrashRecord, clearLocalProfile, consumeCharge, CosmeticKind, defaultProfile, DeviceSettings, grantConsumable, grantPerk, loadDeviceSettings, loadProfile, mergeProfiles, perkRemaining, PlayerProfile, resetProfileRecords, saveDeviceSettings, saveProfile } from '../profile/Profile';
import { achievementCp, COINS, DAILY_CHALLENGES, DailyChallenge, emptyRoundStats, RoundStats, XP, dailyChallengeFor } from '../data/progression';
import { featById, FEAT_TIERS, FEATS, recordHoleFeats } from '../systems/Feats';
import { activePro, careerOvr, careerStarted, CP, pointCost, pointsAffordable, setActivePro, setProLook, startPro } from '../data/career';
// CP belongs to the Pro who earned it — every grant/spend goes through the
// wallet so a rookie starts at zero and a retired Pro's balance is frozen
// rather than nagging from the landing (systems/CareerWallet.ts).
import { buyProAttrPoint, grantCareerCp, spendableCp } from '../systems/CareerWallet';
import { applyRound, RewardEvent } from '../systems/ProgressionEngine';
import { Analytics, restTransport } from '../systems/Analytics';
import { TutorialCoach } from './tutorial';
import { guestId } from '../profile/GuestIdentity';
import { dailyOverrideFor, LiveOpsConfig, weeklyOverrideFor } from '../data/liveOpsConfig';
import { fetchLiveOpsConfigREST } from '../firebase/LiveOpsConfig';
import { dailyEventFor, weeklyEventFor, weeklyStanding, weeklyTimeLeft, WeeklyEvent } from '../systems/WeeklyFeatured';
import { fetchWeeklyEntries, submitWeeklyEntry } from '../firebase/Weekly';
import {
  AsyncChallengeDef,
  challengeOutcome,
  challengeUrl,
  decodeChallenge,
  isExpired as challengeExpired,
  parseChallengeParam,
  sanitizeName
} from '../systems/AsyncChallenge';
import {
  ChallengeDoc,
  createChallengeDoc,
  fetchChallenge,
  makeChallengeId,
  outcomeFor,
  submitChallengeResponse
} from '../firebase/Challenges';
import { applyRoundRecords, RecordEvent } from '../systems/Records';
import { asDifficulty, Difficulty, DIFFICULTIES, difficultyProfile, effectiveDifficulty, recordsAllowed, UNRANKED_RECORDS_MSG, zoneMultFor } from '../systems/Difficulty';
import { advanceStreak, claimStreakReward, currentStreak, cycleDay, emptyStreak, streakRewardFor } from '../systems/Streak';
import {
  calibrateRivalSkill,
  hasRival,
  houseRival,
  recalibrateRival,
  rivalStanding,
  settleRivalDay
} from '../systems/Rival';
import { synthesiseRivalRound } from '../systems/RivalRound';
import {
  acceptRivalInvite,
  createRivalInvite,
  fetchRivalEntry,
  fetchRivalInvite,
  makeRivalInviteCode,
  pairId,
  postRivalEntry,
  RivalEntry
} from '../firebase/Rivals';
import { applyHoleMastery, emptyMastery, holeStars, HoleMasteryInput, nextStarHint, starCount, STAR_BITS } from '../systems/Mastery';
import { MASTERY_CHALLENGES, thirdStarFor } from '../data/masteryChallenges';
import { buyItem, canBuy, equip, equippedBallArt, equippedColor, isOwned } from '../systems/StoreEngine';
import { makeBallArtTexture } from './ballArt3d';
import { addSeasonXp, buyPassWithCoins, claimReward, claimState, levelProgress, ownsPass, rewardLabel, rolloverSeason, seasonActive } from '../systems/SeasonPassEngine';
import { salesOpen, SeasonReward, SEASON_1 } from '../data/seasonPass';
import { claimEntitlements, PRODUCTS, purchaseConfigured, startPurchase } from '../firebase/Purchases';
import { applyClubUpgrades, isEquippableKind, STORE_BY_ID, STORE_CATALOG, StoreItem, upgradePerfectZoneMult, upgradeStatBonus } from '../data/storeCatalog';
// The store offers a WEEKLY SHELF, not the whole catalog (owner: "We should
// start rotating store items… Only leave in the club upgrades always").
import { currentStoreShelf, shelfIds, shelfTimeLeft, storeWeekIndex } from '../systems/StoreRotation';
import { ballArtSwatchCss } from '../core/rendering/ballArt';
import { palByKey, PalDef } from '../data/pals';
import { PerkDef, perkById, perkEffectLabel, perkPerfectZoneMult } from '../data/perks';
import { TRUE_VISION } from '../data/consumables';
import { Pal3D } from './pal3d';
import { AIOpponent, OPPONENTS } from '../data/opponents';
import { AIController, BALANCED_PERSONALITY } from '../systems/AIController';
import { FireSystem } from '../systems/FireSystem';
import { buildHeightField } from '../systems/HeightField';
import { TurnManager } from '../systems/TurnManager';
import { drawWind, simulateHole } from '../systems/RoundSimulator';
import { shouldShowPuttGrid } from '../core/puttAids';
import { renderPacing } from './renderPacing';
import { ballSpinStep } from './ballSpin';
import { dist } from '../utils/Geometry';
import { PhysicsEngine, statsForClub } from '../systems/PhysicsEngine';
import { TreeSpecies } from '../systems/treeField';
import { DEFAULT_TREE_MIX } from '../systems/treeHitbox';
import { boundaryBBox, pointInBoundary, withPlayableBoundary } from '../systems/PlayableBoundary';
import { computeTrueVisionOutcome } from '../systems/TrueVision';
import { scoreName } from '../systems/Scoring';
import { buildCourse, w2b } from './course3d';
import { ClubTuning, Golfer3D } from './golfer3d';
import { DomMeter, MeterContext } from './meter3d';
import { readTrace, resolveTraceSwing, type TraceSample, type TraceState } from '../core/input/TraceSwing';
import { TracePad } from './tracePad';
import { DesignMode, type FlyCam } from './designMode';
import { ShotCapture } from './shotCapture';
import type { QualityProfile } from '../core/rendering/quality';
import {
  demoteQuality,
  qualityStatus,
  renderQuality,
  resetQualityMemory,
  resetQualitySamples,
  sampleFrame,
  setQualityPreference,
  startQualityGovernor
} from './qualityGovernor';

// ------------------------------------------------------------------- boot

const canvas = document.getElementById('scene') as HTMLCanvasElement;
// preserveDrawingBuffer keeps the last composited frame readable, which is what
// makes `page.screenshot()` of a WebGL canvas return the hole instead of black —
// the whole visual reference suite and `npm run shots` depend on it.
//
// It is NOT free, and the old claim that it was is why it shipped on to every
// player's phone: it forces the browser to preserve the back buffer, costing a
// full extra render-target at display resolution plus a copy every frame, and it
// forfeits the compositor's direct-swap path. Nothing IN the game reads pixels
// back — the shot-clip recorder uses `canvas.captureStream()`, which does not
// need it — so it is now paid only where it is used: automation and the capture
// harness.
const needsReadableBuffer =
  (typeof navigator !== 'undefined' && navigator.webdriver === true) || SHOT.hole !== undefined;
//
// GUARDED, because a failure here used to take the WHOLE APP down. This is a
// module-top-level statement and every menu listener is registered hundreds of
// lines below it, so when the constructor threw ("WebGL not supported", after
// Chrome had given up on a page that lost its context too many times) the
// module died and the browser was left painting `#setup`'s static markup with
// empty slots and no handlers — the owner's "smaller version of the menus that
// isn't functional".
//
// The menu layer needs no GPU at all (showLanding, the Locker, the Tour hub and
// the destination sheet are DOM plus profile state), so a device that cannot
// give us a context should still get a working game menu and an honest message,
// not a dead page. `engine3d` is therefore nullable and the handful of uses at
// module scope are guarded; a stand-in object pretending to be an Engine was
// rejected as the more dangerous option — it would have failed later, somewhere
// subtler.
let engine3d: Engine | null = null;
/**
 * MEMORY MARGIN for a device that recently ran out of graphics memory.
 *
 * Read straight off localStorage here because the engine is built at module
 * top, long before `deviceSettings` is initialised — `loadDeviceSettings` is a
 * pure read and calling it twice is harmless. The 7-day window is the same one
 * `captureRisky()` uses (CRASH_QUIET_DAYS, declared later in module order,
 * hence not referenced here).
 *
 * What the margin buys: the engine's 2nd argument is `antialias`. MSAA on the
 * default framebuffer was the single largest UNKNOWN in the GPU-memory
 * inventory of the owner's Pixel 8 crash — up to ~45 MiB if the driver backs
 * the multisample buffers in main memory. A device that just OOM'd is the one
 * place where trading edge smoothing for that headroom is obviously right;
 * healthy devices keep MSAA, and the margin expires with the crash record.
 */
const recentGpuCrash = ((): boolean => {
  try {
    const last = loadDeviceSettings()?.crashes?.[0];
    return !!last && Date.now() - last.at < 7 * 86_400_000;
  } catch {
    return false;
  }
})();
try {
  engine3d = new Engine(canvas, !recentGpuCrash, {
    adaptToDeviceRatio: true,
    preserveDrawingBuffer: needsReadableBuffer
  });
} catch (err) {
  // Keep going. Everything below this point is either GPU-free or guarded.
  console.error('[boot] no WebGL context — menus only', err);
}
/**
 * True when there is a GPU to draw a hole with — retried live, not decided
 * once at boot. Chrome refuses a fresh WebGL context for a short cooldown
 * right after a GPU-process death, which is exactly the state a
 * crash-triggered reload boots into: a boot-only flag would latch false for
 * that page's entire life even though the browser recovers moments later.
 * Every `gpuBlocked()` call is a player's actual tap on Play — cheap to
 * retry construction right there instead of trusting a snapshot taken before
 * the player did anything. A separate try/catch from the boot one above (not
 * a shared helper) so TypeScript keeps narrowing `engine3d` from its boot-time
 * assignment — wrapping that first assignment in a function opaques it from
 * control-flow analysis and every `if (engine3d)` below would narrow to
 * `never`.
 */
function ensureEngine(): boolean {
  if (engine3d) return true;
  try {
    engine3d = new Engine(canvas, !recentGpuCrash, {
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: needsReadableBuffer
    });
  } catch (err) {
    console.error('[gpu] retry failed — still no WebGL context', err);
  }
  return engine3d !== null;
}
/**
 * Set once a lost context has failed to come back (see
 * `abandonAfterContextLoss`), cleared if one ever does.
 *
 * `ensureEngine()` decides whether a NEW context is obtainable and cannot
 * answer this: the engine object still exists after its context dies, so
 * without this flag the menus would cheerfully accept "resume the round" and
 * build a scene against a dead engine — a black canvas, which is the outcome
 * the refusal exists to prevent. Declared up here, not beside the handler
 * that sets it, because `gpuBlocked` reads it thousands of lines earlier and
 * a `let` in temporal dead zone would throw.
 */
let contextGone = false;
/**
 * Whether the round `abandonAfterContextLoss` last tore down actually got a
 * checkpoint written for it (see `checkpointRound`'s deliberately narrow
 * scope — Tour/versus/weekly/challenge rounds never do). Read by the
 * `gpuBlocked` messaging below so a Tour player isn't told "your round is
 * saved" when nothing was.
 */
let roundWasCheckpointed = false;
/** The engine, asserted present. Safe ONLY from code reachable inside a live
 *  hole: `playHole` refuses to build one without a context, so anything running
 *  under a HoleScene is guaranteed a GPU. Never call it at module scope. */
const gpu = (): Engine => engine3d as Engine;

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
// ADAPTIVE QUALITY. The clamp above is a fixed guess about every device in the
// world; the governor turns it into a measurement. It owns the scaling level
// from here on (this call is what it makes at tier 0), stepping the render
// resolution — and, through renderQuality(), the shadow map, water mirror,
// ground bake and decorative scatter — down whenever the median frame time
// says the device cannot hold 30 fps, and back up when it can. See
// src/core/rendering/quality.ts for why that is the fix for the reported
// lag-then-crash rather than thinning any one course.
/**
 * Set once the round machinery exists, to shed quality on a hole that is
 * ALREADY BUILT (everything else in a profile is a build-time budget, which is
 * no help to a player standing on a hole that is too expensive right now).
 *
 * Reached through this hook rather than by touching `current` directly:
 * `startQualityGovernor` invokes its callback SYNCHRONOUSLY, here at module
 * top level, and `current` is declared two thousand lines below — so naming it
 * inside the callback threw a temporal-dead-zone ReferenceError during import
 * and took the whole module down. Exactly the failure mode the engine guard
 * above exists to prevent, arriving by a different door.
 */
let shedLiveQuality: ((q: QualityProfile) => void) | null = null;
startQualityGovernor(
  (q) => {
    engine3d?.setHardwareScalingLevel(1 / (renderDpr * q.renderScale));
    shedLiveQuality?.(q);
  },
  // Read straight from storage: `deviceSettings` is assembled much further down
  // this module, and the governor has to be live before the first scene build.
  loadDeviceSettings()?.graphics ?? 'auto'
);
// Nothing here uses Babylon's offline asset DB — the default `true` makes the
// loader probe for a `.manifest` beside every glb/texture and touch IndexedDB
// on load. Off removes that load-time XHR/DB churn (no visual change).
if (engine3d) engine3d.enableOfflineSupport = false;


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
/** The drag swing's own surface (`dragSwing`). Built once and kept hidden until
 *  a shot arms it, so the flag being off costs nothing but this element. */
const designBtn = document.getElementById('designBtn')!;
const tracePadEl = document.getElementById('tracePad')!;
const tracePad = new TracePad(tracePadEl);
const clubBar = document.getElementById('clubBar')!;
const clubName = document.getElementById('clubName')!;
const aerialBtn = document.getElementById('aerialBtn')!;
const tourBoardBtn = document.getElementById('tourBoardBtn')!;
const pauseBtn = document.getElementById('pauseBtn')!;
const trueVisionBtn = document.getElementById('trueVisionBtn')! as HTMLButtonElement;
const skipBtn = document.getElementById('skipBtn')!;
const flightSkipBtn = document.getElementById('flightSkipBtn')!;
const captureBtn = document.getElementById('captureBtn') as HTMLButtonElement;
// Rolling ~5s canvas capture so a player can save a clip of a great shot to
// their phone. OPT-IN: MediaRecorder encodes video frames continuously while
// running — real per-frame CPU work that has no business on by default during
// gameplay (perf pass: this was the hidden "video work during gameplay").
// First tap on the clip button switches it on (persisted device-locally);
// after that, taps save the last few seconds. Degrades to a hidden button
// where the browser can't record.
// 24fps under the memory margin: a fifth less encode pressure on a device
// that recently lost its context, and the Settings note already tells the
// player recording is the risky feature there. 30 everywhere else.
const shotCapture = new ShotCapture(canvas, recentGpuCrash ? { fps: 24 } : {});
/** How long a recorded context loss keeps the recorder off. A device that has
 *  gone a week without losing its context has earned the feature back. */
const CRASH_QUIET_DAYS = 7;
/**
 * Whether this device has room for the canvas recorder at all.
 *
 * Recording is `canvas.captureStream(30)` feeding a MediaRecorder for the whole
 * round: a full-frame copy off the GPU plus a live encode session, every frame.
 * No quality tier accounts for it, because the tiers budget the SCENE. The
 * owner's Pixel 8 lost its context with the governor already pinned to its
 * cheapest tier and the recorder running — every lever spent, and this still
 * outside the budget.
 *
 * So a device that has actually lost a context this week gets the recorder OFF
 * BY DEFAULT — but this ADVISES, it does not forbid.
 *
 * It used to forbid, and it also fired on `!pinned && floor >= 3`. Both were
 * wrong. The doc said it "comes back on its own once the device climbs off the
 * floor", and the floor could never fall: it was seeded from the boot guess and
 * persisted across sessions, so on Auto this was permanent. The Settings
 * checkbox rendered `disabled`, the 🎥 button refused, and the only escape was
 * to pin Performance — the SAME tier — because a pinned floor was read as a
 * preference. Nothing said so anywhere. Owner: "Don't turn clip recording off
 * or at least let people turn it back on."
 *
 * Now: the game may start it off and say why, and the player may always
 * override. An explicit opt-in wins, on any device, at any tier.
 */
function captureRisky(): boolean {
  const last = deviceSettings.crashes[0];
  return !!last && Date.now() - last.at < CRASH_QUIET_DAYS * 86_400_000;
}
/** Shown when the player switches recording on against advice — never as a
 *  refusal. A button that does nothing is indistinguishable from a broken one,
 *  and a button that scolds and then obeys is better than one that only scolds. */
const CAPTURE_RISKY_MSG =
  'Clip recording ON — heads up, this device ran out of graphics memory recently and recording costs more of it.';
if (captureBtn) {
  captureBtn.addEventListener('pointerdown', () => {
    if (!deviceSettings.clipCapture) {
      updateDeviceSettings({ clipCapture: true });
      shotCapture.start();
      captureBtn.textContent = '🎥 REC';
      // Warn, then obey — the tap always turns it on.
      showMsg(
        captureRisky() ? CAPTURE_RISKY_MSG : 'Clip recording ON — tap 🎥 again to save your last shot',
        captureRisky() ? 4200 : 2600
      );
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

// The post-shot attribution box (#shotWhy) lived here until owner pass 8:
// "Get rid of the shot attribution box. I don't find it helpful." The pure
// counterfactual engine (systems/ShotAttribution.ts) is kept, shelved, in
// case a gentler surface ever earns its place.

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

/** Cinematic celebration banner (V2 delight): display type between gold
 *  hairlines for the EARNED moments — no emojis, no plain toast. Falls back
 *  to showMsg when the delight flag is off, so production keeps today's
 *  presentation until release. */
const cineEl = document.getElementById('cineBanner');
let cineTimer: ReturnType<typeof setTimeout> | null = null;
function showCineBanner(title: string, sub: string, tier: 'epic' | 'great' | 'fire', ms: number): void {
  if (!flag('delight') || !cineEl) {
    showMsg(sub ? `${title} — ${sub}` : title, ms);
    return;
  }
  cineEl.innerHTML =
    `<div class="cineInner cine-${tier}"><div class="cineRule"></div>` +
    `<div class="cineTitle">${escapeHtml(title)}</div>` +
    `<div class="cineRule"></div>` +
    (sub ? `<div class="cineSub">${escapeHtml(sub)}</div>` : '') +
    `</div>`;
  cineEl.classList.add('on');
  replayAnim(cineEl, 'cineAnim');
  if (cineTimer) clearTimeout(cineTimer);
  cineTimer = setTimeout(() => cineEl.classList.remove('on'), ms);
}

const sounds: Record<string, number> = {
  swing: 0.5, 'impact-driver': 0.9, 'impact-iron': 0.8, 'impact-wedge': 0.7,
  putt: 0.7, hole: 0.9, splash: 0.8, chime: 0.75, ui: 0.35
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
    // V2 audio identity (flag-gated): the WebAudio path adds controlled
    // per-key variation. It reports false while unavailable or still
    // decoding a key, in which case the proven HTMLAudio path below carries
    // that play — a sound is never lost to the new pipeline.
    if (flag('audio')) {
      const v = variedParams(key);
      if (playBuffer(key, vol * v.gainMult, { rate: v.rate })) return;
    }
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
/** The bed for the round's current course (V2 Phase 5), default coastal. */
function bedForCurrentCourse(): BedKind {
  return COURSE_BEDS[courseIdByName(round.course.name)] ?? 'coastal';
}
function startAmbience(): void {
  if (ambienceStarted) return;
  ambienceStarted = true;
  // V2 audio identity (flag-gated): a per-course procedural bed replaces the
  // one shared wav loop. Falls back to the wav whenever WebAudio is
  // unavailable; the flag off never touches the new path at all.
  if (flag('audio')) {
    setAmbienceMasterVolume(profile.settings.ambience);
    if (startBed(bedForCurrentCourse())) return;
  }
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
/** Re-point the ambient bed at the current course (round start / Play Next).
 *  No-op until the first gesture has started ambience, or with the flag off. */
function refreshAmbienceBed(): void {
  if (!ambienceStarted || !flag('audio') || !activeBedKind()) return;
  startBed(bedForCurrentCourse());
}
/** Push the current ambience-volume setting to the live loop (slider drag). */
function applyAmbienceVolume(): void {
  setAmbienceMasterVolume(profile.settings.ambience);
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
  /** Per-competitor "on fire" streak carried BETWEEN holes. The per-hole
   *  HoleScene (and its FireSystems) is disposed and rebuilt each hole, so
   *  without this the streak silently reset on every hole change; a streak
   *  should end only on a missed band, never on advancing to a new hole. */
  fireState?: Array<{ streak: number; onFire: boolean }>;
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
  /** Weekly Featured event this round counts toward (Part 8), or null. */
  weeklyEventId?: string | null;
  /** Async challenge being answered this round (Part 9), or null. */
  challenge?: AsyncChallengeDef | null;
  /**
   * The difficulty this round is being played at — LOCKED at the tee.
   *
   * Read by the meter (armMeter) and by the records fold at the summary. It is
   * a snapshot rather than a live read of the setting for two reasons: changing
   * Settings mid-round must not resize the meter under a card already half
   * written, and a shared season plays at the HOST's difficulty rather than
   * each participant's own (see lockRoundDifficulty).
   */
  difficulty: Difficulty;
}

// V2 content expansion (redhollow/wildvalley). The newCourses flag now defaults
// ON in production (playtest-approved release), so the two courses load for
// everyone; adminUnlocked() remains as a legacy override path. The flag stays as
// a kill switch until the courses are folded into the base roster.
// The roster and which JSON each course loads now live in data/courseRoster.ts
// — the server-side verifier has to build the SAME roster from the SAME files
// and cannot import this module (Babylon, DOM, Firebase). Flags are resolved
// here and passed in, so the roster module itself stays pure.
const loadNewCourses = flag('newCourses') || adminUnlocked();
const rebuildsOn = flag('courseRebuilds');
const ROSTER_FLAGS = {
  newCourses: loadNewCourses,
  courseRebuilds: rebuildsOn,
  wildwoodPerf: flag('wildwoodPerf')
};
const COURSES: Record<string, CourseData> = coursesFor(ROSTER_FLAGS);

// Fire the real-turf-grain preloads at boot, well before any round can start
// (the menu is always shown first) — the ground bake is synchronous and
// falls back to procedural noise if a key hasn't resolved yet. Harmless
// no-ops on courses that don't opt into either key (decoded but unread).
preloadGrassGrain('textures/turf_grain.jpg');
preloadGrassGrain('textures/turf_grain_rough.jpg');
preloadGrassGrain('textures/sand_ripple.jpg');

/** Full course roster metadata (id → display + one-line character). */
const COURSE_ROSTER = rosterFor(ROSTER_FLAGS);
/** The playable roster (loaded into COURSES). */
const COURSE_LIST = COURSE_ROSTER.filter((c) => COURSES[c.id]);
/** Roster entries present in the metadata but NOT loaded — shown as locked
 *  "Coming soon" teaser cards. Empty now that every course is released. */

const COMING_SOON_COURSES = COURSE_ROSTER.filter((c) => !COURSES[c.id]);

/** Resolve a course id (or absent/invalid one) to CourseData, defaulting to
 *  Sable Bay. Thin binding of the shared roster to courseDefaults' helper. */
const courseFallback = (id?: string | null): CourseData => courseOrDefault(id, COURSES);

/** Resolve a course by its display name (tournament entries carry the name). */
function courseIdByName(name: string): string {
  const listed = COURSE_LIST.find((c) => COURSES[c.id]?.name === name)?.id;
  if (listed) return listed;
  // COURSE_LIST is the static roster; COURSES additionally holds courses
  // registered at runtime — today's Hole of the Day under a reserved id. A
  // daily round used to fall through to DEFAULT_COURSE_ID here, which stamped
  // its recording with WILDWOOD: the verifier then replayed the generated
  // hole's shots on a completely different hole, so no daily attempt could ever
  // verify and every one of them was silently dropped.
  const registered = Object.keys(COURSES).find((id) => COURSES[id]?.name === name);
  return registered ?? DEFAULT_COURSE_ID;
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
  holePins: [],
  // Replaced by lockRoundDifficulty() at every tee; this is only the value a
  // round would have if one somehow began without one.
  difficulty: 'amateur'
};

/**
 * What the player has chosen in Settings, or the lesson-aware default while
 * they have not chosen (Beginner before the lesson, Amateur after it).
 */
function playerDifficulty(): Difficulty {
  // THIS DEVICE'S EXPLICIT CHOICE WINS, the account's is the fallback.
  //
  // It used to read the profile first, and that is how "I went back to hard and
  // it stayed easy" happened: `persistProfile()` only writes when signed in, so
  // in a guest or pre-sign-in session `profile.updatedAt` never left 0 — every
  // merge then treated the OTHER copy as newer and handed its stale difficulty
  // straight back, where it masked the correct value sitting in device
  // settings. Difficulty now follows the same rule the volumes and reduced
  // motion already do (`applyDeviceSettings`: "this device's preferences always
  // win locally"), which is immune to that by construction.
  //
  // The profile copy is still written and still syncs — it is what a NEW device
  // inherits, and what makes the choice visible to the account.
  return effectiveDifficulty(
    deviceSettings.difficulty ?? profile.settings.difficulty,
    deviceSettings.tutorialDone
  );
}

/**
 * Stamp the difficulty this round will be played at. Called from every tee —
 * casual, AI tournament, tour event, playoff — so there is exactly one rule.
 *
 * Owner rule: "a shared season or event has to be played at the same
 * difficulty. whoever starts it chooses that difficulty." A shared season
 * carries its host's choice in the shared doc (firebase/CoopSeason), so every
 * participant's rounds in it run at that difficulty regardless of their own
 * setting — otherwise the standings would be comparing two different games.
 * Everything else uses the player's own setting.
 */
function lockRoundDifficulty(): void {
  // A RESUMED round keeps the difficulty it teed off at. The whole point of
  // locking at the tee is that a settings change cannot resize the meter under
  // a card already half written — re-locking on resume broke that across the
  // one gap where it matters most, and silently flipped whether the round could
  // set a record.
  const resumed = asDifficulty(resumingFrom?.diff);
  if (resumed) {
    round.difficulty = resumed;
    return;
  }
  // A tour EVENT and its sudden-death playoff are both part of the season, so
  // both inherit the season's locked difficulty; everything else is the
  // player's own setting.
  const inSeason = tourRoundLive || !!tourPlayoff;
  const shared = inSeason ? asDifficulty(tourNow()?.coop?.diff) : undefined;
  round.difficulty = shared ?? playerDifficulty();
}

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
  /** True when the TEE SHOT finished on the green — the only evidence a par 4
   *  was driven, and not derivable from anything else the round records
   *  (systems/Feats.ts, 'drive_a_par4'). */
  droveGreen: boolean;
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
    windSpeed: 0,
    droveGreen: false
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
  // devNow() is real time unless dev tools simulate a date (non-prod only).
  const d = devNow();
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
    const theme = resolveTheme(round.course);
    round.holePins[idx] = pinForSeed(round.seed, idx, round.course.holes[idx], {
      useAuthoredPins: flag('layouts'),
      bunkerDepthScale: theme.bunkerDepthScale ?? 1,
      wasteDepthScale: theme.wasteDepthScale ?? 0,
      gentlePins: roundGentlePins
    });
  }
  return round.holePins[idx];
}

/**
 * Ease-in (`easeIn`): should THIS round draw the kindest pins?
 *
 * Only for a device's first few casual rounds. Simulation puts the casual
 * first-hole blow-up rate at 10% on Wildwood and 8% on Timberline, and a
 * beginner's opening hole is the worst place in the product to spend that — it
 * lands before any of the progressive-disclosure rewards unlock.
 *
 * Deliberately EXCLUDES every shared-seed round — weekly, async challenge,
 * tournament, Hole of the Day, ghost race — because those promise identical
 * conditions for every entrant, and quietly softening one player's pins would
 * make their score incomparable. Invisible when it applies, absent when it
 * would be unfair.
 */
function easeInActive(): boolean {
  if (!flag('easeIn')) return false;
  if (round.weeklyEventId || round.challenge || activeGhost || dailyRound) return false;
  if (round.mode !== 'solo') return false;
  return profile.stats.rounds < EASE_IN_ROUNDS;
}

/**
 * Whether THIS round is drawing the ease-in pins — decided once at the tee and
 * held for the whole round.
 *
 * `easeInActive()` reads `profile.stats.rounds`, which increments when a round
 * is banked. Calling it per hole (as `pinForHole` first did) meant the answer
 * could change underneath a round in progress, and — worse — that the seal path
 * could ask "was this round gentle?" after the counter had already moved and be
 * told no. Pins that the replay cannot reproduce make an honest round fail
 * verification. One decision, one round.
 */
let roundGentlePins = false;

/** How many completed rounds the gentle-pin ease-in covers. Three is one full
 *  sitting: long enough to learn the swing, short enough that the player is on
 *  the real course before they could form a habit around softer pins. */
const EASE_IN_ROUNDS = 3;


/** Score vs par across a participant's completed holes, broadcast style. */
function scoreToPar(p: Participant): string {
  let diff = 0;
  p.scores.forEach((s, i) => (diff += s - round.course.holes[i].par));
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
}

// ----------------------------------------------------------- hole scene

/** Pooled dots that draw the white aim line (ball → carry-landing on full shots,
 *  ball → chosen spot on putts). Dense enough that the full-shot line reads as a
 *  continuous line rather than a few scattered specks. */
const AIM_DOT_COUNT = 40;

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
  /** The hole being played. Readable from outside so a builder preview can hand
   *  its (fly-mode edited) geometry back to the builder. */
  hole: HoleData = withPlayableBoundary(
    { ...round.course.holes[round.holeIdx], pin: pinForHole(round.holeIdx) },
    flag('boundedWorld')
  );
  private theme = resolveTheme(round.course);
  private golfers: Golfer3D[] = [];
  private balls: Mesh[] = [];
  /** The visible spheres, one per anchor in `balls`. These are the meshes that
   *  ROTATE — the anchors must not (see the ball construction comment). */
  private ballSkins: Mesh[] = [];
  /** Bounded-world debug overlay line meshes (see showBoundary); empty in play. */
  private boundaryOverlay: Mesh[] = [];
  /** Red hatched OUT-OF-BOUNDS border, drawn only in the aerial planning view
   *  so a single overhead glance shows where off-course is (owner). Rebuilt on
   *  each aerial entry, disposed otherwise. */
  private obBorder: Mesh[] = [];
  /** Cached OB-border segments for this hole. The border geometry is world-space
   *  and static per hole, so the grid-march that computes it runs at most once —
   *  the HoleScene (and this cache with it) is rebuilt on every hole change. */
  private obSegsCache: Vector3[][] | null = null;
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

  /** The active ball's visible sphere — what spin is applied to. */
  private get ballSkin(): Mesh {
    return this.ballSkins[this.turnIdx];
  }

  /** Scratch quaternion for the per-frame spin, so a flight frame allocates
   *  nothing (the tick is the hot path — see the reused scratch vectors above). */
  private readonly _spinQ = Quaternion.Identity();

  /**
   * Turn the ball for one frame of travel (systems: src/slice3d/ballSpin.ts).
   *
   * PURELY VISUAL, and one-directional by construction: it reads the ball's
   * old and new positions and the shot's club/spin, and writes only the SKIN's
   * orientation. It never touches `flight`, `state`, the recorder or the
   * physics — and it draws no random numbers, because `shotRng` is the stream
   * the replay re-derives and sampling it would break score verification.
   *
   * Driven by distance travelled rather than elapsed time, so slow-motion
   * playback and a skipped-to-rest flight both come out right; see the module
   * header for why that matters.
   */
  private spinBall(nextPos: Vector3, heightAboveGround: number): void {
    const skin = this.ballSkin;
    const fl = this.flight;
    if (!skin || !fl) return;
    const prev = this.ball.position;
    const travel = { x: nextPos.x - prev.x, y: nextPos.y - prev.y, z: nextPos.z - prev.z };
    // `bz` is the trajectory's own height, which is the honest read: a ball at
    // the apex is moving flat but is still airborne, and the vertical component
    // of `travel` would call that a roll.
    const airborne = heightAboveGround > 0.01 && !fl.isPutt;
    const step = ballSpinStep(travel, airborne, 1.0, {
      clubSpin: fl.launch?.club.spin,
      spinEff: fl.launch?.spinEff,
      topSpin: fl.spin.top,
      sideSpin: fl.spin.side
    });
    if (!step.axis || !step.radians) return;
    Quaternion.RotationAxisToRef(
      new Vector3(step.axis.x, step.axis.y, step.axis.z),
      step.radians,
      this._spinQ
    );
    // Compose onto the current orientation rather than replacing it: a golf
    // ball has no home face, and accumulating is what carries the tumble
    // smoothly across the flight-to-roll handover.
    (skin.rotationQuaternion ?? Quaternion.Identity()).multiplyToRef(
      this._spinQ,
      (skin.rotationQuaternion ??= Quaternion.Identity())
    );
  }

  /** Face every ball forward again. Ball meshes live for the whole hole and are
   *  shared by every competitor, so without this each shot would inherit the
   *  last one's tumble — and player B would start wearing player A's. */
  private resetBallSpin(): void {
    for (const skin of this.ballSkins) {
      (skin.rotationQuaternion ??= Quaternion.Identity()).copyFrom(Quaternion.Identity());
    }
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
  /** Skyward burst system for the biggest hole-outs (hole-in-one / eagle / long
   *  hole-out). Idle at emitRate 0 like the puff; driven by staggered manual
   *  emits from launchFireworks(). Additive blend so the sparks glow. */
  private fireworks: ParticleSystem;
  private shakeT = 0;
  // Camera "punch" on a full-swing strike (Phase 6 juice): a brief recoil along
  // the camera's view axis that the normal camera lerp then recovers from.
  // Alloc-free — the direction and a scratch offset are reused each frame.
  private camPunchT = 0;
  private readonly camPunchDir = new Vector3();
  private readonly _camPunchScratch = new Vector3();
  private aimRoot!: TransformNode;
  private aimDots: Mesh[] = [];
  private aimRing!: Mesh;
  /** True Vision's red dashed line — a second, independent dot pool (never
   *  touched by updateAimVisuals' per-frame redraw): populated once on tap
   *  and left alone until the putt is struck or the turn ends. */
  private trueVisionRoot!: TransformNode;
  private trueVisionDots: Mesh[] = [];
  /** Golden, enlarged terminal marker showing exactly where the ball comes to
   *  rest on the revealed line — so short vs long relative to the cup reads at
   *  a glance (playtest: "make it clearer if you're going to come up short or
   *  long"). */
  private trueVisionEnd!: Mesh;
  /** World point the aim-distance/elevation readout floats over (FB2/FB4). */
  private aimReadoutWorld: { x: number; y: number } | null = null;
  private aerial = false;
  /** Course's own fog density, captured on first aerial toggle (see
   *  applyAerialFog). */
  private baseFogDensity: number | null = null;
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
    /** Wall-clock strike time — the ⏩ button appears on TIME, not samples,
     *  because throttled headless/background frames advance samples slowly. */
    startedAt: number;
  } | null = null;
  /** Set by the ⏩ flight-skip button: after the landing beat plays, carry the
   *  shot straight through the roll to rest (fastForwardFlight). */
  private skipToRest = false;
  private disposed = false;
  /** Guards `teardownChrome` — both `dispose()` and the lost-context abandon
   *  path call it, and a lost context can still be followed by a normal
   *  teardown, so it has to be safe to run twice. */
  private chromeTornDown = false;
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
  /** Resolves once the course can actually paint (ground shader compiled) — the
   *  loading veil and flyover wait on this so no blue clearColor frame shows. */
  get groundReady(): Promise<void> {
    return this.course3d.groundReady;
  }
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
  /** Translucent stand-in flying the ghost's recorded shot alongside the
   *  player's (`ghostRace`). Created lazily on the first ghost shot and
   *  disposed with the scene. */
  private ghostBall: Mesh | null = null;
  /** Sudden-death playoff: one parked ball per tied rival (keyed by rival id),
   *  and which rivals' hole-out toast has already fired. */
  private poBalls = new Map<string, Mesh>();
  private poToasted = new Set<string>();
  /** The ghost's flight currently in the air, advanced by the same tick that
   *  advances the player's so both balls read as one moment. */
  private ghostFlight: { path: TrajectoryPoint[]; progress: number } | null = null;
  /** How many shots the ghost has played on this hole so far. */
  private ghostShotIdx = 0;
  /** The tier of the celebration the LAST hole-out earned (null = ordinary),
   *  so the hole-end delay can hold for the fireworks (owner: aces rushed to
   *  the next hole before the show finished). */
  private lastHoleOutTier: 'epic' | 'great' | null = null;
  /** The swing context this turn was armed with, shared by the tap meter and
   *  the drag swing so a perfect strike means the same thing on both. */
  private swingCtx: MeterContext | null = null;
  /**
   * The live traced swing (`dragSwing`), or null when not swinging.
   *
   * The whole PATH is kept, not just the release point: the control scores how
   * far along the route you got, how close to the line you stayed and how well
   * you kept the guide dot's tempo, and none of the three is knowable from
   * where the finger happened to lift.
   */
  private trace: { path: TraceSample[]; state: TraceState } | null = null;
  /**
   * FLY MODE (builder previews only). While it is up the canvas belongs to it:
   * the pointer steers a free camera over the real hole and places assets, and
   * the round is paused underneath.
   */
  design: DesignMode | null = null;
  /** Per-shot random source for the physics engine (see the engine's
   *  construction). Re-seeded before every shot from the round seed, the hole
   *  and the stroke number, so the same shot always breaks the same way. */
  private shotRng: () => number = mulberry32(1);

  constructor(private onHoleComplete: (scores: number[]) => void) {
    markPerf(round.course.name, this.hole.number, 'hole-constructor-start');
    this.scene = new Scene(gpu());
    // All input is raw DOM listeners on the canvas — there are no Babylon
    // ActionManagers, onPointerObservable subscribers, or scene.pick calls — so
    // the default per-pointer-move mesh pick serves nothing. Skip it.
    this.scene.skipPointerMovePicking = true;
    const heightT0 = performance.now();
    // The tree-species mix so each trunk's collision is shaped like the drawn
    // asset (per-asset hitboxes) — same source the renderer picks species from.
    const treeSpecies: TreeSpecies = {
      trees: this.theme.treeKeys ?? DEFAULT_TREE_MIX,
      accents: this.theme.accentTreeKeys ?? []
    };
    this.engine2d = new PhysicsEngine(
      this.hole,
      buildHeightField(this.hole, this.theme.bunkerDepthScale ?? 1, this.theme.wasteDepthScale ?? 0),
      // DETERMINISM: the physics consults randomness in exactly one place — the
      // deflection angle when a putt lips out and horseshoes away. Left as
      // Math.random that single branch makes a round IRREPRODUCIBLE, which
      // quietly breaks everything built on replaying one: an honest round with
      // a lip-out would fail verification, and a ghost would take a different
      // line than its owner did. Seeding it per shot (below, in executeShot)
      // costs nothing, changes no distribution, and makes the whole game a
      // function of (seed, inputs).
      () => this.shotRng(),
      treeSpecies,
      this.theme.edgeWobble ?? 1
    );
    markPerf(round.course.name, this.hole.number, `heightfield-ready:${Math.round(performance.now() - heightT0)}ms`);
    // Aim/preview run on a flat, no-slope engine so the aim line never
    // reveals wind or slope — the player estimates hold-off (FB1/FB2). The
    // real shot uses engine2d (terrain + wind).
    this.previewEngine = new PhysicsEngine(
      { ...this.hole, slope: { angle: 0, strength: 0 } },
      null,
      undefined,
      treeSpecies
    );
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
      const g = new Golfer3D(
        this.scene,
        shadows,
        part.golfer.character,
        part.golfer.look,
        // Personality (V2 Phase 3): flag-gated so production keeps the shared
        // V1 behavior until release. Off/unknown → the neutral set inside.
        flag('personality') ? personalityFor(part.golfer.character) : undefined
      );
      g.root.setEnabled(false);
      // The human player wears their equipped apparel (outfit colorway + club
      // skin); AI opponents keep the defaults (Phase 7 store — playtest FB9).
      if (!part.isAI) {
        g.setOutfitTint(equippedColor(profile, 'outfit', 0xffffff));
        g.setClubSkin(equippedColor(profile, 'clubskin', 0x9aa6b2));
      }
      this.golfers.push(g);
      // THE BALL IS TWO MESHES, AND HAS TO BE (see ballSpin.ts).
      //
      // `b` is an un-rotated ANCHOR: it carries the position, the view scale,
      // and — the reason for the split — it is the trail's generator. Babylon
      // builds the trail ribbon's cross-section ring in the generator's local
      // XY plane and pushes it through the generator's FULL world matrix,
      // rotation included (trailMesh.pure.js `_updateSectionVectors`). Backspin
      // turns about a local horizontal axis, so spinning the generator would
      // tilt that ring every frame and the ribbon would strobe, pinch and
      // self-intersect. Do not collapse these two back into one mesh.
      //
      // `skin` is the sphere the player actually sees: it wears the material
      // and it is the only thing that rotates. Parented, so every existing
      // position and scaling write on the anchor still moves it.
      // The anchor is a geometry-less Mesh — Babylon's empty-parent idiom — so
      // it stays a real Mesh for `balls: Mesh[]`, positions and scales exactly
      // as before, and draws nothing itself.
      const b = new Mesh(`ball${i}`, this.scene);
      // A tumbling silhouette shows faceting a static one hides, so the human
      // player's ball gets 16 segments; AI balls stay at the cheaper 12.
      const skin = MeshBuilder.CreateSphere(
        `ballSkin${i}`,
        { diameter: 1.0, segments: part.isAI ? 12 : 16 },
        this.scene
      );
      skin.parent = b;
      skin.rotationQuaternion = Quaternion.Identity();
      this.ballSkins.push(skin);
      const bm = new StandardMaterial(`ballMat${i}`, this.scene);
      // The human player's ball wears the equipped cosmetic (Phase 7 store):
      // a flat tint as it always has, or — for a DESIGNED ball (StoreItem
      // .ballArt: the ink wash, the alignment stripe, the cavity band, the
      // drip) — a 128x64 lat-long texture painted once here. AI opponents keep
      // plain white. The texture belongs to the scene, so HoleScene.dispose
      // frees it; the material hook covers a material replaced mid-scene, so
      // nothing accumulates across holes (CLAUDE.md rule 13).
      const ballArt = part.isAI ? undefined : equippedBallArt(profile);
      if (ballArt) {
        const ballTex = makeBallArtTexture(this.scene, `ballArt${i}`, ballArt);
        bm.diffuseTexture = ballTex;
        bm.diffuseColor = new Color3(1, 1, 1);
        bm.onDisposeObservable.addOnce(() => ballTex.dispose());
      } else {
        bm.diffuseColor = part.isAI ? new Color3(0.97, 0.97, 0.95) : c3(equippedColor(profile, 'ball', 0xf7f7f2));
      }
      bm.specularColor = new Color3(0.5, 0.5, 0.5);
      // Material and shadow belong to the skin — the anchor has no geometry to
      // shade or to cast. (A rotating sphere casts the same shadow as a still
      // one, so the shadow map is unaffected by the spin either way.)
      skin.material = bm;
      shadows.addShadowCaster(skin);
      this.balls.push(b);
      const fire = new FireSystem();
      // Carry the streak in from the previous hole of this round (holeIdx 0 =
      // fresh start; a missed band is still the only thing that puts it out).
      if (round.holeIdx > 0) fire.restore(round.fireState?.[i]);
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
    this.fireworks = this.makeFireworks();
    // Pay the strike's shader bill NOW, not when the ball is struck. See
    // `warmStrikeShaders`.
    void this.bodiesReady.then(
      () => this.warmStrikeShaders(),
      () => this.warmStrikeShaders()
    );

    // Aim guide: a row of ground dots from the ball toward the aim point,
    // capped by a target ring — the shot line you're setting up
    const aimMat = new StandardMaterial('aimMat', this.scene);
    aimMat.diffuseColor = new Color3(1, 1, 1);
    aimMat.emissiveColor = new Color3(0.9, 0.9, 0.7);
    aimMat.disableLighting = true;
    this.aimRoot = new TransformNode('aimRoot', this.scene);
    // A denser pool so the full-shot aim line reads as a LINE, not a couple of
    // specks lost across a 250-yd carry (owner: "you just see the aim marker").
    // Putts use the same pool at a fine scale, so denser only helps them too.
    for (let i = 0; i < AIM_DOT_COUNT; i++) {
      const dot = MeshBuilder.CreateDisc(`aimDot${i}`, { radius: 0.55, tessellation: 12 }, this.scene);
      dot.rotation.x = Math.PI / 2;
      dot.material = aimMat;
      // The guide is decoration lying ON the aiming surface, so it must never
      // answer a pick. This matters most in the overhead view, where the dots
      // are scaled up to 9x and sit flat under a top-down ray: a tap meant for
      // the ground would land on the aim line instead and the aim would stop
      // moving. (Edge-on in the play view it never bit, which is exactly why
      // it went unnoticed until the aerial guide came back.)
      dot.isPickable = false;
      dot.parent = this.aimRoot;
      this.aimDots.push(dot);
    }
    this.aimRing = MeshBuilder.CreateTorus('aimRing', { diameter: 6, thickness: 0.7, tessellation: 24 }, this.scene);
    this.aimRing.rotation.x = Math.PI / 2;
    this.aimRing.material = aimMat;
    this.aimRing.isPickable = false;
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
      dot.isPickable = false; // decoration on the putting surface — same rule as the aim guide
      dot.parent = this.trueVisionRoot;
      this.trueVisionDots.push(dot);
    }
    // Golden endpoint puck — bigger + a bright gold glow so the resting spot
    // pops out from the red line and reads clearly short/long of the cup.
    const tvEndMat = new StandardMaterial('trueVisionEndMat', this.scene);
    tvEndMat.diffuseColor = new Color3(1, 0.85, 0.1);
    tvEndMat.emissiveColor = new Color3(1, 0.82, 0.05);
    tvEndMat.disableLighting = true;
    const tvEnd = MeshBuilder.CreateDisc('trueVisionEnd', { radius: 0.45, tessellation: 24 }, this.scene);
    tvEnd.rotation.x = Math.PI / 2;
    tvEnd.material = tvEndMat;
    tvEnd.isPickable = false;
    tvEnd.parent = this.trueVisionRoot;
    this.trueVisionEnd = tvEnd;
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

    this.ghostShotIdx = 0; // the ghost's shot index is per HOLE, not per round
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
      // The SKINS, not the anchors: the anchor is a geometry-less parent with
      // no material, so warming it would compile nothing and hand the ball's
      // shader — a textured one, for a designed ball — to the first frame.
      this.ballSkins.forEach((s) => jobs.push(warm(s)));
      await Promise.all(jobs.filter(Boolean));
      markPerf(round.course.name, this.hole.number, `address-shaders-warm:${Math.round(performance.now() - warmT0)}ms`);
    } catch {
      /* best-effort warm-up — a shot must never depend on it */
    }
  }

  /**
   * COMPILE THE STRIKE'S SHADERS BEFORE THE STRIKE.
   *
   * Measured (drain.spec's strike gate, and a per-frame probe): the first frame
   * after the ball is struck intermittently costs 590-1000ms instead of ~25ms,
   * and the slow frames are exactly the ones that compile new GPU programs. The
   * two that show up are `shadowMap` and `particles`:
   *
   *  - the shadow map is FROZEN while the camera is parked at address
   *    (renderPacing.cameraParked), so its depth program is not compiled until
   *    the freeze lifts — which `executeShot` does at the moment of the strike;
   *  - the impact puff's particle shader is not created until a particle first
   *    draws, which is the same instant.
   *
   * Shader compilation is a synchronous driver call, so both land in one frame,
   * on top of the drain resuming at full budget and a fresh trail uploading.
   * That pile-up IS the owner's "I lagged out with the ball in the air".
   *
   * The work cannot be avoided — but it can be moved. Both are warmed here,
   * during the intro flyover, where the camera is already travelling and the
   * governor's sample window is deliberately reset. `forceCompilation` is
   * incremental (it retries on a 16ms timer rather than blocking), and
   * `isReady()` creates the particle effect as a side effect, which is the
   * whole point of calling it and discarding the answer.
   *
   * Numbers are from headless software GL, where a compile is far dearer than
   * on a real GPU — the phone's stall is smaller. Moving it is free either way.
   *
   * Called at BOTH ends of the window: once the golfer bodies are in (the intro
   * flyover, where there is time to spare) and again at the start of every turn
   * (which the player cannot skip, and by which point everything that will be
   * on screen at the strike exists). One pass at a time — `forceCompilation`
   * runs its own retry loop — and a completed pass costs only a readiness check
   * on the next turn.
   */
  private warmingStrike = false;
  private warmStrikeShaders(): void {
    if (this.warmingStrike || this.disposed || this.scene.isDisposed) return;
    this.warmingStrike = true;
    try {
      this.course3d.shadows.forceCompilation(() => {
        this.warmingStrike = false;
      });
      // Creates the particle effect as a side effect; the answer is not the point.
      this.puff.isReady();
    } catch {
      // A warm-up that fails must never cost the hole it was warming.
      this.warmingStrike = false;
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

  /** A soft "in the hole" puff at the cup on a made putt (Phase 6 juice). The
   *  bigger golden shower for special hole-outs (celebrateHoleOut) overrides
   *  this in the same tick, so a long putt keeps its full celebration. Reuses
   *  the shared puff — no new allocation. */
  private cupBurst(): void {
    const pin = this.hole.pin;
    (this.puff.emitter as Vector3).copyFrom(w2b(pin.x, pin.y, 0.6 + this.gh(pin.x, pin.y)));
    this.puff.color1 = new Color4(1, 1, 0.96, 0.8);
    this.puff.color2 = new Color4(0.82, 0.94, 1, 0.4);
    this.puff.manualEmitCount = 12;
  }

  /** A small white-gold sparkle at the ball on a PERFECT strike (perfect power
   *  + perfect accuracy) — the "flushed it" tell (Phase 6 juice). Reuses the
   *  shared puff system; a manual emit, so zero steady-state cost. */
  private perfectSparkle(): void {
    const b = this.state.ballPos;
    (this.puff.emitter as Vector3).copyFrom(w2b(b.x, b.y, 0.8 + this.gh(b.x, b.y)));
    this.puff.color1 = new Color4(1, 1, 0.9, 0.9);
    this.puff.color2 = new Color4(1, 0.85, 0.4, 0.5);
    this.puff.manualEmitCount = 10;
  }

  /** Fireworks for the biggest hole-outs. A single ParticleSystem sitting idle
   *  (emitRate 0) like the puff; each burst is a radial manual emit — direction1
   *  and direction2 span opposite corners so the sparks fly outward in every
   *  direction, gravity arcs them down, and BLENDMODE_ADD makes them glow. */
  private makeFireworks(): ParticleSystem {
    const tex = new DynamicTexture('fwTex', { width: 32, height: 32 }, this.scene, true);
    const c = tex.getContext() as CanvasRenderingContext2D;
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    tex.update(false);
    tex.hasAlpha = true;
    const fw = new ParticleSystem('fireworks', 900, this.scene);
    fw.particleTexture = tex;
    fw.emitter = new Vector3(0, -100, 0);
    fw.minSize = 0.35;
    fw.maxSize = 0.9;
    fw.minLifeTime = 0.7;
    fw.maxLifeTime = 1.3;
    fw.emitRate = 0;
    // A sphere of outward velocity: opposite corners → every direction.
    fw.direction1 = new Vector3(-26, -26, -26);
    fw.direction2 = new Vector3(26, 26, 26);
    fw.minEmitPower = 0.4;
    fw.maxEmitPower = 1;
    fw.gravity = new Vector3(0, -14, 0);
    fw.blendMode = ParticleSystem.BLENDMODE_ADD;
    fw.start();
    return fw;
  }

  /** Launch a short salvo of fireworks in the sky above `(cx, cy)` — the
   *  celebrating GOLFER's spot, NOT the pin: on a hole-in-one the camera pushes
   *  onto the golfer at the tee while the cup is hundreds of units away, so
   *  pin-anchored bursts fired off-screen (owner: "fireworks on hole-in-ones
   *  aren't firing"). Staggered bursts at varied sky positions/colours read as a
   *  real display. `epic` (hole-in-one / eagle) gets a bigger, longer show.
   *  Reduced-motion players get a single modest burst. */
  private launchFireworks(epic: boolean, cx: number, cy: number): void {
    const ground = this.gh(cx, cy);
    const palette: Array<[number, number, number]> = [
      [1, 0.3, 0.3], // red
      [1, 0.85, 0.25], // gold
      [0.35, 0.6, 1], // blue
      [0.55, 1, 0.5], // green
      [1, 0.55, 0.9] // pink
    ];
    const reduced = profile.settings.reducedMotion;
    const bursts = reduced ? 1 : epic ? 9 : 4;
    const perBurst = reduced ? 120 : 220;
    for (let i = 0; i < bursts; i++) {
      // The epic show paces itself across the 5-second hold the hole-end
      // delay now grants it, instead of dumping every shell in two seconds.
      const delayMs = i * (reduced ? 0 : epic ? 460 : 320);
      const col = palette[i % palette.length];
      // Scatter the shells across the sky above the golfer — never dead-centre.
      const jx = i === 0 ? 0 : (((i * 37) % 11) - 5) * 5;
      const jy = i === 0 ? 0 : (((i * 53) % 11) - 5) * 5;
      // Up in the sky but kept in the celebration camera's frame — that camera
      // dollies to ~11u back / 4.6u up looking at the golfer's chest, so bursts
      // much above ~40u sail over the top of the frame once it settles.
      const sky = 20 + ((i * 17) % 18);
      setTimeout(() => {
        if (this.disposed) return;
        (this.fireworks.emitter as Vector3).copyFrom(w2b(cx + jx, cy + jy, ground + sky));
        this.fireworks.color1 = new Color4(col[0], col[1], col[2], 1);
        this.fireworks.color2 = new Color4(col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 0.4);
        this.fireworks.manualEmitCount = perBurst;
      }, delayMs);
    }
  }

  /** One short haptic tick where supported (Android Chrome; iOS Safari has no
   *  vibration API). Kept to single sub-40ms pulses on genuinely earned beats
   *  (perfect strike, hole-out) so it stays a tell, not a buzz. */
  private hapticTick(ms: number): void {
    if (profile.settings.reducedMotion) return;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
    } catch {
      /* never let a haptic failure touch the shot path */
    }
  }

  private ctx(): ShotContext {
    return {
      ball: this.state.ballPos,
      lie: this.state.lie,
      golfer: this.curPart().golfer,
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
    // Tee-shot overpower fix (dev-only): the driver drops the overswing distance
    // bonus so a big overswing no longer flies miles past target; every other
    // club keeps the shared bonus. Undefined → swingModel uses SWING.overswingBonus.
    const overswingBonus =
      flag('driverOverswingNerf') && !this.aim.isPutting && this.aim.club.id === 'driver'
        ? SWING.driverOverswingBonus
        : undefined;
    const swingCtx = {
      stat: statsForClub(this.aim.club, this.curPart().golfer).zone,
      powerTarget: this.aim.barPowerTarget(this.ctx()),
      isPutt: this.aim.isPutting,
      // ...and the ROUND's difficulty multiplies the same band. It is read off
      // `round`, not off the profile, because a round locks its difficulty at
      // the tee (see lockRoundDifficulty) — changing the setting mid-round must
      // not resize the meter under a card already being written.
      perfectMult: fire.perfectZoneMultiplier * upgradeZone * perkZone * zoneMultFor(round.difficulty),
      difficultyMult: this.swingDifficulty(),
      overswingBonus
    };
    // The drag swing (`dragSwing`) resolves against the SAME context, so both
    // control schemes share one definition of a perfect strike.
    this.swingCtx = swingCtx;
    // Show it BEFORE arming: arm() lays the zones out and measures the bar, and
    // a display:none bar measures 0 (see meter3d's perfectBand note — that is
    // the bug that ate the centre line).
    meterEl.style.display = 'block';
    meter.arm(swingCtx);
    meterEl.classList.toggle('onFire', fire.isOnFire);
    // TRACED SWING (`dragSwing`): the pad IS the swing surface, and it marks
    // the point on the route this club is asking for — the same `targetBar` the
    // meter marks. Showing the horizontal meter as well would put the target in
    // two places, so it is one control or the other, and the SWING button goes
    // with the meter.
    const pulling = traceInputOn() && !this.comps[this.turnIdx].isAI;
    if (pulling) {
      meterEl.style.display = 'none';
      swingBtn.style.display = 'none';
      tracePad.arm(swingCtx);
    } else {
      swingBtn.style.display = '';
      tracePad.hide();
    }
    // Fire vignette (juice): while an on-fire HUMAN is at address, a static
    // warm edge glow carries the state beyond the meter. CSS-only overlay;
    // cleared on launch (executeShot) and scene teardown (dispose).
    document.documentElement.classList.toggle(
      'fire-vignette',
      flag('juice') && fire.isOnFire && !this.comps[this.turnIdx].isAI
    );
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

  /**
   * Enter or leave FLY MODE.
   *
   * The gameplay chrome comes down entirely: a swing meter and an aim line are
   * meaningless while you are placing trees, and leaving them up would invite
   * a tap that plays a shot into a hole you are halfway through editing.
   */
  toggleDesign(on = !this.design, resumeCam?: FlyCam): void {
    if (on === !!this.design) return;
    if (!on) {
      this.design?.dispose();
      this.design = null;
      designBtn.classList.remove('on');
      this.setChromeForDesign(false);
      this.setCamSetup();
      return;
    }
    const bar = document.getElementById('designBar');
    if (!bar) return;
    this.design = new DesignMode(
      {
        scene: this.scene,
        hole: this.hole,
        // The course's own nature palette (mirrors course3d's natPalette), so
        // a previewed tree is cloned in this course's colors.
        palette: {
          bark: this.theme.treeTrunk,
          foliage: this.theme.treeCanopy,
          foliageLight: this.theme.treeCanopyLight,
          grass: this.theme.rough,
          stone: this.theme.stoneTint ?? 0x7e7c72,
          grassLit: this.theme.lushGrass
        },
        setCam: (pos, look) => {
          this.camTarget.pos = pos;
          this.camTarget.look = look;
          this.camTarget.k = 12; // barely smoothed: a design camera must feel direct
          this.camTarget.fov = 1.05;
        },
        groundAt: (x, y) => this.gh(x, y),
        // The rebuild must not END the design session: committing a drawn green
        // triggers one, and being thrown back to address after every draw would
        // break the loop the mode exists for (draw → see it → keep drawing).
        // The camera travels across so the designer comes back to their spot.
        rebuild: () => {
          pendingFlyResume = this.design?.getCamState() ?? null;
          rebuildBuilderPreview(this.hole);
        },
        exit: () => this.toggleDesign(false)
      },
      bar,
      resumeCam
    );
    designBtn.classList.add('on');
    this.setChromeForDesign(true);
    // SNAP, don't lerp. Picking unprojects through the CURRENT view matrix, so
    // a tap made while the camera is still gliding into position resolves
    // against the old vantage — placing the asset somewhere the designer never
    // pointed, or (from a near-horizontal address camera) nowhere at all. An
    // editing mode should arrive instantly anyway.
    this.camera.position.copyFrom(this.camTarget.pos);
    this.camera.setTarget(this.camTarget.look);
    this.camera.fov = this.camTarget.fov;
  }

  /**
   * Take the gameplay chrome down around fly mode, and put it back EXACTLY as
   * it was.
   *
   * Snapshotted rather than reset to '': these elements do not share a default.
   * `#clubBar` and `#meter` are `display: none` in the stylesheet and switched
   * on by gameplay, so clearing the inline style hides them for good — which is
   * how leaving fly mode first shipped with no club selector.
   */
  private chromeBefore: Array<[HTMLElement, string]> = [];

  private setChromeForDesign(designing: boolean): void {
    const chrome = [swingBtn, meterEl, clubBar, hudEl, tracePadEl];
    if (designing) {
      this.chromeBefore = chrome.map((el) => [el, el.style.display]);
      for (const el of chrome) el.style.display = 'none';
      promptEl.textContent = '';
      tracePad.hide();
    } else {
      for (const [el, display] of this.chromeBefore) el.style.display = display;
      this.chromeBefore = [];
    }
    this.aimRoot.setEnabled(!designing);
  }

  /**
   * Take the aiming furniture off the screen for a screenshot.
   *
   * Poses are captured at address, so without this the aim ring, the aim dots
   * and the distance readout are baked into every marketing image — including
   * the one used as the landing's background.
   */
  hideAimForCapture(): void {
    this.aimRoot.setEnabled(false);
    this.trueVisionRoot.setEnabled(false);
    aimReadoutEl.style.display = 'none';
    promptEl.textContent = '';
  }

  /**
   * Resume this hole with the ball already in play.
   *
   * The stroke count is set BEFORE the drop so the HUD and the max-strokes rule
   * both see the true number; `dropAt` then does everything else it normally
   * does — surface lookup, club selection, camera, aim — because a resumed ball
   * is an ordinary ball that happens not to have been hit in this session.
   */
  resumeAt(x: number, y: number, strokes: number): void {
    this.state.strokes = strokes;
    this.dropAt(x, y);
    showMsg(`Back where you left it — ${strokes} played`, 2200);
  }

  /** The course's population-queue completion — everything planted. Used by
   *  the capture harness and available to specs via __slice3d. */
  natureReady(): Promise<void> {
    return this.course3d.natureReady;
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
    this.resetBallSpin();
  }

  private fwd3(yaw: number): Vector3 {
    return new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  // ------------------------------------------------------------- cameras

  /** AERIAL READABILITY: EXP2 haze at overhead altitude can wash out the
   *  planning view on large or deliberately hazy holes (the Scottish-turn
   *  links). Thin the fog while the overhead is up; every ground-level
   *  camera gets the course's own atmosphere back. Constitution: atmosphere
   *  may never obstruct aim readability. */
  private applyAerialFog(on: boolean): void {
    if (this.baseFogDensity === null) this.baseFogDensity = this.scene.fogDensity;
    this.scene.fogDensity = on ? this.baseFogDensity * 0.3 : this.baseFogDensity;
  }

  private setCamSetup(): void {
    this.applyAerialFog(this.aerial);
    // NOTE: the OB border is NOT rebuilt here. setCamSetup runs on every
    // pointermove during an aim drag, and the border is static per hole — it's
    // built once when the aerial view opens (toggleAerial / the 'aerial' camera
    // preset) and disposed when it closes. Marching the world grid per drag
    // frame was the "aerial refreshes everything and it's laggy" the owner hit.
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
      let height = putt ? Math.max(90, span * 1.6 + greenR * 0.9) : Math.max(300, span * 1.25);
      // BOUNDED WORLD: never zoom the aerial so far out that it frames empty
      // off-course void. Cap the eye height to the playable world's extent so
      // the corridor fills the frame and only a thin fog-masked void ring shows.
      if (this.hole.boundary && !putt) {
        const [bx0, by0, bx1, by1] = boundaryBBox(this.hole.boundary);
        const extent = Math.max(bx1 - bx0, by1 - by0);
        height = Math.min(height, extent * 0.9);
      }
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
      // THE SWEEP IS A CAMERA MOVE AND NOTHING ELSE. The golfer is standing at
      // address and the ball is on the tee, so no shadow caster moves for the
      // whole travel — and a directional light's shadow map does not depend on
      // the camera. Freezing it here removes a 1024² depth pass every other
      // frame from the single most crowded window in a hole (the scatter drain
      // is still planting under it and the glTF models are still resolving).
      // `invalidateShadows` covers the case where planting had NOT finished:
      // the drain forces a fresh capture when it does.
      renderPacing.cinematic = true;
      this.course3d.invalidateShadows();
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
    // Also wait for the ground shader to be renderable so the sweep never
    // travels over the blue sky clearColor (the veil-less per-hole path relies
    // on this). Same cap so a stalled compile can never hang the intro.
    const groundReadyOrTimeout = Promise.race([
      this.course3d.groundReady,
      new Promise<void>((resolve) => {
        this.introTimers.push(setTimeout(resolve, MAX_NATURE_WAIT_MS));
      })
    ]);
    void this.course3d.natureReady.then(() => {
      markPerf(round.course.name, this.hole.number, 'nature-ready');
      this.natureSettled = true; // soak/perf specs poll this for true steady state
    });
    void Promise.all([teeHoldDone, natureReadyOrTimeout, groundReadyOrTimeout]).then(() => {
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
      this.syncObBorder();
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
      // Hold character idle animation still for pixel-stable captures.
      void this.bodiesReady.then(() => {
        this.scene.animationGroups.forEach((g) => {
          // SEEK, then pause. Pausing alone stops each group wherever it
          // happened to have reached, which depends on how long the body took
          // to load — so two supposedly frozen captures held the golfer in
          // different poses, and the club head alone accounted for half a
          // percent of the frame in the batching gate. Seeking first makes
          // "frozen" mean one specific pose rather than an arbitrary one.
          // (`goToFrame` is a documented no-op on a group that never started,
          // which is already a deterministic bind pose.)
          g.goToFrame(g.from);
          g.pause();
        });
      });
    }
  }

  /** OUT-OF-BOUNDS MARKERS for the aerial planning view (owner WANTS these — the
   *  "red circle aiming system" they wanted gone was the aim dots/ring + True
   *  Vision reveal, now hidden up here, NOT this). A single clean red line traces
   *  genuine OB only: the playable-world boundary plus any authored `ob` regions
   *  (Red Hollow's canyon floors). Present only while the aerial view is up;
   *  rebuilt each entry so it tracks the hole's ground. */
  private syncObBorder(): void {
    for (const m of this.obBorder) m.dispose();
    this.obBorder = [];
    if (!this.aerial) return;
    const RED = new Color3(0.92, 0.14, 0.11);
    const segs = (this.obSegsCache ??= this.computeObSegs());
    if (!segs.length) return;
    const sys = MeshBuilder.CreateLineSystem('obLine', { lines: segs }, this.scene);
    sys.color = RED;
    sys.isPickable = false;
    sys.applyFog = false;
    this.obBorder.push(sys);
  }

  /** March the world grid ONCE per hole to trace the true out-of-bounds line
   *  (the outer perimeter of the playable-region union) plus any authored `ob`
   *  regions. Result is cached in `obSegsCache` — the geometry is static per
   *  hole, so repeated aerial toggles reuse it instead of re-marching. */
  private computeObSegs(): Vector3[][] {
    const h = this.hole;
    const LIFT = 5;
    const segs: Vector3[][] = [];
    // THE OB LINE = the OUTER edge of the UNION of playable regions. Drawing
    // each region (green ellipse, tee circle, landing circles, inflated
    // hazards) as its own outline drew a red RING around every feature — the
    // "red circles" the owner kept flagging. Instead march a grid and emit a
    // segment only where an in-play cell borders an OFF-COURSE cell, so only the
    // single perimeter (the true in/out-of-bounds line) is stroked — no interior
    // rings around the green, tee, fairway or bunkers.
    if (h.boundary && h.boundary.length) {
      const step = 12;
      const w = h.world.width;
      const hgt = h.world.height;
      const inb = (x: number, y: number): boolean => pointInBoundary(x, y, h.boundary!);
      for (let x = 0; x <= w; x += step) {
        for (let y = 0; y <= hgt; y += step) {
          const here = inb(x, y);
          if (here !== inb(x + step, y)) {
            const ex = x + step / 2;
            segs.push([w2b(ex, y - step / 2, this.gh(ex, y) + LIFT), w2b(ex, y + step / 2, this.gh(ex, y) + LIFT)]);
          }
          if (here !== inb(x, y + step)) {
            const ey = y + step / 2;
            segs.push([w2b(x - step / 2, ey, this.gh(x, ey) + LIFT), w2b(x + step / 2, ey, this.gh(x, ey) + LIFT)]);
          }
        }
      }
    }
    // Authored true-OB regions (Red Hollow's canyon floors) keep an explicit
    // outline — those ARE discrete out-of-bounds zones, not the fairway corridor.
    for (const hz of h.hazards) {
      if (hz.type !== 'ob' || hz.polygon.length < 3) continue;
      for (let i = 0; i < hz.polygon.length; i++) {
        const [ax, ay] = hz.polygon[i];
        const [bx, by] = hz.polygon[(i + 1) % hz.polygon.length];
        segs.push([w2b(ax, ay, this.gh(ax, ay) + LIFT), w2b(bx, by, this.gh(bx, by) + LIFT)]);
      }
    }
    return segs;
  }

  /** BOUNDED WORLD debug overlay (capture `?boundary=1`, or __slice3d.showBoundary()).
   *  Draws the core playing surfaces (fairways + green) and the playable-world
   *  boundary as floating line loops so a single aerial screenshot shows the
   *  20-yd corridor, the expanded boundary, and the off-course void. Never shown
   *  in normal play. Re-callable — the previous overlay is disposed first. */
  showBoundary(): void {
    for (const m of this.boundaryOverlay) m.dispose();
    this.boundaryOverlay = [];
    const h = this.hole;
    const loop = (poly: number[][], color: Color3, lift: number): void => {
      if (poly.length < 2) return;
      const pts = poly.map(([x, y]) => w2b(x, y, this.gh(x, y) + lift));
      pts.push(pts[0].clone());
      const lines = MeshBuilder.CreateLines(`boundaryDbg${this.boundaryOverlay.length}`, { points: pts }, this.scene);
      lines.color = color;
      lines.isPickable = false;
      lines.applyFog = false;
      this.boundaryOverlay.push(lines);
    };
    // Core playing surfaces (green): the corridor these expand from.
    for (const fw of h.fairway) loop(fw, new Color3(0.35, 0.95, 0.4), 3);
    const g = h.green;
    const greenRing: number[][] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rot = g.rot ?? 0;
      const lx = Math.cos(a) * g.rx;
      const ly = Math.sin(a) * g.ry;
      greenRing.push([g.cx + lx * Math.cos(rot) - ly * Math.sin(rot), g.cy + lx * Math.sin(rot) + ly * Math.cos(rot)]);
    }
    loop(greenRing, new Color3(0.4, 1, 0.5), 3);
    // The playable-world boundary (the ~20-yd envelope); void lies beyond it.
    for (const region of h.boundary ?? []) loop(region, new Color3(1, 0.85, 0.15), 6);
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
    // The flyover is over the moment the golfer has the club: from here the
    // golfer walks, poses and swings, so the shadow map goes back to its live
    // cadence.
    renderPacing.cinematic = false;
    // The ball has come to rest and the next turn is starting: close the shot's
    // segment so the clip button has a complete recording of it. A no-op when
    // no shot is open (the first turn of a hole, a resumed round).
    shotCapture.endShotClip();
    // Warm the strike's shaders again now that the turn — and everything it
    // brought into the scene — is settled. The intro pass can miss (the player
    // may skip it, and casters arrive asynchronously); this one has the whole
    // aim to finish in, and costs a readiness check per turn when there is
    // nothing left to compile. See `warmStrikeShaders`.
    this.warmStrikeShaders();
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
    // Playoff: advance the tied rivals' parked balls to the sync rule's spot
    // BEFORE this turn is played — "see where it lands before we hit".
    this.syncPlayoffBalls();
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
    // Tournament and tour rounds keep the live leaderboard one tap away (🏆).
    tourBoardBtn.style.display = aiTour || tourRoundLive || tourPlayoff ? 'block' : 'none';
    this.refreshTrueVisionBtn();
    this.updateStrikeUI();
    this.refreshClubBar();
    // Tutorial coaching, keyed to what this turn is: the green read + True Vision
    // when putting, the opening aim/swing/shape lessons off the first tee, else
    // the aerial-view tip on an approach. Each concept shows exactly once.
    if (tutorialCoach.isActive()) {
      tutorialCoach.onAiming({
        isPutting: this.aim.isPutting,
        firstTee: this.state.strokes === 0 && !this.aim.isPutting,
        lie: this.state.lie
      });
    }
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
        : 1.4; // full-shot play view: big enough that the dotted line reads
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
    // THE OVERHEAD AIM LINE (owner: "Aerial view aim line is non existent").
    //
    // Two different overlays used to be conflated here. "Get rid of all the red
    // circle aiming system in the aerial view" was about the RED True Vision
    // reveal — but the switch that answered it hid this WHITE aim guide too, so
    // the one view built for planning a shot stopped showing where the shot was
    // aimed. The red line stays out of the aerial (see updateTrueVision); the
    // white guide belongs here more than anywhere, because from overhead it is
    // the only thing that tells you what the drag is doing.
    //
    // It draws restrained up here on purpose — the dots are already sized for
    // the high camera by aimDotScale, and the play view's near-to-far taper is
    // skipped below, since a top-down view has no perspective to compensate
    // for. The result reads as a line drawn on a map rather than a targeting
    // reticle sitting on the world.
    this.aimRing.setEnabled(true);
    const curved = !this.aim.isPutting && landIdx > 4;
    this.aimDots.forEach((dot, i) => {
      dot.setEnabled(true);
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
      // Full-shot play view: grow the dots along the line so the FAR half (which
      // perspective otherwise shrinks to specks near the target) still reads. No
      // taper on putts (short line) or in the flat aerial view.
      const taper = !this.aim.isPutting && !this.aerial ? 1 + 0.8 * f : 1;
      dot.scaling.setAll(dotScale * taper);
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
      // EFFECTIVE ball→cup rise the ROLL actually fights, expressed as a height
      // the player reads by the 6:1 rule (owner: "uphill by 6 inches, you aim 3
      // feet long; 12 inches = 6 feet"). Production greens are FLAT plateaus in
      // the heightfield — their break lives in the authored hole.slope, invisible
      // to a raw groundAt() delta — so the old height-delta read under-reported
      // every sloped green. slopeAccelAlong sums the SAME authored slope + any
      // heightfield contour the ball obeys; calibrating the shown rise to
      // extra_aim/6 makes "aim 6× the marker" hole out by construction.
      //   extra_aim_px ≈ dPx·aUp/EFFECTIVE_MU ; shown_rise_ft = extra_aim·1.5/6.
      // EFFECTIVE_MU ≈ green friction + the integrator's v0 half-kick (measured).
      const yaw = Math.atan2(this.hole.pin.y - by, this.hole.pin.x - bx);
      const dPx = Math.hypot(this.hole.pin.x - bx, this.hole.pin.y - by);
      const aUp = -this.engine2d.slopeAccelAlong({ x: bx, y: by }, yaw, dPx); // +uphill / −downhill
      // TRUE rise the roll fights, in feet. slopeAccelAlong is the along-line
      // slope acceleration; dividing by slopeGradAccel (the accel-per-unit-
      // heightfield-gradient) recovers the gradient, ×dPx = the rise in world
      // units, ×1.5 = feet. On a uniform slope this equals the real terrain rise
      // (groundAt delta); on a flat-plateau authored-slope green it is the
      // pace-equivalent rise. The player then applies the owner's rule — aim
      // +6 ft of pace per 1 ft of shown rise (2 in = 1 ft) — and the calibrated
      // putt climb-cost (PHYSICS.puttSlopePaceBoost) makes that hole out.
      elevFt = (aUp * dPx * 1.5) / PHYSICS.slopeGradAccel;
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
      obPenalty: false,
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
    // A CONCEDED PUTT IS STILL A PUTT.
    //
    // The tally lives in `afterShot`, which a gimme never reaches — it
    // short-circuits the shot path entirely. So every conceded tap-in went
    // uncounted, and the putts-per-round figure on the card, in career stats and
    // in the records was quietly low for every player. The headless simulator
    // has always counted it (RoundSimulator.simulateHole), so this also puts the
    // live game and the model back in agreement.
    if (!this.ai) {
      shotAcc.holePutts[this.hole.number] = (shotAcc.holePutts[this.hole.number] ?? 0) + 1;
      shotAcc.puttsMade++;
    }
    this.updateHud();
    if (this.tm.isScramble) this.afterScrambleShot(outcome);
    else this.afterShot(outcome);
    return true;
  }

  private toggleAerial(): void {
    if (this.state.phase !== 'aiming' || this.ai) return;
    this.aerial = !this.aerial;
    aerialBtn.classList.toggle('on', this.aerial);
    // The overhead view is a STATIC vantage: freeze the mirror + shadow map so
    // the greens don't shimmer under the every-other-frame shadow regen (owner:
    // the aerial should "just be a picture from above", not refresh/dance).
    renderPacing.overhead = this.aerial;
    // No red aiming overlays in the overhead planning view (owner) — pull any
    // live True Vision reveal off the map on the way up.
    if (this.aerial) this.trueVisionRoot.setEnabled(false);
    this.syncObBorder(); // build (aerial on) / dispose (aerial off) the OB line once
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
    // Leave the last visible red dot off so the golden endpoint puck owns the
    // resting spot without a red dot doubled underneath it.
    const lastVisible = this.trueVisionDots.length - 2;
    this.trueVisionDots.forEach((dot, i) => {
      if (i % 2 === 1 || i === lastVisible) {
        dot.scaling.setAll(0); // the "dash" gaps + the slot the gold puck takes
        return;
      }
      const p = pts[i] ?? pts[pts.length - 1];
      dot.position = w2b(p.x, p.y, 0.12 + this.gh(p.x, p.y));
      dot.scaling.setAll(scale);
    });
    // Golden puck at the ACTUAL final resting point (raw path end, not a
    // resampled dot) — where the ball stops for the current aim + pace.
    const end = path[path.length - 1] ?? pts[pts.length - 1];
    this.trueVisionEnd.position = w2b(end.x, end.y, 0.18 + this.gh(end.x, end.y));
    this.trueVisionEnd.scaling.setAll(scale * 2.6);
    // The red reveal line is a play-camera aid, never drawn in the clean
    // overhead planning view (owner: no red aiming overlay in aerial).
    this.trueVisionRoot.setEnabled(!this.aerial);
  }

  /** The last reveal's promise (see revealTrueVision). Cleared whenever the
   *  reveal leaves the screen — executeShot snapshots it FIRST, since it also
   *  hides the dots at strike time. */
  private tvReveal: { yaw: number; clubId: string; outcome: ShotOutcome } | null = null;

  private hideTrueVision(): void {
    this.tvReveal = null;
    this.trueVisionRoot.setEnabled(false);
    this.setGolferGhost(false);
  }

  /** While the True Vision line is up, the golfer fades translucent (same idea
   *  as the tree-occlusion ghosts) — he often stands square between the low
   *  putt camera and the cup, hiding the very line the charge paid for. */
  private golferGhosted = false;
  private setGolferGhost(on: boolean): void {
    if (this.golferGhosted === on) return;
    this.golferGhosted = on;
    // 0.12 (was 0.28): playtest — the golfer still hid the revealed line at a
    // quarter visibility; at ~an eighth he reads as a faint hologram and the
    // red dots/cup stay fully legible through him.
    for (const m of this.golfer.root.getChildMeshes(false)) m.visibility = on ? 0.12 : 1;
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
    const tvOutcome = computeTrueVisionOutcome(this.engine2d, this.hole, ctx, {
      aimAngle: this.aim.yaw,
      power: this.aim.barToPhysicsPower(this.aim.barPowerTarget(ctx), ctx),
      club: this.aim.club,
      wind: this.wind,
      spin: this.strike.shapeSpin,
      launchMult: this.strike.launchMult
    });
    const path = tvOutcome.path;
    // Keep the reveal as a PROMISE: if the golden dot shows the cup and the
    // player answers with a perfect-perfect stroke on this exact read (same
    // aim + club), executeShot plays this outcome verbatim — a flushed putt
    // on a revealed make can never lip out on band-width power noise.
    this.tvReveal = { yaw: this.aim.yaw, clubId: this.aim.club.id, outcome: tvOutcome };
    const end = path[path.length - 1] ?? ctx.ball;
    const span = Math.hypot(end.x - ctx.ball.x, end.y - ctx.ball.y);
    this.showTrueVisionPath(path, this.aimDotScale(span));
    this.setGolferGhost(true);
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

  /** Scratch AI used only by `playSkilledShot` (the e2e recording gate). Never
   *  created during normal play. */
  private probeAi: AIController | null = null;

  /**
   * Test hook: play ONE competent shot through the human path.
   *
   * The recording gate needs a round that actually holes out. Hitting the same
   * fixed swing every stroke does not: it caps out at `RULES.maxStrokes` on
   * every hole, and a capped hole scores 8 no matter WHERE the cup is — which
   * silently excused the replay from reproducing the pin at all. Borrowing the
   * AI's shot selection (club, aim, spin) and playing it through `executeShot`
   * exactly as `aiTurn` does gives a round that reaches the green and putts,
   * so the gate exercises holing out, gimmes and pin placement too.
   *
   * The AI's own rng is fixed, and it never touches `this.shotRng` — the shot
   * stream stays exactly as reproducible as a human's.
   */
  playSkilledShot(): boolean {
    if (this.state.phase !== 'aiming' || this.ai) return false;
    this.probeAi ??= new AIController(
      this.curPart().golfer,
      this.fires[this.turnIdx],
      this.engine2d,
      () => 0.5
    );
    const decision = this.probeAi.decide(this.state.ballPos, this.state.lie, this.wind, this.hole);
    this.aim.setClubById(decision.club.id);
    this.aim.yaw = decision.aimAngle;
    this.aim.distPx = dist(this.state.ballPos, decision.aimPoint);
    this.executeShot(decision.swing, true);
    return true;
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
      // Course and hole, in the HUD rather than in a separate badge fighting
      // the round controls for the top-right corner.
      `<div class="hudWhere">${escapeHtml(round.course.name)} · ${escapeHtml(this.hole.name ?? `Hole ${this.hole.number}`)} · par ${this.hole.par}</div>` +
      `<div class="row"><span class="chip club">${club.name}</span><span class="chip">${distLabel}</span>` +
      `<span class="chip wind"><span class="arrow" style="transform:rotate(${rel}rad)">➤</span> ${this.wind.speed}</span></div>` +
      `<div class="row"><span class="chip pin">⛳ ${pinLabel}</span><span class="chip">${this.state.lie}</span>` +
      `<span class="chip">Shot ${this.state.strokes + 1}</span><span class="chip score">${scoreToPar(this.curPart())}</span></div>` +
      (round.mode !== 'solo'
        ? `<div class="row"><span class="chip player">${this.curPart().golfer.name}${this.curPart().isAI ? ' (to play)' : ' (you)'}</span></div>`
        : '') +
      (activeGhost ? this.ghostHudRow() : '') +
      (tourPlayoff ? this.playoffHudRow() : '');
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
    // The trace pad is NOT hidden here: the path you just drew stays on it
    // through the flight and the next address, which is the whole point of
    // drawing it. The next `armMeter` resets it for the coming swing.
    // Snapshot the True Vision promise BEFORE hideTrueVision() clears it.
    const tvReveal = this.tvReveal;
    this.state.phase = 'swinging';
    // Tutorial: the ball is about to fly — teach in-flight spin (putts don't spin).
    if (tutorialCoach.isActive() && !this.aim.isPutting) tutorialCoach.onShot();
    // Meter's done and the flight camera is about to take over: let the scatter
    // finish filling AND release the mirror/shadow freeze so they animate live
    // through the flight.
    renderPacing.meterActive = false;
    renderPacing.cameraParked = false;
    // Belt and braces: a shot cannot be struck during the flyover, but the ball
    // and the golfer are both shadow casters and both are about to move, so
    // nothing may leave the map frozen here.
    renderPacing.cinematic = false;
    // NOTE: the capture segment stays OPEN across the flight — it is closed at
    // rest by beginTurn. Releasing it here (as this used to) let the idle
    // cadence rotate mid-flight and cut the clip in half at the one moment
    // there is something worth watching.
    // The address-time fire vignette ends the moment the shot launches.
    document.documentElement.classList.remove('fire-vignette');
    this.pal?.setAiming(false); // stop the address dance once the swing starts
    this.aimRoot.setEnabled(false);
    this.hideTrueVision(); // "stays up until the shot is struck" ends here
    this.aerial = false;
    renderPacing.overhead = false; // leaving the overhead view restores live RTT cadence
    this.applyAerialFog(false); // flight cameras get the course's real haze
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
    const shotParams = {
      origin: this.state.ballPos,
      aimAngle: this.aim.yaw,
      swing: converted,
      club,
      golfer: this.curPart().golfer,
      lie: this.state.lie,
      wind: this.wind,
      hole: this.hole,
      spin: shape,
      launchMult,
      riskMult: shaping && !this.ai ? this.strike.riskMult : 1,
      // Pre-shot stroke count (0 = tee shot) → recovery shots get a more
      // forgiving tree hitbox.
      stroke: this.state.strokes
    };
    // Re-seed the physics randomness for THIS shot BEFORE anything consumes it.
    // resolveLaunch is the first consumer and a heavy one — carry noise, lie
    // noise and residual dispersion are all gaussian draws — so seeding after
    // it (as this first did) left the resolve running on leftover stream state
    // and made the shot unreproducible. Derived from the round seed, hole and
    // stroke number: the same three things the replay knows.
    this.shotRng = mulberry32(shotRngSeed(round.seed ?? 0, round.holeIdx, this.state.strokes));
    const launch = this.engine2d.resolveLaunch(shotParams);
    let outcome = this.engine2d.integrateLaunch(launch, spin, 0);
    // True Vision's promise (playtest: "if my yellow dot is in the hole and I
    // hit perfect perfect, I shouldn't miss"): a PERFECT-PERFECT stroke on the
    // exact revealed read (same aim + club, reveal showed the ball dropping)
    // plays the previewed outcome verbatim. Execution is still fully earned —
    // any aim change or non-perfect input takes the normal physics path, and a
    // revealed MISS is never upgraded.
    if (
      tvReveal &&
      !this.ai &&
      tvReveal.outcome.holed &&
      tvReveal.yaw === this.aim.yaw &&
      tvReveal.clubId === club.id &&
      converted.powerQuality === 'perfect' &&
      converted.accuracyQuality === 'perfect'
    ) {
      outcome = tvReveal.outcome;
    }
    this.strike.resetDot();
    // Record the HUMAN's inputs for this stroke (`roundRecording`). Everything
    // else about the shot — where the ball was, the lie, the wind, the stroke
    // count — is a consequence of the seed and the shots before it, so it is
    // deliberately NOT stored. Pure array push; nothing here touches storage or
    // the network, so it is safe on the shot path.
    if (!this.ai) {
      roundRecorder.add({
        h: round.holeIdx,
        a: this.aim.yaw,
        c: club.id,
        p: converted.power,
        pq: converted.powerQuality,
        // An INPUT to the physics (putt pace noise scales off it), so the
        // replay must have it or it re-simulates a different round.
        pm: converted.powerMiss,
        ac: converted.accuracy,
        aq: converted.accuracyQuality,
        ss: shape.side,
        st: shape.top,
        lm: launchMult,
        rm: shaping && !this.ai ? this.strike.riskMult : 1
      });
    }
    // Feed the streak AFTER the shot resolves with the pre-shot boost
    if (fire.recordSwing(converted)) {
      if (!this.ai && flag('delight')) {
        showCineBanner('ON FIRE', `${this.curPart().golfer.name} is heating up`, 'fire', 1800);
      } else {
        showMsg(`🔥 ${this.curPart().golfer.name} is ON FIRE!`, 1600);
      }
      play('fire');
    }
    this.state.strokes += 1 + (outcome.waterPenalty ? 1 : 0) + (outcome.obPenalty ? 1 : 0);
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
      const onFire = club.id !== 'putter' && this.fires[this.turnIdx].isOnFire;
      // On-fire shots streak bolder and longer for extra drama (Phase 6 juice);
      // the flag off keeps the original trail dimensions while retaining the
      // existing on-fire trail COLOUR below.
      const bold = onFire && flag('juice');
      const trail =
        club.id === 'putter'
          ? null
          : new TrailMesh('trail', this.ball, this.scene, bold ? 0.17 : 0.12, bold ? 60 : 46, true);
      if (trail) {
        const tmat = new StandardMaterial('trailMat', this.scene);
        // On-fire shots streak orange; otherwise the human's equipped trail
        // tint (AI keeps plain white). Phase 6 fire + Phase 7 store.
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
      this.launchGhostShot();
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
        spin,
        startedAt: performance.now()
      };
      this.state.phase = 'flying';
      if (club.id !== 'putter') {
        this.shakeT = 0.18;
        // Impact recoil: kick the camera back along its own view line, harder
        // for a driver than a wedge. Reduced Motion keeps the still frame.
        if (flag('juice') && !profile.settings.reducedMotion) {
          this.camPunchDir.copyFrom(this.camera.position).subtractInPlace(this.camera.getTarget());
          const len = this.camPunchDir.length();
          if (len > 1e-3) this.camPunchDir.scaleInPlace(1 / len);
          this.camPunchT = 0.16;
        }
        // Perfect strike (perfect power AND accuracy on a human full swing):
        // a small sparkle at the ball + one short haptic tick — the moment of
        // contact finally tells the player they flushed it (Phase 6 juice).
        if (
          flag('juice') &&
          !this.ai &&
          converted.powerQuality === 'perfect' &&
          converted.accuracyQuality === 'perfect'
        ) {
          this.perfectSparkle();
          this.hapticTick(20);
        }
      }
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
      // Surprise & delight: a golden burst + cinematic banner for the special
      // skill moments (ace/eagle/long putt/chip-in). When one is coming, the
      // base score toast is SKIPPED — one celebration, not a toast pile-up.
      this.lastHoleOutTier = null;
      const celebrated = !c.isAI && this.celebrateHoleOut(origin, preLie, club, outcome);
      if (!celebrated) {
        if (!c.isAI && flag('delight') && this.state.strokes <= this.hole.par - 1) {
          // Ordinary birdies earn the smaller cinematic treatment.
          showCineBanner(scoreName(this.state.strokes, this.hole.par).toUpperCase(), this.holeSubLabel(), 'great', 2200);
        } else {
          showMsg(`${this.curPart().golfer.name}: ${scoreName(this.state.strokes, this.hole.par)}`, 2200);
        }
      }
      if (this.state.strokes < this.hole.par) setTimeout(() => play('chime'), 450);
      // Per-hole reaction reflects the SCORE: happy at par or better, sad
      // over par (FB7). Eagles+ get the big Song Jump.
      this.golfer.react(this.holeReaction(this.state.strokes));
      // A soft puff at the cup on every made putt — the little "it dropped!"
      // beat ordinary holes were missing (Phase 6). celebrateHoleOut's golden
      // shower overrides it in the same tick for the special moments.
      if (!c.isAI && club.id === 'putter' && flag('juice')) this.cupBurst();
      if (!c.isAI && flag('juice')) this.hapticTick(30);
      // Celebration camera (Phase 2 Pass C): ease into a slow push-in toward
      // the celebrating golfer for the reaction window. Reuses the normal
      // camTarget lerp with a gentle gain — no new camera, and this window
      // never accepts input. Reduced motion keeps the current framing.
      if (!c.isAI && flag('delight') && !profile.settings.reducedMotion) {
        const g = this.golfer.root.getAbsolutePosition();
        // Dolly in along the current ground-plane view line toward the golfer,
        // settling at a three-quarter close-up that keeps the flag in frame.
        const back = this.camera.position.subtract(g);
        back.y = 0;
        const len = back.length();
        if (len > 1e-3) back.scaleInPlace(1 / len);
        this.camTarget.pos = g.add(back.scale(11)).add(new Vector3(0, 4.6, 0));
        this.camTarget.look = g.add(new Vector3(0, 2.1, 0));
        this.camTarget.k = 1.1;
      }
      // (celebrateHoleOut already ran above — a second call here double-fired
      // the whole show, which washed the fireworks into one muddled flash.)
    } else if (outcome.waterPenalty) {
      play('splash');
      showMsg('SPLASH! +1 penalty', 1400);
      this.golfer.react('deject');
      if (!c.isAI && tutorialCoach.isActive()) tutorialCoach.onPenalty('water');
    } else if (outcome.obPenalty) {
      showMsg('OUT OF BOUNDS! +1 penalty', 1500);
      this.golfer.react('deject');
      if (!c.isAI && tutorialCoach.isActive()) tutorialCoach.onPenalty('ob');
    } else if (outcome.hitRock) {
      // Stone knock: the existing 'hit' buffer, rate-shifted brighter than a
      // turf thump so the carom reads as rock, not ground.
      if (flag('audio')) {
        const vol = Math.max(0, Math.min(1, 0.8 * profile.settings.sound));
        if (vol > 0) playBuffer('hit', vol, { rate: 1.5, lowpassHz: 2600 });
      }
      showMsg('Off the rocks!', 1200);
      if (!c.isAI) this.showShotReadout(origin, outcome, club);
    } else if (!c.isAI) {
      this.showShotReadout(origin, outcome, club);
    }
    // Practice has no stroke cap — the whole point is to keep hitting. Elsewhere
    // the cap is what stops a bad hole becoming an endless one.
    if (!practiceMode && this.state.strokes >= RULES.maxStrokes && !c.holed) {
      showMsg(`Pick up — max ${RULES.maxStrokes}`, 1600);
      this.golfer.react('deject');
    }
    if (practiceMode) {
      practiceShots += 1;
      // RANGE DRILL: every swing is its own rep — the ball never plays out
      // from where it finished; the next station is already being dealt.
      if (practiceDrill && !c.holed) {
        showMsg('Next ball', 800);
        setTimeout(() => {
          if (!this.disposed) nextDrillRep();
        }, 900);
        return;
      }
      // A practice ball that has wandered a long way from the hole has stopped
      // teaching anything; re-tee rather than making the player walk it back.
      if (this.state.strokes >= PRACTICE_MAX_SHOTS && !c.holed) {
        showMsg('New ball', 900);
        setTimeout(() => {
          if (!this.disposed) this.resetToTee();
        }, 700);
        return;
      }
    }

    // Hole over when every competitor has holed / picked up; otherwise the
    // away player plays next (which alternates naturally in a 1v1). A special
    // hole-out HOLDS here (owner: "it goes to the next hole too fast — pan to
    // the fireworks and hold ~5 seconds"): the epic show gets its whole sky.
    const allDone = this.comps.every((cc) => this.compDone(cc));
    const delay = outcome.holed
      ? this.lastHoleOutTier === 'epic'
        ? 5600
        : this.lastHoleOutTier === 'great'
          ? 3200
          : 2400
      : 700;
    this.state.phase = allDone ? 'done' : this.state.phase;
    setTimeout(() => {
      if (this.disposed) return;
      if (allDone) this.finishHole();
      else this.beginTurn();
    }, delay);
  }

  /** Golden celebration burst + line for special holed shots (Part 10):
   *  hole-in-one, eagle+, a long chip-in, or a genuinely long putt. Reuses
   *  the existing landing-puff particle system (recolored, a few extra
   *  emits) and the message line — no new assets, no blocking UI. */
  private celebrateHoleOut(
    origin: { x: number; y: number },
    preLie: HoleState['lie'],
    club: ClubSpec,
    outcome: ShotOutcome
  ): boolean {
    const toPar = this.state.strokes - this.hole.par;
    const puttFt = club.id === 'putter' ? (dist(origin, this.hole.pin) / PX_PER_YARD) * 3 : 0;
    const chipInYd = club.id !== 'putter' && preLie !== 'green' ? dist(origin, outcome.finalPos) / PX_PER_YARD : 0;
    // Cinematic moment (delight on) or the classic line (flag off) — decided
    // together so the caller can skip the base score toast when a bigger
    // celebration is coming.
    let cine: { title: string; sub: string; tier: 'epic' | 'great' } | null = null;
    let line = '';
    if (this.state.strokes === 1) {
      cine = { title: 'HOLE-IN-ONE', sub: this.holeSubLabel(), tier: 'epic' };
      line = '⛳ HOLE-IN-ONE!!';
    } else if (toPar <= -2) {
      cine = { title: scoreName(this.state.strokes, this.hole.par).toUpperCase(), sub: this.holeSubLabel(), tier: 'epic' };
      line = '🦅 EAGLE!';
    } else if (puttFt >= 25) {
      cine = { title: 'WHAT A PUTT', sub: `${Math.round(puttFt)}-footer drops`, tier: 'great' };
      line = `🎯 ${Math.round(puttFt)}-footer — what a putt!`;
    } else if (chipInYd >= 15) {
      cine = { title: 'CHIP-IN', sub: `from ${Math.round(chipInYd)} yards`, tier: 'great' };
      line = `🪄 Chip-in from ${Math.round(chipInYd)} yards!`;
    }
    if (!cine) return false;
    this.lastHoleOutTier = cine.tier;
    // Fireworks above the GOLFER for every special hole-out (owner) — a bigger
    // show for the epic tier (hole-in-one / eagle) than a great one. Anchored to
    // the shot origin (where the golfer stands + the celebration camera looks),
    // not the distant cup, so a tee-shot ace still shows them.
    this.launchFireworks(cine.tier === 'epic', origin.x, origin.y);
    // THE PAN (owner): once the push-in has settled, tilt up and pull back so
    // the shells bursting 20–40u overhead own the frame — the hole-end delay
    // holds here for the whole show before the next hole loads.
    if (cine.tier === 'epic' && flag('delight') && !profile.settings.reducedMotion) {
      setTimeout(() => {
        if (this.disposed) return;
        const g = this.golfer.root.getAbsolutePosition();
        const back = this.camera.position.subtract(g);
        back.y = 0;
        const len = back.length();
        if (len > 1e-3) back.scaleInPlace(1 / len);
        this.camTarget.pos = g.add(back.scale(30)).add(new Vector3(0, 12, 0));
        this.camTarget.look = g.add(new Vector3(0, 24, 0));
        this.camTarget.k = 1.2;
      }, 1000);
    }
    // Golden burst at the cup — three staggered emits read as a shower.
    const pin = this.hole.pin;
    (this.puff.emitter as Vector3).copyFrom(w2b(pin.x, pin.y, 1 + this.gh(pin.x, pin.y)));
    this.puff.color1 = new Color4(1, 0.85, 0.3, 0.95);
    this.puff.color2 = new Color4(1, 0.6, 0.1, 0.6);
    this.puff.manualEmitCount = 26;
    for (const delayMs of [220, 440]) {
      setTimeout(() => {
        if (this.disposed) return;
        this.puff.manualEmitCount = 18;
      }, delayMs);
    }
    const chosen = cine;
    setTimeout(() => {
      if (this.disposed) return;
      // The celebration camera is mid-push toward the golfer by now — the
      // banner letterboxes the top while the character celebrates below it.
      if (flag('delight')) showCineBanner(chosen.title, chosen.sub, chosen.tier, 2400);
      else showMsg(line, 2400);
      this.shakeT = Math.max(this.shakeT, profile.settings.reducedMotion ? 0 : 0.22);
    }, 500);
    return true;
  }

  /** "Hole 2 · Devil's Kitchen" — the banner's context line. */
  private holeSubLabel(): string {
    return `Hole ${this.hole.number}${this.hole.name ? ` · ${this.hole.name}` : ''}`;
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
    // Driving the green: the tee shot itself finished on the putting surface.
    // `holed` counts too — an albatross off a par 4 tee is emphatically driving
    // it. The fringe does not: the feat says green.
    if (teeShot && this.hole.par === 4 && (outcome.surface === 'green' || outcome.holed)) {
      facts.droveGreen = true;
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
    // CHECKPOINT AT REST, not just at the hole boundary. This is the only
    // moment the round is genuinely between decisions, and it is where a
    // player who puts the phone down actually stops. Storage write, so it runs
    // here — after the ball has settled — and never on the tap path.
    checkpointRound();
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
    // PRACTICE (`practiceRange`): no card, no round, no end. Holing out just
    // re-tees — the point of a practice ground is that nothing is at stake and
    // the next ball is always right there. A drill deals its next station
    // instead of re-teeing this one.
    if (practiceMode) {
      practiceShots = 0;
      showMsg(practiceDrill ? 'In! Next ball' : 'Nice — another ball', 1100);
      setTimeout(() => {
        if (this.disposed) return;
        if (practiceDrill) nextDrillRep();
        else this.resetToTee();
      }, 900);
      return;
    }
    this.state.phase = 'done';
    // Persist each competitor's fire streak so it survives the HoleScene
    // teardown/rebuild on the way to the next hole (only a missed band ends it).
    round.fireState = this.fires.map((f) => f.snapshot());
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
      // Same ordering rule as armMeter's: visible first, then armed.
      meterEl.style.display = 'block';
      if (!meter.isArmed) this.armMeter();
      // Defer the shot-capture recorder's segment swap only across the brief
      // mid-swing tap sequence (a couple seconds) — NOT the whole addressing/
      // aiming window before it. Pausing from armMeter() onward let rotation
      // stay deferred for however long a deliberate player spent aiming, so a
      // segment (and therefore a saved clip) could balloon to 30-40+ seconds
      // (bug report: "one clip was 43 seconds") and land the boundary right
      // at the swing instead of a fixed ~10s cadence. Closed at rest by
      // beginTurn, or dropped by the cancel paths below.
      if (!isFrozen()) shotCapture.beginShotClip();
      meter.handleTap();
    };
    swingBtn.addEventListener('pointerdown', this.onSwingTap);

    // DRAG SWING (`dragSwing`): the pull starts on the track down the right
    // edge — the one part of a phone screen with a full backswing's worth of
    // travel beneath the thumb.
    this.onTraceDown = (e: PointerEvent): void => {
      if (!traceInputOn() || this.ai || this.state.phase !== 'aiming') return;
      e.preventDefault();
      startAmbience();
      if (!meter.isArmed) this.armMeter();
      // Same as the tap path: the clip starts HERE, at the swing, and is held
      // together until the ball stops.
      if (!isFrozen()) shotCapture.beginShotClip();
      // The guide dot's clock starts on the PRESS, so tempo is measured from
      // the moment the player commits rather than from when the pad appeared.
      tracePad.begin(performance.now());
      const first: TraceSample = { ...tracePad.toPad(e.clientX, e.clientY), t: 0 };
      this.trace = { path: [first], state: readTrace([first], tracePad.targetDepth()) };
      tracePad.update(first, this.trace.state);
      promptEl.textContent = 'Follow the dot — down, then back up';
    };
    tracePadEl.addEventListener('pointerdown', this.onTraceDown);

    // Move/release live on the WINDOW: the pull naturally travels off the
    // track, and a release outside it must still strike (or cancel) rather than
    // leaving the player holding a club forever.
    this.onTraceMove = (e: PointerEvent): void => {
      const drag = this.trace;
      if (!drag) return;
      e.preventDefault();
      const now = performance.now();
      const sample: TraceSample = { ...tracePad.toPad(e.clientX, e.clientY), t: tracePad.elapsed(now) };
      drag.path.push(sample);
      drag.state = readTrace(drag.path, tracePad.targetDepth());
      tracePad.update(sample, drag.state);
      promptEl.textContent = drag.state.engaged ? 'Release to strike' : 'Follow the dot';
    };
    this.onTraceUp = (): void => {
      const drag = this.trace;
      this.trace = null;
      if (!drag) return;
      if (!drag.state.engaged || !this.swingCtx) {
        // Too small to be a swing — treat it as a cancel, not a duffed shot.
        promptEl.textContent = 'Drag to aim — trace the pad to swing';
        shotCapture.cancelShotClip();
        return;
      }
      // The finished trace stays on the pad until the next swing begins: a
      // control that says "miss" and nothing else is a slot machine.
      tracePad.finish(drag.state);
      this.executeShot(resolveTraceSwing(drag.state, this.swingCtx));
    };
    window.addEventListener('pointermove', this.onTraceMove);
    window.addEventListener('pointerup', this.onTraceUp);
    window.addEventListener('pointercancel', this.onTraceUp);

    this.onPointerDown = (e: PointerEvent): void => {
      // FLY MODE owns the canvas outright while it is up: the pointer is
      // steering a camera and placing assets, not aiming a shot.
      if (this.design?.handlePointer(e)) return;
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
      if (this.design?.handlePointer(e)) return;
      if (this.swipeLast) {
        this.applySwipeSpin(e);
        return;
      }
      if (!this.aim.isDragging || this.state.phase !== 'aiming' || meter.isActive) return;
      // Horizontal rotates the aim; vertical moves it nearer/farther.
      if (!this.aim.moveDrag(this.ctx(), { x: e.clientX, y: e.clientY })) return;
      // While the drag lasts, let the parked water mirror + shadow map track
      // the reframing camera at their normal live cadence instead of forcing a
      // full fresh capture per pointermove (see armMeter). NOT in the overhead
      // view — the aerial is a frozen "picture from above" (owner), so keep both
      // RTTs held rather than re-rendering the mirror + 1024² shadow map every
      // drag frame from a vantage where the reflection barely changes.
      if (!this.aerial) this.course3d.aimDragRTTs(true);
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
    this.onPointerUp = (e: PointerEvent): void => {
      if (this.design?.handlePointer(e)) return;
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
    canvas.addEventListener('pointercancel', this.onPointerUp);
    this.onDesignWheel = (e: WheelEvent): void => {
      if (!this.design) return;
      e.preventDefault();
      this.design.handleWheel(e.deltaY);
    };
    canvas.addEventListener('wheel', this.onDesignWheel, { passive: false });

    this.onPrevClub = () => this.cycleClub(-1);
    this.onNextClub = () => this.cycleClub(1);
    this.onAerial = () => this.toggleAerial();
    this.onTrueVision = () => this.revealTrueVision();
    this.onSkip = (e) => {
      e.preventDefault();
      this.skipIntro();
    };
    this.onFlightSkip = (e) => {
      e.preventDefault();
      this.fastForwardFlight();
    };
    document.getElementById('prevClub')!.addEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.addEventListener('pointerdown', this.onNextClub);
    aerialBtn.addEventListener('pointerdown', this.onAerial);
    trueVisionBtn.addEventListener('pointerdown', this.onTrueVision);
    skipBtn.addEventListener('pointerdown', this.onSkip);
    flightSkipBtn.addEventListener('pointerdown', this.onFlightSkip);
    // Roll the shot-capture buffer for the whole time this hole is on screen so
    // "save my last shot" always has the recent seconds ready — but ONLY when
    // the player has opted in (continuous MediaRecorder encode is real
    // per-frame work; see the capture button wiring).
    // The opt-in is honoured on EVERY device. This used to stand the recorder
    // down on hardware the governor had measured to its floor, which read as
    // "the game turned my clips off and won't let me turn them back on"
    // (owner). Advice belongs in Settings; the switch belongs to the player.
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
      shotCapture.cancelShotClip();
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
  /**
   * Send the ghost's corresponding shot into the air at the same moment the
   * player's leaves the club. Same hole, same shot number — so on a par 4 your
   * drive races their drive, not their putt. When the ghost has already holed
   * out there is simply nothing left to fly, which reads exactly as it should.
   */
  private launchGhostShot(): void {
    const ghost = activeGhost;
    if (!ghost || this.ai) return;
    const shot = ghost.shot(round.holeIdx, this.ghostShotIdx);
    this.ghostShotIdx += 1;
    if (!shot || !shot.path.length) return;
    if (!this.ghostBall) {
      const g = MeshBuilder.CreateSphere('ghostBall', { diameter: 1.0, segments: 10 }, this.scene);
      const gm = new StandardMaterial('ghostBallMat', this.scene);
      gm.diffuseColor = new Color3(0.55, 0.85, 1);
      gm.emissiveColor = new Color3(0.2, 0.42, 0.6);
      gm.specularColor = new Color3(0.2, 0.2, 0.2);
      // Translucent so it never hides the player's own ball or the pin, and
      // unpickable/shadowless so a second ball adds no gameplay ambiguity and
      // no per-frame cost beyond its own draw.
      gm.alpha = 0.55;
      g.material = gm;
      g.isPickable = false;
      g.receiveShadows = false;
      this.ghostBall = g;
    }
    this.ghostBall.scaling.setAll(this.ballScale);
    this.ghostBall.setEnabled(true);
    this.ghostFlight = { path: shot.path, progress: 0 };
  }

  /**
   * PLAYOFF BALLS AT REST (owner pass 8: "Instead of seeing the ai ghost
   * shot fly through the air, we should just see where it lands before we
   * hit"): one parked ball per tied rival, standing at that rival's Nth
   * shot's resting place where N = min(your strokes + 1, their shots) — so
   * from the tee you see their drive down the fairway, after your approach
   * you see theirs, and when their record runs out (they holed) the ball
   * disappears with a toast. Named poBall* deliberately: the perf/occlusion
   * specs count ghost* meshes and these are not ghosts.
   */
  private syncPlayoffBalls(): void {
    const po = tourPlayoff;
    if (!po) return;
    po.rivals.forEach((r, i) => {
      if (!r.rests.length) return;
      const shown = Math.min(this.state.strokes + 1, r.rests.length);
      const rest = r.rests[shown - 1];
      let ball = this.poBalls.get(r.id) ?? null;
      if (rest.holed) {
        ball?.setEnabled(false);
        if (!this.poToasted.has(r.id)) {
          this.poToasted.add(r.id);
          showMsg(`⚔ ${r.name} holed out in ${rest.strokes}`, 2600);
        }
        return;
      }
      if (!ball) {
        ball = MeshBuilder.CreateSphere(`poBall${i}`, { diameter: 1.0, segments: 10 }, this.scene);
        const m = new StandardMaterial(`poBallMat${i}`, this.scene);
        // Amber, translucent: readable as "a rival's ball", never mistakable
        // for the player's own white ball or the ghost race's blue.
        m.diffuseColor = new Color3(1, 0.78, 0.35);
        m.emissiveColor = new Color3(0.5, 0.33, 0.08);
        m.specularColor = new Color3(0.2, 0.2, 0.2);
        m.alpha = 0.8;
        ball.material = m;
        ball.isPickable = false;
        ball.receiveShadows = false;
        this.poBalls.set(r.id, ball);
      }
      ball.scaling.setAll(this.ballScale);
      ball.setEnabled(true);
      ball.position = w2b(rest.x, rest.y, this.ballRestH() + this.gh(rest.x, rest.y));
    });
  }

  /** The playoff status line: each tied rival's visible progress on the hole
   *  ("Rex: green after 2 · Mei: holed in 3"), advancing with the sync rule. */
  private playoffHudRow(): string {
    const po = tourPlayoff;
    if (!po) return '';
    const bits = po.rivals.map((r) => {
      const shown = Math.min(this.state.strokes + 1, r.rests.length);
      const rest = r.rests[shown - 1];
      if (!rest) return `${r.name}: on the tee`;
      return rest.holed ? `${r.name}: holed in ${rest.strokes}` : `${r.name}: ${rest.surface} after ${rest.strokes}`;
    });
    return `<div class="row"><span id="playoffStatus" class="chip ghost">⚔ ${escapeHtml(bits.join(' · '))}</span></div>`;
  }

  /** Test hook: the parked rival balls and what the sync rule is showing
   *  (tests/visual/tourPlayoff.spec.ts) — a parked ball that never appears
   *  looks exactly like no playoff at all from the outside. */
  playoffDebug(): { balls: number; shown: Record<string, number>; status: string } | null {
    const po = tourPlayoff;
    if (!po) return null;
    const shown: Record<string, number> = {};
    po.rivals.forEach((r) => (shown[r.id] = Math.min(this.state.strokes + 1, r.rests.length)));
    return {
      balls: [...this.poBalls.values()].filter((b) => b.isEnabled()).length,
      shown,
      status: document.getElementById('playoffStatus')?.textContent ?? ''
    };
  }

  /** The running head-to-head line. Like-for-like: the ghost's strokes on the
   *  hole in progress only count as far as the player has played it, so the
   *  readout never says you are behind on a hole you have not started. */
  private ghostHudRow(): string {
    const ghost = activeGhost;
    if (!ghost) return '';
    const st = ghost.standing(this.curPart().scores, round.holeIdx, this.state.strokes, round.holeIdx);
    const cls = st.diff > 0 ? 'ghostAhead' : st.diff < 0 ? 'ghostBehind' : '';
    return (
      `<div class="row"><span class="chip ghost ${cls}">👻 ${escapeHtml(ghost.name)} ${st.ghost}` +
      ` · you ${st.you} — ${st.label}</span></div>`
    );
  }

  /** Advance the ghost's ball along its recorded path. Driven by the same tick
   *  and the same timescale as the player's flight, so the two shots stay in
   *  step; when it runs out of path the ball rests where the ghost's did. */
  private tickGhost(dt: number): void {
    const gf = this.ghostFlight;
    if (!gf || !this.ghostBall) return;
    gf.progress += dt * 60 * this.flightTimescale();
    const i = Math.floor(gf.progress);
    if (i >= gf.path.length - 1) {
      const last = gf.path[gf.path.length - 1];
      this.ghostBall.position = w2b(last.x, last.y, last.z + this.ballRestH() + this.gh(last.x, last.y));
      this.ghostFlight = null;
      return;
    }
    const p = gf.path[i];
    const pn = gf.path[i + 1];
    const f = gf.progress - i;
    const bx = p.x + (pn.x - p.x) * f;
    const by = p.y + (pn.y - p.y) * f;
    const bz = p.z + (pn.z - p.z) * f;
    this.ghostBall.position = w2b(bx, by, bz + this.ballRestH() + this.gh(bx, by));
  }

  /** Test hook: what the ghost's stand-in is actually doing right now
   *  (tests/visual/ghostRace.spec.ts). A ghost that is armed but never puts a
   *  ball in the air looks exactly like no ghost at all from the outside, and
   *  the HUD standing would still read correctly — so the spec has to be able
   *  to see the ball itself, not just the score line. */
  ghostDebug(): { shown: boolean; flying: boolean; shotIdx: number; pos: [number, number, number] | null } {
    const b = this.ghostBall;
    return {
      shown: !!b && b.isEnabled(),
      flying: !!this.ghostFlight,
      shotIdx: this.ghostShotIdx,
      pos: b ? [b.position.x, b.position.y, b.position.z] : null
    };
  }

  /** Test hook: run the ghost's flight to its end, the ghost-side counterpart
   *  of `settleFlight`. Headless throttles rAF hard enough that a flight would
   *  otherwise advance a fraction of a sample per render. */
  settleGhostFlight(): boolean {
    const gf = this.ghostFlight;
    if (!gf || !this.ghostBall) return false;
    gf.progress = gf.path.length - 1;
    this.tickGhost(0);
    return true;
  }

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
    // The recording keeps the LAST swipe and the step it was applied from —
    // replaying with the spin applied from step 0 would land the ball somewhere
    // the player never hit it (systems/RoundRecording.ts).
    if (!this.ai) roundRecorder.setFlightSpin(ns.side, ns.top, cur);
    promptEl.textContent = `✨ spin ${ns.side >= 0 ? '→' : '←'}${Math.abs(ns.side).toFixed(1)} ${ns.top >= 0 ? '↟' : '↡'}${Math.abs(ns.top).toFixed(1)}`;
  }

  private onSwingTap!: (e: Event) => void;
  private onTraceDown!: (e: PointerEvent) => void;
  private onTraceMove!: (e: PointerEvent) => void;
  private onTraceUp!: () => void;
  private onPointerDown!: (e: PointerEvent) => void;
  private onPointerMove!: (e: PointerEvent) => void;
  private onPointerUp!: (e: PointerEvent) => void;
  private onDesignWheel!: (e: WheelEvent) => void;
  private onPrevClub!: () => void;
  private onNextClub!: () => void;
  private onAerial!: () => void;
  private onTrueVision!: () => void;
  private onSkip!: (e: Event) => void;
  private onFlightSkip!: (e: Event) => void;
  private onStrikeDown!: (e: PointerEvent) => void;
  private onStrikeMove!: (e: PointerEvent) => void;
  private onStrikeUp!: () => void;

  // ----------------------------------------------------------------- loop

  private tick(): void {
    // Clamp the frame delta: a hitch (screen transition, GC, tab refocus) can
    // report a multi-hundred-ms delta that snaps every exponential-lerp toward
    // its target in one frame — that's what made the flyover appear to start
    // mid-fairway and jolted the ball. Cap at ~3 frames' worth.
    const dt = Math.min(0.05, gpu().getDeltaTime() / 1000);

    // Float the aim readout over its world anchor (projected each frame so it
    // tracks the smoothing camera). Scratch objects reused per frame — this
    // block runs every aiming frame and used to allocate a Vector3 + identity
    // Matrix + Viewport each time (GC churn during the aim/idle window).
    if (this.aimReadoutWorld && this.state.phase === 'aiming' && !this.ai) {
      const wp = w2b(this.aimReadoutWorld.x, this.aimReadoutWorld.y, this.gh(this.aimReadoutWorld.x, this.aimReadoutWorld.y) + 4);
      this._readoutViewport.width = gpu().getRenderWidth();
      this._readoutViewport.height = gpu().getRenderHeight();
      const s = Vector3.Project(
        wp,
        this._identity,
        this.scene.getTransformMatrix(),
        this._readoutViewport
      );
      const w = gpu().getRenderWidth();
      const h = gpu().getRenderHeight();
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

    this.tickGhost(dt);

    if (this.flight) {
      // ⏩ mid-skip: the landing beat has played (landed flipped on its
      // discrete sample), so carry the shot straight through the roll.
      if (this.skipToRest && this.flight.landed) {
        this.flight.progress = this.flight.outcome.path.length;
      }
      this.flight.progress += dt * 60 * this.flightTimescale();
      // Offer the ⏩ a beat into the flight — never at the strike itself, so
      // the swing's release can't double-tap it into existence-and-fire.
      // Wall-clock, not samples: throttled frames must not delay the offer.
      if (
        !this.skipToRest &&
        performance.now() - this.flight.startedAt > 400 &&
        flightSkipBtn.style.display !== 'block'
      ) {
        flightSkipBtn.style.display = 'block';
      }
      const i = Math.floor(this.flight.progress);
      const path = this.flight.outcome.path;
      if (i >= path.length) {
        const outcome = this.flight.outcome;
        // Dispose the trail's material + textures with it — each shot creates a
        // fresh StandardMaterial, and plain dispose() leaves it registered on
        // the scene until hole teardown (materials accumulated per shot).
        // stop() BEFORE dispose(): TrailMesh registers an
        // onBeforeRenderObservable observer when constructed with autoStart,
        // and Babylon 9's TrailMesh has no dispose() override — so Mesh.dispose
        // tears down the geometry and leaves the observer running for the life
        // of the scene. One leaked observer per non-putt shot (CLAUDE.md rule
        // 13: "observers... must not accumulate").
        this.flight.trail?.stop();
        this.flight.trail?.dispose(false, true);
        this.flight = null;
        this.skipToRest = false;
        flightSkipBtn.style.display = 'none';
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
        const nextPos = w2b(bx, by, bz + this.ballRestH() + this.gh(bx, by));
        this.spinBall(nextPos, bz);
        this.ball.position = nextPos;
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
            const landSurface = this.engine2d.surfaceAt(p.x, p.y);
            this.landingPuff(p.x, p.y, landSurface === 'sand');
            // Surface-shaped landing thump (V2 Phase 5): the touchdown gets a
            // soft 'hit' — bright/quiet on short grass, darker in rough,
            // deep + low-passed in sand. Water keeps its splash; runs off the
            // flight tick, never an input path.
            if (flag('audio')) {
              const spec = LANDING_THUMP[landSurface];
              if (spec) {
                const vol = Math.max(0, Math.min(1, spec.volume * profile.settings.sound));
                if (vol > 0) playBuffer('hit', vol, { rate: spec.rate * variedParams('hit').rate, lowpassHz: spec.lowpassHz });
              }
            }
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
    // Impact recoil, decaying along the stored view axis (alloc-free scratch).
    if (this.camPunchT > 0) {
      this.camPunchT -= dt;
      const push = 2.6 * Math.max(0, this.camPunchT) / 0.16;
      this._camPunchScratch.copyFrom(this.camPunchDir).scaleInPlace(push);
      this.camera.position.addInPlace(this._camPunchScratch);
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

  /** Put the ball back on the tee with a clean card. Practice re-tees with it;
   *  the test hook `dropAt` uses the same path from an arbitrary spot. */
  resetToTee(): void {
    const c = this.comps[this.turnIdx];
    c.ball = { ...this.hole.tee };
    c.lie = 'tee';
    c.holed = false;
    c.strokes = 0;
    this.state.strokes = 0;
    this.beginTurn();
  }

  /**
   * Test hook: fast-forward the shot currently in the air to its resting place.
   *
   * Headless throttles rAF, and a tight `scene.render()` loop produces
   * near-zero frame deltas, so a flight advances a fraction of a sample per
   * render — a spec cannot play a round in reasonable time by rendering. This
   * jumps playback to the final sample, which lands on the same terminal branch
   * the normal tick reaches (the one a "tap to skip the roll" already uses), so
   * the shot resolves through the real code path.
   */
  settleFlight(): boolean {
    if (!this.flight) return false;
    this.flight.progress = this.flight.outcome.path.length;
    this.tick();
    return true;
  }

  /**
   * The ⏩ button (owner pass 8: "tap to fast forward to the end of any
   * shot"). NOT the instant jump settleFlight() does: a shot still in the
   * air first jumps to just before touchdown so the landing crosses its
   * discrete sample — puff, thump, camera cut and the hole-out drama all
   * still fire — and then `skipToRest` carries it through the roll to rest
   * on the next tick. A DOM button so it can never collide with the
   * swipe-spin gesture: the canvas listeners never see a pointer that went
   * down on a sibling button.
   */
  fastForwardFlight(): void {
    const fl = this.flight;
    if (!fl) return;
    this.skipToRest = true;
    if (!fl.landed) fl.progress = Math.max(fl.progress, fl.landIdx - 1);
    else fl.progress = fl.outcome.path.length;
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

  /** RANGE DRILLS: deal the next chipping/putting station — a random legal
   *  spot for that shot around this hole's green. Tries a handful of draws so
   *  a chip never starts from water and a putt always starts ON the green,
   *  with a safe fallback near the pin. */
  drillDrop(kind: 'chip' | 'putt'): void {
    const pin = this.hole.pin;
    const g = this.hole.green;
    for (let i = 0; i < 10; i++) {
      let x: number;
      let y: number;
      if (kind === 'putt') {
        const a = Math.random() * Math.PI * 2;
        const k = 0.3 + Math.random() * 0.45;
        x = g.cx + Math.cos(a) * g.rx * k;
        y = g.cy + Math.sin(a) * g.ry * k;
      } else {
        // 15–40 yd out on the tee side — the direction an approach actually
        // missed from — with a little lateral scatter.
        const dx = this.hole.tee.x - pin.x;
        const dy = this.hole.tee.y - pin.y;
        const len = Math.hypot(dx, dy) || 1;
        const d = 30 + Math.random() * 50;
        const lat = (Math.random() - 0.5) * 44;
        x = pin.x + (dx / len) * d + (-dy / len) * lat;
        y = pin.y + (dy / len) * d + (dx / len) * lat;
      }
      const s = this.engine2d.surfaceAt(x, y);
      const ok = kind === 'putt' ? s === 'green' : s !== 'water' && s !== 'green';
      if (ok) {
        this.dropAt(x, y);
        return;
      }
    }
    const ang = Math.random() * Math.PI * 2;
    const r = kind === 'putt' ? 20 : 90;
    this.dropAt(pin.x + Math.cos(ang) * r, pin.y + Math.sin(ang) * r);
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

  /**
   * Shed what this hole is spending, without rebuilding it. The governor calls
   * this when it demotes mid-hole; everything else in a quality profile is a
   * build-time budget and only reaches the NEXT hole, which is no help to a
   * player standing on this one.
   */
  applyQuality(q: QualityProfile): void {
    if (this.disposed) return;
    this.course3d.shedQuality(q);
  }

  /**
   * Put every piece of in-round UI back, and unbind every listener this scene
   * attached. Touches NO GPU object, so it is safe to run against a scene whose
   * WebGL context has already died — which is the whole reason it is split out
   * of `dispose()`.
   *
   * That split matters more than it looks. `abandonAfterContextLoss` cannot call
   * `dispose()` (disposing a dead context throws), so before this existed it
   * hand-rolled a handful of `display:none` calls and skipped the rest —
   * including the three WINDOW-level pointer listeners. `onTraceMove` calls
   * `preventDefault()` on every pointermove, and with `touch-action: none` set
   * globally that kills tap synthesis and stops the landing (which scrolls)
   * from scrolling. The owner's report was exact: "None of the menus actually
   * worked … it was like I was clicking in the wrong spots."
   *
   * Idempotent, because both `dispose()` and the abandon path call it and a
   * lost context can be followed by a normal teardown.
   */
  teardownChrome(): void {
    if (this.chromeTornDown) return;
    this.chromeTornDown = true;
    document.documentElement.classList.remove('fire-vignette');
    // Cancel any still-pending intro-flyover timers outright (they were only
    // no-op'd by the disposed guard before — harmless, but the timers
    // lingered past scene teardown).
    for (const t of this.introTimers) clearTimeout(t);
    this.introTimers.length = 0;
    // `renderPacing` is module-global and outlives the scene, so a hole
    // abandoned mid-flyover must not leave its freeze flags standing over the
    // next one. (beginTurn would clear them anyway; leaving them set until
    // then is the kind of cross-hole leak this file has been bitten by.)
    renderPacing.cinematic = false;
    renderPacing.overhead = false;
    renderPacing.meterActive = false;
    renderPacing.cameraParked = false;
    swingBtn.removeEventListener('pointerdown', this.onSwingTap);
    tracePadEl.removeEventListener('pointerdown', this.onTraceDown);
    this.trace = null;
    tracePad.hide();
    window.removeEventListener('pointermove', this.onTraceMove);
    window.removeEventListener('pointerup', this.onTraceUp);
    window.removeEventListener('pointercancel', this.onTraceUp);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onDesignWheel);
    this.design?.dispose();
    this.design = null;
    document.getElementById('prevClub')!.removeEventListener('pointerdown', this.onPrevClub);
    document.getElementById('nextClub')!.removeEventListener('pointerdown', this.onNextClub);
    aerialBtn.removeEventListener('pointerdown', this.onAerial);
    trueVisionBtn.removeEventListener('pointerdown', this.onTrueVision);
    skipBtn.removeEventListener('pointerdown', this.onSkip);
    flightSkipBtn.removeEventListener('pointerdown', this.onFlightSkip);
    flightSkipBtn.style.display = 'none'; // a scene torn down mid-flight must not leave it up
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
    // The 🏆 board button was shown by beginTurn and hidden only on the paths
    // that end a turn cleanly — so it survived even a NORMAL teardown and sat
    // on the landing with a live listener. Hidden here for both paths.
    tourBoardBtn.style.display = 'none';
    // In-round modals live ABOVE the menu layer. `showTourBoard` builds its
    // sheet with an inline `z-index: 30` against the landing's 21, and only a
    // tap on it removes it — so a board left open when the round ends is a
    // full-screen tap-swallower over the menu. This is the one piece of
    // in-round DOM that genuinely can cover the landing.
    document.querySelectorAll('.storeConfirm').forEach((el) => el.remove());
    // Belt and braces: the drags the window listeners read. Even if a listener
    // somehow outlives the removals above, an inactive drag makes both handlers
    // no-ops rather than a preventDefault() storm or a shot fired into a dead
    // scene.
    this.trace = null;
    this.strikeDragging = false;
  }

  dispose(): void {
    this.disposed = true;
    this.teardownChrome();
    this.scene.dispose();
  }
}

// -------------------------------------------------------- round orchestration

let current: HoleScene | null = null;
// Now that `current` exists, let the quality governor reach the live hole.
shedLiveQuality = (q) => current?.applyQuality(q);
const holesThisRound = (): number => Math.min(RULES.holesPerRound, round.course.holes.length);

/** Play one hole. Every competitor plays it in a single scene (alternating
 *  turns for 1v1/scramble); the callback returns each competitor's strokes. */
const loadingEl = document.getElementById('loading');
/**
 * Bumped by every `showLoading`. A hide that was SCHEDULED against an earlier
 * veil must not lower a later one.
 *
 * `buildWithLoading` arms two deferred lifts (ground-ready, and a 4 s safety
 * cap). If the context is lost while a build is still resolving, the loss
 * handler raises its own "Rebuilding the hole…" veil — and the dead build's
 * safety cap would then fire and lower it, uncovering a hole that was never
 * rebuilt, seconds before the abandon timer had its say. Only two functions
 * raise the veil, and each owns lowering the one it raised.
 */
let veilGen = 0;
function showLoading(msg = 'Loading course…'): void {
  veilGen++;
  const txt = document.getElementById('loadingTxt');
  if (txt) txt.textContent = msg;
  loadingEl?.classList.add('on');
}
function hideLoading(): void {
  if (!loadingEl) return;
  // Delight: release the veil with a short fade (CSS transition under
  // ff-delight) instead of a hard swap. The .fading class keeps display:flex
  // through the transition; reduced motion (or flag off) keeps today's
  // instant release.
  if (flag('delight') && !profile.settings.reducedMotion && loadingEl.classList.contains('on')) {
    loadingEl.classList.add('fading');
    loadingEl.classList.remove('on');
    setTimeout(() => loadingEl.classList.remove('fading'), 400);
  } else {
    loadingEl.classList.remove('on');
  }
}
/** Show the loading veil, wait for it to actually PAINT, then run a heavy,
 *  main-thread-blocking build — so tapping "Tee off" gives instant feedback
 *  instead of a frozen menu while the course bakes. A double rAF guarantees the
 *  browser has committed a frame with the veil up before we block; a short
 *  setTimeout fallback still runs the build where rAF is throttled (headless /
 *  backgrounded tabs). The veil lifts one frame after the build so the fresh
 *  course paints first. Runs `build` exactly once. */
function buildWithLoading(build: () => void, msg?: string): void {
  showLoading(msg);
  // The veil THIS build owns. See `veilGen`.
  const gen = veilGen;
  let ran = false;
  const go = (): void => {
    if (ran) return;
    ran = true;
    try {
      build();
    } finally {
      // Lift the veil only once the course can actually paint (ground shader
      // compiled) plus one frame — so the player never sees the blue sky
      // clearColor while a heavy hole (Wildwood h1) compiles its ground material
      // on the first frame. A 4s safety cap guarantees the veil always lifts
      // even if the compile stalls or fails.
      let lifted = false;
      const lift = (): void => {
        if (lifted) return;
        lifted = true;
        // Only lower the veil this build raised — a later one belongs to
        // whoever raised it. Re-checked inside the frame callback because a
        // loss can land in the gap.
        if (gen !== veilGen) return;
        requestAnimationFrame(() => {
          if (gen === veilGen) hideLoading();
        });
      };
      void (current?.groundReady ?? Promise.resolve()).then(lift);
      setTimeout(lift, 4000);
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
  // Practice is not a round and must never enter the funnel: it has no end, so
  // every practice session would otherwise read as a started-and-abandoned
  // round and quietly wreck the completion metric the retention dashboard is
  // built on (docs/technical/ANALYTICS_FRAMEWORK.md).
  if (practiceMode) return;
  analytics.track('round_started', {
    course: courseIdByName(round.course.name),
    mode: round.mode
  });
}

/** Fold the HUMAN player's completed round into the permanent mastery state
 *  (Part 5). Runs once at ROUND end so the round-scale third stars ("shoot 4
 *  under", "3 putts or fewer") can evaluate; duplicate stars stay structurally
 *  impossible (bitmask OR). */
function applyRoundMasteryForHuman(holes: HoleData[], scores: number[], roundToPar: number): void {
  const courseId = courseIdByName(round.course.name);
  const roundPutts = holes.reduce((a, h) => a + (shotAcc.holePutts[h.number] ?? 0), 0);
  holes.forEach((hole, i) => {
    const strokes = scores[i] ?? 0;
    if (!strokes) return;
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
      holePutts: shotAcc.holePutts[hole.number] ?? 0,
      approachFt: facts.approachFt,
      onFire: facts.onFire,
      windSpeed: facts.windSpeed,
      roundToPar,
      roundPutts
    };
    // The legend-tier feat ledger asks a different question from the mastery
    // stars — "which COURSES have given this up" rather than "what has this
    // hole given up" — so it is recorded alongside rather than derived from
    // them (systems/Feats.ts).
    profile.retention.feats = recordHoleFeats(profile.retention.feats, {
      courseId,
      par: hole.par,
      strokes,
      droveGreen: facts.droveGreen
    });
    const res = applyHoleMastery(profile.retention.mastery, input, thirdStarFor(courseId, hole.number));
    for (const star of res.newStars) {
      roundNewStars.push({ hole: hole.number, star });
      analytics.track('mastery_star_earned', { mastery_star_id: `${courseId}:${hole.number}:${star}`, course: courseId });
    }
  });
}

/**
 * Checkpoint the round at a hole boundary so an interrupted player can come
 * back and finish it (`resumeRound` flag). Deliberately narrow: plain solo
 * rounds only — see systems/RoundCheckpoint.ts for why versus / AI-tournament /
 * weekly / tournament / challenge rounds are excluded — and never during the
 * tutorial, which is its own guided thing with its own entry point.
 */
/**
 * Returns whether a checkpoint was actually written — callers that tell the
 * player their round was saved (see `abandonAfterContextLoss`) must not say
 * so for the round types this deliberately skips.
 */
function checkpointRound(): boolean {
  if (!flag('resumeRound') || practiceMode) return false;
  if (
    round.mode !== 'solo' ||
    aiTour ||
    tourRoundLive ||
    tourPlayoff ||
    round.weeklyEventId ||
    round.challenge ||
    tutorialCoach.isActive() ||
    round.seed === undefined
  ) {
    return false;
  }
  const holes = holesThisRound();
  if (round.holeIdx < 0 || round.holeIdx >= holes) return false;
  // WHERE THE BALL IS, AND WHAT IT HAS COST. Without these "finish the round"
  // sent a player who was three shots into a par 5 back to the tee, which is a
  // worse offer than starting a new round.
  const live = current;
  const strokes = live?.state.strokes ?? 0;
  const ball = live && strokes > 0 ? { x: live.state.ballPos.x, y: live.state.ballPos.y } : undefined;
  if (round.holeIdx <= 0 && !ball) return false;
  saveCheckpoint(
    checkpointFor({
      courseId: courseIdByName(round.course.name),
      seed: round.seed,
      holeIdx: round.holeIdx,
      holes,
      scores: round.players[0]?.scores ?? [],
      parSoFar: round.course.holes.slice(0, round.holeIdx).reduce((a, h) => a + h.par, 0),
      at: Date.now(),
      ball,
      strokes,
      diff: round.difficulty
    })
  );
  return true;
}

/**
 * Refuse to start a round when there is no GPU, and say why.
 *
 * Returns true when the caller must bail. Called at the three points that
 * cover all thirteen ways into a hole: `startRound` (quick play, the wizard,
 * the tutorial, the daily hole, the range and its drills, resume, the builder,
 * and the test hook), `startTourEvent`, and `playHole` as the backstop for the
 * tour/AI paths that reach it directly.
 *
 * Deliberately BEFORE `buildWithLoading` at every site: that raises the loading
 * veil before it runs the build, so refusing later would leave the player
 * staring at a veil for the four seconds its safety cap takes to lift.
 */
function gpuBlocked(): boolean {
  if (ensureEngine() && !contextGone) return false;
  // Put the player back where they can act. Several callers hide the landing
  // (or the wizard) BEFORE they ask for a round, so refusing without this
  // leaves them on a blank screen with nothing to press — the failure this
  // whole change exists to remove. Restoring here covers every caller at once,
  // rather than trusting thirteen entry points to each undo their own
  // teardown.
  hideLoading();
  showLanding();
  // Name the fix. `contextGone` is the common case here — the GPU died during a
  // round — and a page reload gets a fresh context, so telling the player only
  // that graphics are "unavailable" leaves them stuck on a screen that would
  // work again after one pull-to-refresh. Only claim the card is saved when it
  // actually is — `roundWasCheckpointed` reflects the same narrow scope
  // `checkpointRound` applies (see `abandonAfterContextLoss`).
  showMsg(
    contextGone
      ? roundWasCheckpointed
        ? 'Graphics stopped on this device. Reload the page to play on — your round is saved.'
        : 'Graphics stopped on this device. Reload the page to play on — this round couldn’t be saved.'
      : 'This device can’t start a round right now — its graphics are unavailable.',
    4200
  );
  return true;
}

function playHole(): void {
  if (gpuBlocked()) return;
  checkpointRound();
  current?.dispose();
  // The build stall, the glTF loads and the intro flyover are not steady play —
  // starting the quality governor's window fresh here keeps it from demoting a
  // device for the one part of a hole that is expensive by design.
  resetQualitySamples();
  // Layouts (flag-gated): materialize this seed's tee variants onto the round
  // course. Idempotent + deterministic (same seed → same tees), so calling it
  // per hole is safe; without authored `tees` it returns the course unchanged.
  if (flag('layouts')) round.course = applyTeeVariants(round.course, round.seed);
  refreshAmbienceBed(); // per-course bed follows the round (V2 Phase 5)
  // Restore the gameplay chrome the results screen hid.
  swingBtn.style.display = '';
  hudEl.style.display = '';
  pauseBtn.style.display = 'block';
  // TAB-CRASH BREADCRUMB (owner: repeated white screens on one hole). A scene
  // build that kills the tab — iOS WebKit reclaiming a heavy page dies without
  // any JS error — leaves this key behind; the next boot reads it, strikes the
  // checkpoint (two strikes retire it), and clears it. Set before the build,
  // cleared right after: the window where a death implicates this hole.
  try {
    sessionStorage.setItem('jg-building', `${courseIdByName(round.course.name)}:${round.holeIdx}`);
  } catch { /* storage unavailable — the breadcrumb is best-effort */ }
  current = new HoleScene((scores) => {
    // Tutorial: the first hole is the lesson — wrap up once it's done.
    if (tutorialCoach.isActive() && round.holeIdx === 0) tutorialCoach.onHoleDone(completeTutorial());
    round.players.forEach((p, i) => {
      p.scores[round.holeIdx] = scores[i] ?? 0;
    });
    round.holeIdx += 1;
    if (round.holeIdx < holesThisRound()) {
      // Between holes the next scene builds synchronously — without a veil the
      // screen froze on the old hole's last frame for the whole build. Run the
      // rebuild behind the same paint-guaranteed veil as round start, labeled
      // with the upcoming hole so the cut reads as the round's rhythm.
      const next = round.course.holes[round.holeIdx];
      buildWithLoading(() => playHole(), next ? `Hole ${next.number} · Par ${next.par}` : undefined);
    } else {
      showSummary();
    }
  });
  // The build survived — the breadcrumb has done its job for this hole.
  try {
    sessionStorage.removeItem('jg-building');
  } catch { /* best-effort */ }
  // A capture/spec boot (?hole=) never shows the landing — a built scene is
  // the other definition of a healthy boot for the watchdog.
  (window as unknown as { __booted?: boolean }).__booted = true;
  exposeDebug();
  // A builder-preview rebuild triggered from fly mode comes straight back to
  // fly mode, camera and all — the rebuild is a render step in the drawing
  // loop, not an exit from it.
  if (pendingFlyResume && sel.courseId === BUILDER_COURSE_ID) {
    const cam = pendingFlyResume;
    pendingFlyResume = null;
    current.toggleDesign(true, cam);
  } else {
    pendingFlyResume = null;
  }
  // RANGE DRILLS: a fresh station just built. Skip the flyover — the drill's
  // rhythm is ball after ball, not tour after tour — and put the ball where
  // this drill wants it (a drive already stands on the tee).
  if (practiceMode && practiceDrill && current) {
    current.skipIntro();
    if (practiceDrill !== 'drive') current.drillDrop(practiceDrill);
  }
}

/** The canonical Play Next rotation (Part 1): a simple, predictable order the
 *  player can learn. Unavailable courses are skipped safely. */
// The expansion ids ride at the end; nextCourseIdAfter already skips any id
// missing from COURSES, so with the newCourses flag off the rotation is the
// original four and with it on the two new courses join the loop.
const PLAY_NEXT_ROTATION = ['sablebay', 'wildwood', 'timberline', 'portjohnson', 'redhollow', 'wildvalley', 'maplevale'];
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

/**
 * Replay a CSS entrance animation on a PERSISTENT element (one that is shown/
 * hidden rather than re-created). Removing the class, forcing a reflow, then
 * re-adding it restarts the keyframes so the fade plays on every show. A no-op
 * feel under Reduced Motion, where the CSS zeroes the animation. (Phase 2.)
 */
function replayAnim(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow so the animation can restart
  el.classList.add(cls);
}

function showSummary(): void {
  // A sudden-death playoff hole is not a round: no records, no rewards, no
  // recording — it gets its own card and resolves the pending tie.
  if (tourPlayoff) {
    renderPlayoffSummary();
    return;
  }
  current?.dispose();
  current = null;
  sealRoundRecording();
  recordDailyAttempt();
  // Take the gameplay chrome down with the scene — the results card is the
  // whole screen's purpose now (leftover HUD/aim-readout/SWING read as noise
  // around the card). playHole() restores them for the next round.
  swingBtn.style.display = 'none';
  hudEl.style.display = 'none';
  pauseBtn.style.display = 'none';
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
  // Mastery stars evaluate at round end (round-scale third stars need the
  // final to-par and putt totals).
  applyRoundMasteryForHuman(holes, me.scores, totals[0] - totalPar);
  // Previous course best BEFORE this round folds in (PB comparison line).
  const prevBest = profile.retention.records.bestByCourse[courseId]?.total ?? null;
  const recEvents: RecordEvent[] = applyRoundRecords(profile.retention.records, {
    courseId,
    courseName: round.course.name,
    total: totals[0],
    stats: rstats,
    fireStreakBest: shotAcc.fireStreakBest,
    closestApproachFt: shotAcc.closestApproachFt,
    weeklyEventId: round.weeklyEventId ?? undefined,
    // Owner rule: course records are only set on Pro or Expert. The round is
    // otherwise completely normal — it pays, it counts, it fills the career.
    ranked: recordsAllowed(round.difficulty),
    now: Date.now()
  });
  // Weekly Featured entry (Part 8): submit ONLY when this round set the
  // player's best for the event (duplicate/regression submissions never reach
  // the network; the RTDB rule additionally only accepts improvements).
  let weeklyLine = '';
  if (round.weeklyEventId) {
    analytics.track('weekly_round_completed', {
      weekly_event: round.weeklyEventId,
      score_to_par: totals[0] - totalPar
    });
    const bestNow = profile.retention.records.bestWeekly[round.weeklyEventId];
    // Gated on the round's own difficulty, not just on bestWeekly: an unranked
    // round that happens to TIE a Pro round's total would otherwise read as
    // "this is my best" and post to a board it is not comparable with.
    const isBest = recordsAllowed(round.difficulty) && bestNow && bestNow.total === totals[0];
    if (!recordsAllowed(round.difficulty)) {
      weeklyLine = `<div class="rwLine">🏆 ${escapeHtml(UNRANKED_RECORDS_MSG)} This round is not on the weekly board.</div>`;
    } else if (signedIn && isBest) {
      void submitWeeklyEntry(round.weeklyEventId, {
        playerId: profile.id,
        name: profile.name || 'Golfer',
        golferId: me.golfer.id,
        total: totals[0],
        toPar: totals[0] - totalPar,
        holes: me.scores.slice(0, holes.length),
        submittedAt: Date.now(),
        // The rating that PLAYED — the board shows it beside the name.
        rating: ovr(me.golfer.stats)
      });
      weeklyLine = `<div class="rwLine ach">🏆 Weekly entry posted: ${totals[0]} (${parLabel(totals[0])})</div>`;
    } else if (isBest) {
      weeklyLine = `<div class="rwLine ach">🏆 Weekly best: ${totals[0]} — sign in to post it to the leaderboard</div>`;
    }
  }
  // Async challenge outcome (Part 9): report the result AND post it to the
  // shared results doc (write-once) so both sides' "Your Challenges" list can
  // settle who won.
  let challengeLine = '';
  if (round.challenge) {
    const out = challengeOutcome(round.challenge, totals[0]);
    analytics.track('async_challenge_completed', { result: out, course: courseId });
    if (round.challenge.cid) {
      void submitChallengeResponse(round.challenge.cid, {
        playerId: challengePlayerId(),
        name: sanitizeName(profile.name || 'A rival'),
        total: totals[0],
        toPar: totals[0] - totalPar,
        at: Date.now()
      });
      profile.retention.challenges = [
        { cid: round.challenge.cid, at: Date.now() },
        ...profile.retention.challenges.filter((c) => c.cid !== round.challenge!.cid)
      ].slice(0, 30);
    }
    const who = escapeHtml(round.challenge.creator || 'Your rival');
    challengeLine =
      out === 'beat'
        ? `<div class="rwLine ach">⚔ You beat ${who}'s ${round.challenge.total}! Send one back ↓</div>`
        : out === 'tied'
          ? `<div class="rwLine ach">⚔ Tied ${who}'s ${round.challenge.total} — one more stroke next time</div>`
          : `<div class="rwLine ach">⚔ ${who}'s ${round.challenge.total} stands — replay and take it down</div>`;
  }
  for (const a of events) {
    if (a.kind === 'achievement') analytics.track('achievement_earned', { achievement_id: a.id });
  }
  const dailyEvent = events.find((e) => e.kind === 'daily');
  // THE STREAK ADVANCES ON THE DAILY CHALLENGE, NOT ON PLAYING.
  //
  // It used to advance on any completed round, which is why the owner could
  // skip a daily and keep a 12-day streak. Read `profile.daily` rather than
  // `dailyEvent` so a SECOND round on a day whose challenge is already done
  // still sees the streak as earned (the event only fires on the round that
  // completes it); `advanceStreak` is idempotent within a day either way.
  const dailyDoneToday = profile.daily.date === todayKey() && profile.daily.done;
  const adv = dailyDoneToday
    ? advanceStreak(profile.retention.streak, todayKey())
    : { state: profile.retention.streak, advanced: false, usedProtection: false, restarted: false };
  profile.retention.streak = adv.state;
  // The legacy mirror the older UI spots read. Stamped from the LIVE value so
  // it cannot outlive the streak it mirrors.
  profile.dailyStreak = currentStreak(adv.state, todayKey());
  if (adv.advanced) analytics.track('streak_advanced', { streak_length: adv.state.current });
  if (adv.usedProtection) analytics.track('streak_protection_used', { streak_length: adv.state.current });
  let streakRewardLine = '';
  if (dailyEvent) {
    analytics.track('daily_completed', { course: courseId, streak_length: adv.state.current });
    const claim = claimStreakReward(profile.retention.streak, todayKey());
    profile.retention.streak = claim.state;
    if (claim.reward) {
      profile.coins += claim.reward.coins;
      profile.coinsEarned += claim.reward.coins;
      // Streak XP bounties pay as CP now (career mode's ÷25 re-denomination).
      const streakCp = claim.reward.xp ? achievementCp(claim.reward.xp) : 0;
      if (streakCp) grantCareerCp(profile, streakCp);
      const day = cycleDay(adv.state.current);
      streakRewardLine =
        `<div class="rwLine daily">🔥 Streak day ${day}: ` +
        `${claim.reward.coins ? `+${claim.reward.coins} 🪙 ` : ''}` +
        `${streakCp ? `+${streakCp} CP` : ''}` +
        `${claim.reward.milestone ? ' · week complete! 🏆' : ''}</div>`;
    }
  }
  const protectionLine = adv.usedProtection
    ? `<div class="rwLine daily">🛡 Streak protected — you missed a day, the weekly token covered it</div>`
    : '';
  // WHICH DIFFICULTY THIS ROUND WAS ACTUALLY PLAYED AT.
  //
  // The setting only widens the swing bands by a few pixels, so "did it even do
  // anything?" is a fair question and the card is the honest place to answer
  // it. It also explains, at the moment it matters, why a good round did or did
  // not go in the record book.
  const diffProfile = difficultyProfile(round.difficulty);
  const difficultyLine =
    `<div class="rwLine">🎚 Played at ${escapeHtml(diffProfile.label)}` +
    (diffProfile.ranked ? '' : ` · ${escapeHtml(UNRANKED_RECORDS_MSG)}`) +
    `</div>`;
  analytics.track('round_completed', {
    course: courseId,
    mode: round.mode,
    score_to_par: totals[0] - totalPar,
    round_duration: roundStartedAt ? Math.round((Date.now() - roundStartedAt) / 1000) : 0
  });
  // First completed round on this device → the landing's secondary systems
  // (daily/weekly/season/store) reveal from now on (Part 11).
  if (!deviceSettings.firstRoundDone) updateDeviceSettings({ firstRoundDone: true });
  // The round is in the book — there is nothing left to resume.
  clearCheckpoint();

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
    // For the record boards: two facts that only ever lived in the profile, so
    // no leaderboard could see them.
    ...(rstats.longestDriveYds > 0 ? { drive: Math.round(rstats.longestDriveYds) } : {}),
    ...(rstats.chipIns > 0 ? { chipIns: rstats.chipIns } : {}),
    // The difficulty this round was played at, so the shared record boards can
    // rank only comparable rounds. Absent on rounds recorded before difficulty
    // shipped — those were all played at what is now Pro, and RecordBoards
    // treats an absent value as exactly that.
    diff: round.difficulty,
    // Signed in → the real Firebase uid; guest → the device's STABLE guest id
    // (so a guest's rounds group together across a session), flagged `guest`.
    uid: signedIn ? profile.id : guestId(),
    ...(signedIn ? { xp: profile.xp } : { guest: true })
  };
  // Account PROGRESS (coins/records/profile) stays account-gated — a guest
  // round persists nothing to the profile. But the round itself IS recorded to
  // the shared /rounds node for EVERYONE, so the admin dashboard counts guest
  // play (Constitution rule 18). Guest rounds are flagged and never appear on
  // the player-facing leaderboard or as an account (see aggregate/bestRounds).
  saveRound(record);
  // Season pass: the round's CP also advances the pass track (accrues for
  // everyone while the season runs; claiming needs the pass).
  const roundCp = events.find((e): e is Extract<RewardEvent, { kind: 'cp' }> => e.kind === 'cp');
  if (roundCp) {
    addSeasonXp(profile, SEASON_1, roundCp.amount, Date.now());
    refreshProgressSurfaces();
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

  // TOUR SEASON round: fold this score into the current event, field the
  // rivals' rounds, and show where the event and the season stand. Majors
  // resolve over three rounds; the finale major closes the season — champion,
  // purse, rollover.
  let tourSeasonBlock = '';
  let tourSeasonPrimary = '';
  let tourCpLine = '';
  let tourEventJustDone = false;
  const liveSeason = tourNow();
  if (tourRoundLive && liveSeason) {
    tourRoundLive = false;
    const ids = tourCourseIds();
    const t = liveSeason;
    const def = currentEvent(t, ids);
    const outcome = def ? completeTourRound(t, COURSES, totals[0], totals[0] - totalPar, ids) : null;
    if (def && outcome) {
      const evName = tourEventName(def);
      const evRows = tourEventBoardHtml(outcome.standings, def.idx);
      if (!outcome.eventDone && outcome.playoff) {
        // Regulation ended with the player TIED FOR THE LEAD: the event holds
        // un-finalized — no points yet — until sudden death settles it.
        const names = outcome.playoff.tiedRivalIds.map(tourEntrantName).join(' & ');
        headline = `${evName} — tied at the top`;
        tourSeasonBlock =
          `<div class="tourResult"><div class="tourHeadRow">⚔ ${escapeHtml(evName)} — you and ${escapeHtml(names)} finished level</div>${evRows}` +
          `<div class="recSub">Sudden death: their ball waits at rest each shot — beat them outright to take the trophy.</div></div>`;
        tourSeasonPrimary = `<button id="tourPlayoffBtn">⚔ Playoff — settle the tie →</button>`;
      } else if (!outcome.eventDone) {
        // A major between rounds: the event's banked rounds are already on the
        // profile, so this is the resumable state, not a fragile one.
        const nextRound = eventRoundsPlayed(t) + 1;
        headline = `${evName} — round ${nextRound - 1} of ${def.rounds} complete`;
        tourSeasonBlock =
          `<div class="tourResult"><div class="tourHeadRow">⛳ ${escapeHtml(evName)} · MAJOR — after round ${nextRound - 1}/${def.rounds}</div>${evRows}</div>`;
        tourSeasonPrimary = `<button id="tourNextBtn">Round ${nextRound} of ${def.rounds} →</button>`;
      } else {
        const ui = tourEventOutcomeUi(t, def, outcome, ids);
        headline = ui.headline;
        tourSeasonBlock = ui.block;
        tourCpLine = ui.cpLine;
        tourSeasonPrimary = ui.primary;
        tourEventJustDone = true;
      }
      persistProfile();
      if (signedIn)
        void cloudSyncProfile(profile).then((res) => {
          applyCloudMerge(profile, res.profile);
          showCloudStatus(res.status, true);
        });
    }
  }
  // ---- THE CARD A PLAYER WITH NO ACCOUNT SEES ----
  //
  // Owner: "Get rid of some of the other post round stuff for these players. If
  // you don't have an account it doesn't matter. We need to make it a clear cta
  // to start an account and spend the coins in the store on cool new things."
  //
  // So for a guest the card keeps what is TRUE for them — the score, and the
  // coins they just earned — and drops everything that only pays off with an
  // account behind it: the weekly entry, the challenge, the records they cannot
  // keep, the ghost race, the next-objective nudge. What replaces it is the two
  // things worth doing next.
  const guest = guestWithNoAccount();
  const signInNudge =
    guest
      ? `<div class="guestCta">` +
        `<div class="gcHead">Your coins are on this device only</div>` +
        `<div class="gcSub">An account keeps your coins, your Pro and your records — and gets them on every device you play.</div>` +
        `<div class="gcRow"><button id="guestSignUpBtn" class="gcPrimary">Create an account to save progress</button>` +
        `<button id="guestStoreBtn" class="gcSecondary">🪙 ${profile.coins} — spend it in the store</button></div>` +
        `</div>`
      : '';
  const purseLine = aiTourPurse ? `<div class="rwLine ach">💰 Tournament purse: +${aiTourPurse} 🪙</div>` : '';
  // Mid-tournament the primary button advances the tournament, not the menu.
  const midTour = aiTour && !isFinal(aiTour);

  // ---- Compact results card (Part 1): score + PB, records, ONE objective,
  // expandable details, and the two primary actions (Replay / Play Next) ----
  const isNewBest = prevBest !== null && totals[0] < prevBest;
  const pbLabel = prevBest === null ? 'First round here' : isNewBest ? '🏆 New best!' : `Best: ${prevBest}`;
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
    `<span class="pb${isNewBest ? ' newBest' : ''}">${pbLabel}</span></div>` +
    (guest ? '' : starLine) +
    holeSurveyHtml() +
    // Records are kept on this device only until there is an account to keep
    // them in, so a guest is told about coins (spendable now) rather than
    // records (a promise the build cannot make yet).
    (guest ? '' : recLines) +
    // WHAT YOU EARNED — one block. These were five separate stacked lines
    // (rewards, streak, protection, purse, and the sign-in nudge under them),
    // each styled to be noticed, all saying "you got something".
    rewardStripHtml(events) +
    streakRewardLine +
    protectionLine +
    difficultyLine +
    purseLine +
    tourCpLine +
    signInNudge +
    // WHAT IT MEANT — the competitive outcomes. A weekly entry, a challenge
    // settled and a tournament standing are the reason the round was played,
    // so they stay on the card; everything hole-by-hole goes behind the fold.
    // All of it is account-shaped, so none of it is on a guest's card.
    (guest ? '' : weeklyLine) +
    (guest ? '' : challengeLine) +
    aiTourBlock +
    tourSeasonBlock +
    (guest ? '' : `<div class="objLine">🎯 ${escapeHtml(objective)}</div>`) +
    // THE TWO PRIMARY ACTIONS, directly under the objective — the card's whole
    // job is to start the next round, and on a phone anything below a details
    // expander and a five-button row is a scroll away.
    (tourSeasonPrimary
      ? `<div class="primaryRow">${tourSeasonPrimary}</div>`
      : midTour
        ? `<div class="primaryRow"><button id="againBtn">Next Round →</button></div>`
        : `<div class="primaryRow"><button id="replayBtn">${replayLabel}</button>` +
          `<button id="playNextBtn">Play Next: ${escapeHtml(nextName)} →</button></div>`) +
    // The retention actions keep their own row — racing this round and
    // challenging somebody with it are the two things that bring a player
    // back, so they are one tap, not two. A tour round keeps the card about
    // the tour (no ghost/challenge: its rounds aren't recorded).
    (midTour
      ? `<div class="btnRow"><button id="quitTourBtn" class="ghostBtn">Quit tournament</button></div>`
      : tourSeasonBlock || guest
        ? ''
        : `<div class="btnRow">` +
          (ghostRematchAvailable() ? `<button id="ghostBtn" class="ghostBtn">👻 Race this</button>` : '') +
          `<button id="shareChBtn" class="ghostBtn">⚔ Challenge a friend</button></div>`) +
    // Everything else — the scorecard, and the two destinations that are
    // always one tap from the menu anyway — folds away.
    `<details class="roundDetails"><summary>Scorecard &amp; more</summary>` +
    `<table><tr><th>Hole</th><th>Par</th>${headCols}</tr>${rows}${totalRow}${teamRow}</table>` +
    `<div class="btnRow"><button id="recBtn" class="ghostBtn">🏆 Records</button>` +
    `<button id="profBtn" class="ghostBtn">👤 Profile</button></div>` +
    `</details>` +
    (midTour ? '' : `<button id="againBtn" class="ghostBtn summaryMenu">☰ Menu</button>`);
  summaryEl.style.display = 'block';
  wireHoleSurvey();
  replayAnim(summaryEl, 'fadeIn'); // gentle entrance for the results screen
  // Reveal cascade (Pass B): children stagger in under ff-delight (CSS is
  // scoped, so the class is inert with the flag off). Re-added per show so the
  // fresh innerHTML's children animate every round.
  summaryEl.classList.add('cascade');
  // Score count-up: the big total counts to the real score over ~0.6 s. The
  // pure countUpValue clamp guarantees the exact final number; reduced motion
  // and flag-off render the final value on the first frame.
  const bigEl = summaryEl.querySelector<HTMLElement>('.scoreHead .big');
  if (bigEl && flag('delight') && !profile.settings.reducedMotion && totals[0] > 0) {
    const t0 = performance.now();
    const DUR = 600;
    const step = (now: number): void => {
      // The card was torn down (replay/menu tapped mid-count) → stop quietly.
      if (!bigEl.isConnected) return;
      const t = (now - t0) / DUR;
      bigEl.textContent = String(countUpValue(0, totals[0], t));
      if (t < 1) requestAnimationFrame(step);
    };
    bigEl.textContent = '0';
    requestAnimationFrame(step);
  }
  document.getElementById('profBtn')!.addEventListener('pointerdown', () => renderProfile());
  // The guest card's two actions: make an account, or go spend what you just
  // won. Both leave the results card up behind them, so a player who backs out
  // of either is still where they were.
  document.getElementById('guestSignUpBtn')?.addEventListener('pointerdown', () => {
    analytics.track('account_cta_tapped', { from: 'summary' });
    renderProfile('settings');
  });
  document.getElementById('guestStoreBtn')?.addEventListener('pointerdown', () => {
    analytics.track('store_opened', { from: 'summary' });
    renderStore();
  });
  // Replay: the SAME setup (course/mode/character/pal/perk all ride sel +
  // profile), back to the first tee with one tap. Play Next: the rotation's
  // next course, same mode/loadout, no course-select menu.
  document.getElementById('replayBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui'); // quiet confirmation on the primary actions only
    summaryEl.style.display = 'none';
    aiTour = null;
    sel.courseId = courseId;
    analytics.track('replay_selected', { course: courseId, mode: round.mode });
    startRound(0);
  });
  document.getElementById('playNextBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    summaryEl.style.display = 'none';
    aiTour = null;
    if (sel.mode === 'aitour') sel.mode = 'solo'; // a course pick isn't a new tournament
    sel.courseId = nextId;
    analytics.track('play_next_selected', { course: courseId, destination_course: nextId, mode: sel.mode });
    startRound(0);
    // next_course_started deprecated 2026-07-18: pure duplicate of
    // play_next_selected(destination_course) + the round_started that follows
    // (docs/technical/ANALYTICS_FRAMEWORK.md).
  });
  // Tour Season: the next round of a major, or straight into the next event.
  document.getElementById('tourNextBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    summaryEl.style.display = 'none';
    startTourRound();
  });
  // A tie at the top: into sudden death.
  document.getElementById('tourPlayoffBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    summaryEl.style.display = 'none';
    startTourPlayoffHole();
  });
  // A finished tour event's primary: back to the Tour page the result lives on.
  document.getElementById('tourHubBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    returnToTourHub();
  });
  document.getElementById('againBtn')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    if (midTour) {
      startAiTourRound();
    } else if (tourEventJustDone) {
      // ☰ Menu off a finished tour event also lands on the tour page — the
      // course wizard is the wrong "menu" for a season in progress.
      returnToTourHub();
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
  // 1v1 challenge share: this round's exact setup (course + seed) and score
  // become a tracked challenge — the doc records both sides' results so "Your
  // Challenges" in the profile can show who won. The share sheet opens a
  // ready-to-text message; clipboard/prompt fallbacks where share isn't
  // available.
  document.getElementById('ghostBtn')?.addEventListener('pointerdown', () => startGhostRematch());
  document.getElementById('shareChBtn')?.addEventListener('pointerdown', () => {
    const cid = makeChallengeId();
    const def: AsyncChallengeDef = {
      v: 1,
      courseId,
      mode: round.mode,
      seed: round.seed ?? 0,
      total: totals[0],
      toPar: totals[0] - totalPar,
      creator: sanitizeName(profile.name || 'A friend'),
      at: Date.now(),
      exp: 0,
      cid
    };
    // Best-effort results doc + my pointer to it (works for guests too; the
    // link itself stays self-contained if the write doesn't land).
    void createChallengeDoc({
      cid,
      courseId,
      seed: def.seed,
      createdAt: def.at,
      creator: {
        playerId: challengePlayerId(),
        name: def.creator,
        total: totals[0],
        toPar: totals[0] - totalPar,
        at: def.at
      }
    });
    profile.retention.challenges = [
      { cid, at: def.at },
      ...profile.retention.challenges.filter((c) => c.cid !== cid)
    ].slice(0, 30);
    persistProfile();
    const url = challengeUrl(def, `${window.location.origin}${window.location.pathname}`);
    const toParTxt = def.toPar === 0 ? 'even par' : def.toPar > 0 ? `+${def.toPar}` : `${def.toPar}`;
    const text = `I shot ${toParTxt} at ${round.course.name}. Can you do better? ${url}`;
    analytics.track('async_challenge_created', { course: courseId });
    const copied = (): void => showMsg('⚔ Challenge copied — text it to a friend!', 2200);
    if (typeof navigator.share === 'function') {
      navigator.share({ text }).catch(() => {
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(copied, () => window.prompt('Send this challenge:', text));
        else window.prompt('Send this challenge:', text);
      });
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(copied, () => window.prompt('Send this challenge:', text));
    } else {
      window.prompt('Send this challenge:', text);
    }
  });
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
  const sum = (k: 'cp' | 'coins'): number =>
    events.filter((e): e is Extract<RewardEvent, { kind: 'cp' | 'coins' }> => e.kind === k).reduce((a, e) => a + e.amount, 0);
  // CP leads the strip (career mode: CP is THE progression currency), and the
  // line under it says what CP is FOR — spendable growth, one tap away.
  let html =
    `<div class="rewardStrip"><span class="rw xp">+${sum('cp')} CP</span>` +
    `<span class="rw coin">+${sum('coins')} 🪙</span></div>`;
  const rewardCp = spendableCp(profile);
  if (flag('careerMode') && careerStarted(profile.career) && rewardCp > 0) {
    html += `<div class="rwLine level">📈 ${rewardCp} CP to spend — grow your Pro in the Locker</div>`;
  }
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

/**
 * FEATS, WITH A TRACKER ON EVERY ONE.
 *
 * The old list showed the earned ones, three arbitrary locked ones and the
 * sentence "… 14 more to discover" — so the goals a player was closest to were
 * usually the ones they could not see, and the ones they could see said nothing
 * about how close they were (owner: "the challenges need to be redone ... with
 * trackers").
 *
 * Now: three tiers, every feat listed, and every unfinished one carries the bar
 * and the raw numbers. Within a tier the nearly-done sort to the top, because
 * "2 of 3" is the row worth reading. Done feats collapse into a single line of
 * medals per tier — they are a trophy, not a to-do.
 */
function featsHtml(p: PlayerProfile): string {
  const done = new Set(p.achievements);
  return (
    `<div class="featList">` +
    FEAT_TIERS.map((tier) => {
      const mine = FEATS.filter((f) => f.tier === tier.id);
      if (!mine.length) return '';
      const got = mine.filter((f) => done.has(f.id));
      const todo = mine
        .filter((f) => !done.has(f.id))
        .map((f) => ({ f, ...f.progress(p) }))
        // Closest first. A feat with nothing on it yet sorts last inside its
        // tier rather than sitting above one that is two thirds finished.
        .sort((a, b) => b.have / b.need - a.have / a.need);
      const rows = todo
        .map(({ f, have, need }) => {
          const pct = Math.round((have / need) * 100);
          // A 0/1 feat has nothing useful to count, so it shows the goal
          // instead of the arithmetic — "0 of 1" tells a player nothing.
          const count = need === 1 ? '' : `<span class="featN">${have} / ${need}</span>`;
          return (
            `<div class="featRow"><div class="featTop"><b>${escapeHtml(f.name)}</b>${count}</div>` +
            `<div class="featDesc">${escapeHtml(f.desc)}</div>` +
            `<div class="xpBar"><i style="width:${pct}%"></i></div></div>`
          );
        })
        .join('');
      const gotLine = got.length
        ? `<div class="featGot">${got.map((f) => `<span class="chip" data-id="${escapeHtml(f.id)}">🏅 ${escapeHtml(f.name)}</span>`).join('')}</div>` +
          // Hidden until a medal is tapped, then filled with that feat's own
          // name + desc — one shared slot per tier, not a toast. `showMsg()`
          // was the first attempt; it renders behind the full-screen profile
          // overlay (#records, z-index 25) with no way to see it, so a
          // completed feat looked unclickable even though the handler fired.
          // Inline, in the same list a todo feat's `.featDesc` already uses,
          // has nothing to occlude and reads as one consistent list.
          `<div class="featGotDesc" style="display:none"></div>`
        : '';
      return (
        `<div class="featTier"><div class="featTierHead">${escapeHtml(tier.label)}` +
        `<span class="featTierN">${got.length} / ${mine.length}</span></div>${gotLine}${rows}</div>`
      );
    }).join('') +
    `</div>`
  );
}

/** Per-course, per-hole mastery breakdown for the profile drill-down: each
 *  hole lists its three authored challenges (easiest → hardest) shown filled
 *  or empty, so the player sees exactly what's completed and what remains. */
function masteryDetailHtml(p: PlayerProfile): string {
  return COURSE_LIST.map((c) => {
    const course = COURSES[c.id];
    const holes = course.holes.slice(0, holesThisRound());
    const blocks = holes
      .map((h) => {
        const bits = holeStars(p.retention.mastery, c.id, h.number);
        const def = thirdStarFor(c.id, h.number);
        const rows = (def?.stars ?? [])
          .map((sc, i) => {
            const got = (bits & STAR_BITS[i]) !== 0;
            return (
              `<div class="mStarRow${got ? ' got' : ''}">` +
              `<span class="mStar">${got ? '★' : '☆'}</span>` +
              `<span class="mStarDesc">${escapeHtml(sc.desc)}</span></div>`
            );
          })
          .join('');
        return `<div class="mHoleBlock"><div class="mHoleName">H${h.number} · par ${h.par}</div>${rows}</div>`;
      })
      .join('');
    return (
      `<div class="mCourse"><div class="mCourseHead">${c.icon} ${escapeHtml(course.name)} ` +
      `<span class="mCount">${starCount(p.retention.mastery, c.id)}/9</span></div>${blocks}</div>`
    );
  }).join('');
}

/**
 * THE PROFILE, AS TABS.
 *
 * This was one column and about two thousand pixels of it: identity, ten stat
 * cells, mastery chips, a per-hole mastery drill-down, challenges,
 * achievements, four settings, a danger zone — and then, at the very bottom of
 * all that, the Admin panel and the Dev tools. Two surfaces that get used
 * constantly during development were the furthest thing on the screen from the
 * player's thumb, reachable only by scrolling past everything else.
 *
 * Same shape as the landing, one level down: pick a section, see that section.
 *
 *   Player     who you are, and the career numbers
 *   Progress   mastery, challenges, achievements
 *   Settings   sound, motion, clips, the account row, and the danger zone
 *   Admin      only for an admin account
 *   Dev        only off production, with the dev-tools flag on
 *
 * `renderProfile('dev')` opens straight onto a tab, which is what the landing's
 * More menu uses — so Admin and Dev are now two taps from the front door
 * instead of a scroll to the bottom of a wall.
 */
type ProfileTab = 'player' | 'progress' | 'settings' | 'admin' | 'dev';

const PROFILE_TAB_LABELS: Record<ProfileTab, string> = {
  player: 'Player',
  progress: 'Progress',
  settings: 'Settings',
  admin: '🔑 Admin',
  dev: '🛠 Dev'
};

/** Settings → Graphics. 'Auto' is the default and the one anybody should need;
 *  the pinned tiers exist for a player who would rather choose than be
 *  measured, and for diagnosing a report of lag on a specific device. */
// All four tiers, plus Auto. 'High' was missing — which was odd, because until
// this pass Auto put EVERY phone on exactly that tier and offered no way to ask
// for it by name.
const GRAPHICS_CHOICES: ReadonlyArray<[DeviceSettings['graphics'], string]> = [
  ['auto', 'Auto'],
  [0, 'Full'],
  [1, 'High'],
  [2, 'Balanced'],
  [3, 'Performance']
];

/** One line under the Graphics row saying what the game is drawing RIGHT NOW.
 *  On Auto that is the whole point: the player can see the device was measured
 *  and what it was measured as. */
function graphicsNote(): string {
  const q = qualityStatus();
  const detail = q.reason ? ` · ${q.reason}` : '';
  return q.pinned ? `Drawing at ${q.label}${detail}` : `Auto chose ${q.label} for this device${detail}`;
}

/** One labelled section of the Settings pane. A heading and a hairline are all
 *  it takes to turn a flat list into "these change my game, those change this
 *  phone" — the pane had neither. */
function setGroup(title: string, body: string): string {
  return `<div class="setGroup"><div class="setGroupHead">${title}</div>${body}</div>`;
}

/**
 * The line under Difficulty: what the current choice does, and — while the
 * player has not chosen — that the game picked for them and why.
 *
 * A setting whose effect is invisible until you have played three holes is a
 * setting nobody touches, so this says the actual rule (records need Pro) on
 * the screen where the choice is made rather than in a results-screen surprise.
 */
function difficultyNote(): string {
  const d = playerDifficulty();
  const p = difficultyProfile(d);
  const auto = profile.settings.difficulty === undefined
    ? deviceSettings.tutorialDone
      ? ' (chosen for you — change it any time)'
      : ' (the lesson starts here — change it any time)'
    : '';
  const records = p.ranked ? '' : ` ${UNRANKED_RECORDS_MSG}`;
  return `${p.label}${auto} — ${p.blurb}${records}`;
}

/**
 * A second line under Graphics: what this device was drawing the last time it
 * lost its WebGL context, or nothing if it never has.
 *
 * The crashes worth fixing happen on players' phones, and until now the only
 * evidence was a sentence typed afterwards. A phone has no console, so the
 * numbers have to be somewhere a player can read them out — this is that place.
 */
function crashNote(): string {
  const log = deviceSettings.crashes;
  if (!log.length) return '';
  const c = log[0];
  const days = Math.floor((Date.now() - c.at) / 86_400_000);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const hole = c.hole > 0 ? ` h${c.hole}` : '';
  const heap = c.heapMB === null ? '' : ` · ${c.heapMB}MB heap`;
  // Everything that says WHAT WAS HAPPENING, which the counts alone could not:
  // whether the loss landed inside a scene build, whether there was a scene at
  // all, and whether the canvas recorder was running. Each is omitted when it
  // has nothing to say, so the common case stays one readable line.
  const context = [
    c.building ? 'mid-build' : '',
    c.sceneNull ? 'no live scene' : '',
    c.recording ? 'recording' : '',
    c.lossIndex > 1 ? `loss #${c.lossIndex} of the session` : ''
  ]
    .filter(Boolean)
    .join(', ');
  const buffer = c.canvasW > 0 ? ` · ${c.canvasW}×${c.canvasH} @${c.dpr.toFixed(1)}x` : '';
  const mem = c.deviceMemory === null ? '' : ` · ${c.deviceMemory}GB device`;
  const floor = c.floor !== c.tier ? ` (session floor ${c.floor})` : '';
  const why = c.reason ? ` · ${escapeHtml(c.reason)}` : '';
  const earlier = log.length > 1 ? ` · +${log.length - 1} earlier` : '';
  // The crash moved a player-pinned tier down — say so, or the player pins it
  // back up without ever learning why their setting changed underneath them.
  const label = (t: number): string => GRAPHICS_CHOICES.find(([v]) => v === t)?.[1] ?? `tier ${t}`;
  const stepped =
    c.pinnedTo !== undefined ? ` · moved the ${label(c.tier)} pin to ${label(c.pinnedTo)}` : '';
  return (
    `Last graphics failure ${when}: ${escapeHtml(c.course)}${hole} at tier ${c.tier}${floor}${why}${stepped}` +
    `<br />${c.props.toLocaleString()} props · ${c.meshes} meshes · ${c.textures} textures` +
    ` · ${c.engineTextures} engine textures${heap}${buffer}${mem}` +
    (context ? `<br />${context}` : '') +
    earlier
  );
}

/** Which tab was last open, so a re-render (a claim, a grant, a reset) comes
 *  back to where the player was rather than throwing them to the top. */
let profileTab: ProfileTab = 'player';

/** The tabs this session is entitled to. Admin follows the signed-in account;
 *  Dev follows the environment and the flag. */
function profileTabs(): ProfileTab[] {
  const tabs: ProfileTab[] = ['player', 'progress', 'settings'];
  if (adminUnlocked()) tabs.push('admin');
  if (devToolsActive()) tabs.push('dev');
  return tabs;
}

/** Profile overlay: identity, career, progress, settings — and the tools. */
function renderProfile(tab?: ProfileTab): void {
  const p = profile;
  const s = p.stats;
  // The header reads in career terms now: the Pro's rating and the CP behind
  // it, with the bar showing progress into the current season-pass level
  // (which CP also paces). Legacy xp/level are frozen and no longer shown.
  const lp = levelProgress(SEASON_1, p.season.xp);
  const pct = lp.levelCost > 0 ? Math.round((lp.intoLevel / lp.levelCost) * 100) : 100;
  const tabs = profileTabs();
  if (tab && tabs.includes(tab)) profileTab = tab;
  if (!tabs.includes(profileTab)) profileTab = 'player';
  const pane = (id: ProfileTab, body: string): string =>
    `<div class="profPane${id === profileTab ? ' on' : ''}" data-tab="${id}">${body}</div>`;

  recordsEl.style.display = 'flex';
  recordsEl.innerHTML =
    `<div class="recInner"><h2>${escapeHtml(p.name || 'Golfer')}</h2>` +
    `<div class="profLvl">${(() => {
      const pro = flag('careerMode') ? activePro(p.career) : null;
      return pro ? `${escapeHtml(pro.name)} OVR ${careerOvr(pro.attrs)} · ` : '';
    })()}Pass level ${lp.level} · ${p.coins} 🪙 · ${spendableCp(p)} CP</div>` +
    `<div class="xpBar"><i style="width:${pct}%"></i></div>` +
    `<div class="profTabs">` +
    tabs
      .map(
        (t) =>
          `<button class="recTab profTab${t === profileTab ? ' sel' : ''}" data-tab="${t}">${PROFILE_TAB_LABELS[t]}</button>`
      )
      .join('') +
    `</div>` +
    pane(
      'player',
      // WHO YOU ARE, first (owner pass 8: "need to give a log out option") —
      // the door is labeled Profile, so the account and its Log out button
      // live at the top of the Player tab, not only buried in Settings.
      // Distinct ids from the Settings row: both panes exist in the DOM at
      // once, and duplicate ids would leave one row dead.
      (authConfigured()
        ? `<div class="acctRow"><span id="acctStatusP" class="acctStatus">Checking account…</span>` +
          `<button id="linkGoogleP" class="ghostBtn">Sign in with Google</button></div>`
        : '') +
        `<div class="profStats">` +
        statCell(s.rounds, 'Rounds') +
        statCell(s.birdies, 'Birdies') +
        statCell(s.eagles, 'Eagles') +
        statCell(s.holeInOnes, 'Aces') +
        statCell(s.bestRoundToPar === null ? '—' : s.bestRoundToPar, 'Best') +
        statCell(Math.round(s.longestDriveYds), 'Long drive') +
        statCell(s.chipIns, 'Chip-ins') +
        statCell(s.wins, 'Wins') +
        (() => {
          // LIVE, not stored: a streak that lapsed while the player was away
          // must read as lapsed the moment they open this pane.
          const st = currentStreak(p.retention.streak, todayKey());
          return statCell(st > 0 ? `🔥 ${st}` : '—', 'Daily streak');
        })() +
        statCell(`⭐ ${starCount(p.retention.mastery)}`, 'Mastery stars') +
        `</div>`
    ) +
    pane(
      'progress',
      // Course-by-course mastery totals + an expandable per-hole drill-down so
      // the player can see exactly which stars are done and which remain.
      `<div class="profMastery">` +
        COURSE_LIST.map((c) => `<span class="chip">${c.icon} ${starCount(p.retention.mastery, c.id)}/9</span>`).join('') +
        `</div>` +
        `<details class="masteryDetails"><summary>View mastery stars by hole</summary>` +
        masteryDetailHtml(p) +
        `</details>` +
        // Your Challenges (1v1): who you challenged, the result, and the W-L
        // record — filled asynchronously from the shared /challenges docs.
        (p.retention.challenges.length
          ? `<div class="chSection"><div class="chHead">⚔ Your Challenges <span id="chRecord" class="chip"></span></div>` +
            `<div id="chList" class="chList"><span class="chPending">Loading results…</span></div></div>`
          : '') +
        // Achievements: earned first, then a FEW useful next targets — never the
        // whole locked wall (Part 6).
        featsHtml(p)
    ) +
    pane(
      'settings',
      // SETTINGS, IN GROUPS.
      //
      // This was a flat stack of thirteen rows with no headings, in the order
      // they happened to be added: audio, then a control scheme, then a
      // recorder, then the one setting that changes how the game PLAYS, then a
      // graphics budget, then a diagnostic, then a destructive button. Nothing
      // told you which of those touched your game and which touched this phone
      // (owner: "reorganize the settings tab so it makes more sense").
      //
      // Four groups, in the order a player cares: who you are, how it plays,
      // how it sounds, what this device does. Every row keeps its element id,
      // so every handler below is untouched.
      `<div class="profSettings">` +
        (authConfigured()
          ? setGroup(
              'Account',
              `<div class="acctRow"><span id="acctStatus" class="acctStatus">Checking account…</span>` +
                `<button id="linkGoogle" class="ghostBtn">Sign in with Google</button></div>`
            )
          : '') +
        setGroup(
          'Game',
          // Difficulty leads: it is the only setting here that changes how the
          // game plays, so somebody looking for "make this easier" meets it
          // before anything about drawing or volume.
          `<div class="setRow"><span>Difficulty</span><div class="setSeg">` +
            DIFFICULTIES.map((d) => {
              const sel = playerDifficulty() === d;
              return `<button id="setDiff-${d}" class="segBtn${sel ? ' sel' : ''}">${difficultyProfile(d).label}</button>`;
            }).join('') +
            `</div></div>` +
            `<div class="setNote" id="diffNote">${difficultyNote()}</div>` +
            (flag('dragSwing')
              ? `<div class="setRow"><span>Swing</span><div class="setSeg">` +
                `<button id="setSwingTap" class="segBtn${deviceSettings.swingType === 'tap' ? ' sel' : ''}">Three-click</button>` +
                `<button id="setSwingTrace" class="segBtn${deviceSettings.swingType === 'trace' ? ' sel' : ''}">Drag &amp; trace</button>` +
                `</div></div>`
              : '')
        ) +
        setGroup(
          'Sound',
          `<label class="setRow"><span>Sound</span>` +
            `<input id="setSound" type="range" min="0" max="1" step="0.05" value="${p.settings.sound}" /></label>` +
            `<label class="setRow"><span>Ambience</span>` +
            `<input id="setAmbience" type="range" min="0" max="1" step="0.05" value="${p.settings.ambience}" /></label>`
        ) +
        setGroup(
          'This device',
          `<label class="setRow"><span>Reduced motion</span>` +
            `<input id="setReducedMotion" type="checkbox" ${p.settings.reducedMotion ? 'checked' : ''} /></label>` +
            (shotCapture.supported
              ? `<label class="setRow"><span>Record shot clips</span>` +
                `<input id="setClipCapture" type="checkbox" ${deviceSettings.clipCapture ? 'checked' : ''} /></label>` +
                // NEVER `disabled`. The note warns; the checkbox still works.
                // A greyed-out toggle with no way to reach it is the complaint
                // this row exists to answer.
                (captureRisky()
                  ? `<div class="setNote">This device ran out of graphics memory recently. ` +
                    `Recording costs more of it — switch it on if you want it anyway.</div>`
                  : '')
              : '') +
            // Graphics: Auto measures this device and picks a budget for it; the
            // rest pin one. Whatever is showing, the readout underneath says what
            // the game is ACTUALLY drawing right now, so "it's laggy" has an
            // answer that does not require a debugger.
            `<div class="setRow"><span>Graphics</span><div class="setSeg">` +
            GRAPHICS_CHOICES.map(
              ([value, label]) =>
                `<button id="setGfx${value}" class="segBtn${deviceSettings.graphics === value ? ' sel' : ''}">${label}</button>`
            ).join('') +
            `</div></div>` +
            `<div class="setNote" id="gfxNote">${graphicsNote()}</div>` +
            // Only rendered once this device has actually lost a context, so it
            // is invisible to everyone whose hardware copes.
            (crashNote() ? `<div class="setNote setNoteWarn" id="crashNote">${crashNote()}</div>` : '')
        ) +
        // Outside the groups, at the bottom: one link out and one destructive
        // button, kept well clear of anything a player taps by habit.
        `<a class="ghostBtn aboutGameRow" href="marketing.html">ℹ️ About the game</a>` +
        `<div id="resetZone" class="resetZone">` +
        `<button id="resetRecords" class="dangerBtn">Reset Records</button></div>` +
        `</div>`
    ) +
    pane('admin', `<div id="profAdminZone"></div>`) +
    pane('dev', `<div id="profDevZone"></div>`) +
    `<button id="profBack">Back</button></div>`;

  // Switching tabs re-renders rather than toggling classes: the Admin and Dev
  // panes are rebuilt from live state (an account check, the current flag
  // values), and a stale pane behind a tab is worse than a repaint.
  for (const el of Array.from(recordsEl.querySelectorAll<HTMLElement>('.profTab'))) {
    el.addEventListener('pointerdown', () => renderProfile(el.dataset.tab as ProfileTab));
  }
  // A completed feat collapses to a bare medal chip (`featGot`, above) — the
  // description that explains what it actually was only exists in the TODO
  // row markup, so finishing one made it permanently unreadable (owner: "I
  // completed it and now all I can see is it's done and the title, I can't
  // click it and see what it was"). Toggle the tier's own hidden
  // `.featGotDesc` slot rather than a toast: `showMsg()` was the first
  // attempt, and it renders behind this very panel (`#records` is a
  // full-screen, opaque, z-index:25 overlay; `#msg` has no z-index at all),
  // so the handler fired but nothing was ever visible — tapping a badge
  // looked like it did nothing. Inline has nothing to occlude.
  for (const el of Array.from(recordsEl.querySelectorAll<HTMLElement>('.featGot .chip'))) {
    el.addEventListener('pointerdown', () => {
      const f = featById(el.dataset.id ?? '');
      const desc = el.closest('.featTier')?.querySelector<HTMLElement>('.featGotDesc');
      if (!f || !desc) return;
      const text = `${f.name} — ${f.desc}`;
      // Tapping the same medal again collapses it; tapping a different one
      // in the same tier swaps the text rather than stacking two open.
      const reopening = desc.style.display === 'none' || desc.textContent !== text;
      desc.textContent = text;
      desc.style.display = reopening ? 'block' : 'none';
    });
  }
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
  // Swing type is a mid-round-safe choice: the input surfaces are re-picked at
  // the next address (armSwing reads traceInputOn), so no rebuild is needed.
  const pickSwing = (type: DeviceSettings['swingType']): void => {
    updateDeviceSettings({ swingType: type });
    document.getElementById('setSwingTap')?.classList.toggle('sel', type === 'tap');
    document.getElementById('setSwingTrace')?.classList.toggle('sel', type === 'trace');
  };
  document.getElementById('setSwingTap')?.addEventListener('click', () => pickSwing('tap'));
  document.getElementById('setSwingTrace')?.addEventListener('click', () => pickSwing('trace'));
  // Difficulty is a PROFILE setting (it decides whether a round can set a
  // record, and records sync with the account). It takes effect from the next
  // round: `round.difficulty` was locked at the tee, so a mid-round change can
  // never resize the meter under a card already half written.
  for (const d of DIFFICULTIES) {
    document.getElementById(`setDiff-${d}`)?.addEventListener('click', () => {
      profile.settings.difficulty = d;
      // Written to BOTH stores on purpose: the profile is the synced,
      // record-deciding copy, and the device copy is the one a signed-out
      // player still has after a reload.
      updateDeviceSettings({ difficulty: d });
      persistProfile();
      if (signedIn) void cloudSyncProfile(profile).then((res) => applyCloudMerge(profile, res.profile));
      for (const other of DIFFICULTIES) {
        document.getElementById(`setDiff-${other}`)?.classList.toggle('sel', other === d);
      }
      const note = document.getElementById('diffNote');
      if (note) note.textContent = difficultyNote();
      showMsg(
        current
          ? 'Difficulty saved — it applies from your next round'
          : `Difficulty set to ${difficultyProfile(d).label}`,
        2600
      );
    });
  }
  // Graphics takes effect immediately for the render resolution and from the
  // next hole for everything sized at build time — so it is safe mid-round and
  // never rebuilds the hole under the player.
  for (const [value] of GRAPHICS_CHOICES) {
    document.getElementById(`setGfx${value}`)?.addEventListener('click', () => {
      updateDeviceSettings({ graphics: value });
      setQualityPreference(value);
      for (const [v] of GRAPHICS_CHOICES) {
        document.getElementById(`setGfx${v}`)?.classList.toggle('sel', v === value);
      }
      const note = document.getElementById('gfxNote');
      if (note) note.textContent = graphicsNote();
    });
  }
  document.getElementById('setClipCapture')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    updateDeviceSettings({ clipCapture: on });
    // Take effect immediately: start the rolling recorder if a hole is live,
    // stop + release the stream outright when switched off.
    if (on && current) shotCapture.start();
    else if (!on) shotCapture.stop();
    if (captureBtn) captureBtn.textContent = on ? '🎥 REC' : '🎥 CLIP';
    if (on && captureRisky()) showMsg(CAPTURE_RISKY_MSG, 4200);
  });
  // Destructive: fire on a deliberate tap (down+up on the button), not on
  // finger-down — a scroll flick that starts on this button used to open the
  // reset dialog by accident (the "too touchy" report).
  document.getElementById('resetRecords')!.addEventListener('click', confirmResetRecords);
  wireAccountRow();
  refreshProfileAdminZone();
  refreshProfileDevZone();
  void fillChallengeSection(p);
}

/** The stable identity used on 1v1 challenge docs: the account uid when
 *  signed in, else the device's guest id (survives sessions — a raw guest
 *  profile id is re-rolled every visit and would orphan the player's own
 *  challenges). */
function challengePlayerId(): string {
  return signedIn ? profile.id : guestId();
}

/** Fill the profile's "Your Challenges" rows + W-L record from the shared
 *  /challenges docs (bounded, async, never blocks the profile paint). */
async function fillChallengeSection(p: PlayerProfile): Promise<void> {
  if (!p.retention.challenges.length) return;
  const refs = p.retention.challenges.slice(0, 8);
  const docs = (await Promise.all(refs.map((r) => fetchChallenge(r.cid)))).filter(
    (d): d is ChallengeDoc => !!d
  );
  const list = document.getElementById('chList');
  if (!list) return; // profile closed while fetching
  const myId = challengePlayerId();
  let w = 0;
  let l = 0;
  let t = 0;
  const rows = docs.map((doc) => {
    const iAmCreator = doc.creator.playerId === myId;
    const responses = Object.values(doc.responses ?? {});
    const opponent = iAmCreator ? (responses[0]?.name ?? 'Waiting for reply…') : doc.creator.name || 'A rival';
    const mine = iAmCreator ? doc.creator.total : doc.responses?.[myId]?.total;
    const theirs = iAmCreator
      ? responses.length
        ? Math.min(...responses.map((r) => r.total))
        : null
      : doc.creator.total;
    const out = outcomeFor(doc, myId);
    if (out === 'won') w++;
    else if (out === 'lost') l++;
    else if (out === 'tied') t++;
    const badge = out === 'won' ? 'W' : out === 'lost' ? 'L' : out === 'tied' ? 'T' : '⏳';
    const courseName = COURSES[doc.courseId]?.name ?? doc.courseId;
    const score = mine !== undefined ? `${mine}${theirs !== null ? ` vs ${theirs}` : ''}` : '—';
    return (
      `<div class="chRow"><span class="chBadge ch-${out}">${badge}</span>` +
      `<b>${escapeHtml(opponent)}</b><span class="chMeta">${escapeHtml(courseName)}</span>` +
      `<span class="chScore">${score}</span></div>`
    );
  });
  list.innerHTML = rows.join('') || `<span class="chPending">Results unavailable right now</span>`;
  const rec = document.getElementById('chRecord');
  if (rec) rec.textContent = `${w}-${l}${t ? `-${t}` : ''}`;
}

/** Admin-only zone inside the Profile screen (moved here from the main menu
 *  so it's no longer a permanent line item every player sees) — the Admin
 *  Dashboard link, the debug True Vision grant, and the gift-to-another-
 *  account form, all gated behind the same allow-listed email check
 *  refreshAdminLink() used to gate the old menu buttons with. */
/** Development test-data controls (devTools flag consumer — hard-gated to
 *  non-prod via devToolsActive(), see core/devTools.ts). Local profile state
 *  only: grant coins, reset mastery/achievements, reset streak, simulate the
 *  Daily/Weekly date, and flip feature-flag overrides. Cloud seeding waits
 *  for the dev Firebase project (documented deferral). */
function refreshProfileDevZone(): void {
  const zone = document.getElementById('profDevZone');
  if (!zone) return;
  zone.innerHTML = '';
  if (!devToolsActive()) return;
  const dateNow = devDateOverride();
  const flagRows = allFlags()
    .map(
      ({ def, value }) =>
        `<div class="devFlagRow"><code>${def.key}</code> ${value ? '🟢 on' : '⚪ off'} ` +
        `<button class="ghostBtn devFlagBtn" data-flag="${def.key}" data-to="${value ? 'off' : 'on'}">${value ? 'turn off' : 'turn on'}</button>` +
        `<button class="ghostBtn devFlagBtn" data-flag="${def.key}" data-to="clear">default</button></div>`
    )
    .join('');
  zone.innerHTML =
    `<div class="profAdminSection"><div class="profAdminTitle">🛠 Dev Tools (${ENV.name} only)</div>` +
    `<button id="devVeteran" class="ghostBtn">🏌️ Match my production profile</button>` +
    `<div class="acctHint">Max club upgrades, the best perk equipped, and a locked ` +
    `Big Hitter loadout — the golfer a long-time production player is actually ` +
    `swinging. A fresh dev profile is a DIFFERENT, weaker golfer, which is why ` +
    `dev plays harder than prod.</div>` +
    `<button id="devGrantCoins" class="ghostBtn">🪙 Grant 1,000 coins</button>` +
    `<button id="devResetMastery" class="ghostBtn">⭐ Reset mastery + achievements</button>` +
    `<button id="devResetStreak" class="ghostBtn">🔥 Reset streak</button>` +
    `<div class="profAdminTitle">Simulate date ${dateNow ? `(active: ${dateNow})` : '(off — real time)'}</div>` +
    `<input id="devDate" type="date" class="giftInput" value="${dateNow ?? todayKey()}" />` +
    `<button id="devDateSet" class="ghostBtn">Set date</button>` +
    `<button id="devDateClear" class="ghostBtn">Real time</button>` +
    `<div class="acctHint">Daily/Weekly systems read the simulated date; reopen the menu to see it applied.</div>` +
    `<div class="profAdminTitle">Feature flags (sticky overrides, reload applies)</div>` +
    flagRows +
    `</div>`;
  /**
   * Make this dev profile the golfer a production veteran is actually swinging.
   *
   * `?env=dev` and production run the SAME BUILD (config/env.ts) — same physics,
   * same courses. What differs is the profile, because dev lives in its own
   * Firebase namespace and therefore starts empty. Three things follow from
   * that, and together they are why dev plays so much harder:
   *
   *   1. no club upgrades — each tier is +3 to the family's stats AND, on the
   *      short clubs, up to a 1.4x WIDER perfect band (upgradePerfectZoneMult);
   *   2. no perk — which layers another 1.4x on that band, or +6 driving;
   *   3. an unlocked loadout, so `roundGolfer` re-rolls a RANDOM archetype every
   *      round. `statsForClub` reads drivingPower as the distance for EVERY
   *      club, and archetypes span 79..100 — so a random golfer is up to 21%
   *      shorter off every club in the bag.
   *
   * Nothing here changes the game. It changes who is playing it.
   */
  document.getElementById('devVeteran')!.addEventListener('pointerdown', () => {
    profile.clubUpgrades = { driver: 2, irons: 2, wedges: 2, putter: 2 };
    grantPerk(profile, 'perk_iron_t2_r3', 99);
    profile.equippedPerk = 'perk_iron_t2_r3';
    profile.character = 'chip';
    profile.archetype = 'bigHitter';
    profile.loadoutLocked = true;
    persistProfile();
    showMsg('🛠 Veteran profile: max upgrades, perk equipped, Big Hitter locked', 2600);
    renderProfile();
  });
  document.getElementById('devGrantCoins')!.addEventListener('pointerdown', () => {
    profile.coins += 1000;
    profile.coinsEarned += 1000;
    persistProfile();
    showMsg('🛠 +1,000 coins (dev)', 1200);
    renderProfile();
  });
  document.getElementById('devResetMastery')!.addEventListener('pointerdown', () => {
    profile.retention.mastery = emptyMastery();
    profile.achievements = [];
    persistProfile();
    showMsg('🛠 Mastery + achievements reset (dev)', 1400);
    renderProfile();
  });
  document.getElementById('devResetStreak')!.addEventListener('pointerdown', () => {
    profile.retention.streak = emptyStreak();
    profile.dailyStreak = 0;
    persistProfile();
    showMsg('🛠 Streak reset (dev)', 1200);
    renderProfile();
  });
  document.getElementById('devDateSet')!.addEventListener('pointerdown', () => {
    const v = (document.getElementById('devDate') as HTMLInputElement).value;
    setDevDateOverride(v || null);
    showMsg(`🛠 Simulating ${v}`, 1400);
    renderProfile();
  });
  document.getElementById('devDateClear')!.addEventListener('pointerdown', () => {
    setDevDateOverride(null);
    showMsg('🛠 Back to real time', 1200);
    renderProfile();
  });
  zone.querySelectorAll<HTMLElement>('.devFlagBtn').forEach((btn) => {
    btn.addEventListener('pointerdown', () => {
      const key = btn.dataset.flag!;
      const to = btn.dataset.to!;
      setFlagOverride(key, to === 'clear' ? null : to === 'on');
      window.location.reload();
    });
  });
}

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
/** Wire ONE account row (the Settings tab's and the Player tab's — both
 *  panes are in the DOM at once, so they carry distinct ids). */
function wireOneAccountRow(statusId: string, btnId: string): void {
  const status = document.getElementById(statusId);
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
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
    // NEVER-STUCK RULE (owner: "iPhone logins seem stuck"): every path out of
    // this promise — including no path at all — re-enables the button. The
    // 20s race covers a hung Firebase init/chunk download; the sign-in
    // itself, once the popup is up, resolves on the popup's own terms.
    let settled = false;
    const fail = (msg: string): void => {
      if (settled) return;
      settled = true;
      status.textContent = msg;
      btn.disabled = false;
    };
    const timer = window.setTimeout(() => fail("Sign-in didn't complete — tap to try again."), 20_000);
    void signInWithGoogle().then((res) => {
      window.clearTimeout(timer);
      if (settled && res.status !== 'ok') return; // timed out already; leave the retry text
      switch (res.status) {
        case 'ok':
          settled = true;
          void adoptCloudAccount().then(() => {
            renderAcctMenu();
            refreshWizardIfVisible();
            renderProfile(); // re-render with the account's coins/records now loaded
          });
          break;
        case 'redirect':
          // The page should be navigating away. If it still exists in 8s the
          // redirect never happened (iOS storage partitioning can drop it) —
          // hand the button back so the player can retry.
          status.textContent = 'Redirecting to Google…';
          window.setTimeout(() => fail("The redirect didn't go through — tap to try again."), 8_000);
          break;
        case 'cancelled':
          fail('Sign-in cancelled.');
          break;
        case 'error':
          fail(`Sign-in failed (${res.code}) — tap to try again.`);
          break;
      }
    });
  };
}

function wireAccountRow(): void {
  wireOneAccountRow('acctStatus', 'linkGoogle');
  wireOneAccountRow('acctStatusP', 'linkGoogleP');
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
    refreshProgressSurfaces();
    if (storeEl.style.display === 'flex') renderStore();
    if (seasonEl.style.display === 'flex') renderSeasonPass();
  });
}

/** The Characters store section starts collapsed to two rows (playtest FB9). */
/** Character cards shown before "See more" (two rows of the 3-wide grid). */
/** Item id awaiting the "Spend X coins?" confirmation (null = no popup). */
let pendingBuy: string | null = null;

/** Store overlay (Phase 7): buy/equip cosmetics + club upgrades with coins. */
/**
 * Has the shelf changed since this device last looked?
 *
 * The store rotates weekly, and until now nothing said so from the outside —
 * the new balls could sit on the shelf for a week with the player never
 * opening the store (owner: "show the coins and 'new items available' to draw
 * attention to the new balls"). Compares the week this device last SAW against
 * the week that is live.
 *
 * Device-local, not profile-backed: a signed-out player persists no profile at
 * all, and they need telling just as much as anyone.
 */
function storeHasNewItems(): boolean {
  return deviceSettings.storeSeenWeek < storeWeekIndex(devNow());
}

/** Mark this week's shelf as seen and repaint the chip that was flagging it. */
function markStoreSeen(): void {
  const week = storeWeekIndex(devNow());
  if (deviceSettings.storeSeenWeek === week) return;
  updateDeviceSettings({ storeSeenWeek: week });
  refreshProgressSurfaces();
}

function renderStore(): void {
  const p = profile;
  refreshEntitlements();
  // Opening the store IS seeing it. Marked on entry rather than on close so a
  // player who backs out with the hardware button still doesn't get told about
  // the same week twice.
  markStoreSeen();
  // THE SHELF, NOT THE CATALOG (owner: "We should start rotating store items…
  // Only leave in the club upgrades always"). The catalog still holds every
  // item — nothing was deleted, so no saved profile and no pass reward can be
  // orphaned — but only this week's slate is offered. `devNow()` rather than
  // Date.now() so the dev date override moves the shelf too.
  const shelf = currentStoreShelf(devNow());
  const onShelf = shelfIds(shelf.weekIndex);
  const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  const card = (item: StoreItem): string => {
    const owned = isOwned(p, item);
    const equipped = isEquippableKind(item.kind) && p.cosmetics.equipped[item.kind as CosmeticKind] === item.id;
    const affordable = canBuy(p, item, onShelf).ok;
    const cls = equipped ? 'equipped' : owned ? 'owned' : affordable ? '' : 'locked';
    // A patterned ball has to preview as its PATTERN — the four drop balls all
    // carry a white shell colour, so the flat-tint swatch would render the
    // whole collection as identical white squares.
    const swatch = item.ballArt
      ? `<div class="swatch" style="background:${ballArtSwatchCss(item.ballArt)}"></div>`
      : item.color !== undefined
        ? `<div class="swatch" style="background:${hex(item.color)}"></div>`
        : `<div class="swatch" style="background:#2b6b41">⬆️</div>`;
    const label =
      item.kind === 'character'
        ? `<img src="ui/characters/${item.character}.png" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;object-position:50% 22%;border-radius:8px" />`
        : item.kind === 'pal'
          ? `<div class="swatch palSwatch">${palByKey(item.pal)?.icon ?? '🐾'}</div>`
          : swatch;
    const price = equipped ? 'Equipped' : owned ? (isEquippableKind(item.kind) ? 'Tap to equip' : 'Owned') : `${item.price} 🪙`;
    return `<div class="storeCard ${cls}" data-item="${item.id}">${label}<div class="sName">${item.name}</div><div class="sPrice">${price}</div></div>`;
  };
  // Season-pass exclusives never appear in the store (claim-only); the shelf
  // already excludes them and the default-owned starters, so this is the
  // week's offer plus the permanent club upgrades.
  const forSale: StoreItem[] = shelf.items;
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
  // Characters used to collapse behind a See-more toggle because there were
  // 20+ on one page. The shelf offers three, so the toggle is gone.
  const charItems = forSale.filter((i) => i.kind === 'character');
  const charactersSection = `<div class="storeTab">Characters</div><div class="storeGrid">${charItems.map(card).join('')}</div>`;
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
    // A rotating shelf only works if the player can see that it rotates: what
    // is here this week, how long it lasts, and — when a themed drop is on —
    // what the drop is. Without the clock, an item vanishing next week reads as
    // a bug rather than an offer that ended.
    `<div class="shelfBar">` +
    (shelf.drop ? `<span class="shelfDrop">✨ ${escapeHtml(shelf.drop.name)}</span>` : `<span class="shelfDrop">This week's shelf</span>`) +
    `<span class="shelfClock">${escapeHtml(shelfTimeLeft(shelf, devNow().getTime()))} left</span></div>` +
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
      // Gate on THIS WEEK's shelf: an item can be owned and equipped forever,
      // but only bought while it is offered.
      const can = canBuy(p, item, onShelf);
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
      const r = buyItem(p, pending.id, onShelf);
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
    goBack(() => {});
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
/**
 * The loadout the CURRENT round is actually being played with.
 *
 * An unlocked profile re-rolls its character and archetype every round
 * (`roundGolfer`), and those choices used to live only inside that function's
 * locals. Anything downstream asking "who played this round?" read
 * `profile.character/archetype` instead and got the wrong golfer — including
 * `sealRoundRecording`, which stamped every recording with a loadout that did
 * not play it. The replay then assembled a DIFFERENT golfer, the round did not
 * reproduce, and the recording was silently dropped. For any player who has not
 * locked a loadout, that was every round.
 */
let roundLoadout: { character: CharacterKey; archetype: ArchetypeId | 'career' } = {
  character: 'chip',
  archetype: 'bigHitter'
};

/** The Pro's attributes AS PLAYED this round (career style only) — snapshot
 *  at tee-off so mid-round CP spending can't change the golfer in hand, and
 *  stamped into the recording so the replay assembles the same one. */
let roundCareerStats: GolferStats | null = null;

/** What the chosen style is called, the career Pro included — archetypeById
 *  throws on 'career', which is not a preset. The Pro's OVR includes club
 *  upgrades, the SAME number the locker card shows — two surfaces quoting
 *  two different overalls for one golfer reads as a bug (owner: "I just
 *  increased my guy to 75 but the menu button says 71"). */
function styleName(a: ArchetypeId | 'career'): string {
  if (a !== 'career') return archetypeById(a).name;
  const pro = activePro(profile.career);
  return pro ? `${pro.name} · ${ovr(applyClubUpgrades(pro.attrs, profile.clubUpgrades))} OVR` : 'Your Pro';
}

function roundGolfer(): Golfer {
  let character = profile.character as CharacterKey;
  let archetype: ArchetypeId | 'career' = profile.archetype;
  if (!profile.loadoutLocked) {
    const owned = CHARACTERS.filter((c) => profile.cosmetics.owned.includes(`char_${c.key}`));
    character = (owned.length ? randomOf(owned) : CHARACTERS[0]).key as CharacterKey;
    // The Pro SURVIVES the shuffle: with the career style selected, random
    // dress-up changes the look, never the golfer you built.
    if (archetype !== 'career') archetype = randomOf(ARCHETYPES).id as ArchetypeId;
    const ownedPals = STORE_CATALOG.filter((i) => i.kind === 'pal' && isOwned(profile, i));
    if (ownedPals.length) equip(profile, randomOf(ownedPals).id); // a random companion for the round
  }
  // A career round is played AS the Pro: their dedicated look and their name,
  // locked loadout or not — a merge that lost the active Pro falls back to a
  // preset so the round always has a real golfer.
  const pro = archetype === 'career' ? activePro(profile.career) : null;
  if (archetype === 'career' && !pro) archetype = 'bigHitter';
  if (pro) character = pro.character;
  roundLoadout = { character, archetype };
  const perk = equippedPerkDef();
  roundPerkId = perk?.id ?? null;
  roundCareerStats = pro ? { ...pro.attrs } : null;
  return assembleGolfer(
    pro ? pro.name : profile.name || 'Player',
    character,
    archetype,
    profile.clubUpgrades,
    perk,
    roundCareerStats ?? undefined
  );
}

/** The perk the CURRENT round is being played with — recorded for the same
 *  reason the loadout is: a replay without it assembles a different golfer. */
let roundPerkId: string | null = null;

// `updateSeasonLink`/`updateStoreBanner` used to render #seasonBanner and
// #storeBanner here. Neither element has existed in the landing markup for some
// time, so both functions ran, found nothing and returned — dead code that read
// as live. The level and the unclaimed-reward count they were meant to surface
// now live on the progression strip and the Locker tile.

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
  // Everything currently claimable, for the one-tap Claim All next to Back.
  const claimableLevels = Array.from({ length: def.levels }, (_, i) => i + 1).filter(
    (level) => claimState(p, def, level) === 'claimable'
  );
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
    // A patterned ball previews as its pattern — the drop balls all carry a
    // white shell colour, so the flat tint would render them identically.
    if (item.ballArt) return `<div class="swatch" style="background:${ballArtSwatchCss(item.ballArt)}"></div>`;
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
  // Coin unlock is a LOCAL spend (no Stripe), so it's offered whenever sales are
  // open — even if the cash purchase isn't configured, and for guests. The cash
  // button is shown additionally when the Stripe product is configured.
  const canAffordCoins = p.coins >= def.priceCoins;
  const footer = ownsPass(p, def)
    ? `<div class="spOwned">🎫 Season Pass owned — rewards unlock as you play</div>`
    : !salesOpen(def, Date.now())
      ? `<div class="spNote">🔒 Season Pass purchases coming soon — every round already counts toward the track.</div>`
      : (purchaseConfigured('seasonpass_s1')
          ? `<button id="spBuy" class="spBuy">Get the Season Pass · $${def.priceUsd}</button>`
          : '') +
        `<button id="spCoinBuy" class="spBuy spCoinBuy${canAffordCoins ? '' : ' locked'}">Unlock with ${def.priceCoins} 🪙</button>` +
        (purchaseConfigured('seasonpass_s1') && !signedIn && authConfigured()
          ? `<div class="spNote">Buy with coins now, or sign in with Google to pay with $ and keep it on your account.</div>`
          : '');
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
    `<div class="btnRow">` +
    (claimableLevels.length
      ? `<button id="spClaimAll" class="spBuy">Claim All (${claimableLevels.length})</button>`
      : '') +
    `<button id="spBack">Back</button></div></div>`;
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
      refreshProgressSurfaces();
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
  // Coin unlock: spend def.priceCoins to own the pass (local — works for guests
  // and signed-in players; ownership syncs to the account on sign-in).
  const coinBuyBtn = document.getElementById('spCoinBuy');
  if (coinBuyBtn)
    onTap(coinBuyBtn, () => {
      const res = buyPassWithCoins(profile, def);
      if (!res.ok) {
        showMsg(res.reason ?? 'Purchase failed', 1800);
        return;
      }
      persistProfile();
      if (signedIn)
        void cloudSyncProfile(profile).then((r) => {
          applyCloudMerge(profile, r.profile);
          showCloudStatus(r.status, true);
        });
      showMsg(`🎫 Season Pass unlocked for ${def.priceCoins} 🪙!`, 2000);
      refreshProgressSurfaces();
      renderSeasonPass();
    });
  // Claim All: sweep every currently-claimable level in one tap, one persist,
  // one cloud sync. claimReward itself stays the single grant path (idempotent
  // — a level can never pay twice), so this is pure convenience.
  const claimAllBtn = document.getElementById('spClaimAll');
  if (claimAllBtn)
    onTap(claimAllBtn, () => {
      let claimed = 0;
      for (const level of claimableLevels) {
        if (claimReward(p, def, level).ok) claimed++;
      }
      if (!claimed) return;
      persistProfile();
      if (signedIn)
        void cloudSyncProfile(p).then((res) => {
          applyCloudMerge(p, res.profile);
          showCloudStatus(res.status, true);
        });
      refreshProgressSurfaces();
      showMsg(`🎫 Claimed ${claimed} reward${claimed > 1 ? 's' : ''}!`, 1600);
      renderSeasonPass();
    });
  // 'click' — see the #lkLock comment in renderLockerRoom.
  document.getElementById('spBack')!.addEventListener('click', () => {
    spPage = -1;
    seasonEl.style.display = 'none';
    goBack(() => {});
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
/** The boards live under a reserved tab id, so the course tabs stay a plain
 *  course-id lookup and nothing has to special-case a magic name. */
const BOARDS_TAB = '__boards';

async function renderRecords(): Promise<void> {
  recordsEl.style.display = 'flex';
  if (recCourseId !== BOARDS_TAB && (!recCourseId || !COURSES[recCourseId]))
    recCourseId = flag('recordBoards') ? BOARDS_TAB : courseIdByName(round.course.name);
  // THE BOARDS TAB (`recordBoards`) sits FIRST, because "who has hit it
  // furthest" is a more interesting question than "who shot low at Sable Bay",
  // and the per-course lists were the only thing here for a long time.
  const boardsTab = flag('recordBoards')
    ? `<button class="recTab${recCourseId === BOARDS_TAB ? ' sel' : ''}" data-course="${BOARDS_TAB}">🏅 Records</button>`
    : '';
  const tabs =
    boardsTab +
    COURSE_LIST.map(
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
    if (recCourseId === BOARDS_TAB) {
      // Top 5 per stat, with the viewer's own ranked row riding along (marked
      // and highlighted) even when they sit outside the top — "where am I" is
      // the question that brings a player back to a board.
      listEl.innerHTML = recordBoards(data, signedIn ? profile.id : null)
        .map((b) => {
          const rows = b.entries.length
            ? b.entries
                .map(
                  (e) =>
                    `<div class="recRow${e.you ? ' you' : ''}">` +
                    `<span class="recRk">${e.rank === 1 ? '🏆' : `${e.rank}.`}</span>` +
                    `<span class="recNm">${escapeHtml(e.name)}${e.you ? '<span class="youTag">YOU</span>' : ''}</span>` +
                    `<span class="recTot">${escapeHtml(e.label)}</span></div>`
                )
                .join('')
            : `<div class="recEmpty">Nobody yet — be first.</div>`;
          return `<div class="boardBlock"><div class="boardHead">${b.title}</div>` +
            `<div class="boardBlurb">${escapeHtml(b.blurb)}</div>${rows}</div>`;
        })
        .join('');
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









/** Weekly Featured entry armed by the landing card — the next startRound runs
 *  under the event's standardized seed and submits to its leaderboard. */
let pendingWeekly: WeeklyEvent | null = null;
/** Async challenge armed from a ?c= link — the next startRound replays the
 *  challenger's exact setup (course + shared seed). */
let pendingChallenge: AsyncChallengeDef | null = null;

/** Opt-in "Learn to play" onboarding coach (dev-only, `tutorial` flag). Owns its
 *  own overlay; the game just feeds it lifecycle events from beginTurn/
 *  executeShot/the hole-done callback. */
const tutorialCoach = new TutorialCoach();

/** Start the guided lesson: a solo round on Sable Bay #1 with coaching overlaid.
 *  A no-op unless the tutorial flag is on (the entry is hidden in prod anyway). */
function startTutorial(): void {
  if (!flag('tutorial')) return;
  endPractice();
  tutorialCoach.stop(); // discard any half-finished prior run
  sel.mode = 'solo';
  sel.courseId = 'sablebay';
  landingEl.classList.remove('on');
  analytics.track('tutorial_started', { course: 'sablebay' });
  // The lesson's difficulty is the one the round will actually lock in — so the
  // coach names the same thing the meter is drawing.
  tutorialCoach.start(() => undefined, flag('tutorialDepth'), playerDifficulty());
  startRound(0);
}

/**
 * The lesson hole is done. Mark it complete on this device (so the landing's
 * lesson hero steps aside — the lesson stays available, it just stops
 * competing with Play) and pay the one-time completion reward.
 *
 * Idempotent by construction: the payout is gated on the same device flag it
 * sets, so replaying the lesson never pays twice. Returns what was actually
 * granted so the closing card can name it, or undefined when nothing was.
 */
function completeTutorial(): { coins: number } | undefined {
  const first = !deviceSettings.tutorialDone;
  if (first) updateDeviceSettings({ tutorialDone: true });
  refreshLandingCards();
  analytics.track('tutorial_completed', { course: 'sablebay', result: first ? 'first' : 'replay' });
  if (!first || !flag('tutorialDepth')) return undefined;
  profile.coins += COINS.tutorial;
  profile.coinsEarned += COINS.tutorial;
  persistProfile();
  if (signedIn) {
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status, true);
    });
  }
  return { coins: COINS.tutorial };
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
  round.seed = (Math.random() * 0xffffffff) >>> 0;
  round.weeklyEventId = null;
  round.challenge = null;
  lockRoundDifficulty();
  shotAcc = freshShotAcc();
  beginRoundTracking();
  grantRoundTrueVision();
  // A tournament round is not the plain solo round the recorder covers.
  lastRecording = null;
  roundRecorder.stop();
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

// ----- TOUR SEASON (career round 2): the Pro's own-pace season — sixteen
// events against the ten named rivals, majors at 4/8/12/16, a PGA-style
// points table. State lives on the PROFILE (`profile.tours`) so a major's
// completed rounds survive closing the game; this flag only marks that the
// round currently in play belongs to the tour.

let tourRoundLive = false;

/**
 * THE ACTIVE SEASON.
 *
 * The profile used to hold exactly one season in `profile.tour`, and every
 * caller here read and assigned it directly. It now holds a keyed collection
 * (systems/TourSeason.ts, Stage 5), and these two functions are the only way
 * this file touches it — so the map, the active id and the archive can never
 * be left disagreeing by a caller that assigned one and forgot the others.
 */
function tourNow(): TourSeasonState | null {
  return activeTour(profile.tours);
}

/** Insert-or-replace the season and make it active; null drops the active one
 *  WITHOUT archiving it (for the paths that never had a season to close). */
function setTour(t: TourSeasonState | null): void {
  profile.tours = t ? putTour(profile.tours, t) : clearActiveTour(profile.tours);
}

/**
 * End a season properly: archive it with its full final standings, then roll
 * the next one out unless the Pro who played it has retired.
 *
 * This replaces three copies of `profile.tour = retired ? null : rollover(t)`.
 * Each of them destroyed the points table, all sixteen event results and the
 * whole shared-season block — which is why a finished co-op season's standings
 * could not be looked at afterwards.
 */
function closeOutSeason(t: TourSeasonState, ended: 'finale' | 'retired'): void {
  const pro = activePro(profile.career);
  profile.tours = archiveTour(profile.tours, t, {
    proId: pro?.id ?? '',
    proName: pro?.name ?? '',
    at: Date.now(),
    ended
  });
  if (ended !== 'retired') setTour(rolloverTourSeason(t, Math.floor(Math.random() * 1e9)));
}

// ----- SUDDEN DEATH (owner pass 8): a player tied for an event's lead plays
// extra holes against the tied rivals' BALLS AT REST — each rival's hole is
// simulated up front (raw physics, no tournament-form shift on one hole) and
// their shots appear parked where they finished, advancing with the player's
// stroke count: before your Nth stroke you see their Nth shot at rest.

const PLAYOFF_COURSE_ID = '__playoff';

interface TourPlayoffLive {
  rivals: Array<{
    id: string;
    name: string;
    /** The rival's finished hole: total strokes and whether they holed out. */
    strokes: number;
    holed: boolean;
    /** Every shot's resting place, in play order (penalties included in the
     *  running stroke count). */
    rests: Array<{ x: number; y: number; surface: Surface; strokes: number; holed: boolean }>;
  }>;
}

/** Set while a playoff HOLE is being played live; null otherwise. The
 *  pending-playoff state itself lives on profile.tour (reload-safe). */
let tourPlayoff: TourPlayoffLive | null = null;

/** The tour's course pool: the canonical Play Next rotation, availability-
 *  filtered (an id missing from COURSES — expansion flag off — drops out). */
function tourCourseIds(): string[] {
  return PLAY_NEXT_ROTATION.filter((id) => COURSES[id]);
}

/** What an event is called on every surface: the major's name, or the stop's
 *  course + "Open". */
function tourEventName(def: TourEventDef): string {
  return def.major ? (def.majorName ?? 'Major') : `${COURSES[def.courseId]?.name ?? def.courseId} Open`;
}

/** Enter the tour from the Today card: the career Pro's story, so a started
 *  career is required (the card deep-links to the Locker instead) and the Pro
 *  is force-selected for the round. Creates the season on first entry. */
function startTourEvent(): void {
  if (gpuBlocked()) return;
  if (!flag('careerMode') || !careerStarted(profile.career)) return;
  const pro = activePro(profile.career);
  if (pro && proRetired(profile.tourHistory, pro.id)) {
    showMsg(`🏛 ${pro.name} has retired after ${SEASON_LIMIT} seasons — start a new Pro to tour again`, 3400);
    lkTab = 'style';
    renderLockerRoom();
    return;
  }
  if (!tourNow()) {
    // nextSeasonNo, not the default 1: a player who has archived seasons (or
    // is running one alongside) must not be handed a duplicate number.
    setTour(newSeason(Math.floor(Math.random() * 1e9), nextSeasonNo(profile.tours)));
    persistProfile();
  }
  // The tour is played AS the Pro — entering selects the career style.
  if (sel.archetype !== 'career') {
    sel.archetype = 'career';
    syncLoadout();
  }
  // A tie waiting on sudden death resumes THERE, not into a fresh round —
  // the regulation rounds are banked and the event can only end via playoff.
  if (playoffPending(tourNow()!, tourCourseIds())) {
    startTourPlayoffHole();
    return;
  }
  startTourRound();
}

// ----- SHARED SEASONS (owner pass 9): two players, one schedule. The AI
// field is deterministic from the season seed, so only each human's per-event
// score travels — see firebase/CoopSeason.ts.

/** Who you are on a shared season's board: the Pro you tour as, since that is
 *  the name your friend sees on every leaderboard beside the rivals. */
function coopDisplayName(): string {
  return activePro(profile.career)?.name || profile.name || 'A golfer';
}

/** Turn the doc's players into the local partner cache (everyone but me). */
function coopPartnersFrom(doc: CoopSeasonDoc, myId: string): TourCoopPartner[] {
  return Object.values(doc.players ?? {})
    .filter((p) => p.playerId !== myId)
    .map((p) => {
      const posts = Object.values(p.results ?? {});
      return {
        playerId: p.playerId,
        name: p.name,
        results: Object.fromEntries(
          Object.entries(p.results ?? {}).map(([k, r]) => [Number(k), { total: r.total, toPar: r.toPar }])
        ),
        // Newest post — the clock coopSeasonSettled runs down on a partner
        // who walks away mid-season.
        ...(posts.length ? { updatedAt: Math.max(...posts.map((r) => r.at || 0)) } : {})
      };
    });
}

/** Pull the shared doc and re-settle the points table. Safe to call on any
 *  hub paint: bounded, failure-tolerant, and a no-op for a solo season. */
async function syncCoopSeason(repaint = false): Promise<void> {
  const t = tourNow();
  if (!t?.coop) return;
  const doc = await fetchCoopSeason(t.coop.id);
  if (!doc || tourNow() !== t) return;
  applyCoopSnapshot(t, coopPartnersFrom(doc, t.coop.playerId), tourCourseIds());
  settleFinishedCoopSeason(t);
  persistProfile();
  // Repaint whatever the player is actually looking at. A partner's score
  // changes the points table and can re-rank a finished event, so the schedule
  // and the event drill-down want the update as much as the hub does — but
  // drawing the hub over one of them is how this button came to look broken.
  // The records screen is per-Pro history, untouched by a partner's post.
  if (!repaint || document.getElementById('tourHub')?.style.display !== 'flex') return;
  if (tourView === 'hub') renderTourHub(true);
  else if (tourView === 'schedule') renderTourSchedule();
  else if (tourView === 'event') renderTourEventResult(tourEventView);
  // The picker and the archive read the collection, not the live season, so a
  // partner's result landing mid-view must not throw them back to the hub.
  else if (tourView === 'picker') renderSeasonPicker();
  else if (tourView === 'history') renderSeasonHistory();
}

/**
 * A shared season the player has FINISHED sits waiting for their friend (the
 * crown is not theirs until both are done). Every sync checks whether it can
 * be settled now — because they finished, or because they went quiet long
 * enough — and if so writes the final placing over the provisional one and
 * pays the champion reward it was holding back.
 */
function settleFinishedCoopSeason(t: TourSeasonState): void {
  const pro = activePro(profile.career);
  if (!pro || t.played < TOUR_EVENTS || !t.coop) return;
  if (!coopSeasonSettled(t, Date.now())) return;
  const fin = finishSeason(t);
  recordTourSeasonFinish(profile.tourHistory, pro.id, pro.name, t.seasonNo, fin.playerRank, t.points['player'] ?? 0);
  if (fin.playerRank === 1) {
    awardSeasonChampion(t);
    showMsg(`🏆 Season ${t.seasonNo} is yours — ${escapeHtml(pro.name)} takes the title.`, 3600);
  } else {
    showMsg(`Season ${t.seasonNo} settled: ${escapeHtml(fin.championName)} takes it.`, 3200);
  }
  // The season has done its job; the next one can roll now. It is ARCHIVED
  // first (Stage 5) — the points table, the sixteen event lines and the shared
  // season's partners all used to go in the bin at this exact line.
  closeOutSeason(t, proRetired(profile.tourHistory, pro.id) ? 'retired' : 'finale');
}

/** Start a shared season and hand the player a link to text. Uses the season
 *  already in progress when it is untouched, so "invite a friend" on a fresh
 *  season keeps its schedule. */
async function startCoopSeason(): Promise<void> {
  if (!careerStarted(profile.career)) return;
  const myId = challengePlayerId();
  const existing = tourNow();
  const seasonNo = existing?.seasonNo ?? 1;
  // A season with events already banked can't be shared retroactively — the
  // partner would be joining a race already run — so that case starts fresh.
  const base = existing && existing.played === 0 ? existing : newSeason(Math.floor(Math.random() * 1e9), seasonNo);
  const sid = makeCoopId();
  // Whoever starts the season chooses its difficulty, and it is theirs at the
  // moment of starting — so a later Settings change never retunes a season
  // already in flight for the friend who joined it.
  const diff = playerDifficulty();
  const doc: CoopSeasonDoc = {
    v: 1,
    sid,
    seed: base.seed,
    seasonNo: base.seasonNo,
    createdAt: Date.now(),
    players: { [myId]: { playerId: myId, name: coopDisplayName(), results: {} } },
    diff
  };
  const ok = await createCoopSeason(doc);
  if (!ok) {
    showMsg('Shared seasons need an online connection', 2600);
    return;
  }
  base.coop = { id: sid, playerId: myId, partners: [], diff };
  setTour(base);
  persistProfile();
  const url = coopUrl(sid, `${location.origin}${location.pathname}`);
  await shareOrCopy(`Play a golf season with me — same schedule, same rivals. Join: `, url);
  renderTourHub();
}

/** A ?coop= link: show who invited you and offer to join their season. */
async function receiveCoopInvite(raw: string): Promise<void> {
  const sid = parseCoopParam(raw);
  const el = document.getElementById('challengeBanner');
  if (!el) return;
  if (!sid) {
    el.innerHTML = `<span class="chLabel">SEASON</span><div class="chName">That season link isn't valid.</div>`;
    return;
  }
  const doc = await fetchCoopSeason(sid);
  if (!doc) {
    el.innerHTML = `<span class="chLabel">SEASON</span><div class="chName">That season couldn't be found.</div>`;
    return;
  }
  const myId = challengePlayerId();
  const host = Object.values(doc.players).find((p) => p.playerId !== myId);
  el.innerHTML =
    `<span class="chLabel">👥 SHARED SEASON</span>` +
    `<div class="chName">${escapeHtml(host?.name ?? 'A friend')} invited you to Season ${doc.seasonNo} — ` +
    `same schedule, same rivals, play at your own pace.` +
    // Say it up front: the host's difficulty is the season's, so a joiner is
    // never surprised by a meter that does not match their own setting.
    (doc.diff ? ` Played at <b>${difficultyProfile(doc.diff).label}</b> — the host's difficulty.` : '') +
    `</div>` +
    `<button id="coopJoin" class="chPlay">Join the season</button>`;
  document.getElementById('coopJoin')!.addEventListener('pointerdown', () => {
    void (async () => {
      el.innerHTML = '';
      if (!careerStarted(profile.career)) {
        showMsg('Start a career Pro first — the tour is their story', 3000);
        lkTab = 'style';
        renderLockerRoom();
        return;
      }
      await joinCoopSeason(sid, myId, coopDisplayName());
      const fresh = (await fetchCoopSeason(sid)) ?? doc;
      const season = newSeason(fresh.seed, fresh.seasonNo);
      // The host's difficulty comes along with the schedule and the seed: from
      // here on every event in THIS season is played at it, whatever the joiner
      // has set for their own rounds.
      season.coop = {
        id: sid,
        playerId: myId,
        partners: coopPartnersFrom(fresh, myId),
        ...(fresh.diff ? { diff: fresh.diff } : {})
      };
      // An INSERT, not an overwrite: joining a friend's season used to assign
      // straight over profile.tour and silently discard the season the player
      // already had going (Stage 5).
      setTour(season);
      persistProfile();
      renderTourHub();
    })();
  });
}

/** Post a finished event to the shared doc, then re-settle both sides. */
function publishCoopResult(t: TourSeasonState, res: TourEventResult): void {
  if (!t.coop || res.total === undefined) return;
  void postCoopResult(t.coop.id, t.coop.playerId, res.idx, {
    total: res.total,
    toPar: res.toPar,
    at: Date.now()
  }).then(() => syncCoopSeason());
}

/** Play the current event's next round as a normal solo round — the aiTour
 *  precedent: round.mode stays 'solo', the summary spots the live tour round
 *  and swaps its footer for standings + the event's next step. */
function startTourRound(): void {
  const t = tourNow();
  const def = t ? currentEvent(t, tourCourseIds()) : null;
  if (!t || !def) return;
  round.course = courseFallback(def.courseId);
  round.mode = 'solo';
  round.holeIdx = 0;
  round.activePlayer = 0;
  round.holeWinds = [];
  round.holePins = [];
  round.seed = (Math.random() * 0xffffffff) >>> 0;
  // A MAJOR escalates per round — forward tees/kind pins, the authored card,
  // then back tees/tucked pins (owner pass 8). The course is materialized for
  // the round about to be played, and the pins are prefilled from it so the
  // lazy seeded draw (pinForSeed) never overrides the championship setup. The
  // FIELD is handed the identical materialized course in completeTourRound —
  // majorCourseForRound is pure in (course, roundNo), so they cannot drift.
  if (def.major) {
    round.course = majorCourseForRound(round.course, eventRoundsPlayed(t));
    round.holePins = round.course.holes.map((h) => ({ ...h.pin }));
  }
  round.weeklyEventId = null;
  round.challenge = null;
  aiTour = null;
  tourRoundLive = true;
  tourPlayoff = null;
  lockRoundDifficulty();
  // Tour rounds enter from the HUB, not startRound's wizard path — so the
  // round-state resets startRound performs must happen HERE too or the last
  // mode's state leaks in: an ease-in device's gentle pins softening a tour
  // cup, an armed ghost/daily/practice session riding into the event.
  roundGentlePins = false;
  activeGhost = null;
  pendingGhost = null;
  dailyRound = null;
  endPractice();
  shotAcc = freshShotAcc();
  beginRoundTracking();
  grantRoundTrueVision();
  // A tour round is not the plain solo round the recorder covers.
  lastRecording = null;
  roundRecorder.stop();
  const golfer = roundGolfer();
  round.players = [{ golfer, isAI: false, scores: [] }];
  // The tour is entered from the HUB over the landing — not from the wizard
  // like the AI tournament — so the landing must come down too, or the round
  // builds underneath it and "Play event" appears to bounce back to the menu
  // (owner report, verbatim). The wizard/setup path is a no-op here.
  landingEl.classList.remove('on');
  closeDest();
  setupEl.style.display = 'none';
  playHole();
}

/**
 * One sudden-death hole (owner pass 8): a 1-hole course cut from the event's
 * venue — the hole rotates with each extra hole played — under a
 * deterministic playoff seed, injected under a reserved id exactly like the
 * Hole of the Day. The tied rivals' holes are simulated up front (RAW
 * simulateHole — the tournament-form shift is a per-round correction and has
 * no business on a single hole) with every shot's rest captured; the scene
 * parks their balls and advances them with the player's stroke count.
 */
function startTourPlayoffHole(): void {
  const t = tourNow();
  const ids = tourCourseIds();
  const pending = t ? playoffPending(t, ids) : null;
  if (!t || !pending) return;
  const def = pending.def;
  const src = COURSES[def.courseId];
  if (!src) return;
  const holeNo = (def.idx + pending.holesPlayed) % src.holes.length;
  const base = src.holes[holeNo];
  // Deterministic per (season, event, playoff hole) — reloading mid-playoff
  // rebuilds the identical hole, wind, pin, and rival scores. Distinct salt
  // from every other seed stream in the game.
  const seed = (((t.seed ^ 0x5bf03635) >>> 0) + def.idx * 15013 + pending.holesPlayed * 7919) >>> 0;
  const theme = resolveTheme(src);
  const wind = drawWind(mulberry32(seed * 1000), src.minWind ?? 2, src.maxWind ?? PHYSICS.maxWind);
  const pin = pinForSeed(seed, 0, base, {
    useAuthoredPins: flag('layouts'),
    bunkerDepthScale: theme.bunkerDepthScale ?? 1,
    wasteDepthScale: theme.wasteDepthScale ?? 0
  });
  // ONE materialized hole both sides play: the pin baked in, tee/pin variants
  // stripped so no seeded draw can move the setup between the field's sim and
  // the player's live round.
  const { tees: _tees, pins: _pins, ...bare } = base;
  const hole: HoleData = { ...bare, pin: { ...pin } };
  const poCourse: CourseData = { ...src, name: `${src.name} — Playoff`, holes: [hole] };
  COURSES[PLAYOFF_COURSE_ID] = poCourse;
  const treeSpecies: TreeSpecies = {
    trees: theme.treeKeys ?? DEFAULT_TREE_MIX,
    accents: theme.accentTreeKeys ?? []
  };
  const rivals: TourPlayoffLive['rivals'] = pending.tiedRivalIds.map((id, i) => {
    const rival = TOUR_RIVALS.find((x) => x.id === id);
    const golfer: Golfer = rival ?? TOUR_RIVALS[0];
    const rests: TourPlayoffLive['rivals'][number]['rests'] = [];
    const res = simulateHole(hole, golfer, {
      rng: mulberry32((seed + 7013 + i * 104729) >>> 0),
      wind,
      bunkerDepthScale: theme.bunkerDepthScale ?? 1,
      wasteDepthScale: theme.wasteDepthScale ?? 0,
      edgeWobble: theme.edgeWobble ?? 1,
      treeSpecies,
      onShot: (s) =>
        rests.push({ x: s.finalPos.x, y: s.finalPos.y, surface: s.surface, strokes: s.strokes, holed: s.holed })
    });
    return { id, name: rival?.name ?? id, strokes: res.strokes, holed: res.holed, rests };
  });
  tourPlayoff = { rivals };
  round.course = poCourse;
  round.mode = 'solo';
  round.holeIdx = 0;
  round.activePlayer = 0;
  // Prefilled so the lazy per-hole draws can never disagree with the field's
  // simulated conditions.
  round.holeWinds = [{ ...wind }];
  round.holePins = [{ ...pin }];
  round.seed = seed;
  round.weeklyEventId = null;
  round.challenge = null;
  aiTour = null;
  tourRoundLive = false; // not a scored tour ROUND — the event pays at resolution
  lockRoundDifficulty();
  roundGentlePins = false;
  activeGhost = null;
  pendingGhost = null;
  dailyRound = null;
  endPractice();
  shotAcc = freshShotAcc();
  // Sudden death is one extra hole, not a round: nothing is recorded, no
  // round tracking/rewards run — showSummary routes to the playoff card.
  lastRecording = null;
  roundRecorder.stop();
  grantRoundTrueVision();
  const golfer = roundGolfer();
  round.players = [{ golfer, isAI: false, scores: [] }];
  landingEl.classList.remove('on');
  closeDest();
  setupEl.style.display = 'none';
  playHole();
  const names = rivals.map((r) => r.name).join(' & ');
  showMsg(`⚔ Sudden death, hole ${pending.holesPlayed + 1} — beat ${names} outright`, 3200);
}
function tourSeasonTableHtml(): string {
  const t = tourNow();
  if (!t) return '';
  // HOT STREAKS, MADE VISIBLE (owner: "give some ais random hot streaks where
  // they play higher than their level (+5) for a few weeks"). A streak that
  // only shows up as a rival mysteriously running away with an event reads as
  // the field being unfair; badged, it reads as form. `hotStreakAt` is pure and
  // derived from (seed, rival id, event index), so this costs a hash — no
  // stored state, no extra simulation.
  const eventIdx = Math.min(t.played, TOUR_EVENTS - 1);
  const rows = coopSeasonStandings(t)
    .map((r, i) => {
      const rank = i === 0 ? '🏆' : `${i + 1}.`;
      const hot = !r.isPlayer && hotStreakAt(t.seed, r.id, eventIdx);
      return (
        `<div class="recRow${r.isPlayer ? ' you' : ''}"><span class="recRk">${rank}</span>` +
        `<span class="recNm">${escapeHtml(r.name)}${hot ? ' <span class="hotForm" title="In hot form">🔥</span>' : ''}</span>` +
        `<span class="recTot">${r.total} pts</span></div>`
      );
    })
    .join('');
  return (
    `<div class="tourResult"><div class="tourHeadRow">🏅 Season ${t.seasonNo} points — after ${Math.min(t.played, TOUR_EVENTS)}/${TOUR_EVENTS} events</div>` +
    rows +
    `</div>`
  );
}

/** An entrant's display name on tour surfaces ('player' is always You). */
function tourEntrantName(id: string): string {
  return id === 'player' ? 'You' : (TOUR_RIVALS.find((r) => r.id === id)?.name ?? id);
}

/** Event standings as board rows (shared by the round summary, the playoff
 *  card, and the tied-at-the-top card). */
function tourStandingRowsHtml(standings: TourRoundOutcome['standings']): string {
  // A DNP row holds no rank, so the numbering counts only the scored rows above
  // it — otherwise a partner who has not teed off yet would read as "11th".
  let placed = 0;
  return standings
    .map((r) => {
      if (r.dnp) {
        return (
          `<div class="recRow dnp"><span class="recRk">–</span>` +
          `<span class="recNm">${escapeHtml(r.name)}</span>` +
          `<span class="recTot">DNP</span></div>`
        );
      }
      const sign = r.toPar === 0 ? 'E' : r.toPar > 0 ? `+${r.toPar}` : `${r.toPar}`;
      const rank = placed === 0 ? '🏆' : `${placed + 1}.`;
      placed++;
      return (
        `<div class="recRow${r.isPlayer ? ' you' : ''}"><span class="recRk">${rank}</span>` +
        `<span class="recNm">${escapeHtml(r.name)}</span>` +
        `<span class="recTot">${r.total} (${sign})</span></div>`
      );
    })
    .join('');
}

/** An event board with the shared-season partners folded in — their score if
 *  they have posted this event, a DNP row if they have not. The scored array
 *  itself is left untouched; see `eventBoardRows`. */
function tourEventBoardHtml(standings: TourRoundOutcome['standings'], eventIdx: number): string {
  const t = tourNow();
  return tourStandingRowsHtml(t ? eventBoardRows(standings, t, eventIdx) : standings);
}

/**
 * A FINISHED tour event's summary pieces — headline, standings block, reward
 * lines, and the primary action — plus the profile mutations the finish pays
 * (win CP, season purse/rollover, achievements). One implementation because
 * an event now ends on two different cards: the normal round summary and the
 * playoff card, and the payout drifting between them would be a real bug.
 */
function tourEventOutcomeUi(
  t: NonNullable<PlayerProfile['tour']>,
  def: TourEventDef,
  outcome: TourRoundOutcome,
  ids: string[]
): { headline: string; block: string; cpLine: string; primary: string } {
  const evName = tourEventName(def);
  const evRows = tourEventBoardHtml(outcome.standings, def.idx);
  const won = outcome.playerRank === 1;
  const myPts = outcome.pointsAwarded?.['player'] ?? 0;
  // The Pro this result belongs to in the record book (the tour force-selects
  // the active Pro on entry, so this is who just played).
  const recordPro = activePro(profile.career);
  let headline: string;
  let cpLine = '';
  if (won) {
    headline = def.major ? `🏆 ${evName} — champion!` : `🏆 ${evName} — won!`;
    // A tour win is a tournament win: the stat counts it and the career
    // pays it (majors double — they're the season's spine).
    profile.stats.tournamentWins += 1;
    const winCp = CP.tournamentWin * (def.major ? 2 : 1);
    grantCareerCp(profile, winCp, recordPro?.id);
    cpLine = `<div class="rwLine ach">🏅 ${def.major ? 'Major champion' : 'Event won'}: +${winCp} CP</div>`;
    if (recordPro) recordTourEventWin(profile.tourHistory, recordPro.id, recordPro.name, def.majorName);
  } else {
    headline = `${evName}: ${ordinal(outcome.playerRank ?? outcome.standings.length)} place`;
  }
  cpLine += `<div class="rwLine level">🏅 +${myPts} season points${def.major ? ' (major — double)' : ''}</div>`;
  let block = `<div class="tourResult"><div class="tourHeadRow">⛳ ${escapeHtml(evName)}${def.major ? ' · MAJOR' : ''} — final</div>${evRows}</div>`;
  if (outcome.seasonEnded) {
    // The season is over: crown, purse, roll into the next one. The
    // rivals persist; the schedule and points start fresh.
    const fin = finishSeason(t);
    // SHARED SEASON: the title is not yours to claim until your friend has
    // finished too — you have out-scored the AI field, not them (owner:
    // settle when they finish). The purse below is still paid now and never
    // clawed back; only the crown waits.
    const settled = coopSeasonSettled(t, Date.now());
    if (recordPro) {
      recordTourSeasonFinish(
        profile.tourHistory,
        recordPro.id,
        recordPro.name,
        t.seasonNo,
        fin.playerRank,
        t.points['player'] ?? 0,
        undefined,
        !settled
      );
    }
    profile.coins += fin.coins;
    profile.coinsEarned += fin.coins;
    grantCareerCp(profile, fin.cp, recordPro?.id);
    cpLine += `<div class="rwLine ach">💰 Season purse: +${fin.coins} 🪙 · +${fin.cp} CP (${ordinal(fin.playerRank)} in points)</div>`;
    if (fin.playerRank === 1 && settled) {
      awardSeasonChampion(t);
      cpLine += `<div class="rwLine ach">🏅 Season Champion</div>`;
    } else if (fin.playerRank === 1) {
      const waiting = t.coop?.partners.map((p) => `${p.name} (${Object.keys(p.results).length}/${TOUR_EVENTS})`).join(', ');
      cpLine +=
        `<div class="rwLine level">🏅 Leading the season — not final until ` +
        `${escapeHtml(waiting || 'your friend')} finishes.</div>`;
    } else {
      const champName = escapeHtml(fin.championName);
      cpLine += `<div class="rwLine level">👑 ${champName} takes the Season ${t.seasonNo} title</div>`;
    }
    block += tourSeasonTableHtml();
    // TEN SEASONS AND THE CAREER IS OVER (owner pass 9). The Pro retires to
    // the Hall of Fame — no eleventh season rolls out under them; the player
    // starts a new Pro, and this one's record book page stands as their
    // career. Their look and stats stay playable in casual rounds.
    if (recordPro && proRetired(profile.tourHistory, recordPro.id)) {
      closeOutSeason(t, 'retired');
      cpLine +=
        `<div class="rwLine ach">🏛 ${escapeHtml(recordPro.name)} retires to the Hall of Fame — ` +
        `${SEASON_LIMIT} seasons, ${profile.tourHistory[recordPro.id]?.wins ?? 0} wins, ` +
        `${profile.tourHistory[recordPro.id]?.majorWins ?? 0} majors. Start a new Pro to tour again.</div>`;
    } else if (settled) {
      closeOutSeason(t, 'finale');
    }
    // …and when it ISN'T settled the season stays put: `played` is already 16
    // so there is nothing left to play, the hub says who it is waiting on, and
    // its button rolls the next season whenever the player wants it.
  } else {
    block += tourSeasonTableHtml();
  }
  // After an event, back to the TOUR PAGE (owner pass 8): the hub is where
  // the result just landed — standings moved, the schedule row filled in —
  // and its play-next button sits right on top. The season finale returns
  // there too, showing the fresh season. (Mid-major rounds keep their direct
  // "Round N of 3" button — that's not this path.)
  // SHARED SEASON: post this event and re-settle the table. Your partner's
  // points move the moment they post theirs, and yours move again with them.
  const justPlayed = t.results[t.results.length - 1];
  if (t.coop && justPlayed) {
    t.points = recomputeSeasonPoints(t, ids, TOUR_RIVALS);
    publishCoopResult(t, justPlayed);
  }
  const primary = `<button id="tourHubBtn">Tour Season →</button>`;
  return { headline, block, cpLine, primary };
}

/** Pay the season-champion rewards. Extracted because a SHARED season can
 *  crown you late — when your friend finally finishes — and the reward has to
 *  be identical whether it lands at the finale or a week later. */
function awardSeasonChampion(t: TourSeasonState): void {
  profile.stats.seasonChampionships += 1;
  if (!profile.achievements.includes('season_champion')) {
    profile.achievements.push('season_champion');
    const champ = featById('season_champion');
    if (champ) {
      grantCareerCp(profile, champ.cp);
      profile.coins += champ.coins;
      profile.coinsEarned += champ.coins;
    }
  }
  showCineBanner('SEASON CHAMPION', `Season ${t.seasonNo} · ${t.points['player'] ?? 0} points`, 'epic', 5200);
}

/** Leave a summary card for the Tour hub — the landing behind it, the hub on
 *  top (the same stack the gold tile builds). */
function returnToTourHub(): void {
  summaryEl.style.display = 'none';
  showLanding();
  renderTourHub();
}

/**
 * The card after a sudden-death hole. Deliberately NOT showSummary: a playoff
 * hole earns no records, coins, CP, streaks, or recordings — the EVENT pays
 * when the tie resolves — so none of the round machinery runs. Either the
 * playoff continues (next hole) or the event finalizes here with the same
 * payout code the normal summary uses.
 */
function renderPlayoffSummary(): void {
  const po = tourPlayoff;
  tourPlayoff = null;
  current?.dispose();
  current = null;
  roundRecorder.stop();
  swingBtn.style.display = 'none';
  hudEl.style.display = 'none';
  pauseBtn.style.display = 'none';
  promptEl.textContent = '';
  aimReadoutEl.style.display = 'none';
  const t = tourNow();
  const ids = tourCourseIds();
  const def = t ? currentEvent(t, ids) : null;
  const playerStrokes = round.players[0]?.scores[0] ?? 0;
  const rivalStrokes: Record<string, number> = {};
  for (const r of po?.rivals ?? []) rivalStrokes[r.id] = r.strokes;
  const outcome = t && def && po ? completeTourPlayoffHole(t, ids, playerStrokes, rivalStrokes) : null;
  const holePar = round.course.holes[0]?.par ?? 4;
  const holeRows =
    `<div class="tourResult"><div class="tourHeadRow">⚔ Sudden death — par ${holePar}</div>` +
    `<div class="recRow you"><span class="recRk">•</span><span class="recNm">You</span><span class="recTot">${playerStrokes}</span></div>` +
    (po?.rivals ?? [])
      .map(
        (r) =>
          `<div class="recRow"><span class="recRk">•</span><span class="recNm">${escapeHtml(r.name)}</span><span class="recTot">${r.strokes}</span></div>`
      )
      .join('') +
    `</div>`;
  let headline = 'Sudden death';
  let block = holeRows;
  let cpLine = '';
  let primary = '';
  if (t && def && outcome) {
    if (!outcome.eventDone) {
      const names = (outcome.playoff?.tiedRivalIds ?? []).map(tourEntrantName).join(' & ');
      headline = 'Still tied — sudden death continues';
      block += `<div class="rwLine level">⚔ ${escapeHtml(names)} matched you. Next hole settles it — and after hole ${MAX_PLAYOFF_HOLES} the trophy is yours.</div>`;
      primary = `<button id="tourPlayoffBtn">Next playoff hole →</button>`;
    } else {
      const ui = tourEventOutcomeUi(t, def, outcome, ids);
      headline =
        outcome.playoffWinnerId === 'player'
          ? `🏆 ${tourEventName(def)} — playoff won!`
          : `${tourEventName(def)} — ${escapeHtml(tourEntrantName(outcome.playoffWinnerId ?? ''))} takes the playoff`;
      block += ui.block;
      cpLine = ui.cpLine;
      primary = ui.primary;
    }
    persistProfile();
    if (signedIn)
      void cloudSyncProfile(profile).then((res) => {
        applyCloudMerge(profile, res.profile);
        showCloudStatus(res.status, true);
      });
  }
  summaryEl.innerHTML =
    `<h2>${headline}</h2>` +
    cpLine +
    block +
    (primary ? `<div class="primaryRow">${primary}</div>` : '') +
    `<button id="againBtn" class="ghostBtn summaryMenu">☰ Menu</button>`;
  summaryEl.style.display = 'block';
  replayAnim(summaryEl, 'fadeIn');
  summaryEl.classList.add('cascade');
  document.getElementById('tourPlayoffBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    summaryEl.style.display = 'none';
    startTourPlayoffHole();
  });
  document.getElementById('tourHubBtn')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    returnToTourHub();
  });
  const resolved = !!outcome?.eventDone;
  document.getElementById('againBtn')!.addEventListener('pointerdown', () => {
    summaryEl.style.display = 'none';
    // A resolved event's Menu lands on the tour page (same as the primary);
    // an unresolved tie leaves through the ordinary menu — the pending
    // playoff survives on the profile and the hub offers it back.
    if (resolved) returnToTourHub();
    else showSetup();
  });
}

/**
 * QUIT THE SEASON (owner pass 9b: "you should be able to quit a season and
 * start a new one whenever you want. the partial season counts for the
 * golfer"). Destructive, so it asks first — and the question states the whole
 * price: the placement that goes on the record, the career slot it spends,
 * and the purse it forfeits.
 */
function confirmQuitSeason(): void {
  const t = tourNow();
  const pro = activePro(profile.career);
  if (!t || !pro) return;
  const started = t.played > 0;
  const complete = t.played >= TOUR_EVENTS;
  const table = coopSeasonStandings(t);
  const rank = table.findIndex((r) => r.isPlayer) + 1;
  const pts = t.points['player'] ?? 0;
  const partner = t.coop?.partners[0]?.name;
  // A COMPLETE shared season waiting on the friend is a different question:
  // nothing is forfeited (the purse was paid at the finale) and no extra
  // season is spent — moving on just freezes the title where it stands.
  const ask = complete
    ? `Season ${t.seasonNo} finishes as it stands — ` +
      (rank === 1
        ? `the title is yours.`
        : `${escapeHtml(table[0].name)} takes it.`) +
      ` Your purse is already banked. Start Season ${t.seasonNo + 1} now?`
    : started
    ? `Season ${t.seasonNo} goes into ${escapeHtml(pro.name)}'s record as ` +
      `${ordinal(rank || table.length)} with ${pts} points after ${t.played} of ${TOUR_EVENTS} events. ` +
      `It counts as one of their ${SEASON_LIMIT} seasons, and the season purse is forfeited.`
    : `This season hasn't started, so you'll just get a new schedule. ` +
      `It won't count against ${escapeHtml(pro.name)}'s ${SEASON_LIMIT}.`;
  const coopNote =
    started && !complete && partner
      ? ` <br>${escapeHtml(partner)} keeps the events you've already posted — you just stop appearing in new ones.`
      : '';
  const modal = document.createElement('div');
  modal.className = 'storeConfirm';
  // The tour hub is an overlay; .storeConfirm's own z-index only works inside
  // the store's stacking context, so lift it (the reset-records precedent).
  modal.style.zIndex = '30';
  const close = (): void => modal.remove();
  modal.innerHTML =
    `<div class="storeConfirmBox"><div class="scTitle">${
      complete ? 'Start the next season?' : started ? 'End this season?' : 'New schedule?'
    }</div>` +
    `<div class="scAsk">${ask}${coopNote}</div>` +
    `<div class="btnRow"><button id="quitSeasonYes" class="${complete ? 'ghostBtn' : 'dangerBtn'}">${
      complete ? 'Start it' : started ? 'Yes, end it' : 'Yes, reroll'
    }</button>` +
    `<button id="quitSeasonNo" class="ghostBtn">Cancel</button></div></div>`;
  // Tapping the dimmed backdrop cancels; `click` so a drag that merely starts
  // there doesn't dismiss it.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.body.appendChild(modal);
  // The tap that OPENED this must not also confirm it if the finger lands
  // where "Yes" renders — same arming window as confirmResetRecords.
  const armedAt = Date.now();
  const ARM_MS = 350;
  modal.querySelector<HTMLButtonElement>('#quitSeasonNo')!.addEventListener('click', close);
  modal.querySelector<HTMLButtonElement>('#quitSeasonYes')!.addEventListener('click', () => {
    if (Date.now() - armedAt < ARM_MS) return;
    close();
    applyQuitSeason();
  });
}

/** Apply the quit: record the partial season, replace the season (or retire
 *  the Pro if that was their tenth), and drop the round-scoped tour state the
 *  same way startRound does. */
function applyQuitSeason(): void {
  const t = tourNow();
  const pro = activePro(profile.career);
  if (!t || !pro) return;
  // Moving on from a COMPLETE shared season freezes the title where it
  // stands, so a player who is leading takes it rather than losing it by
  // declining to wait. (The season is replaced below, so the deferred
  // settle can never pay this a second time.)
  const freezing = t.played >= TOUR_EVENTS && !!t.coop;
  const champOnFreeze = freezing && coopSeasonStandings(t).findIndex((r) => r.isPlayer) === 0;
  const out = quitSeason(t, profile.tourHistory, pro.id, pro.name, Math.floor(Math.random() * 1e9));
  // Quitting is still a season that happened: it is archived with whatever
  // standings it had reached, not erased.
  profile.tours = archiveTour(profile.tours, t, { proId: pro.id, proName: pro.name, at: Date.now(), ended: 'quit' });
  if (out.next) profile.tours = putTour(profile.tours, out.next);
  if (champOnFreeze) awardSeasonChampion(t);
  // A season in progress can own a live round, a live playoff hole, and an
  // AI-tournament left over from another mode — none of them survive it.
  aiTour = null;
  tourRoundLive = false;
  tourPlayoff = null;
  persistProfile();
  if (signedIn)
    void cloudSyncProfile(profile).then((res) => {
      applyCloudMerge(profile, res.profile);
      showCloudStatus(res.status, true);
    });
  if (out.retired) {
    showMsg(
      `🏛 ${pro.name} retires to the Hall of Fame after ${SEASON_LIMIT} seasons — start a new Pro to tour again`,
      3600
    );
  } else if (out.recorded) {
    showMsg(`Season ${out.recorded.seasonNo} closed — ${ordinal(out.recorded.rank)} in points. A fresh season is up.`, 3000);
  } else {
    showMsg('New schedule drawn.', 2000);
  }
  renderTourHub();
  refreshProgressSurfaces();
}

/**
 * Which screen the `#tourHub` overlay is currently showing.
 *
 * Four screens share that one element, and a shared season repaints it from the
 * background whenever a partner's score arrives. Without knowing which one is
 * up, that repaint always drew the HUB — so in a co-op season, opening
 * "Schedule & standings" painted the schedule and the in-flight sync replaced it
 * with the hub a moment later. From the player's side the button simply did
 * nothing (owner: "the schedule and standings button doesn't work in a
 * multiplayer season"). Solo seasons never saw it because `syncCoopSeason`
 * returns immediately when there is no partner.
 */
type TourView = 'hub' | 'schedule' | 'event' | 'records' | 'picker' | 'history' | 'past';
let tourView: TourView = 'hub';
/** The event the drill-down is showing, so a background sync can repaint it. */
let tourEventView = 0;

/**
 * THE TOUR HUB (owner: "when you click into the tour season you should be
 * able to go to all past results, standings, schedule and play next event").
 * The gold tile opens this; playing the next event is the button on top,
 * the season points table and the full schedule — past finishes included —
 * read beneath it.
 */
function renderTourHub(fromSync = false): void {
  const el = document.getElementById('tourHub');
  if (!el) return;
  el.style.display = 'flex';
  tourView = 'hub';
  // Belt and braces: the tile routes a career-less player to the Locker, but
  // the hub can still be reached with a career that a merge later lost.
  if (!flag('careerMode') || !careerStarted(profile.career)) {
    el.innerHTML =
      `<div class="recInner"><h2>⛳ Tour Season</h2>` +
      `<div class="recSub">Sixteen events, four majors, ten rivals — your Pro's season. Start a career to join the tour.</div>` +
      `<button id="thLocker" class="tourAction">Open the Locker</button>` +
      `<button id="thBack" class="ghostBtn">Back</button></div>`;
    el.querySelector('#thBack')?.addEventListener('click', () => {
      el.style.display = 'none';
    });
    el.querySelector('#thLocker')?.addEventListener('click', () => {
      el.style.display = 'none';
      pushReturn(() => renderTourHub());
      lkTab = 'style';
      renderLockerRoom();
    });
    return;
  }
  // First visit: the season is born HERE, so the schedule has a seed to show.
  if (!tourNow()) {
    // nextSeasonNo, not the default 1: a player who has archived seasons (or
    // is running one alongside) must not be handed a duplicate number.
    setTour(newSeason(Math.floor(Math.random() * 1e9), nextSeasonNo(profile.tours)));
    persistProfile();
  }
  const t = tourNow()!;
  const ids = tourCourseIds();
  const def = currentEvent(t, ids);
  const roundsIn = eventRoundsPlayed(t);
  const table = seasonStandings(t);
  const myRank = table.findIndex((r) => r.isPlayer) + 1;
  const myPts = t.points['player'] ?? 0;
  const status = Object.keys(t.points).length
    ? `${t.played}/${TOUR_EVENTS} events played · you're ${ordinal(myRank)} in points (${myPts} pts)`
    : `Season ${t.seasonNo} tees off — the field is waiting.`;
  const hubPro = activePro(profile.career);
  const hubRetired = !!hubPro && proRetired(profile.tourHistory, hubPro.id);
  const cpToSpend = spendableCp(profile);
  const activeKey = profile.tours.activeId;
  const otherSeasons = Object.entries(profile.tours.seasons).filter(([k]) => k !== activeKey);
  // A finished shared season that is waiting on the friend: nothing left to
  // play, and the title is not final yet.
  const awaiting = t.played >= TOUR_EVENTS && !!t.coop && !coopSeasonSettled(t, Date.now());
  const poPending = playoffPending(t, ids);
  const playLabel = hubRetired
    ? ''
    : def
    ? poPending
      ? `⚔ ${tourEventName(def)} — playoff! Settle the tie →`
      : roundsIn > 0
        ? `⛳ ${tourEventName(def)} — round ${roundsIn + 1} of ${def.rounds} →`
        : `⛳ Play Event ${def.idx + 1}/${TOUR_EVENTS} · ${tourEventName(def)} →`
    : '';
  el.innerHTML =
    `<div class="recInner"><h2>⛳ Tour Season ${t.seasonNo}</h2>` +
    `<div class="recSub">${status}</div>` +
    (playLabel ? `<button id="thPlay" class="tourAction">${escapeHtml(playLabel)}</button>` : '') +
    (hubRetired
      ? `<div class="recSub">🏛 ${escapeHtml(hubPro!.name)} retired after ${SEASON_LIMIT} seasons — ` +
        `their career is in the records. Start a new Pro in the Locker to tour again.</div>`
      : '') +
    (awaiting
      ? `<div class="recSub">🏁 Season complete — waiting on ` +
        escapeHtml(
          t.coop!.partners
            .map((p) => `${p.name} (${Object.keys(p.results).length} of ${TOUR_EVENTS})`)
            .join(', ') || 'your friend'
        ) +
        `. The table below is provisional; start the next season whenever you like.</div>`
      : '') +
    coopHubHtml(t) +
    // THE CAREER LANDING (owner: "there should be a career landing, button to
    // look at schedule, play the next event, see career records, improve your
    // player, whatever else makes sense"). This screen used to be one long
    // scroll — status, play, the points table, all sixteen schedule rows, then
    // the actions — so the two things a player opens it to DO (tee off, spend
    // CP) sat above and below a wall of reference material. The reference moves
    // to its own screen; what stays here is the season in one line and the
    // things you can act on.
    `<div class="tourHeadRow">Your career</div>` +
    `<div class="careerNav">` +
    `<button id="thSched" class="careerNavBtn"><span class="cnIcon">📋</span>` +
    `<span class="cnName">Schedule &amp; standings</span>` +
    `<span class="cnSub">${t.played}/${TOUR_EVENTS} played${myRank ? ` · ${ordinal(myRank)} in points` : ''}</span></button>` +
    // "From tour season there should be a button to take you directly to the
    // screen to spend your cp." The subtitle carries the balance, so the answer
    // to "have I got anything to spend?" is on the button itself.
    (hubPro
      ? `<button id="thTrain" class="careerNavBtn${cpToSpend > 0 ? ' hot' : ''}"><span class="cnIcon">💪</span>` +
        `<span class="cnName">Improve your Pro</span>` +
        // THE SAME OVR THE LOCKER CARD SHOWS. `careerOvr(hubPro.attrs)` is the
        // BASE rating, and the Locker renders `ovr(applyClubUpgrades(...))` —
        // so one Pro read 97 here and 100 there, and the player had no way to
        // know which one a feat was grading (it was this one, and that is what
        // made "The Zenith" unwinnable; see Feats.bestProOvrEffective).
        `<span class="cnSub">${escapeHtml(hubPro.name)} · ${ovr(
          applyClubUpgrades(hubPro.attrs, profile.clubUpgrades)
        )} OVR · ${
          cpToSpend > 0 ? `${cpToSpend} CP to spend` : 'no CP banked'
        }</span></button>`
      : '') +
    `<button id="thRecords" class="careerNavBtn"><span class="cnIcon">🏅</span>` +
    `<span class="cnName">Career records</span>` +
    `<span class="cnSub">Wins, majors and every season placement</span></button>` +
    // MORE THAN ONE SEASON.
    //
    // This row used to be gated on `otherSeasons.length`, which made the whole
    // feature unreachable: the picker only appeared once a second season
    // existed, and NO SOLO PATH EVER CREATED ONE. Every route either guarded
    // `if (!tourNow())` or archived-and-replaced, so only the co-op flow could
    // ever add to the map — and the owner, playing solo, correctly reported
    // that there was still no way to run more than one season. The row now
    // shows whenever another season could be started OR switched to, and the
    // screen it opens is where both happen.
    (otherSeasons.length || canAddSeason(profile.tours)
      ? `<button id="thSwitch" class="careerNavBtn"><span class="cnIcon">🔀</span>` +
        `<span class="cnName">${otherSeasons.length ? 'Your seasons' : 'Run another season'}</span>` +
        `<span class="cnSub">${
          otherSeasons.length
            ? `${otherSeasons.length + 1} on the go · switch between them`
            : 'Keep this one and start a second alongside it'
        }</span></button>`
      : '') +
    (profile.tours.archive.length
      ? `<button id="thHistory" class="careerNavBtn"><span class="cnIcon">📖</span>` +
        `<span class="cnName">Past seasons</span>` +
        `<span class="cnSub">${profile.tours.archive.length} finished · final tables kept</span></button>`
      : '') +
    (hubRetired
      ? ''
      : `<button id="thQuit" class="careerNavBtn"><span class="cnIcon">${
          awaiting ? '➡' : t.played > 0 ? '🚪' : '🎲'
        }</span><span class="cnName">${
          awaiting ? 'Start next season' : t.played > 0 ? 'End this season' : 'New schedule'
        }</span><span class="cnSub">${
          awaiting
            ? 'Freeze the table as it stands and tee up the next one'
            : t.played > 0
              ? `The part-season still counts toward ${SEASON_LIMIT}`
              : 'Reroll the sixteen events before you start'
        }</span></button>`) +
    `</div>` +
    `<button id="thBack" class="ghostBtn">Back</button></div>`;
  // 'click' for Back (the tap-through rule — see #lkLock); pointerdown for
  // Play is fine: the round scene replaces everything under the finger.
  el.querySelector('#thBack')?.addEventListener('click', () => {
    el.style.display = 'none';
    refreshProgressSurfaces();
  });
  el.querySelector('#thRecords')?.addEventListener('click', () => renderTourGolferRecords());
  el.querySelector('#thSwitch')?.addEventListener('click', () => renderSeasonPicker());
  el.querySelector('#thHistory')?.addEventListener('click', () => renderSeasonHistory());
  el.querySelector('#thSched')?.addEventListener('click', () => renderTourSchedule());
  // Straight to the stat-spend screen — the Locker's Style tab IS that screen,
  // so this is one tap instead of Back → Locker → Style.
  el.querySelector('#thTrain')?.addEventListener('click', () => {
    el.style.display = 'none';
    // The hub hid itself, so the Locker's Back has to bring it back.
    pushReturn(() => renderTourHub());
    lkTab = 'style';
    renderLockerRoom();
  });
  // 'click', NOT 'pointerdown': this opens a modal that stays under the
  // finger, so a pointerdown binding would risk the release landing on the
  // confirm's Yes — the exact hazard its arming window exists for.
  el.querySelector('#thQuit')?.addEventListener('click', () => confirmQuitSeason());
  el.querySelector('#thCoop')?.addEventListener('click', () => void startCoopSeason());
  el.querySelector('#thCoopShare')?.addEventListener('click', () => {
    const id = tourNow()?.coop?.id;
    if (id) void shareOrCopy('Play a golf season with me — same schedule, same rivals. Join: ', coopUrl(id, `${location.origin}${location.pathname}`));
  });
  // A partner may have posted since the last paint; refresh in the background.
  //
  // NOT when this paint WAS the sync's repaint. `syncCoopSeason(true)` calls
  // back into here, so syncing on every paint made the two call each other for
  // as long as the hub stayed open — an unbounded loop of Firebase reads that
  // also rebuilt this screen's DOM every time a read landed, dropping taps
  // aimed at buttons that had just been replaced.
  if (!fromSync) void syncCoopSeason(true);
  el.querySelector('#thPlay')?.addEventListener('pointerdown', () => {
    if (flag('audio')) play('ui');
    el.style.display = 'none';
    startTourEvent();
  });
}

/**
 * SCHEDULE & STANDINGS — the season's reference material, moved off the career
 * landing so the landing can be a set of decisions rather than a scroll. Points
 * table first (where you stand), then all sixteen events with what each one
 * paid. Renders into the same overlay; Back returns to the landing.
 */
function renderTourSchedule(): void {
  const el = document.getElementById('tourHub');
  const t = tourNow();
  if (!el || !t) return;
  el.style.display = 'flex';
  tourView = 'schedule';
  const ids = tourCourseIds();
  const sched = tourSchedule(t.seed, ids);
  const def = currentEvent(t, ids);
  const roundsIn = eventRoundsPlayed(t);
  const poPending = playoffPending(t, ids);
  const rows = sched
    .map((e) => {
      const res = t.results.find((r) => r.idx === e.idx);
      const cur = def && e.idx === def.idx;
      // A finished event opens its full leaderboard (owner: "once I'm in the
      // schedule, I should be able to click an event and see the full
      // results"). Only finished ones — an event with no result has no
      // leaderboard to show, and a row that looks tappable and does nothing is
      // worse than one that plainly is not.
      const open = !!res;
      const cls = `thEv${res ? ' done' : ''}${cur ? ' cur' : ''}${e.major ? ' major' : ''}${open ? ' thEvOpen' : ''}`;
      const name =
        escapeHtml(tourEventName(e)) +
        (res && res.playerRank !== 1 && res.winnerId ? ` — 🏆 ${escapeHtml(tourEntrantName(res.winnerId))}` : '');
      const right = res
        ? `${res.playerRank === 1 ? '🏆 won' : ordinal(res.playerRank)} · +${res.points} pts`
        : cur
          ? poPending
            ? '⚔ playoff'
            : roundsIn > 0
              ? `round ${roundsIn + 1}/${e.rounds}`
              : 'up next'
          : e.major
            ? '3 rounds'
            : '';
      return (
        `<div class="${cls}"${open ? ` data-ev="${e.idx}"` : ''}><span class="thNo">E${e.idx + 1}</span>` +
        `<span class="thName">${name}</span>` +
        `<span class="thRes">${right}${open ? ' <span class="thGo">›</span>' : ''}</span></div>`
      );
    })
    .join('');
  el.innerHTML =
    `<div class="recInner"><h2>📋 Season ${t.seasonNo}</h2>` +
    tourSeasonTableHtml() +
    `<div class="tourHeadRow">Schedule &amp; results</div>` +
    `<div class="thSched">${rows}</div>` +
    `<button id="thSchedBack" class="ghostBtn">Back</button></div>`;
  el.querySelector('#thSchedBack')?.addEventListener('click', () => renderTourHub());
  // One delegated listener on the list rather than sixteen on the rows — the
  // list is rebuilt on every partner sync, and per-row bindings would have to
  // be re-attached each time.
  el.querySelector('.thSched')?.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-ev]');
    if (row) renderTourEventResult(Number(row.dataset.ev));
  });
}

/**
 * ONE FINISHED EVENT, in full (owner: "once I'm in the schedule, I should be
 * able to click an event and see the full results").
 *
 * The schedule could only ever say where the player finished and what it paid;
 * who else was up there, and by how much, was gone the moment the summary
 * closed. This is the whole leaderboard — the player, the ten rivals, and any
 * shared-season partner who has posted this event — with the points each one
 * took from it.
 *
 * The table comes from `eventRowsFor`, the same function that decides the
 * season's points, rather than a display-only rebuild: a second implementation
 * would be free to disagree with the standings on the previous screen, and on a
 * shared event that re-ranks when a partner posts, it eventually would.
 */
function renderTourEventResult(idx: number): void {
  const el = document.getElementById('tourHub');
  const t = tourNow();
  if (!el || !t) return;
  const res = t.results.find((r) => r.idx === idx);
  const def = tourSchedule(t.seed, tourCourseIds())[idx];
  // Only finished events are reachable, but a sync can settle a season out from
  // under this screen — fall back to the schedule rather than an empty card.
  if (!res || !def) {
    renderTourSchedule();
    return;
  }
  el.style.display = 'flex';
  tourView = 'event';
  tourEventView = idx;

  // Every partner shows, always: their score for this event if posted, a DNP
  // row if not. Appended after the scored rows, never mixed into the points.
  // SCORED first, and points computed from THAT — a partner who has not played
  // must not be handed a rank or a share of the points. The board adds them
  // back afterwards purely to be seen.
  const scored = eventRowsFor(res, t, TOUR_RIVALS);
  // A result banked before shared seasons existed carries no `field`, so the
  // rebuilt table is the player alone. Say so instead of showing a one-row
  // leaderboard that looks like a bug. Measured on the SCORED rows, so an
  // added DNP row cannot make a legacy result look reconstructable.
  const rebuilt = scored.length > 1;
  const awarded = rebuilt ? pointsForStandings(scored, def.major) : {};
  const rows = eventBoardRows(scored, t, idx);
  const par = (n: number): string => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
  let placed = 0;
  const body = rows
    .map((r) => {
      if (r.dnp) {
        return (
          `<div class="recRow dnp"><span class="recRk">–</span>` +
          `<span class="recNm">${escapeHtml(r.name)}</span>` +
          `<span class="thEvPar">–</span>` +
          `<span class="recTot">DNP</span></div>`
        );
      }
      const rank = placed === 0 ? '🏆' : `${placed + 1}.`;
      placed++;
      const pts = awarded[r.id] ?? 0;
      return (
        `<div class="recRow${r.isPlayer ? ' you' : ''}"><span class="recRk">${rank}</span>` +
        `<span class="recNm">${escapeHtml(r.name)}</span>` +
        `<span class="thEvPar">${par(r.toPar)}</span>` +
        `<span class="recTot">${pts} pts</span></div>`
      );
    })
    .join('');

  el.innerHTML =
    `<div class="recInner"><h2>${def.major ? '👑' : '⛳'} ${escapeHtml(tourEventName(def))}</h2>` +
    `<div class="recSub">Event ${idx + 1} of ${TOUR_EVENTS} · ${def.rounds} round${def.rounds > 1 ? 's' : ''}` +
    `${def.major ? ' · major, double points' : ''} · you finished ${ordinal(res.playerRank)} at ${par(res.toPar)}</div>` +
    (rebuilt
      ? `<div class="tourResult">${body}</div>`
      : `<div class="recSub">This event was played before full leaderboards were kept, so only your own` +
        ` finish is on record: ${ordinal(res.playerRank)}, ${par(res.toPar)}, +${res.points} pts.</div>`) +
    (t.coop
      ? `<div class="recSub">Shared season — a partner shown as DNP has not played this event yet.` +
        ` Their score joins the board when they post it, and the points re-settle around them.</div>`
      : '') +
    `<button id="thEvBack" class="ghostBtn">Back to the schedule</button></div>`;
  el.querySelector('#thEvBack')?.addEventListener('click', () => renderTourSchedule());
}

/**
 * THE RECORD BOOK (owner: "inside the tour screen there should be a way to
 * access past results by golfer. so I can see career wins, major wins and
 * season placements. for any golfer I've used"): every Pro in the stable —
 * and every Pro since deleted whose record survives on the profile — with
 * their career wins, major wins, and season-by-season placements. Renders
 * inside the tour hub overlay; Back returns to the hub.
 */
function renderTourGolferRecords(): void {
  const el = document.getElementById('tourHub');
  if (!el) return;
  el.style.display = 'flex';
  tourView = 'records';
  const hist = profile.tourHistory;
  const pros = profile.career.pros;
  // The stable in creation order, then record-book-only Pros (deleted from
  // the stable, but their wins are still theirs).
  const ids = [...pros.map((p) => p.id), ...Object.keys(hist).filter((id) => !pros.some((p) => p.id === id))];
  const t = tourNow();
  const liveNote =
    t && Object.keys(t.points).length
      ? `<div class="recSub">Season ${t.seasonNo} is in progress — its placement joins the book when it ends.</div>`
      : '';
  const cards = ids
    .map((id) => {
      const pro = pros.find((p) => p.id === id);
      const rec = hist[id];
      const name = pro?.name ?? rec?.name ?? id;
      const style = pro ? (ARCHETYPES.find((a) => a.id === pro.styleId)?.name ?? '') : '';
      const tag = !pro ? ' · retired' : proRetired(hist, id) ? ' · 🏛 Hall of Fame' : style ? ` · ${style}` : '';
      const wins = rec?.wins ?? 0;
      const majors = rec?.majorWins ?? 0;
      const seasons = rec?.seasons ?? [];
      const slam = hasGrandSlam(rec);
      const majorNames = rec?.majors ?? [];
      const seasonRows = seasons.length
        ? seasons
            .map(
              (s) =>
                `<div class="recRow"><span class="recRk">S${s.seasonNo}</span>` +
                `<span class="recNm">${s.rank === 1 ? '🏆 Season champion' : `${ordinal(s.rank)} in points`}` +
                `${s.events !== undefined ? ` · left after ${s.events}` : ''}</span>` +
                `<span class="recTot">${s.points} pts</span></div>`
            )
            .join('')
        : `<div class="recSub">No season finished yet.</div>`;
      return (
        `<div class="tourResult thProCard"><div class="tourHeadRow">🏌 ${escapeHtml(name)}${escapeHtml(tag)}</div>` +
        `<div class="recRow"><span class="recRk">🏆</span><span class="recNm">Tour wins</span><span class="recTot">${wins}</span></div>` +
        `<div class="recRow"><span class="recRk">👑</span><span class="recNm">Majors${slam ? ' — GRAND SLAM' : ''}</span><span class="recTot">${majors}</span></div>` +
        (majorNames.length ? `<div class="recSub">${escapeHtml(majorNames.join(' · '))}</div>` : '') +
        `<div class="recRow"><span class="recRk">📅</span><span class="recNm">Seasons played</span><span class="recTot">${seasons.length}/${SEASON_LIMIT}</span></div>` +
        seasonRows +
        `</div>`
      );
    })
    .join('');
  el.innerHTML =
    `<div class="recInner"><h2>🏅 Golfer records</h2>` +
    (cards || `<div class="recSub">Start a career and play the tour — every Pro's wins land here.</div>`) +
    liveNote +
    `<button id="thRecBack" class="ghostBtn">Back</button></div>`;
  el.querySelector('#thRecBack')?.addEventListener('click', () => renderTourHub());
}

/** One line describing a season, for the picker and the history list. */
function seasonBlurb(t: TourSeasonState): string {
  const bits = [`${t.played}/${TOUR_EVENTS} events`];
  if (t.coop) {
    const names = t.coop.partners.map((x) => x.name).filter(Boolean);
    bits.push(names.length ? `👥 with ${names.join(', ')}` : '👥 shared — nobody has joined yet');
  }
  if (Object.keys(t.points).length) {
    const rank = (t.coop ? coopSeasonStandings(t) : seasonStandings(t)).findIndex((r) => r.isPlayer) + 1;
    if (rank) bits.push(`${ordinal(rank)} in points`);
  }
  return bits.join(' · ');
}

/**
 * THE SEASON PICKER (Stage 5).
 *
 * There was nothing to pick from before: the profile held one season, and
 * joining a friend's overwrote it. Now a player can have a solo season and one
 * shared season with each of two friends going at once, and this is where they
 * say which one the next round belongs to.
 */
function renderSeasonPicker(): void {
  const el = document.getElementById('tourHub');
  if (!el) return;
  el.style.display = 'flex';
  tourView = 'picker';
  const entries = Object.entries(profile.tours.seasons).sort(
    (a, b) => Number(b[0] === profile.tours.activeId) - Number(a[0] === profile.tours.activeId)
  );
  const rows = entries
    .map(([key, t]) => {
      const live = key === profile.tours.activeId;
      return (
        `<button class="careerNavBtn seasonPick${live ? ' hot' : ''}" data-season="${escapeHtml(key)}">` +
        `<span class="cnIcon">${t.coop ? '👥' : '⛳'}</span>` +
        `<span class="cnName">Season ${t.seasonNo}${live ? ' — playing now' : ''}</span>` +
        `<span class="cnSub">${escapeHtml(seasonBlurb(t))}</span></button>`
      );
    })
    .join('');
  // START ANOTHER ONE, ALONGSIDE. The missing half of this screen: the picker
  // could always switch between seasons, but nothing solo could ever create a
  // second, so it had nothing to switch between. `putTour` already inserts
  // WITHOUT archiving — the collection supported this from the start; there was
  // simply no button.
  const room = canAddSeason(profile.tours);
  const addRow = room
    ? `<button id="thAddSeason" class="careerNavBtn"><span class="cnIcon">➕</span>` +
      `<span class="cnName">Start another season</span>` +
      `<span class="cnSub">A fresh schedule and a fresh table. The ones above keep going.</span></button>`
    : `<div class="recSub">That is ${LIVE_SEASON_CAP} seasons at once — as many as you can keep straight. ` +
      `Finish or leave one to start another.</div>`;
  el.innerHTML =
    `<div class="recInner"><h2>🔀 Your seasons</h2>` +
    `<div class="recSub">The next event you play belongs to whichever season is selected here. ` +
    `Nothing else moves — each one keeps its own schedule, its own field and its own table.</div>` +
    `<div class="careerNav">${rows}${addRow}</div>` +
    `<button id="thPickBack" class="ghostBtn">Back</button></div>`;
  el.querySelectorAll('.seasonPick[data-season]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = (b as HTMLElement).dataset.season!;
      profile.tours = selectTour(profile.tours, key);
      persistProfile();
      renderTourHub();
    })
  );
  el.querySelector('#thAddSeason')?.addEventListener('click', () => {
    // Guard again at the click: the screen may have been open while a co-op
    // join landed and filled the last slot.
    if (!canAddSeason(profile.tours)) {
      renderSeasonPicker();
      return;
    }
    profile.tours = putTour(
      profile.tours,
      newSeason(Math.floor(Math.random() * 1e9), nextSeasonNo(profile.tours))
    );
    persistProfile();
    analytics.track('season_started', { live: Object.keys(profile.tours.seasons).length });
    renderTourHub();
  });
  el.querySelector('#thPickBack')?.addEventListener('click', () => renderTourHub());
}

/**
 * PAST SEASONS (Stage 5).
 *
 * Owner: a shared season could not be looked at once it finished. It could not
 * — the rollover replaced the whole season object, so the points table, all
 * sixteen event lines and the partner's name went with it. They are archived
 * now, and this is where they are read.
 */
function renderSeasonHistory(): void {
  const el = document.getElementById('tourHub');
  if (!el) return;
  el.style.display = 'flex';
  tourView = 'history';
  const rows = profile.tours.archive
    .map((a, i) => {
      const how = a.ended === 'quit' ? 'left part-way' : a.ended === 'retired' ? 'final season' : 'played out';
      const who = a.coop?.partnerNames.length ? ` · 👥 ${a.coop.partnerNames.join(', ')}` : '';
      return (
        `<button class="careerNavBtn pastSeason" data-past="${i}">` +
        `<span class="cnIcon">${a.playerRank === 1 ? '🏆' : a.coop ? '👥' : '📖'}</span>` +
        `<span class="cnName">Season ${a.seasonNo}${a.proName ? ` · ${escapeHtml(a.proName)}` : ''}</span>` +
        `<span class="cnSub">${a.playerRank === 1 ? 'Season champion' : `${ordinal(a.playerRank)} in points`} · ` +
        `${a.playerPoints} pts · ${how}${escapeHtml(who)}</span></button>`
      );
    })
    .join('');
  el.innerHTML =
    `<div class="recInner"><h2>📖 Past seasons</h2>` +
    (rows
      ? `<div class="careerNav">${rows}</div>`
      : `<div class="recSub">No season has finished yet.</div>`) +
    `<button id="thHistBack" class="ghostBtn">Back</button></div>`;
  el.querySelectorAll('.pastSeason[data-past]').forEach((b) =>
    b.addEventListener('click', () => renderPastSeason(Number((b as HTMLElement).dataset.past)))
  );
  el.querySelector('#thHistBack')?.addEventListener('click', () => renderTourHub());
}

/** One finished season in full: the final table exactly as it stood, and every
 *  event line. This is the screen the owner could not reach. */
function renderPastSeason(idx: number): void {
  const el = document.getElementById('tourHub');
  const a = profile.tours.archive[idx];
  if (!el || !a) return;
  el.style.display = 'flex';
  tourView = 'past';
  const board = a.standings
    .map(
      (r, i) =>
        `<div class="recRow${r.isPlayer ? ' me' : ''}"><span class="recRk">${i + 1}</span>` +
        `<span class="recNm">${escapeHtml(r.name)}</span><span class="recTot">${r.total} pts</span></div>`
    )
    .join('');
  const events = a.results.length
    ? a.results
        .map(
          (r) =>
            `<div class="recRow"><span class="recRk">E${r.idx + 1}</span>` +
            `<span class="recNm">${r.playerRank === 1 ? '🏆 won it' : `${ordinal(r.playerRank)}`} · ${
              r.toPar > 0 ? `+${r.toPar}` : r.toPar
            }</span><span class="recTot">${r.points} pts</span></div>`
        )
        .join('')
    : `<div class="recSub">No event was completed.</div>`;
  el.innerHTML =
    `<div class="recInner"><h2>📖 Season ${a.seasonNo}</h2>` +
    `<div class="recSub">${escapeHtml(a.proName || 'Your Pro')} · ${
      a.playerRank === 1 ? 'season champion' : `${ordinal(a.playerRank)} in points`
    }${a.coop?.partnerNames.length ? ` · shared with ${escapeHtml(a.coop.partnerNames.join(', '))}` : ''}</div>` +
    `<div class="tourResult"><div class="tourHeadRow">Final table</div>${board}</div>` +
    `<div class="tourResult"><div class="tourHeadRow">Every event</div>${events}</div>` +
    `<button id="thPastBack" class="ghostBtn">Back</button></div>`;
  el.querySelector('#thPastBack')?.addEventListener('click', () => renderSeasonHistory());
}

/** The shared-season row on the hub: an invite when the season is solo, or
 *  where your partner has got to when it isn't. */
function coopHubHtml(t: TourSeasonState): string {
  if (!t.coop) {
    return (
      `<button id="thCoop" class="ghostBtn">👥 Play this season with a friend</button>` +
      `<div class="recSub">Same schedule, same rivals — you each play at your own pace and the ` +
      `points settle as you both finish each event.</div>`
    );
  }
  const rows = t.coop.partners
    .map((p) => {
      const done = Object.keys(p.results).length;
      const mine = t.results.length;
      const status =
        done >= mine
          ? done > mine
            ? `${done} events in — ahead of you`
            : 'level with you'
          : `${done}/${mine} of your events posted`;
      return (
        `<div class="recRow"><span class="recRk">👥</span>` +
        `<span class="recNm">${escapeHtml(p.name)}</span>` +
        `<span class="recTot">${escapeHtml(status)}</span></div>`
      );
    })
    .join('');
  // The season's locked difficulty, stated where the standings are read: the
  // totals in this table are only comparable BECAUSE everyone played at it, and
  // a joiner's own Settings choice does not apply inside the season.
  const diff = asDifficulty(tourNow()?.coop?.diff);
  const diffLine = diff
    ? `<div class="recSub">Everyone plays this season at ${difficultyProfile(diff).label} — the difficulty whoever started it chose.</div>`
    : '';
  return (
    `<div class="tourResult"><div class="tourHeadRow">👥 Shared season</div>` +
    diffLine +
    (rows || `<div class="recSub">Waiting for your friend to join — send them the link again if it got lost.</div>`) +
    `</div><button id="thCoopShare" class="ghostBtn">🔗 Copy the invite link</button>`
  );
}

/** Mid-round board for a tour round (the 🏆 HUD button): where the event
 *  stands through the rounds banked so far, and the season table. */
function showTourBoard(): void {
  const t = tourNow();
  if (!t) return;
  const def = currentEvent(t, tourCourseIds());
  const modal = document.createElement('div');
  modal.className = 'storeConfirm';
  modal.style.zIndex = '30';
  const roundNo = Math.min(eventRoundsPlayed(t) + 1, def?.rounds ?? 1);
  const head = def
    ? `<div class="tourResult"><div class="tourHeadRow">⛳ ${escapeHtml(tourEventName(def))}${def.major ? ' · MAJOR' : ''}</div>` +
      `<div class="recSub">You're playing round ${roundNo} of ${def.rounds} — scores post when the round ends.</div></div>`
    : '';
  modal.innerHTML =
    `<div class="storeConfirmBox">` +
    head +
    tourSeasonTableHtml() +
    `<div class="btnRow"><button id="tourBoardClose">Close</button></div></div>`;
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
  modal.querySelector<HTMLButtonElement>('#tourBoardClose')!.addEventListener('pointerdown', () => modal.remove());
}

engine3d?.runRenderLoop(() => {
  current?.render();
  // Only frames that actually drew a hole are evidence about rendering cost —
  // a menu frame is nearly free and would flatter a struggling device.
  if (current) sampleFrame(gpu().getDeltaTime());
});
window.addEventListener('resize', () => engine3d?.resize());

// WEBGL CONTEXT LOSS. On iOS the GPU process reclaims contexts under memory
// pressure, and an unhandled loss leaves the canvas frozen on its last frame
// for good — the "sometimes crashes all together" half of the report, seen
// from the player's side as a dead screen with the UI still responding.
// Babylon's own restore path rebuilds file-backed textures, but every surface
// in this game is drawn procedurally into a DynamicTexture at build time and
// cannot be restored that way, so the honest recovery is to rebuild the hole.
// Round state (course, seed, hole, card) is plain data that outlives the scene,
// and the ball and stroke count are carried across below, so the player comes
// back to the same lie. Only a shot already in flight is lost.
/**
 * The GPU is gone and is not coming back. Put the player somewhere they can
 * act instead of leaving them under a veil.
 *
 * This cannot go through `leaveRound()`: that calls `current.dispose()`, and
 * disposing a scene whose context has been destroyed throws. It runs the
 * scene's own `teardownChrome()` instead — the GPU-free half of `dispose()` —
 * then drops the scene reference WITHOUT disposing (there is nothing left to
 * free; the context took it), having saved the card first so the round can be
 * picked up again from the menu.
 */
function abandonAfterContextLoss(): void {
  // This runs BECAUSE the GPU already died, so treat every step before the
  // chrome reset as able to fail. None of it may be allowed to stop the player
  // reaching a menu — that is the entire purpose of the function, and a throw
  // halfway through would recreate the trap it exists to open.
  const hadRound = current !== null;
  roundWasCheckpointed = false;
  if (hadRound) {
    // Save the card BEFORE dropping the scene — checkpointRound reads the ball
    // and stroke count, which are plain state and safe to touch.
    try {
      roundWasCheckpointed = checkpointRound();
    } catch {
      /* best-effort — a lost card is better than a stuck screen */
    }
    // Unbind the scene's listeners and put its UI away. This is the step whose
    // absence made the menus unusable: the window-level pointer handlers stayed
    // bound to the dead scene, and `onTraceMove` preventDefault()s every move.
    try {
      current?.teardownChrome();
    } catch {
      /* best-effort — never block the way out */
    }
  }
  // Drop the scene WITHOUT disposing: disposing against a destroyed context
  // throws, and there is nothing left to free — the context took it.
  current = null;
  // The GPU is not coming back for this page, so refuse further rounds until a
  // restore says otherwise (see `contextGone`).
  contextGone = true;
  if (hadRound) {
    try {
      exposeDebug();
      roundRecorder.stop();
      tourRoundLive = false;
    } catch {
      /* best-effort */
    }
  }
  // UNCONDITIONAL from here down. `teardownChrome` above owns the gameplay
  // controls; these are the round-frame elements it does not touch (they are
  // shown by the round, not by the scene), and they must be reset even when
  // there was no live scene to tear down.
  hideLoading();
  swingBtn.style.display = 'none';
  hudEl.style.display = 'none';
  pauseBtn.style.display = 'none';
  promptEl.textContent = '';
  aimReadoutEl.style.display = 'none';
  summaryEl.style.display = 'none';
  showLanding();
  showMsg(
    roundWasCheckpointed
      ? 'The graphics ran out of memory. Your card is saved — finish the round from the menu.'
      : "The graphics ran out of memory. This round couldn't be saved, but your tour progress is safe — reload and start it again from the hub.",
    4200
  );
  showGpuReloadBanner();
}

/**
 * A PERSISTENT way out after the GPU process dies — not a toast.
 *
 * Once `contextGone` is set, this page can never start another round
 * (`gpuBlocked()` refuses), and the only thing that fixes it is a reload. That
 * used to be communicated by a transient toast shown IF the player happened to
 * tap Play — miss it and the game simply looks broken (owner: "had another
 * crash"). The banner stays until the reload, or until a late
 * `webglcontextrestored` proves the context came back after all.
 *
 * `#gpuReload`, deliberately NOT `#jgReload`: the no-WebGL boot fallback
 * asserts that id never exists (tests/visual/webglFallback.spec.ts), and that
 * contract is about a different situation — a device that never had a context,
 * where reloading cannot help. Here a reload genuinely fixes it.
 */
function showGpuReloadBanner(): void {
  if (document.getElementById('gpuReload')) return;
  const bar = document.createElement('div');
  bar.id = 'gpuReload';
  bar.innerHTML =
    `<span>Graphics stopped — reload to keep playing. Your round is saved.</span>` +
    `<button id="gpuReloadBtn">Reload</button>`;
  document.body.appendChild(bar);
  document.getElementById('gpuReloadBtn')?.addEventListener('click', () => location.reload());
}

/**
 * Write down what this device was drawing when the context died.
 *
 * Every crash so far has arrived as a sentence — "it lagged then died on Wild
 * Prairie 3" — with no numbers, on hardware no rig here can reproduce. This
 * turns the next one into figures the player can read straight off Settings →
 * Graphics (`graphicsNote`), which is the only console a phone has.
 *
 * MUST NOT TOUCH THE GPU. The context is already gone, so anything that would
 * round-trip to the driver either throws or hangs; every value here is a plain
 * JS property or an array length that Babylon keeps on the CPU side. The whole
 * thing is wrapped anyway — a diagnostic that breaks the escape path would be
 * worse than no diagnostic at all.
 *
 * APPENDS, never overwrites. The first readout this shipped with came back all
 * zeros: a lost context is routinely followed by a SECOND loss event once the
 * abandon path has dropped the scene, and with one slot that aftershock — which
 * has no scene to read and therefore knows nothing — replaced the record that
 * did. Everything below that reads through `current` is now paired with a
 * scene-independent field, so even an aftershock says which loss it was and
 * what the device looked like.
 */
let crashSeq = 0;
function recordCrash(pinnedTo?: 0 | 1 | 2 | 3): void {
  try {
    crashSeq += 1;
    const scene = current?.scene ?? null;
    const q = qualityStatus();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    // Thin-instance counts are a plain number on the mesh — no GL call. Batch
    // meshes are named `nat*` (excluding the `natProto*` prototypes), the same
    // filter the batching gate uses.
    let props = 0;
    if (scene) {
      for (const m of scene.meshes) {
        if (!m.name.startsWith('nat') || m.name.startsWith('natProto')) continue;
        // thinInstanceCount lives on Mesh, not AbstractMesh, and scene.meshes is
        // typed as the latter. Read it structurally rather than casting the mesh
        // to Mesh — a non-Mesh entry simply contributes nothing.
        props += (m as unknown as { thinInstanceCount?: number }).thinInstanceCount ?? 0;
      }
    }
    // The engine outlives any one scene, so its texture cache is the only count
    // here that still means something once `current` is gone.
    let engineTextures = 0;
    try {
      engineTextures = engine3d ? engine3d.getLoadedTexturesCache().length : 0;
    } catch {
      /* the cache is a plain array, but the engine is mid-death — never assume */
    }
    let building = '';
    try {
      building = sessionStorage.getItem('jg-building') ?? '';
    } catch {
      /* storage unavailable — the breadcrumb is best-effort, as where it is set */
    }
    const record: CrashRecord = {
      at: Date.now(),
      course: round.course.name,
      // Prefer the live scene, fall back to the ROUND. The round is plain state
      // that survives the scene being dropped, so an aftershock still names the
      // hole instead of reporting 0.
      hole: current ? current.hole.number : (round.course.holes[round.holeIdx]?.number ?? 0),
      tier: q.tier,
      floor: q.floor,
      reason: q.reason,
      meshes: scene ? scene.meshes.length : 0,
      materials: scene ? scene.materials.length : 0,
      textures: scene ? scene.textures.length : 0,
      props,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      lossIndex: crashSeq,
      sceneNull: !scene,
      building,
      recording: deviceSettings.clipCapture && shotCapture.isRecording,
      engineTextures,
      // The DRAWING BUFFER, not the CSS box: this is what the render scale
      // actually resolved to, which is the number the tier is supposed to move.
      canvasW: canvas.width,
      canvasH: canvas.height,
      dpr: window.devicePixelRatio || 1,
      deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
      // Present only when the loss handler is about to move a player-pinned
      // tier down — recorded here so the Settings note can say what changed.
      ...(pinnedTo !== undefined ? { pinnedTo } : {})
    };
    updateDeviceSettings({ crashes: [record, ...deviceSettings.crashes].slice(0, CRASH_LOG_MAX) });
  } catch {
    /* diagnostics are never worth breaking the way out */
  }
}

/** Fires if the context never comes back — see the handler below. */
let contextLostTimer: ReturnType<typeof setTimeout> | null = null;
/** How long to wait for a restore before assuming the GPU process is gone.
 *  Chrome usually restores within a second or two when it is going to at all. */
const CONTEXT_RESTORE_GRACE_MS = 8000;

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // without this the context is never eligible for restore
  // RECORD FIRST, so the crash record carries the tier the scene actually
  // died at. This used to demote first and record second, which stamped
  // unpinned records with the tier the device LANDED on rather than the one
  // that crashed — and pinned records looked right only because the demote
  // was silently a no-op (see below).
  //
  // THE PIN STEPS DOWN TOO. `demoteQuality` respects a player pin absolutely
  // — right for frame-time evidence, wrong for a lost context, because a
  // pinned device rebuilt the exact scene that had just run out of memory and
  // died again (the owner's Pixel 8: two crashes in one day, both pinned Full
  // at tier 0). A lost context is the device overruling the preference, so
  // the PIN moves one tier down — still pinned, still the player's setting,
  // persisted through the same path the Settings buttons use, and announced
  // both here and in the Settings crash note. Set it straight back if you
  // want: nothing hides Full.
  const g = deviceSettings.graphics;
  const stepTo = g !== 'auto' && g < 3 ? ((g + 1) as 0 | 1 | 2 | 3) : undefined;
  recordCrash(stepTo);
  if (stepTo !== undefined) {
    updateDeviceSettings({ graphics: stepTo });
    // Refuses under automation/url overrides — exactly right; the stored
    // setting above is what a real device reads at its next boot either way.
    setQualityPreference(stepTo);
    const name = (t: 0 | 1 | 2 | 3): string => GRAPHICS_CHOICES.find(([v]) => v === t)?.[1] ?? `tier ${t}`;
    showMsg(`Graphics ran out of memory at ${name(g as 0 | 1 | 2 | 3)} — moved to ${name(stepTo)}. Set it back in Settings if you want.`, 4600);
  } else {
    // Auto (or already at Performance): the governor's demote — a lost context
    // is stronger evidence than any frame median, and `remember()` writes the
    // landing tier to localStorage synchronously so it survives even if the
    // tab is killed a moment later.
    demoteQuality('webgl context lost');
  }
  // The veil is raised here and lifted by the restore handler, or by the
  // timeout below — never by playHole itself.
  showLoading('Rebuilding the hole…');
  // A MODAL WITH NO EXIT IS NEVER ACCEPTABLE. This veil is opaque and swallows
  // taps, and the only thing that lifted it was `webglcontextrestored`. When
  // the GPU PROCESS dies rather than the context being recycled, that event
  // never arrives — so the player sat behind "Rebuilding the hole…" forever
  // (owner: "it went to a screen that said rebuilding hole but couldn't ever
  // rebuild it"). Worse than the behaviour it replaced, where the picture
  // froze but the pause button still worked.
  if (contextLostTimer) clearTimeout(contextLostTimer);
  contextLostTimer = setTimeout(() => {
    contextLostTimer = null;
    abandonAfterContextLoss();
  }, CONTEXT_RESTORE_GRACE_MS);
});
canvas.addEventListener('webglcontextrestored', () => {
  if (contextLostTimer) {
    clearTimeout(contextLostTimer);
    contextLostTimer = null;
  }
  // There is a context again, so rounds are allowed again — this matters when
  // restore arrives LATE, after the grace period already gave up and sent the
  // player back to the menu. The reload banner goes with it: its one claim
  // ("reload to keep playing") stopped being necessary.
  contextGone = false;
  document.getElementById('gpuReload')?.remove();
  // The lost context took every GPU resource with it; the JS-side scene is
  // rubble. The lost handler above already moved the budget down — a pinned
  // tier stepped its PIN one notch, an auto tier took the governor's demote —
  // so the rebuild below genuinely comes back cheaper than the scene that
  // just died. (Under a pin that claim used to be false: demoteQuality no-ops
  // when pinned, and the rebuild came back at the killing budget.)
  if (!current) {
    hideLoading();
    return;
  }
  // Where the player actually stood. `round` survives (it is plain state, not
  // scene objects), so the hole and card come back on their own; this is the
  // mid-hole part — the same ball/strokes restore the unfinished-round card
  // uses. resumeAt re-reads the surface under the point, so the lie comes from
  // the rebuilt course rather than from a snapshot that could disagree with it.
  const strokes = current.state.strokes;
  const ball = strokes > 0 ? { x: current.state.ballPos.x, y: current.state.ballPos.y } : null;
  // DISPOSE, don't abandon. The reason the abandon path (below, where no
  // restore ever comes) drops the scene without disposing is that disposing
  // against a dead context throws — but here the context is BACK, so the whole
  // scene's meshes, materials, textures and RTTs can actually be handed in.
  // Dropping the reference instead left every one of them behind, on the
  // device least able to afford it, immediately before building a fresh scene.
  const dead = current;
  current = null;
  try {
    dead.teardownChrome();
    dead.scene.dispose();
  } catch (err) {
    // A restore that arrives half-broken must not take the rebuild with it —
    // freeing what we can is a best effort, and the rebuild is the point.
    console.warn('[context] could not dispose the pre-loss scene', err);
  }
  buildWithLoading(() => {
    playHole();
    if (ball) current?.resumeAt(ball.x, ball.y, strokes);
  });
});

// Unmistakable DEV badge outside production; a no-op on the live site.
mountEnvBadge();
// Gate the Phase 2 screen-entrance animations: the CSS is scoped under
// html.ff-delight, so production (flag off) keeps today's instant screen swaps.
document.documentElement.classList.toggle('ff-delight', flag('delight'));

// Perf probe for the Playwright FPS baseline (Phase 9).
(window as unknown as { __fps: () => number }).__fps = () => engine3d?.getFps() ?? 0;

/**
 * Difficulty probe: set the stored choice, and read back what the METER is
 * actually drawing.
 *
 * The difficulty setting shipped correct in the model and invisible on the bar,
 * and every test we had passed — because they all measured `perfectHalf()` and
 * none of them measured a pixel. This exposes both ends of the chain so a spec
 * can assert that choosing Expert really does narrow the green band on screen.
 */
(window as unknown as { __difficulty: unknown }).__difficulty = (set?: string) => {
  const chosen = asDifficulty(set);
  if (chosen) {
    profile.settings.difficulty = chosen;
    updateDeviceSettings({ difficulty: chosen });
  }
  // Selected by CLASS, not by z-index: the first version of this probe keyed on
  // the layer number and silently returned nothing the moment the layering
  // changed — a probe that fails open is worse than none.
  const perfectPx = Array.from(meterEl.querySelectorAll<HTMLElement>('.zone.perfect'))
    .filter((z) => z.style.display !== 'none')
    .map((z) => z.getBoundingClientRect().width);
  return {
    chosen: profile.settings.difficulty ?? null,
    effective: playerDifficulty(),
    round: round.difficulty,
    perfectPx,
    barPx: meterEl.clientWidth
  };
};

/** Adaptive-quality probe: what tier the device settled on, why, and what that
 *  tier is currently spending. Read by the perf spec and by support requests
 *  ("it's laggy" → ask for this). */
(window as unknown as { __quality: unknown }).__quality = () => ({
  ...qualityStatus(),
  profile: renderQuality(),
  hardwareScaling: engine3d?.getHardwareScalingLevel() ?? 0
});
(window as unknown as { __resetQuality: unknown }).__resetQuality = () => {
  resetQualityMemory();
  return qualityStatus();
};

/** Repeat-round soak probe: a snapshot of every resource class that could
 *  accumulate across Replay / Play Next scene rebuilds. The soak spec starts
 *  round after round and asserts these counts return to the same level for the
 *  same course — any monotonic growth is a leak (retained observers, meshes,
 *  materials, textures, timers). Heap is best-effort (Chrome only). */
(window as unknown as { __golfSoak: unknown }).__golfSoak = () => {
  const scene = current?.scene ?? null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  // Ghost tree-occlusion stand-ins are created/removed dynamically as the
  // camera looks through canopies — pure snapshot-time noise for the soak
  // comparison, so they're reported separately and excluded from `meshes`.
  const ghosts = scene ? scene.meshes.filter((m) => m.name.startsWith('ghost')).length : 0;
  return {
    hasScene: !!scene,
    course: round.course.name,
    natureSettled: current?.natureSettled ?? false,
    meshes: scene ? scene.meshes.length - ghosts : 0,
    ghostMeshes: ghosts,
    materials: scene ? scene.materials.length : 0,
    textures: scene ? scene.textures.length : 0,
    particleSystems: scene ? scene.particleSystems.length : 0,
    beforeRenderObservers: scene ? scene.onBeforeRenderObservable.observers.length : 0,
    engineScenes: engine3d?.scenes.length ?? 0,
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
        natureReady: () => current?.natureReady(),
        // FLY MODE, so a spec can drive the whole loop — enter, place on the
        // rendered hole, and check the placement reached the hole DATA rather
        // than inferring it from pixels.
        toggleDesign: (on?: boolean) => current?.toggleDesign(on),
        designActive: () => !!current?.design,
        holeCounts: () => ({
          props: (current?.hole.props ?? []).length,
          hazards: (current?.hole.hazards ?? []).length
        }),
        // The drawn shapes, for the builder-engine gates: a green drawn from
        // the air must land in the DATA, not just on the screen.
        holeShape: () => ({
          tee: { ...(current?.hole.tee ?? { x: 0, y: 0 }) },
          green: current?.hole.green ? { ...current.hole.green } : null,
          par: current?.hole.par,
          fairways: (current?.hole.fairway ?? []).length
        }),
        // Play a real shot and settle it. Together these let a spec play a
        // whole round through the LIVE code path — which is the only way to
        // prove the game records what it actually played
        // (tests/visual/roundRecording.spec.ts).
        executeShot: (sw: SwingResult, physicsPower = true) => current?.executeShot(sw, physicsPower),
        // A competent shot (AI selection, human path) so a spec can play a
        // round that actually holes out rather than capping every hole.
        playSkilledShot: () => current?.playSkilledShot() ?? false,
        settleFlight: () => current?.settleFlight() ?? false,
        // The ghost's stand-in ball — armed, in the air, and where
        // (tests/visual/ghostRace.spec.ts).
        ghostDebug: () => current?.ghostDebug() ?? null,
        settleGhostFlight: () => current?.settleGhostFlight() ?? false,
        clubLab: (tuning: Partial<ClubTuning> | undefined, kind: 'swing' | 'driver' | 'putter') =>
          current?.clubLab(tuning, kind),
        clubLabView: (view: 'hero' | 'face' | 'edge') => current?.clubLabView(view),
        debugTreeOcclusion: (x: number, y: number, z: number) => current?.debugTreeOcclusion(x, y, z),
        golferAbs: () => current?.golferAbs(),
        occlusionCandidates: () => current?.occlusionCandidates(),
        showBoundary: () => current?.showBoundary()
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
  // this device's audio/motion/difficulty preferences always win locally.
  applyDeviceSettings();
  backfillTourHistory(live);
  persistProfile();
  // A merge lands ASYNCHRONOUSLY, long after the screen was drawn. If the
  // Settings pane is open it is now showing values that may no longer be true —
  // and a segmented control still highlighting the choice the merge just undid
  // is indistinguishable from the setting being broken. Redraw it.
  if (recordsEl.style.display !== 'none' && profileTab === 'settings') renderProfile('settings');
}

/**
 * ONE-TIME BACKFILL (pass 8b): tour wins earned before the per-golfer record
 * book existed live only in the CURRENT season's results log — attribute them
 * to the active Pro (the tour force-selects it on entry, so this is almost
 * surely who won them). Runs only while the book is empty: after any backfill
 * it has entries, and with no wins there is nothing to record — so a cloud
 * copy that merges in later can never double-count.
 */
/** The major's title for a schedule index, or undefined for a regular stop. */
function majorNameForIdx(idx: number): string | undefined {
  const n = (TOUR_MAJOR_IDXS as readonly number[]).indexOf(idx);
  return n >= 0 ? MAJOR_NAMES[n] : undefined;
}

function backfillTourHistory(p: PlayerProfile): void {
  const t = activeTour(p.tours);
  const pro = activePro(p.career);
  if (!t || !pro || Object.keys(p.tourHistory).length > 0) return;
  for (const r of t.results) {
    if (r.playerRank !== 1) continue;
    recordTourEventWin(p.tourHistory, pro.id, pro.name, majorNameForIdx(r.idx));
  }
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
  clipCapture: false,
  firstRoundDone: legacyLocal.stats.rounds > 0, // returning devices skip the intro reveal
  tutorialDone: false,
  lastCourseId: '',
  swingType: 'tap',
  graphics: 'auto',
  // -1, not 0: week 0 is a real week, and a device that has never opened the
  // store should be told the shelf has something on it.
  storeSeenWeek: -1,
  crashes: []
};

/** Whether THIS device swings by tracing the rabbit. The `dragSwing` flag is
 *  availability (is the option offered at all); the device setting is the
 *  player's choice — and the default is the three-click meter. */
function traceInputOn(): boolean {
  return flag('dragSwing') && deviceSettings.swingType === 'trace';
}

/** Push the device preferences into the live profile + live audio. Call after
 *  boot and after ANY wholesale profile replacement (cloud merge, sign-out). */
function applyDeviceSettings(): void {
  profile.settings.sound = deviceSettings.sound;
  profile.settings.ambience = deviceSettings.ambience;
  profile.settings.reducedMotion = deviceSettings.reducedMotion;
  // ...and the difficulty, once this device has actually chosen one. This runs
  // immediately after every cloud merge (applyCloudMerge, adoptCloudAccount),
  // so a stale synced value can never survive on top of a local choice.
  if (deviceSettings.difficulty) profile.settings.difficulty = deviceSettings.difficulty;
  applyAmbienceVolume();
  // Mirror the in-game Reduced Motion preference onto the root element so the
  // CSS delight (screen fade-ins, transitions) can honor it alongside the OS
  // `prefers-reduced-motion` media query. Both switch the same motion off.
  document.documentElement.classList.toggle('reduce-motion', deviceSettings.reducedMotion);
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

/** Bring the CACHED account copy live locally (no network): merge the local
 *  legacy/cache, enable persistence, and refresh every profile-driven surface.
 *  Shared by the real adoption and the optimistic hint boot path. */
function adoptLocalCache(): void {
  if (!legacyMerged) {
    Object.assign(profile, mergeProfiles(profile, legacyLocal));
    legacyMerged = true;
  }
  signedIn = true; // enable persistence before the sync writes back
  analytics.setUid(profile.id);
  syncSelFromProfile();
  refreshLandingCards();
}

/**
 * Adopt the signed-in player's cloud account as the live profile. On the first
 * sign-in this device, fold any pre-existing local progress up first (grow-only
 * merge, nothing lost), then pull+merge+push the cloud copy.
 */
async function adoptCloudAccount(): Promise<void> {
  adoptLocalCache();
  // The cloud phase is capped: on a bad connection the RTDB get() can hang for
  // minutes, and everything after this await (account menu, name prompt) used
  // to hang with it. The UI is already correct from the local cache; a timed-
  // out sync reports offline and the next persist/round-end sync reconciles.
  const res = await Promise.race([
    cloudSyncProfile(profile),
    new Promise<CloudSaveResultLike>((resolve) => setTimeout(() => resolve({ profile, status: 'offline' }), 12000))
  ]);
  // Through the guarded merge, NOT a blind Object.assign. `cloudSyncProfile`
  // does a full network round trip between reading the remote copy and
  // resolving, and the player can change a setting during it — this was the one
  // call site that would overwrite that fresh local change wholesale, which is
  // precisely the hazard applyCloudMerge's own comment warns about.
  applyCloudMerge(profile, res.profile);
  saveProfile(profile); // cache the account locally for offline/reload
  showCloudStatus(res.status);
  syncSelFromProfile();
  refreshLandingCards(); // cloud may have brought newer daily/weekly state
  // Attribute this device's guest activity to the account WITHOUT
  // double-counting: subsequent events carry uid+gid, and the linked event
  // lets the dashboard fold earlier guest sessions into this player.
  analytics.setUid(profile.id);
  analytics.track('identity_linked');
  void linkedAccountName().then((name) => {
    updateLandingProfileButton(name ?? undefined);
    // Confirm admin (async — the email only resolves once the Firebase SDK +
    // auth have restored) and persist it into the sign-in hint. The hint's
    // `admin` flag is the SYNCHRONOUS signal `adminUnlocked()` reads at the next
    // module-load to include the expansion courses in COURSES (admin-only play
    // in production). Also widen the flag-override channel for the live game so
    // an admin can toggle flags in prod (the game page never did this before).
    void confirmAdminUnlock(name ?? '');
  });
  refreshEntitlements(); // deliver purchases made while away / on other devices
}

/** Resolve admin status for the signed-in account and reflect it on this device:
 *  stamp the sign-in hint's `admin` flag (so a later load unlocks the expansion
 *  courses synchronously), enable admin flag overrides for this session, and — on
 *  the first unlock in a session where the courses are not yet loaded (prod) —
 *  reload ONCE so the module-level COURSES const rebuilds with them. The
 *  "already loaded" guard (`COURSES.redhollow`) makes the reload fire at most
 *  once and never for a normal player or in dev. */
async function confirmAdminUnlock(name: string): Promise<void> {
  const email = await cloudEmail();
  const isAdmin = isAdminEmail(email);
  writeSignInHint(profile.id, name, isAdmin);
  enableFlagOverrides(isAdmin);
  // Reload only when the marker actually persisted (`adminUnlocked()` re-reads
  // localStorage): if storage is blocked the write is a no-op, and reloading
  // would loop forever without ever unlocking. `!COURSES.redhollow` keeps this
  // to the first unlock in a session (never in dev, never for a normal player).
  if (isAdmin && !COURSES.redhollow && adminUnlocked()) {
    window.location.reload();
  }
}
type CloudSaveResultLike = { profile: PlayerProfile; status: CloudSaveStatus };

/** Sign out: return to a clean slate. Wipe the local view + persisted data so a
 *  signed-out browser shows no coins/records; the account stays safe in the
 *  cloud under its uid and returns on next sign-in. */
async function doSignOut(): Promise<void> {
  await signOutAccount();
  resetToSignedOut();
}

/** Local half of signing out — also used when a persisted session turns out
 *  to be gone (revoked/expired) after an optimistic hint boot. */
function resetToSignedOut(): void {
  signedIn = false;
  clearSignInHint();
  // Don't resurrect the previous account's local data into a later sign-in.
  legacyMerged = true;
  clearLocalProfile();
  clearLocalHistory();
  Object.assign(profile, defaultProfile());
  applyDeviceSettings(); // device audio/motion prefs survive sign-out
  analytics.setUid(null);
  syncSelFromProfile();
  refreshLandingCards();
  updateLandingProfileButton();
}

/** Re-prefill the setup wizard from the live profile (after a cloud adopt or a
 *  sign-out reset) so name/character/style reflect the current account. */
function syncSelFromProfile(): void {
  sel.name = profile.name;
  sel.character = (profile.character as CharacterKey) || (CHARACTERS[0].key as CharacterKey);
  sel.archetype = (profile.archetype as ArchetypeId) || (ARCHETYPES[0].id as ArchetypeId);
  refreshProgressSurfaces();
}

/** Re-render the visible setup wizard so a sign-in/sign-out actually clears (or
 *  loads) the on-screen name/character — not just the account button. Without
 *  this the wizard's Name field keeps showing the previous account's name. */
function refreshWizardIfVisible(): void {
  if (setupEl.style.display !== 'none') goStep(sel.step);
}

// A leftover build breadcrumb means the previous page DIED building a hole —
// an iOS tab crash leaves no error, just this corpse. The checkpoint (written
// during that same round) describes exactly the round that killed the tab, so
// it takes a strike; two strikes retire it (owner: "white screened … three
// times in a row and can't resume").
try {
  if (sessionStorage.getItem('jg-building')) {
    markResumeAttempt();
    sessionStorage.removeItem('jg-building');
  }
} catch {
  /* storage unavailable — nothing to heal */
}

// On boot, adopt the account only if a real Google session persists; otherwise
// stay on the empty guest view and prompt the player to sign in.
void (async () => {
  // LOCAL-FIRST (weak-connection fix): a device that was signed in renders its
  // cached account copy IMMEDIATELY — daily/weekly completion, coins, and the
  // Profile button label — before Firebase's SDK chunks have even downloaded.
  // The real auth check + cloud sync below reconcile (or revert) when they
  // resolve. Without this, every reload (including Admin → back) showed an
  // empty guest view until the network caught up.
  const hint = authConfigured() ? readSignInHint() : null;
  if (hint) {
    adoptLocalCache();
    updateLandingProfileButton(hint.name || undefined);
  }
  const auth = authConfigured() ? await authState() : 'out';
  if (auth === 'in') {
    await adoptCloudAccount();
    // Stripe's success URL lands back here with ?purchase=success — the
    // adopt above already kicked off the entitlement claim.
    if (new URLSearchParams(window.location.search).get('purchase') === 'success') {
      showMsg('Thanks! Applying your purchase…', 2200);
      history.replaceState(null, '', window.location.pathname);
    }
  } else if (auth === 'out' && hint) {
    // DEFINITIVELY signed out (revoked/expired) — mirror the sign-out reset
    // so the optimistic view never lingers on a dead account. 'unknown'
    // (offline / SDK unreachable) keeps the cached view: local play continues
    // and the next good connection reconciles.
    resetToSignedOut();
  }
  // A user who APPEARS outside the flows above — a completed redirect return
  // (the iOS fallback), or a session Firebase restores late — used to go
  // unnoticed until the next full reload. Adopt them the moment they land.
  onAccountAppeared(() => {
    if (signedIn) return;
    void adoptCloudAccount().then(() => {
      renderAcctMenu();
      refreshWizardIfVisible();
      refreshLandingCards();
    });
  });
  renderAcctMenu();
  // First visit / fresh guest with no name yet — ask once (editable later in
  // the Locker Room / Profile). Gated on the account check above resolving
  // first: profile.name starts empty for EVERY boot (defaultProfile()) and
  // only gets the cloud value once adoptCloudAccount finishes, so checking
  // synchronously at load used to pop the modal for a signed-in player on
  // every reload, right before their name loaded in underneath it. Skipped in
  // the screenshot-harness boot (?hole) and under automation (Playwright drives
  // specific screens/flows and sets names programmatically — onboarding is not
  // what those specs exercise, and it must not sit over the wizard/canvas).
  const automated = typeof navigator !== 'undefined' && navigator.webdriver;
  if (!profile.name.trim() && !SHOT.hole && !automated) promptName(false);
})();

/** Capture-harness seed override (set only by the __startRound test hook for
 *  the one call it wraps, so two page loads can render the identical round). */
let forcedSeed: number | undefined;

/** Set for the duration of ONE startRound call when the player chose Resume, so
 *  that call keeps the stored seed and scores instead of starting clean. */
let resumingFrom: RoundCheckpoint | null = null;

/**
 * Records the human's shot INPUTS for the round in progress (`roundRecording`).
 * The recording is what makes a score verifiable and a ghost possible — see
 * systems/RoundRecording.ts. Solo rounds only: a versus round's scorecard is
 * not the human's alone, and replaying it would need the AI's stream too.
 */
const roundRecorder = new RoundRecorder();

/** The last completed round's recording, held for the results screen (share,
 *  ghost challenge, verification) until the next round starts. */
let lastRecording: RoundRecording | null = null;

/**
 * The opponent being raced this round, or null for an ordinary solo round
 * (`ghostRace`). Read by the hole scene to fly the ghost's ball and by the HUD
 * to show the standing; cleared when a round starts without one.
 */
let activeGhost: GhostRun | null = null;

/** A recording armed to be raced by the NEXT startRound (the landing/results
 *  entry points set this, then start the round). */
let pendingGhost: RoundRecording | null = null;
/** Fly-mode camera carried across a builder-preview rebuild, so committing a
 *  drawn green does not end the design session. Consumed by playHole. */
let pendingFlyResume: FlyCam | null = null;

/** Reserved course id the generated Hole of the Day is registered under, so it
 *  flows through the same lookup-by-id path as every authored course. */
const DAILY_COURSE_ID = '__daily';

/**
 * PRACTICE GROUND (`practiceRange`).
 *
 * Every golf game has one, and this one never did. It is where the swing is
 * actually learned — no card, no penalty, no consequence — and it is the only
 * entry point that fits a 90-second session, which a three-hole round does not.
 * Holing out simply re-tees; there is no scorecard, no reward, and nothing is
 * recorded, so nothing here can inflate a record or a streak.
 */
let practiceMode = false;
/** Shots on the current practice ball before it is replaced. */
let practiceShots = 0;
/** Strokes after which a wandering practice ball is re-teed. */
const PRACTICE_MAX_SHOTS = 12;
/**
 * RANGE DRILLS (owner pass 6): "Go to the range" on the course chooser picks
 * ONE shot to practice — driving, chipping or putting — and the range deals
 * stations endlessly: a random spot for that shot on a random hole, another
 * ball the moment the last one stops rolling, a fresh random hole every few
 * reps. Backing out to the menu is the only way a drill ends. Rides the whole
 * practice chassis (no card, no recording, no rewards).
 */
type DrillKind = 'drive' | 'chip' | 'putt';
let practiceDrill: DrillKind | null = null;
/** Reps left before the drill rotates to a fresh random hole. */
let drillRepsOnHole = 0;

/** Set while a Hole of the Day round is in progress, so the results card knows
 *  to record the attempt and offer the share. */
let dailyRound: { dateKey: string; par: number; rival: RoundRecording | null; seed: number } | null = null;

/**
 * Seal the round recording at the end of the round and self-check it: replay
 * the inputs through the same physics the round just ran on, and keep the
 * recording only if it reproduces the score that was actually played.
 *
 * That check runs on the CLIENT deliberately. It is not a security measure —
 * verification against a leaderboard belongs on the server
 * (systems/RoundVerify.ts, functions/verifyRound). It is a CORRECTNESS measure:
 * a recording that does not round-trip means the game and the replay engine
 * have drifted apart, and shipping a ghost or a challenge built on it would
 * show the player a round that never happened. Better to drop it silently.
 */
function sealRoundRecording(): void {
  if (!roundRecorder.isRecording()) return;
  const courseId = courseIdByName(round.course.name);
  const me = round.players[0];
  const rec = roundRecorder.finish({
    courseId,
    seed: round.seed ?? 0,
    holes: holesThisRound(),
    golfer: {
      // The loadout that PLAYED this round, not the one sitting on the profile.
      // They differ on every round an unlocked profile re-rolls (roundGolfer).
      character: roundLoadout.character,
      archetype: roundLoadout.archetype,
      upgrades: { ...profile.clubUpgrades },
      // The Pro's attributes as played (career style only) — the live profile
      // keeps growing, so the replay needs this snapshot, not the profile.
      ...(roundCareerStats ? { career: { ...roundCareerStats } } : {})
    },
    scores: me?.scores ?? [],
    at: Date.now(),
    name: profile.name || 'Player',
    gentlePins: roundGentlePins,
    perkId: roundPerkId
  });
  if (!rec) return;
  const check = verifyRecording(rec, COURSES, replayOptions());
  if (!check.ok) {
    // Never surfaced to the player — there is nothing they did wrong and
    // nothing they can do. Logged in dev so drift is caught in playtesting.
    if (!ENV.isProd) {
      console.warn(
        `[recording] dropped — ${check.status}: ${check.detail ?? ''} course=${rec.courseId} shots=${rec.shots.length} scores=${rec.scores.join('/')}`,
        check
      );
    }
    analytics.track('recording_rejected', { result: check.status, course: courseId });
    return;
  }
  lastRecording = rec;
  saveRecording(rec);
  // Submit for SERVER verification, well off the gameplay path: the results
  // card is already on screen, the call is fire-and-forget, and a signed-out or
  // offline player simply keeps an unverified round. Only a server-verified
  // round can back a leaderboard claim (functions/index.js verifyRound).
  if (flag('verifiedScores') && signedIn) {
    void submitRoundForVerification(rec).then((res) => {
      if (!res.ok && !ENV.isProd) console.warn('[verify] server rejected/failed', res);
      analytics.track('round_verified', { result: res.ok ? 'verified' : (res.status ?? 'failed'), course: courseId });
    });
  }
}

/** The replay/verify options that mirror this build's feature flags. Kept in
 *  one place so the client self-check, ghost playback and the server verifier
 *  cannot disagree about how the round was played. */
function replayOptions(): ReplayOptions {
  const theme = resolveTheme(round.course);
  return {
    useAuthoredPins: flag('layouts'),
    bounded: flag('boundedWorld'),
    bunkerDepthScale: theme.bunkerDepthScale ?? 1,
    wasteDepthScale: theme.wasteDepthScale ?? 0,
    edgeWobble: theme.edgeWobble ?? 1,
    // The course's tree mix shapes every trunk's HITBOX. Omitting it gives the
    // replay generic broadleaf lollipops instead of the real species, so a
    // drive that threaded a pine alley live clips a tree in the replay — the
    // divergence that stopped honest rounds verifying at all.
    treeSpecies: { trees: theme.treeKeys ?? DEFAULT_TREE_MIX, accents: theme.accentTreeKeys ?? [] }
  };
}

/** The setup choices, prefilled from the profile so returning players jump
 *  straight to "Tee off". */
const sel = {
  step: 0,
  mode: 'solo' as GameMode,
  courseId: DEFAULT_COURSE_ID,
  name: profile.name,
  character: (profile.character as CharacterKey) || (CHARACTERS[0].key as CharacterKey),
  archetype: (profile.archetype as ArchetypeId | 'career') || (ARCHETYPES[0].id as ArchetypeId),
  opponentId: OPPONENTS[1].id
};

/** Solo rounds skip the rival step; 1v1/scramble add it at the end. The AI
 *  Tournament also skips the Course step — its three-course rota is drawn
 *  when the tournament starts. */
function stepLabels(): string[] {
  // Loadout (character/style/pal/perk) lives in the Locker Room now, so the
  // round flow is just the per-round choices.
  // Entering an online tournament: mode + course are locked, so just confirm.
  if (sel.mode === 'aitour') return ['Mode'];
  // With the modes stripped there is exactly one, so asking which is a step
  // that can only be answered one way.
  if (flag('focusedGame')) return ['Course'];
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
 *  always shows the true (capped) width.
 *
 *  `cp`, when given, draws a GHOST SEGMENT past the filled bar showing how far
 *  the unspent CP would take that one attribute if it all went there — so
 *  spending is a visible decision made against the bar rather than arithmetic
 *  done against five buttons (Stage 2.3). It is a preview only; nothing is
 *  spent until a `.cpSpend` button is tapped. It carries the Pro's BASE
 *  attributes because `stats` here is already club-upgraded, and the cost
 *  brackets are charged against the base value, not the effective one. */
function statBars(
  stats: GolferStats,
  signature?: StatKey,
  clubUpgrades?: Record<string, number>,
  cp?: { bank: number; base: GolferStats }
): string {
  return (
    `<div class="stats">` +
    STAT_KEYS.map(([k, label]) => {
      const tier = clubUpgrades ? clubUpgrades[STAT_UPGRADE_FAMILY[k]] ?? 0 : 0;
      const badge = tier > 0 ? `<span class="svup">${'+'.repeat(Math.min(2, tier))}</span>` : '';
      const shown = Math.min(100, stats[k]);
      // The ghost starts where the fill ends and cannot run past 100, because
      // pointsAffordable stops at the same base+bonus ceiling the buy does.
      const buys = cp ? pointsAffordable(cp.base[k], cp.bank, upgradeStatBonus(k, clubUpgrades ?? {})) : 0;
      const ghostW = Math.max(0, Math.min(100 - shown, buys));
      const ghost =
        ghostW > 0 ? `<u style="left:${shown}%;width:${ghostW}%" title="+${buys} if you spend ${cp?.bank} CP here"></u>` : '';
      return (
        `<div class="stat${k === signature ? ' sig' : ''}"><span class="sl">${label}</span>` +
        `<span class="sbar"><i style="width:${shown}%"></i>${ghost}</span>` +
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

/**
 * THE STRIP-DOWN (`focusedGame`).
 *
 * Four ways to play a round, three ways to race somebody and two tournament
 * cadences — all aimed at a library of 21 holes. With the flag on the game is
 * solo golf, one social feature, and one thing to come back for each day.
 * Everything else is hidden rather than deleted, so living with the decision is
 * a flag flip rather than an archaeology exercise.
 */
function offeredModes(): typeof MODES {
  return flag('focusedGame') ? MODES.filter((m) => m.id === 'solo') : MODES;
}

function renderMode(): void {
  const modes = offeredModes();
  // With one mode there is no question to ask; the step still exists so the
  // wizard's shape does not change under the flag, but it states rather than
  // asks.
  stepBodyEl.innerHTML =
    `<div class="stepTitle">${modes.length > 1 ? 'How do you want to play?' : 'Your round'}</div>` +
    `<div class="modeGrid">` +
    modes.map(
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
    // Non-playable "Coming soon" teasers (production, where newCourses is off).
    // Deliberately NOT `.modeCard` — the click handler below never binds them, so
    // they can't be selected or entered; the course JSON is never even loaded.
    COMING_SOON_COURSES.map(
      (c) =>
        `<div class="archCard courseCard locked" style="--course-art:url('${c.art}')" aria-disabled="true">` +
        `<div class="lockBadge">Coming soon</div>` +
        `<div class="ahead"><span class="an">${c.icon} ${c.name}</span></div>` +
        `<div class="courseMeta"><span class="diff diff-${c.difficulty.toLowerCase()}">${c.difficulty}</span>` +
        `<span>${c.tag}</span></div>` +
        `</div>`
    ).join('') +
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
let lkTab: 'char' | 'style' | 'pal' | 'perk' | 'cosmetics' | 'upgrades' =
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
  // THE CHARACTER TAB MEANS "WHO AM I", whoever that is right now.
  //
  // Playing a career Pro, it sets THAT PRO's face; on a preset style it sets
  // `sel.character` as it always did. One grid, one meaning — and it is what
  // frees the Style card, whose cramped LOOK row (a wrapping strip of 44px
  // portraits under the Pro's name, inside a scroll box ~380px tall) the owner
  // asked to be rid of: "feels like we don't need the look part under the name
  // that way there's more space to see".
  const careerPro =
    flag('careerMode') && sel.archetype === 'career'
      ? p.career.pros.find((pr) => pr.id === p.career.activeProId) ?? null
      : null;
  const shownChar = careerPro ? careerPro.character : sel.character;
  const charCards =
    (careerPro
      ? `<div class="lkTabNote">Choosing the face for <b>${escapeHtml(careerPro.name)}</b>, your career Pro.</div>`
      : '') +
    ownedChars
      .map(
        (ch) =>
          `<div class="charCard${shownChar === ch.key ? ' sel' : ''}" data-ch="${ch.key}">` +
          `<img src="ui/characters/${ch.key}.png" alt="${ch.name}" loading="lazy" />` +
          `<div class="cn">${ch.name}</div></div>`
      )
      .join('');
  // CAREER MODE: your Pro leads the Style tab — a rookie you start once and
  // grow with CP, selectable exactly like the five presets beneath it.
  const STAT_SHORT: Record<keyof GolferStats, string> = {
    drivingPower: 'PWR',
    drivingAccuracy: 'ACC',
    approach: 'APP',
    chipping: 'CHP',
    putting: 'PUT'
  };
  const careerCards = ((): string => {
    if (!flag('careerMode')) return '';
    const c = p.career;
    // One card per Pro in the stable. The ACTIVE Pro carries the spend chips
    // and the Look row (their dedicated character); the others are a tap away
    // from being active again — retirement is soft.
    const proCard = (pro: (typeof c.pros)[number]): string => {
      const isActive = pro.id === c.activeProId;
      const selected = isActive && sel.archetype === 'career';
      const upgraded = applyClubUpgrades(pro.attrs, p.clubUpgrades);
      const sig = archetypeById(pro.styleId).signature;
      // A Pro who has played out all SEASON_LIMIT seasons is retired: no more
      // tour, no more attribute growth. Their record stands and they stay
      // playable in casual rounds (owner pass 9).
      const retired = proRetired(p.tourHistory, pro.id);
      const rec = p.tourHistory[pro.id];
      const tag = retired
        ? `🏛 Hall of Fame · ${rec?.wins ?? 0} wins · ${rec?.majorWins ?? 0} majors`
        : isActive
          ? `grows as you play · ${spendableCp(p)} CP to spend`
          : 'in the stable — tap to play as them';
      let inner =
        `<div class="ahead"><span class="an">${retired ? '🏛' : '🎓'} ${escapeHtml(pro.name)}</span>` +
        `<span class="atag">${tag}</span>` +
        `<span class="aovr">OVR ${ovr(upgraded)}</span></div>` +
        // The ghost preview only belongs on the Pro you can actually spend on:
        // a retired Pro's attributes are frozen, and a stabled one is not the
        // one the CP buys for.
        statBars(
          upgraded,
          sig,
          p.clubUpgrades,
          isActive && !retired ? { bank: spendableCp(p), base: pro.attrs } : undefined
        );
      if (isActive && retired) {
        inner +=
          `<div class="recSub">${escapeHtml(pro.name)} has played out all ${SEASON_LIMIT} seasons. ` +
          `Start a new Pro to tour again — this career is in the books.</div>`;
      }
      if (isActive && !retired) {
        // THE BALANCE ONCE, AT THE TOP — not repeated on five buttons. Five
        // chips each ending "· 8 CP" wrapped to three lines on a phone and
        // still never said how much you HAD.
        const bank = spendableCp(p);
        const spendRow = (Object.keys(STAT_SHORT) as Array<keyof GolferStats>)
          .map((k) => {
            const cost = pointCost(pro.attrs[k]);
            // MAX at the EFFECTIVE ceiling, not just the 99 base cap: with a
            // driver upgrade the engine and the card both clamp at 100, so a
            // point past base+bonus=100 buys literally nothing (owner, with a
            // screenshot of PWR 100 still selling points for 10 CP).
            const maxed = !Number.isFinite(cost) || pro.attrs[k] + upgradeStatBonus(k, p.clubUpgrades) >= 100;
            const can = !maxed && bank >= cost;
            const label = maxed ? 'MAX' : `+1`;
            const title = maxed ? 'Already at the ceiling' : `${cost} CP`;
            return (
              `<button class="cpSpend" data-cspend="${k}"${can ? '' : ' disabled'} title="${title}">` +
              `<span class="cpsK">${STAT_SHORT[k]}</span><span class="cpsV">${label}</span>` +
              (maxed ? '' : `<span class="cpsC">${cost}</span>`) +
              `</button>`
            );
          })
          .join('');
        inner +=
          `<div class="cpBank">${bank} CP to spend</div>` +
          `<div class="careerSpendRow">${spendRow}</div>`;
        // The LOOK row is gone from here — it lives on the Character tab now,
        // in a proper grid rather than a wrapping strip of 44px thumbnails
        // squeezed under the Pro's name (owner: "it's too [cramped] in the
        // style menu ... we don't need the look part under the name that way
        // there's more space to see").
      }
      return `<div class="archCard careerCard${selected ? ' sel' : ''}" data-pro="${pro.id}" style="--accent:#d9a441">${inner}</div>`;
    };
    // The New Pro card: name them, pick a style. Doubles as the start-a-career
    // card when the stable is empty.
    const opts = ARCHETYPES.map((a) => `<button class="careerStart" data-cstart="${a.id}">${a.name}</button>`).join('');
    // NAME FIRST, EXPLANATION UNDER THE CHOICE. The card used to open with a
    // paragraph and bury the input below it, so the first thing a new player
    // met was prose rather than the field they had to fill in.
    const head = c.pros.length ? `<span class="an">➕ New Pro</span>` : `<span class="an">🎓 Your Pro — start a career</span>`;
    const foot = c.pros.length
      ? 'A fresh rookie at 65. Unspent CP carries over, and your current Pro stays in the stable.'
      : 'A rookie at 65 overall who grows every round YOU play.';
    const newCard =
      `<div class="archCard careerNew" style="--accent:#d9a441">` +
      `<div class="ahead">${head}</div>` +
      `<input id="proName" class="proNameInput" type="text" maxlength="18" placeholder="Pro name" autocomplete="off" />` +
      `<div class="careerStartRow">${opts}</div>` +
      `<div class="atag careerNewFoot">${foot}</div></div>`;
    return c.pros.map(proCard).join('') + newCard;
  })();
  const archCards =
    careerCards +
    ARCHETYPES.map((a) => {
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
    // Patterned balls preview as their pattern here too — the Locker is where
    // you choose between the ones you own, so they cannot all read as white.
    const bg = item.ballArt ? ballArtSwatchCss(item.ballArt) : item.color !== undefined ? hex(item.color) : '#2b6b41';
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
  // SIX TABS, NOT NINE. Outfit / Ball / Trail / Skin are four tabs of the same
  // thing — colours you own — and on a phone nine tabs wrap to two rows and eat
  // the scroll area the cards need. They fold into one Cosmetics tab with the
  // four kinds stacked under their own headings; nothing is lost, and the tab
  // bar fits one line again.
  const tabs: Array<[typeof lkTab, string]> = [
    ['char', 'Character'],
    ['style', 'Style'],
    ['pal', 'Pal'],
    ['perk', 'Perk'],
    ['cosmetics', 'Cosmetics'],
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
                  // All four cosmetic kinds, each under its own heading, in one
                  // scroll. A kind you own nothing in says so rather than
                  // rendering an empty grid.
                  const KINDS: Array<[typeof lkTab & string, 'outfit' | 'ball' | 'trail' | 'clubskin', string]> = [
                    ['cosmetics', 'outfit', 'Outfit'],
                    ['cosmetics', 'ball', 'Ball'],
                    ['cosmetics', 'trail', 'Trail'],
                    ['cosmetics', 'clubskin', 'Club skin']
                  ];
                  return KINDS.map(([, kind, label]) => {
                    const items = cosmeticTabs[kind];
                    return (
                      `<div class="lkSubHead">${label}</div>` +
                      (items.length
                        ? `<div class="charGrid">${items.map((i) => cosmeticCard(kind, i)).join('')}</div>`
                        : `<div class="lkEmpty">Nothing here yet — the Store and the Season Pass stock these.</div>`)
                    );
                  }).join('');
                })();

  lockerEl.style.display = 'flex';
  lockerEl.innerHTML =
    `<div class="storeInner lockerInner">` +
    `<div class="lkTop"><h2>🎽 Locker Room</h2><button id="lkBack" class="ghostBtn">Done</button></div>` +
    `<div class="lkName">Golfer: <b>${escapeHtml(p.name || 'Player')}</b> <button id="lkEditName" class="ghostBtn">Edit</button></div>` +
    `<div class="recTabs lkTabs">${tabBar}</div>` +
    `<div class="storeScroll lkScroll">${body}</div>` +
    // The two places you GET the things this room equips. Everything in here
    // is bought on the Season Pass or in the Store, so sending the player back
    // out to the landing to reach either was a round trip through a menu they
    // had already navigated once.
    `<div class="lkGet"><button id="lkSeason" class="lkFootBtn">🎫 Season Pass</button>` +
    `<button id="lkStore" class="lkFootBtn">🛍️ Store</button></div>` +
    `<div class="lkFooter"><button id="lkRandom" class="lkFootBtn">🎲 Randomize</button>` +
    `<button id="lkLock" class="lkFootBtn primary">${p.loadoutLocked ? '✓ Locked in' : 'Lock it in'}</button></div>` +
    `</div>`;
  // 'click' — see the #lkLock comment below: hiding a full-screen overlay on
  // the down-stroke lets the release land on whatever is exposed underneath.
  // Leave the room first: with the locker left open it painted OVER the
  // overlay it had just launched (all three shared z-index 25 and the locker
  // is last in the DOM), so these two buttons looked dead until Done.
  // Same bug, one level down: the Locker hides itself to open these, so their
  // Back used to land on the landing rather than back in the Locker.
  lockerEl.querySelector('#lkSeason')!.addEventListener('click', () => {
    lockerEl.style.display = 'none';
    pushReturn(() => renderLockerRoom());
    renderSeasonPass();
  });
  lockerEl.querySelector('#lkStore')!.addEventListener('click', () => {
    lockerEl.style.display = 'none';
    pushReturn(() => renderLockerRoom());
    renderStore();
  });

  lockerEl.querySelectorAll('.lkTab').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      lkTab = (el as HTMLElement).dataset.tab as typeof lkTab;
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.charCard[data-ch]').forEach((el) =>
    onTap(el, () => {
      const key = (el as HTMLElement).dataset.ch as CharacterKey;
      // Career Pro active → this is that Pro's face (see charCards). Otherwise
      // it is the preset loadout's character, exactly as before.
      const c = profile.career;
      if (flag('careerMode') && sel.archetype === 'career' && c.activeProId) {
        profile.career = setProLook(c, c.activeProId, key);
        persistProfile();
        if (signedIn)
          void cloudSyncProfile(profile).then((res) => {
            applyCloudMerge(profile, res.profile);
            showCloudStatus(res.status, true);
          });
      } else {
        sel.character = key;
        syncLoadout();
      }
      renderLockerRoom();
    })
  );
  lockerEl.querySelectorAll('.archCard[data-arch]').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      sel.archetype = (el as HTMLElement).dataset.arch as ArchetypeId | 'career';
      syncLoadout();
      renderLockerRoom();
    })
  );
  // Career: a tap on a Pro's card makes them active AND selects the career
  // style — the stable is one tap from "play as them".
  lockerEl.querySelectorAll('.careerCard[data-pro]').forEach((el) =>
    el.addEventListener('pointerdown', () => {
      profile.career = setActivePro(profile.career, (el as HTMLElement).dataset.pro!);
      sel.archetype = 'career';
      syncLoadout();
      renderLockerRoom();
      refreshProgressSurfaces();
    })
  );
  // Begin a Pro (name + starting style) and grow the active one (spend CP).
  // stopPropagation — these rows live INSIDE selectable cards.
  lockerEl.querySelectorAll('.careerStart[data-cstart]').forEach((el) =>
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const nameEl = lockerEl.querySelector('#proName') as HTMLInputElement | null;
      profile.career = startPro(profile.career, {
        name: nameEl?.value ?? '',
        styleId: (el as HTMLElement).dataset.cstart as ArchetypeId,
        character: sel.character,
        now: Date.now()
      });
      sel.archetype = 'career';
      syncLoadout();
      renderLockerRoom();
      // The landing underneath reads career state (the Locker tile's "CP to
      // spend" line) — repaint it NOW, not when something else happens to.
      refreshProgressSurfaces();
    })
  );
  lockerEl.querySelectorAll('.cpSpend[data-cspend]').forEach((el) =>
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const key = (el as HTMLElement).dataset.cspend as keyof GolferStats;
      if (!buyProAttrPoint(profile, key, upgradeStatBonus(key, profile.clubUpgrades))) return;
      persistProfile();
      if (signedIn) void cloudSyncProfile(profile).then((res) => { applyCloudMerge(profile, res.profile); showCloudStatus(res.status, true); });
      renderLockerRoom();
      // Owner report, verbatim: "the CP to spend on your Pro didn't reset
      // after I spent it" — the Locker tile behind this overlay kept its old
      // line because nothing repainted the landing after a spend.
      refreshProgressSurfaces();
    })
  );
  // The active Pro's dedicated look — what they wear EVERY round, shuffle or
  // not (the owner's "dedicate a skin and a look").
  lockerEl.querySelectorAll('.proLook[data-look]').forEach((el) =>
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const c = profile.career;
      if (!c.activeProId) return;
      profile.career = setProLook(c, c.activeProId, (el as HTMLElement).dataset.look as CharacterKey);
      persistProfile();
      if (signedIn) void cloudSyncProfile(profile).then((res) => { applyCloudMerge(profile, res.profile); showCloudStatus(res.status, true); });
      renderLockerRoom();
    })
  );
  // Typing a rookie's name must not bubble into card selection.
  lockerEl.querySelector('#proName')?.addEventListener('pointerdown', (e) => e.stopPropagation());
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
      refreshProgressSurfaces();
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
    // Confirming is still LEAVING the Locker, so it owes the same return as Done.
    goBack(() => {});
  });
  document.getElementById('lkEditName')!.addEventListener('pointerdown', () => promptName(true));
  document.getElementById('lkBack')!.addEventListener('click', () => {
    lkPendingBuy = null;
    lockerEl.style.display = 'none';
    // Back to whoever opened the Locker — the tour hub, usually — instead of
    // whatever happens to be underneath (which is the landing, because the
    // caller hid itself on the way in).
    goBack(() => {});
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
  else renderOpponent();
  replayAnim(stepBodyEl, 'animIn'); // each wizard step slides gently into place
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


function goStep(n: number): void {
  sel.step = Math.max(0, Math.min(stepLabels().length - 1, n));
  renderSteps();
  renderStepBody();
  updateNav();
}

/**
 * WHERE "BACK" GOES.
 *
 * Every overlay in this file closes the same way — hide myself, and whatever is
 * underneath becomes visible again. That works only while a screen has exactly
 * ONE caller, and the Locker Room has seven: the landing, the landing nav, the
 * Tour tile, the tour hub's "Improve your Pro", the retired-Pro deep link, the
 * co-op invite, and the career-less hub. Six of those hide their own screen on
 * the way in, so hiding the Locker on the way out drops the player on the
 * LANDING rather than where they were (owner: "the menus when you improve your
 * pro always go back to the main menu rather than where you came from. Any
 * going back should always take you back to where you came from").
 *
 * So a screen that can be reached from more than one place records how to get
 * back before it opens, and its Back button runs that instead of just hiding.
 * A stack, not a single slot, because the Locker can open the Store and the
 * Season Pass and those have the same bug for the same reason.
 *
 * Deliberately small: no router, no history integration, no per-screen state.
 * It holds closures that RE-RENDER a screen, so a stale entry can only ever
 * repaint something from live profile data.
 */
const navReturn: Array<() => void> = [];

/** Record where Back should go, then open the next screen. */
function pushReturn(back: () => void): void {
  navReturn.push(back);
  // A player who wanders in circles must not grow this forever. Six is deeper
  // than any real path in the game.
  if (navReturn.length > 6) navReturn.shift();
}

/**
 * Run the most recent return, or `fallback` when there is none (the screen was
 * opened from the landing, where hiding it IS going back).
 *
 * MUST be bound on 'click', never 'pointerdown' — hiding a full-screen overlay
 * on the down-stroke lets the release hit-test onto whatever is underneath and
 * opens a screen the player never asked for. The whole file documents this.
 */
function goBack(fallback: () => void): void {
  const back = navReturn.pop();
  (back ?? fallback)();
}

/** Drop any recorded returns — the landing is the root, so nothing above it. */
function clearReturns(): void {
  navReturn.length = 0;
}

function showLanding(): void {
  // The boot watchdog (index.html) shows a reload panel if NOTHING paints —
  // the menus being up is the definition of a healthy boot.
  (window as unknown as { __booted?: boolean }).__booted = true;
  clearReturns(); // the landing is the root of navigation
  endPractice();
  tutorialCoach.stop(); // returning home ends any in-progress lesson + overlay
  setupEl.style.display = 'none';
  landingEl.classList.add('on');
  // Coming home always lands on the top level, never inside whichever door was
  // last opened.
  closeDest();
  refreshLandingCards(); // owns the "Learn to play" entry (incl. its new-player hero)
  updateLandingProfileButton();
  applyAccountCta(); // signed out → the account is the hero, Quick Start steps down
}

/** Render the landing's profile-driven surfaces (daily/weekly cards, Season
 *  Pass/Store reveal) from the CURRENT profile. Split out of showLanding so
 *  the async account adoption can re-run it when the profile fills in — the
 *  cards used to render once from the boot-empty profile and only recover
 *  after a Play Now round-trip re-entered showLanding (playtest: "results
 *  wiped until I go to play now and back"). No-op while the landing is
 *  hidden. */
function refreshLandingCards(): void {
  if (!landingEl.classList.contains('on')) return;
  // Progressive disclosure (Part 11): a brand-new player sees core golf and
  // one big Play action — the daily/weekly cards and Season Pass/Store
  // entries reveal after the first completed round on this device.
  const newPlayer = isNewPlayer();
  const dailyCardEl = document.getElementById('dailyCard');
  const weeklyCardEl = document.getElementById('weeklyCard');
  const seasonBtn = document.getElementById('landingSeason');
  const storeBtn = document.getElementById('landingStore');
  if (newPlayer) {
    if (dailyCardEl) dailyCardEl.innerHTML = '';
    if (weeklyCardEl) weeklyCardEl.innerHTML = '';
    if (seasonBtn) seasonBtn.style.display = 'none';
    if (storeBtn) storeBtn.style.display = 'none';
  } else {
    if (seasonBtn) seasonBtn.style.display = '';
    if (storeBtn) storeBtn.style.display = '';
    // The Store art tile carries the same amber "something new here" as the
    // coins chip — tint only, since the tile is artwork with a label and extra
    // copy would sit on top of the picture.
    storeBtn?.classList.toggle('hasNews', storeHasNewItems());
    updateDailyBanner();
    updateWeeklyCard();
  }
  updateLearnEntry(newPlayer);
  updateResumeCard();
  updateSetupEntry();
  updateGhostCard();
  updateDailyHoleCard();
  // Practice lives on the course chooser now (the "Go to the range" bar), so
  // the Today pane no longer carries an entry for it.
  const rangeBar = document.getElementById('rangeBar');
  if (rangeBar) rangeBar.style.display = flag('practiceRange') ? '' : 'none';
  // The destinations are painted LAST: each tile's headline is read off the
  // cards above, so it has to run after they exist.
  refreshProgressSurfaces();
}

/**
 * Progressive disclosure (Part 11): a device that has never finished a round is
 * shown core golf and nothing else.
 */
function isNewPlayer(): boolean {
  return !deviceSettings.firstRoundDone && profile.stats.rounds === 0;
}

/**
 * Repaint the landing's progression surfaces after XP, coins or a claim moved.
 *
 * Cheap — arithmetic over the profile and a handful of DOM writes, no card
 * regeneration — so purchase, claim and end-of-round handlers can call it
 * directly. This is what the dead `updateSeasonLink`/`updateStoreBanner` pair
 * were reaching for.
 */
function refreshProgressSurfaces(): void {
  const newPlayer = isNewPlayer();
  updateProgressStrip(newPlayer);
  // The Tour tile is painted inside updateDestinations, so a career start or
  // a finished event refreshes it on the same call.
  updateDestinations(newPlayer);
  // The Quick Start button quotes the Pro's name and OVR — a CP spend in the
  // locker has to reach it NOW, not on the next full landing rebuild (owner:
  // the button kept saying 71 after the Pro grew to 75).
  updateSetupEntry();
  // Signing in mid-session has to take the CTA away, and updateDestinations
  // above repaints the tile the CTA hides.
  applyAccountCta();
}

// ---------------------------------------------------------------------------
// THE LANDING'S INFORMATION ARCHITECTURE
//
// The panel had grown to ten stacked cards — resume, hole of the day, ghost,
// challenge, daily, weekly, play, learn, course & mode, practice, then a nav
// grid — so the screen answered "what can this game do" instead of "what shall
// I do now", and on a phone the primary action was below the fold. The vision
// doc asks for "a clear primary action rather than a dashboard of competing
// demands"; the design constitution (rule 5) makes reachability without
// scrolling a hard requirement.
//
// The shape is now ONE PRIMARY ACTION and FOUR DOORS:
//
//   Play         the action. Tees off on the rotation's next course.
//   Tour Season  the Pro's season — acts directly, no sheet (career 2b; the
//                daily surfaces that lived here as "Today" are all under the
//                🔥 chip's popup now, per the owner)
//   Locker       season pass, store, locker room
//   More         profile, about, and the dev/admin tools when they apply
//
// Nothing was deleted and nothing became harder to find: each tile carries a
// one-line headline of what is behind it, so the daily hole and the streak
// still advertise themselves from the top level. A door with nothing written on
// it would be worse than the stack it replaced.
// ---------------------------------------------------------------------------

// 'today' retired (career round 2b): the Tour Season tile took its slot, and
// the daily surfaces all live under the 🔥 chip's popup.
type DestId = 'locker' | 'more';

const DEST_TITLES: Record<DestId, string> = {
  locker: 'Locker',
  // The id stays 'more' (it is baked into markup, specs and muscle memory);
  // only what the player reads changed.
  more: 'Profile'
};

/** Level · streak · coins, in one quiet row. Replaces three separate banners
 *  that each argued for attention against the Play button. */
function updateProgressStrip(newPlayer: boolean): void {
  const el = document.getElementById('progressStrip');
  if (!el) return;
  // A player with no rounds has no progression to report, and an empty ladder
  // is a worse first impression than no ladder.
  if (newPlayer) {
    el.innerHTML = '';
    return;
  }
  const { level } = levelProgress(SEASON_1, profile.season.xp);
  const streak = currentStreak(profile.retention.streak, todayKey());
  // BUTTONS, not readouts. Each chip is the front door to the thing it
  // reports: the level to the pass that pays it, the streak to today's
  // challenge that feeds it, the coins to the store that spends them. Bound on
  // 'click' (the tap-through rule — see the destination tiles).
  // The coins chip doubles as the store's notification. It is one of three in a
  // nowrap flex row, so "new items available" cannot share the line with the
  // balance on a phone — it goes underneath, and only when there is actually
  // something unseen. `.hasNews` is the same amber the Tour and Locker tiles use
  // for "something is waiting for you here".
  const shelfNew = storeHasNewItems();
  el.innerHTML =
    `<button id="psLevel">Level ${level}</button>` +
    `<button id="psStreak">${streak > 0 ? `🔥 ${streak} day${streak > 1 ? 's' : ''}` : '🔥 Daily'}</button>` +
    `<button id="psCoins"${shelfNew ? ' class="hasNews"' : ''}>` +
    `<span class="psMain">🪙 ${profile.coins}</span>` +
    (shelfNew ? `<span class="psSub">New items</span>` : '') +
    `</button>`;
  document.getElementById('psLevel')!.addEventListener('click', () => renderSeasonPass());
  document.getElementById('psStreak')!.addEventListener('click', () => openDailyPopup());
  document.getElementById('psCoins')!.addEventListener('click', () => renderStore());
}

/**
 * THE DAILY-CHALLENGE POPUP — the 🔥 chip's destination.
 *
 * The daily challenge is deliberately passive (it evaluates at the end of ANY
 * round — ProgressionEngine.applyRound), which made it invisible: a status
 * card buried in a pane, with nothing to tap. It is the reason to come back
 * today, so it gets a surface of its own: what the challenge is, whether it is
 * done, what the streak is worth, and one button that starts a round.
 */
function openDailyPopup(): void {
  // ALL of today's surfaces live in this popup now (career round 2b): the
  // challenge, the Hole of the Day, the ghost race and the weekly — repaint
  // each so the popup always opens fresh.
  updateDailyBanner();
  updateDailyHoleCard();
  updateGhostCard();
  updateWeeklyCard();
  document.getElementById('dailyPopup')?.classList.add('on');
}

function closeDailyPopup(): void {
  document.getElementById('dailyPopup')?.classList.remove('on');
}

/**
 * Paint the four tiles: which are offered, and what each one says.
 *
 * Progressive disclosure (Part 11) survives the rebuild, one level up: a
 * brand-new player is offered Play, Compete and More — core golf and their
 * account — while Today and Locker stay closed until a first round is in the
 * books. Previously the same rule blanked individual cards, which left the
 * player looking at gaps.
 */
function updateDestinations(newPlayer: boolean): void {
  const tile = (id: DestId): HTMLElement | null => document.getElementById(`dest${id[0].toUpperCase()}${id.slice(1)}`);
  const set = (id: DestId, shown: boolean, sub: string, news = false): void => {
    const el = tile(id);
    if (!el) return;
    el.style.display = shown ? '' : 'none';
    const s = el.querySelector('.dtSub');
    if (s) s.textContent = sub;
    el.classList.toggle('hasNews', shown && news);
  };

  // TOUR SEASON — the tile that took Today's slot (the daily surfaces all
  // live under the 🔥 chip now). It acts directly: tap to play the next
  // event, or to open the Locker when no career has started.
  const tourTile = document.getElementById('destTour');
  if (tourTile) {
    const showTour = flag('careerMode') && !newPlayer;
    tourTile.style.display = showTour ? '' : 'none';
    const sub = tourTile.querySelector('.dtSub');
    if (sub) {
      const tilePro = activePro(profile.career);
      if (!careerStarted(profile.career)) {
        sub.textContent = 'start a career to join';
      } else if (tilePro && proRetired(profile.tourHistory, tilePro.id)) {
        sub.textContent = `🏛 ${tilePro.name} retired — start a new Pro`;
      } else {
        const t = tourNow();
        const def = t ? currentEvent(t, tourCourseIds()) : null;
        if (!t) {
          sub.textContent = `16 events · 4 majors · Event 1/${TOUR_EVENTS}`;
        } else if (def) {
          const roundsIn = eventRoundsPlayed(t);
          const stage = playoffPending(t, tourCourseIds())
            ? ' · ⚔ playoff — settle the tie'
            : def.major && roundsIn > 0
              ? ` · round ${roundsIn + 1}/${def.rounds}`
              : def.major
                ? ' · MAJOR'
                : '';
          sub.textContent = `Event ${def.idx + 1}/${TOUR_EVENTS} · ${tourEventName(def)}${stage}`;
        } else {
          sub.textContent = 'season complete';
        }
      }
    }
    // A major mid-play is the one thing here worth a glow.
    const t = tourNow();
    const majorLive = !!t && !!currentEvent(t, tourCourseIds())?.major;
    tourTile.classList.toggle('hasNews', showTour && majorLive);
  }

  // LEADERBOARDS — the Compete door collapsed into the one thing behind it
  // once tournaments were stripped: a door with one thing behind it IS that
  // thing. Direct button, no sheet.
  const boards = document.getElementById('destBoards');
  if (boards) {
    const sub = boards.querySelector('.dtSub');
    if (sub) sub.textContent = flag('recordBoards') ? 'drives · aces · averages' : 'best rounds by course';
  }

  // LOCKER — an unclaimed reward is the one thing here worth interrupting
  // for; otherwise the sub says what the room actually IS (owner: "being able
  // to select character and other things needs to be more clear") — the Season
  // Pass and Store already have their own chips on the progression strip.
  const claimable = seasonClaimableCount();
  // Unspent CP is the second thing worth interrupting for: growth waiting to
  // be taken (career mode).
  const cpWaiting = flag('careerMode') && careerStarted(profile.career) ? spendableCp(profile) : 0;
  set(
    'locker',
    !newPlayer,
    claimable > 0
      ? `${claimable} reward${claimable > 1 ? 's' : ''} to claim`
      : cpWaiting >= 2
        ? `📈 ${cpWaiting} CP to spend on your Pro`
        : 'change golfer · clubs · gear',
    claimable > 0 || cpWaiting >= 2
  );

  // MORE — the account, and the tools when they apply.
  // Signed out this door is the account CTA as well as Settings, and it says
  // so — the landing hero above it opens the same screen (see applyAccountCta).
  // Named here rather than in applyAccountCta because this is the function that
  // owns the tiles; two writers for one label is how a label starts flickering.
  const moreTile = tile('more');
  const moreName = moreTile?.querySelector('.dtName');
  if (moreName) moreName.textContent = guestWithNoAccount() ? 'Account & Settings' : 'Profile';
  set(
    'more',
    true,
    signedIn ? profile.name || 'Your account' : 'Save your progress',
    guestWithNoAccount()
  );

  // THE TOOLS. Two different gates, deliberately: Admin follows the signed-in
  // ACCOUNT (so an admin sees it in production, which is where they need it),
  // Dev follows the environment plus the devTools flag. Binding both to
  // devToolsActive() — as the first cut did — hid the admin panel from the
  // only place it matters.
  const show = (id: string, on: boolean): void => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  };
  // ONE ADMIN DOOR (`focusedGame`). Admin panel, admin dashboard and dev tools
  // were three separate entries to three surfaces that all mean "the owner's
  // controls". Stripped, there is one, and it opens the dashboard where
  // everything lives.
  const focused = flag('focusedGame');
  show('landingAdmin', adminUnlocked() && !focused);
  show('landingAdminSite', adminUnlocked() || (focused && devToolsActive()));
  show('landingDev', devToolsActive() && !focused);
  show('landingBuilder', devToolsActive());
}

/** How many season-pass levels are sitting unclaimed. Cheap arithmetic over the
 *  profile — no I/O — so it is safe on a landing paint. */
function seasonClaimableCount(): number {
  let n = 0;
  for (let level = 1; level <= SEASON_1.levels; level++) {
    if (claimState(profile, SEASON_1, level) === 'claimable') n++;
  }
  return n;
}

function openDest(id: DestId): void {
  const sheet = document.getElementById('destSheet');
  const title = document.getElementById('destSheetTitle');
  if (!sheet || !title) return;
  title.textContent = DEST_TITLES[id];
  for (const pane of Array.from(document.querySelectorAll('.destPane'))) {
    pane.classList.toggle('on', pane.id === `pane${id[0].toUpperCase()}${id.slice(1)}`);
  }
  sheet.classList.add('on');
  document.getElementById('destSheetBody')!.scrollTop = 0;
}

function closeDest(): void {
  document.getElementById('destSheet')?.classList.remove('on');
}

/**
 * THE RIVAL (`rival`).
 *
 * The daily hole answers "what shall I play today". The rival answers "why
 * today rather than whenever" — there is a person on the other side of it, the
 * fixture is settled at the end of the day, and the record between you is
 * unfinished by construction. See systems/Rival.ts for the reasoning.
 *
 * Everything here is lazy and memoised: assigning a rival and synthesising
 * their round happen when the landing paints, never during play.
 */
function ensureRival(): void {
  if (flag('focusedGame')) return; // stripped — see the flag registry
  const r = profile.retention.rival;
  if (hasRival(r)) return;
  // Calibrate against recent form so the very first rival is already the right
  // size. `toPar` is per ROUND; the standard is per hole.
  const recent = loadLocal()
    .slice(-10)
    .map((x) => (x.holes.length ? x.toPar / x.holes.length : 0));
  const skill = calibrateRivalSkill(recent);
  // Seeded off the player's own id, so the same person meets the same rival on
  // every device they sign in on — and a fresh device does not hand them a
  // stranger mid-rivalry.
  let seed = 2166136261;
  for (const ch of profile.id || 'guest') {
    seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  }
  const house = houseRival(seed >>> 0, skill);
  profile.retention.rival = {
    ...profile.retention.rival,
    id: house.id,
    name: house.name,
    kind: 'house',
    seed: house.seed,
    skill: house.skill
  };
  analytics.track('rival_assigned', { kind: 'house' });
}

/**
 * FRIEND RIVALS. Adopting a real person as the rival, and keeping the channel
 * they post their rounds to.
 *
 * A rivalry is mutual, so it cannot be established by a one-way link: the
 * sender never learns who accepted. The link carries an invite CODE naming a
 * rendezvous both sides read — see `firebase/Rivals.ts`. This side of it is:
 * create one, accept one, and check whether an invite you sent was taken up.
 */
function adoptFriendRival(playerId: string, name: string): void {
  if (!playerId || !name) return;
  profile.retention.rival = {
    ...profile.retention.rival,
    id: playerId,
    name: name.slice(0, 20),
    kind: 'friend',
    // A friend's standard is whatever they actually shoot; the synthesis dial
    // is meaningless for them and is zeroed so it can never be read by mistake.
    skill: 0,
    // A new opponent starts a new record. Carrying the old one forward would
    // credit this person with wins against somebody else.
    wins: 0,
    losses: 0,
    ties: 0,
    history: [],
    lastDate: ''
  };
  rivalRoundCache = null;
  persistProfile();
  analytics.track('rival_assigned', { kind: 'friend' });
  showMsg(`${name} is your rival. Play today's hole to open the account.`, 3200);
  showLanding();
}

/** The invite this device sent and is waiting on, if any (device-local — it is
 *  a pending handshake, not profile state worth syncing). */
const PENDING_RIVAL_INVITE_KEY = 'bsg.rivalInvite.v1';

function pendingRivalInvite(): string {
  try {
    return localStorage.getItem(PENDING_RIVAL_INVITE_KEY) ?? '';
  } catch {
    return '';
  }
}

function setPendingRivalInvite(code: string): void {
  try {
    if (code) localStorage.setItem(PENDING_RIVAL_INVITE_KEY, code);
    else localStorage.removeItem(PENDING_RIVAL_INVITE_KEY);
  } catch {
    /* storage blocked — the invite simply cannot be tracked on this device */
  }
}

/** Create and share a rival invite. */
async function inviteRival(): Promise<void> {
  const code = makeRivalInviteCode();
  const me = { playerId: challengePlayerId(), name: profile.name || 'Player' };
  const ok = await createRivalInvite({ code, from: me, at: Date.now() });
  if (!ok) {
    showMsg('Could not create the invite — check your connection', 2400);
    return;
  }
  setPendingRivalInvite(code);
  const url = `${location.origin}${location.pathname}?rival=${encodeURIComponent(code)}`;
  await shareOrCopy(`Be my rival on Bite-Sized Golf — same hole every day, ghost for ghost.`, url);
  updateDailyHoleCard();
}

/** Open an invite someone sent: adopt them, and claim the other half so they
 *  can adopt you back. */
async function receiveRivalInvite(code: string): Promise<void> {
  const invite = await fetchRivalInvite(code);
  if (!invite) {
    showMsg('That rival invite has expired', 2400);
    return;
  }
  const me = challengePlayerId();
  if (invite.from.playerId === me) {
    showMsg('That is your own invite — send it to a friend', 2600);
    return;
  }
  await acceptRivalInvite(code, { playerId: me, name: profile.name || 'Player' });
  adoptFriendRival(invite.from.playerId, invite.from.name);
}

/** Has an invite this device sent been accepted? Checked when the landing
 *  paints — one bounded read, and only while an invite is outstanding. */
async function checkPendingRivalInvite(): Promise<void> {
  const code = pendingRivalInvite();
  if (!code || !flag('rival')) return;
  const invite = await fetchRivalInvite(code);
  if (!invite?.to) return;
  setPendingRivalInvite('');
  adoptFriendRival(invite.to.playerId, invite.to.name);
}

/** Today's rival round, memoised for the session (synthesis is a few ms of
 *  pure physics, but it should still happen once). */
let rivalRoundCache: { key: string; rec: RoundRecording | null } | null = null;

/** A friend rival's round for today, once fetched. Kept beside the synthesis
 *  cache so both kinds of rival read through one path. */
let friendRivalToday: { key: string; entry: RivalEntry | null } | null = null;

/**
 * A rival round on ANY course — the opponent that always exists.
 *
 * "Race your best" needs you to have already recorded a good round, so on a
 * course you have not played it shows nothing. The rival has no such problem:
 * their round is played headlessly through the real physics at a standard
 * calibrated just above you, and it verifies against the same replay engine a
 * human's round does. Memoised per (course, rival, standard) — synthesis is a
 * few ms of arithmetic, but it belongs on the landing paint, never in play.
 */
const rivalByCourse = new Map<string, RoundRecording | null>();

function rivalRoundFor(courseId: string, course: CourseData, holes: number): RoundRecording | null {
  if (!flag('rival') || !flag('roundRecording') || !flag('ghostRace')) return null;
  ensureRival();
  const r = profile.retention.rival;
  // A friend's rounds are theirs to play; only a house rival can be synthesised
  // for an arbitrary course.
  if (!hasRival(r) || r.kind !== 'house') return null;
  const key = `${courseId}|${r.id}|${r.skill}|${holes}`;
  const hit = rivalByCourse.get(key);
  if (hit !== undefined) return hit;
  const theme = resolveTheme(course);
  const rec = synthesiseRivalRound({
    courseId,
    course,
    holes,
    name: r.name,
    seed: r.seed,
    skill: r.skill,
    // Stable per course rather than per day: this is a standing challenge on
    // that course, not today's fixture.
    dateKey: `course:${courseId}`,
    at: Date.now(),
    useAuthoredPins: flag('layouts'),
    bounded: flag('boundedWorld'),
    bunkerDepthScale: theme.bunkerDepthScale ?? 1,
    wasteDepthScale: theme.wasteDepthScale ?? 0,
    edgeWobble: theme.edgeWobble ?? 1,
    treeSpecies: { trees: theme.treeKeys ?? DEFAULT_TREE_MIX, accents: theme.accentTreeKeys ?? [] }
  });
  rivalByCourse.set(key, rec);
  return rec;
}

function todaysRivalRound(dateKey: string, courseId: string, course: CourseData): RoundRecording | null {
  if (!flag('rival') || !flag('roundRecording') || !flag('ghostRace')) return null;
  ensureRival();
  const r = profile.retention.rival;
  if (!hasRival(r)) return null;
  // A FRIEND's round is not synthesised — it is fetched, because they have to
  // actually play it. Until they do, there is no fixture today and the card
  // says so rather than inventing an opponent. The fetch itself is kicked off
  // by `refreshFriendRival`; this reads whatever has landed.
  if (r.kind === 'friend') {
    return friendRivalToday?.key === `${dateKey}|${r.id}` ? (friendRivalToday.entry?.rec ?? null) : null;
  }
  const cacheKey = `${dateKey}|${courseId}|${r.id}|${r.skill}`;
  if (rivalRoundCache?.key === cacheKey) return rivalRoundCache.rec;
  const theme = resolveTheme(course);
  const rec = synthesiseRivalRound({
    courseId,
    course,
    holes: Math.min(RULES.holesPerRound, course.holes.length),
    name: r.name,
    seed: r.seed,
    skill: r.skill,
    dateKey,
    at: Date.now(),
    useAuthoredPins: flag('layouts'),
    bounded: flag('boundedWorld'),
    bunkerDepthScale: theme.bunkerDepthScale ?? 1,
    wasteDepthScale: theme.wasteDepthScale ?? 0,
    edgeWobble: theme.edgeWobble ?? 1,
    treeSpecies: { trees: theme.treeKeys ?? DEFAULT_TREE_MIX, accents: theme.accentTreeKeys ?? [] }
  });
  rivalRoundCache = { key: cacheKey, rec };
  return rec;
}

/**
 * Fetch a friend rival's round for today, then repaint the card.
 *
 * Bounded, async, and entirely off every gameplay path — a friend who has not
 * played yet is an ordinary state, not an error, and the card reads "hasn't
 * played yet" rather than fabricating a score.
 */
async function refreshFriendRival(dateKey: string): Promise<void> {
  const r = profile.retention.rival;
  if (!flag('rival') || r.kind !== 'friend' || !hasRival(r)) return;
  const key = `${dateKey}|${r.id}`;
  if (friendRivalToday?.key === key && friendRivalToday.entry) return;
  const entry = await fetchRivalEntry(pairId(challengePlayerId(), r.id), dateKey, r.id);
  friendRivalToday = { key, entry };
  if (entry) updateDailyHoleCard();
}

/**
 * Publish this player's daily round so their rival can fly it. Fire-and-forget:
 * the results card is already on screen, and a failed post costs the friend
 * one day's ghost, never the player's own score.
 */
function publishRivalEntry(dateKey: string, strokes: number, rec: RoundRecording | null): void {
  const r = profile.retention.rival;
  if (!flag('rival') || r.kind !== 'friend' || !hasRival(r)) return;
  const me = challengePlayerId();
  void postRivalEntry(pairId(me, r.id), dateKey, {
    playerId: me,
    name: profile.name || 'Player',
    total: strokes,
    rec: rec ?? undefined,
    at: Date.now()
  });
}

/** The rival's line on the daily card: who they are, what they shot, and where
 *  the rivalry stands. One sentence — it is the reason to tap, not a screen. */
function rivalLine(rec: RoundRecording | null, dateKey?: string): string {
  if (!flag('rival')) return '';
  const r = profile.retention.rival;
  if (!hasRival(r)) return '';
  const standing = rivalStanding(r);
  // Once a day is SETTLED, its result is the truth — not whatever a fresh
  // synthesis would produce now. Recalibration moves the rival's standard after
  // a sweep, so re-deriving today's round afterwards would quietly report a
  // score the player never actually played against.
  const settled = dateKey ? r.history.find((d) => d.date === dateKey) : undefined;
  if (settled) {
    return (
      `<div class="dhRival">👤 <b>${escapeHtml(r.name)}</b> went round in ${settled.them}` +
      ` · ${escapeHtml(standing.label)}</div>`
    );
  }
  if (!rec) {
    // A friend who has not teed off yet. Saying so is the honest version of an
    // empty fixture, and it is also a nudge — they are waiting on you too.
    return r.kind === 'friend'
      ? `<div class="dhRival">👤 <b>${escapeHtml(r.name)}</b> hasn't played today yet` +
          ` · ${escapeHtml(standing.label)}</div>`
      : '';
  }
  const them = rec.scores.reduce((a, b) => a + b, 0);
  return (
    `<div class="dhRival">👤 <b>${escapeHtml(r.name)}</b> went round in ${them}` +
    ` · ${escapeHtml(standing.label)}</div>`
  );
}

/** The "make it a friend" entry. Deliberately quiet: the house rival already
 *  works, so this is an upgrade, not a prerequisite. */
function rivalInviteRow(): string {
  if (!flag('rival') || !hasRival(profile.retention.rival)) return '';
  const waiting = !!pendingRivalInvite() && profile.retention.rival.kind !== 'friend';
  return waiting
    ? `<div class="dhInvite">Rival invite sent — they become your rival when they open it.</div>`
    : `<button id="dhInvite" class="dhInviteBtn">Make a friend your rival</button>`;
}

/**
 * Settle today's fixture. Called once the daily attempt is booked, so the
 * result the player just posted is the one compared.
 *
 * Idempotent by date inside `settleRivalDay` — a replay, a resume or a late
 * cloud sync can never pad the record.
 */
function settleRivalFixture(dateKey: string, yourStrokes: number, rec: RoundRecording | null): void {
  if (!flag('rival') || !rec) return;
  const them = rec.scores.reduce((a, b) => a + b, 0);
  const out = settleRivalDay(profile.retention.rival, dateKey, yourStrokes, them);
  if (!out.result) return;
  // Drift the standard against recent form so the rival stays beatable in both
  // directions — the next fixture is built from this.
  profile.retention.rival = recalibrateRival(out.state);
  analytics.track('rival_day_settled', { result: out.result });
  const r = out.state;
  showMsg(
    out.result === 'win'
      ? `You beat ${r.name} ${yourStrokes}–${them}. ${rivalStanding(r).label}.`
      : out.result === 'loss'
        ? `${r.name} takes it ${them}–${yourStrokes}. ${rivalStanding(r).label}.`
        : `Tied with ${r.name} on ${them}. ${rivalStanding(r).label}.`,
    3200
  );
}

/**
 * Hole of the Day (`dailyHole`) — one generated hole, the same for everyone,
 * one attempt, a spoiler-free shareable result.
 *
 * The hole is resolved lazily on first paint of the landing (a few tens of ms
 * of pure arithmetic: generate, simulate ~140 rounds, retry until one lands in
 * the playable band) and memoised for the session. Never on a gameplay path.
 */
function updateDailyHoleCard(): void {
  const el = document.getElementById('dailyHoleCard');
  if (!el) return;
  el.innerHTML = '';
  if (!flag('dailyHole')) return;
  const key = todayKey();
  const res = dailyHole(key, COURSES);
  if (!res.spec) {
    // No candidate passed the band today. Showing nothing is correct: a daily
    // hole nobody vetted is worse than no daily hole.
    if (!ENV.isProd) console.warn(`[dailyHole] no playable hole for ${key}`, res.rejected);
    return;
  }
  const played = loadDailyPlay(key);
  const { par, yardage, attempts } = res.spec;
  const themeName = COURSES[res.spec.themeId]?.name ?? '';
  // The rival plays the same hole. Their round is synthesised here, off every
  // gameplay path, so the card can say what they shot before the player tees
  // off — a target to chase is worth more than a result to discover.
  //
  // Deliberately does NOT register the generated hole in COURSES: that map is
  // the roster every course list reads, and putting today's hole in it while
  // merely PAINTING THE LANDING added a seventh course to the wizard. Only
  // `startDailyHole` registers it, and only when it is about to be played.
  const rivalRec = todaysRivalRound(key, DAILY_COURSE_ID, res.spec.course);
  // A friend rival's round has to be fetched; a house rival's is already here.
  // Both are off the gameplay path, and the card repaints when it lands.
  void refreshFriendRival(key);
  if (played) {
    const toPar = played.strokes - par;
    const doneArch = res.spec.archetype ? ARCHETYPE_NAMES[res.spec.archetype] : '';
    el.innerHTML =
      `<span class="dhLabel">⛳ HOLE OF THE DAY · DONE</span>` +
      `<div class="dhName">You shot ${played.strokes} (${toPar === 0 ? 'par' : toPar > 0 ? `+${toPar}` : toPar})` +
      ` on today's par ${par}${doneArch ? ` — <b>${escapeHtml(doneArch)}</b>` : ''}. One attempt a day — back tomorrow.</div>` +
      rivalLine(rivalRec, key) +
      `<button id="dhShare" class="dhPlay">Share result</button>` +
      rivalInviteRow();
    document.getElementById('dhShare')!.addEventListener('pointerdown', () => {
      void shareDailyResult(key, par, played.strokes);
    });
    document.getElementById('dhInvite')?.addEventListener('pointerdown', () => void inviteRival());
    // A friend may post their round after the player has already played, so a
    // fixture can settle late. Settle whatever is now known.
    if (rivalRec) settleRivalFixture(key, played.strokes, rivalRec);
    return;
  }
  const rivalName = flag('rival') && rivalRec ? profile.retention.rival.name : '';
  const archName = res.spec.archetype ? ARCHETYPE_NAMES[res.spec.archetype] : '';
  el.innerHTML =
    `<span class="dhLabel">⛳ HOLE OF THE DAY</span>` +
    // The archetype is the day's IDENTITY, not decoration: a daily is now
    // built to a shape ("Island Green", "Canyon Carry") rather than being
    // whatever the seed happened to produce, and naming it is what tells a
    // player today's is a different KIND of hole from yesterday's.
    `<div class="dhName">${archName ? `<b>${escapeHtml(archName)}</b> — a` : 'A'} brand-new par ${par}, ${yardage} yd${
      themeName ? ` at ${escapeHtml(themeName)}` : ''
    } — same hole for everyone, one attempt.</div>` +
    rivalLine(rivalRec) +
    `<button id="dhPlay" class="dhPlay">${rivalName ? `Play — beat ${escapeHtml(rivalName)}` : "Play today's hole"}</button>` +
    rivalInviteRow() +
    (ENV.isProd ? '' : `<div class="dhDev">seed ${res.spec.seed} · attempt ${attempts} · ${res.rejected.length} rejected</div>`);
  document.getElementById('dhPlay')!.addEventListener('pointerdown', () => startDailyHole());
  document.getElementById('dhInvite')?.addEventListener('pointerdown', () => void inviteRival());
}

/** Book the Hole of the Day attempt when its round ends. First attempt wins —
 *  replaying to improve a shared score is what one-a-day exists to prevent. */
/**
 * RATE THE HOLE.
 *
 * The Hole of the Day is GENERATED, vetted only by a simulator that can measure
 * whether a hole is playable and cannot tell whether it is any good. The
 * generator's vocabulary widens from here, and the only honest signal about
 * which holes are worth making more of comes from the people who played them.
 *
 * Asked once, at the moment the opinion exists — the shot that just finished —
 * and never asked twice about the same hole. A survey that nags is a survey
 * nobody answers truthfully.
 */
let pendingHoleSurvey: { dateKey: string; seed: number } | null = null;

function holeSurveyHtml(): string {
  if (!pendingHoleSurvey) return '';
  return (
    `<div class="holeSurvey"><span class="hsAsk">Was that a good hole?</span>` +
    `<span class="hsRow">` +
    [1, 2, 3, 4, 5]
      .map((n) => `<button class="hsStar" data-rate="${n}" aria-label="${n} out of 5">${'★'.repeat(1)}</button>`)
      .join('') +
    `</span></div>`
  );
}

function wireHoleSurvey(): void {
  const pending = pendingHoleSurvey;
  if (!pending) return;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.hsStar'))) {
    el.addEventListener('pointerdown', () => {
      const rating = Number(el.dataset.rate);
      // Analytics only: the rating is about the GENERATOR, not about the
      // player, so it never touches the profile and never blocks anything.
      analytics.track('daily_hole_rated', { rating, hole_seed: pending.seed, date: pending.dateKey });
      pendingHoleSurvey = null;
      const box = el.closest('.holeSurvey');
      if (box) box.innerHTML = `<span class="hsAsk">Thanks — that shapes the next one.</span>`;
    });
  }
}

function recordDailyAttempt(): void {
  if (!dailyRound) return;
  const strokes = round.players[0]?.scores[0] ?? 0;
  const { dateKey, par, rival, seed } = dailyRound;
  dailyRound = null;
  if (strokes <= 0) return;
  if (flag('focusedGame')) pendingHoleSurvey = { dateKey, seed };
  saveDailyPlay({ dateKey, strokes, par, at: Date.now() });
  analytics.track('daily_hole_completed', { score_to_par: strokes - par });
  // Settle the fixture against the rival round this attempt was actually
  // played against — not whatever the card would synthesise now.
  settleRivalFixture(dateKey, strokes, rival);
  // Publish this round so a friend rival can fly it as their ghost. Off the
  // gameplay path and failure-tolerant: the results card is already up.
  publishRivalEntry(dateKey, strokes, lastRecording);
}

/** Reserved course id a hole handed over by the Hole Builder is registered
 *  under. Separate from the daily's so a preview can never be mistaken for the
 *  day's attempt, or vice versa. */
const BUILDER_COURSE_ID = '__builder';

/**
 * THE WAY BACK.
 *
 * "Play it" opens the preview in a new tab, and there was no route out of it:
 * finishing the round landed on the game's own menu with the builder nowhere in
 * sight, so the only way back to the design you were testing was to find the
 * other tab yourself. A preview you cannot return from is a dead end, and it
 * breaks the loop the whole tool is built around — draw, play, adjust, play.
 *
 * The button rides above the round chrome and survives to the results card,
 * because "that green is too small" is a thought you have at the moment you
 * hole out.
 */
function showBuilderReturn(on: boolean): void {
  const btn = document.getElementById('builderBackBtn');
  if (btn) btn.style.display = on ? 'block' : 'none';
  designBtn.style.display = on ? 'block' : 'none';
  // The top-right stack (Menu, Clip, breakdown) shifts down a row so nothing
  // sits on top of anything else.
  document.documentElement.classList.toggle('builder-preview', on);
}

/**
 * Rebuild the preview so fly-mode placements become real geometry.
 *
 * `buildCourse` plants a hole's nature in one chunked pass at scene build —
 * there is no incremental "add one tree" seam — so seeing a placement for real
 * means building the hole again. That is deliberate rather than a limitation:
 * inventing a second way to render a prop would mean two code paths for what a
 * hole looks like, which is the class of divergence this codebase has already
 * been bitten by once (live vs replay).
 *
 * The edited hole is written back to the handover slot on the way, so the
 * builder picks up the placements whether you rebuild, play on, or leave.
 */
function rebuildBuilderPreview(hole: HoleData): void {
  saveBuilderEdits(hole);
  buildWithLoading(() => {
    if (!startBuilderHole()) showMsg('Could not rebuild the hole', 2200);
  }, 'Rebuilding the hole');
}

/**
 * Hand fly-mode edits back to the builder.
 *
 * The preview tab was opened by the builder, so it holds a COPY of the
 * builder's sessionStorage. Writing the edited hole into the same slot the
 * handover used means the builder — reopened here, or reached by closing this
 * tab — reads back exactly what was placed.
 */
function saveBuilderEdits(hole: HoleData): void {
  try {
    const raw = sessionStorage.getItem('bsg.builderHole.v1');
    if (!raw) return;
    const payload = JSON.parse(raw) as Record<string, unknown>;
    payload.hole = hole;
    payload.editedAt = Date.now();
    sessionStorage.setItem('bsg.builderHole.v1', JSON.stringify(payload));
  } catch {
    /* storage unavailable — the edits still apply to this session's scene */
  }
}

function backToBuilder(): void {
  if (current) saveBuilderEdits(current.hole);
  // The preview was opened by the builder with window.open, so closing this tab
  // returns to the builder tab EXACTLY as it was left — unsaved edits included.
  // A tab we did not open cannot be closed by script, so navigation is the
  // fallback rather than the first choice.
  try {
    window.close();
  } catch {
    /* not script-opened — fall through */
  }
  setTimeout(() => {
    window.location.href = 'holebuilder.html';
  }, 120);
}

/**
 * PREVIEW PLAY (`holebuilder.html` → "▶ Play it").
 *
 * The builder hands its edited hole over in sessionStorage and opens the game
 * with `?builderHole=1`. The hole is registered under a reserved id and played
 * as an ordinary one-hole round, which is the whole point: "play it" has to mean
 * the real game — the real physics, the real renderer, the real swing — or the
 * feedback is about an approximation and the designer tunes the wrong thing.
 *
 * Admin/dev only, and never recorded: a preview is not a score.
 */
function startBuilderHole(): boolean {
  // Admin-gated in production for the same reason the authoring tools are:
  // it plays arbitrary handed-over geometry.
  if (ENV.isProd && !adminUnlocked()) return false;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem('bsg.builderHole.v1');
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw) as {
      name?: string;
      theme?: Record<string, string | number | string[]> | null;
      minWind?: number;
      maxWind?: number;
      hole: unknown;
    };
    const course = loadCourse({
      name: payload.name || 'Hole Builder preview',
      theme: payload.theme ?? undefined,
      minWind: payload.minWind,
      maxWind: payload.maxWind,
      holes: [payload.hole]
    } as never);
    if (!course.holes.length) return false;
    COURSES[BUILDER_COURSE_ID] = course;
    endPractice();
    dailyRound = null;
      pendingGhost = null;
    sel.mode = 'solo';
    sel.courseId = BUILDER_COURSE_ID;
    landingEl.classList.remove('on');
    startRound(0);
    showBuilderReturn(true);
    showMsg('Preview — this round is not scored', 2600);
    return true;
  } catch (err) {
    if (!ENV.isProd) console.warn('[builderHole] could not load the handed-over hole', err);
    return false;
  }
}

/**
 * Play today's hole. A one-hole round on generated geometry, seeded off the
 * date so the wind and pin match everybody else's, and recorded so the attempt
 * can be verified and shared.
 *
 * The generated course is injected into COURSES under a reserved id, because
 * everything downstream — the scene builder, the physics, the recorder, the
 * results card — looks courses up by id. Doing it this way means the daily hole
 * runs through exactly the same code as an authored one.
 */
function startDailyHole(): void {
  if (!flag('dailyHole')) return;
  endPractice();
  const key = todayKey();
  if (loadDailyPlay(key)) {
    showMsg("You've already played today's hole — back tomorrow", 1800);
    return;
  }
  const res = dailyHole(key, COURSES);
  if (!res.spec) return;
  COURSES[DAILY_COURSE_ID] = res.spec.course;
  // The rival is the opponent for today's fixture: their round flies beside
  // yours, and the result settles the head-to-head when the attempt is booked.
  const rival = todaysRivalRound(key, DAILY_COURSE_ID, res.spec.course);
  dailyRound = { dateKey: key, par: res.spec.par, rival, seed: res.spec.seed };
  pendingGhost = rival;
  sel.mode = 'solo';
  sel.courseId = DAILY_COURSE_ID;
  closeDailyPopup(); // the card lives in the 🔥 popup — don't leave it over the round
  landingEl.classList.remove('on');
  analytics.track('daily_hole_started', { course: res.spec.themeId });
  // Seeded off the DATE so every player faces the same wind and the same cup.
  forcedSeed = res.spec.seed;
  startRound(0);
  forcedSeed = undefined;
}

/**
 * Open the practice ground: the default course's opening hole, no card, no
 * round, infinite balls. Nothing that happens here is recorded, scored,
 * rewarded, or counted toward a streak — that is what makes it practice.
 */
function startPractice(drill: DrillKind | null = null): void {
  if (!flag('practiceRange')) return;
  practiceMode = true;
  practiceShots = 0;
  practiceDrill = drill;
  pendingGhost = null;
  dailyRound = null;
  sel.mode = 'solo';
  landingEl.classList.remove('on');
  if (drill) {
    analytics.track('practice_started', { drill });
    startDrillHole();
    return;
  }
  sel.courseId = courseIdOrDefault(deviceSettings.lastCourseId || sel.courseId, COURSES);
  analytics.track('practice_started', { course: sel.courseId });
  startRound(0);
}

/** Deal the drill's next STATION: a random hole on a random course, with a
 *  few reps on it before the next rotation (a rebuild per swing would spend
 *  more time behind the veil than over the ball). */
function startDrillHole(): void {
  // Real roster only — never the builder preview or the generated daily
  // (their '__' ids are registration plumbing, not places to practice).
  const ids = Object.keys(COURSES).filter((id) => !id.startsWith('__'));
  sel.courseId = ids[Math.floor(Math.random() * ids.length)] ?? sel.courseId;
  const holeCount = COURSES[sel.courseId]?.holes.length ?? 1;
  drillRepsOnHole = practiceDrill === 'drive' ? 2 : 4;
  startRound(Math.floor(Math.random() * holeCount));
}

/** The next rep of the running drill: same hole while reps remain (a fresh
 *  random spot each ball), then a fresh random hole. */
function nextDrillRep(): void {
  if (!current || !practiceDrill) return;
  drillRepsOnHole -= 1;
  if (drillRepsOnHole <= 0) {
    startDrillHole();
    return;
  }
  if (practiceDrill === 'drive') current.resetToTee();
  else current.drillDrop(practiceDrill);
}

/** Leave practice. Called whenever any other flow starts a round, so practice
 *  can never leak into a scored one. */
function endPractice(): void {
  practiceMode = false;
  practiceShots = 0;
  practiceDrill = null;
  drillRepsOnHole = 0;
}

/** Copy the spoiler-free result, falling back to a visible message when the
 *  clipboard is unavailable (iOS without a user-gesture-scoped permission). */
async function shareDailyResult(key: string, par: number, strokes: number): Promise<void> {
  await shareOrCopy(shareText(key, par, strokes));
}

/**
 * Hand something to the OS share sheet, falling back to the clipboard and then
 * to showing it. One implementation because there are now four callers and the
 * fallback chain is the part that is easy to get subtly wrong — a share that
 * silently does nothing on a desktop browser is indistinguishable from a broken
 * button.
 */
async function shareOrCopy(text: string, url?: string): Promise<void> {
  const payload = url ? `${text} ${url}` : text;
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share(url ? { text, url } : { text });
      return;
    }
    await navigator.clipboard.writeText(payload);
    showMsg('Copied — send it to a friend', 1800);
  } catch {
    // Share cancelled, clipboard blocked, or neither available: put it on
    // screen so the player can still get at it.
    showMsg(payload, 2600);
  }
}

/** True when the round just finished can be raced again as a ghost — i.e. it
 *  was recorded and survived its own replay check. */
function ghostRematchAvailable(): boolean {
  // `gp` — an ease-in round, played to the kindest pins. It replays fine, but a
  // ghost race uses the seeded pins, so it would not be the same course twice.
  return flag('ghostRace') && flag('roundRecording') && !!lastRecording && !lastRecording.gp;
}

/** Replay the round that just finished, against the round that just finished.
 *  Same course, same seed, same pins and wind — the only variable is you. */
function startGhostRematch(): void {
  if (!lastRecording) return;
  endPractice();
  pendingGhost = lastRecording;
  sel.mode = 'solo';
  sel.courseId = lastRecording.courseId;
  forcedSeed = lastRecording.seed;
  summaryEl.style.display = 'none';
  startRound(0);
  forcedSeed = undefined;
}

/**
 * "Race your best" (`ghostRace`). The player's own best recorded round on the
 * course they would play next is the one opponent guaranteed to exist — no
 * friends, no network, no matchmaking — and beating yourself is the oldest
 * motivation in golf. Hidden until a recording exists, so a first-time player
 * never sees an entry that cannot do anything.
 */
function updateGhostCard(): void {
  const el = document.getElementById('ghostCard');
  if (!el) return;
  el.innerHTML = '';
  // Stripped: racing a recorded round is a whole third opponent system on top
  // of the daily hole and the challenge link (`focusedGame`).
  if (flag('focusedGame')) return;
  if (!flag('ghostRace') || !flag('roundRecording')) return;
  const courseId = courseIdOrDefault(deviceSettings.lastCourseId || sel.courseId, COURSES);
  const course = COURSES[courseId];
  if (!course) return;
  const holes = Math.min(RULES.holesPerRound, course.holes.length);
  // Your own best round is the ideal opponent — but it only exists once you have
  // recorded one, so the card was invisible on any course you had not already
  // played well. The RIVAL fills that gap: their round is synthesised for
  // whatever course this is, at a standard calibrated just above you, and it
  // verifies against the same replay engine a human's does. So there is always
  // somebody to race, on every course, from the first visit.
  const best = bestRecordingFor(courseId, holes) ?? rivalRoundFor(courseId, course, holes);
  if (!best) return;
  const isRival = !bestRecordingFor(courseId, holes);
  const total = best.scores.reduce((a, b) => a + b, 0);
  const par = course.holes.slice(0, best.holes).reduce((a, h) => a + h.par, 0);
  const toPar = total - par;
  const label = isRival ? `👻 RACE ${escapeHtml((best.name || 'YOUR RIVAL').toUpperCase())}` : '👻 RACE YOUR BEST';
  const blurb = isRival
    ? `shot for shot, against the round they played`
    : `shot for shot, against the round you played`;
  el.innerHTML =
    `<span class="gcLabel">${label}</span>` +
    `<div class="gcName">${escapeHtml(course.name)} · ${total} (${toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : toPar})` +
    ` — ${blurb}</div>` +
    `<button id="gcPlay" class="gcPlay">Race it</button>`;
  document.getElementById('gcPlay')!.addEventListener('pointerdown', () => {
    pendingGhost = best;
    sel.mode = 'solo';
    sel.courseId = courseId;
    closeDailyPopup(); // the card lives in the 🔥 popup — don't leave it over the round
    landingEl.classList.remove('on');
    // The ghost's round used a specific seed; racing it on different wind and
    // pins would not be the same race, so the rematch inherits the seed.
    forcedSeed = best.seed;
    startRound(0);
    forcedSeed = undefined;
  });
}

/**
 * The unfinished-round card (`resumeRound`). Shown only when a checkpoint that
 * is still worth finishing exists — see systems/RoundCheckpoint.isResumable,
 * which rejects stale, structurally broken, and no-progress records. It sits
 * above the daily/weekly cards on purpose: the best next action for someone
 * mid-round is the round they are already mid-way through.
 *
 * "Start fresh" is offered beside it because a player who has moved on should
 * not have to finish an old round to clear the shelf.
 */
function updateResumeCard(): void {
  const el = document.getElementById('resumeCard');
  if (!el) return;
  el.innerHTML = '';
  if (!flag('resumeRound')) return;
  const cp = loadCheckpoint();
  if (!cp) return;
  const course = COURSES[cp.courseId];
  if (!course) {
    // The course is no longer in the roster (flag change, renamed id) — the
    // round can never be resumed, so retire the record rather than show a
    // button that cannot work.
    clearCheckpoint();
    return;
  }
  // Say where they actually are. "Hole 2" when the ball is on the 2nd green
  // having played three is a different offer from "hole 2" on the tee.
  const where = cp.strokes
    ? `hole ${cp.holeIdx + 1}, ${cp.strokes} played`
    : `hole ${cp.holeIdx + 1} of ${cp.holes}`;
  el.innerHTML =
    `<span class="rsLabel">↩ UNFINISHED ROUND</span>` +
    `<div class="rsName">${escapeHtml(course.name)} · ${where} · ${toParLabel(cp)}</div>` +
    `<div class="rsRow"><button id="rsPlay" class="rsPlay">Finish the round</button>` +
    `<button id="rsDrop" class="rsDrop">Start fresh</button></div>`;
  document.getElementById('rsPlay')!.addEventListener('pointerdown', () => resumeSavedRound(cp));
  document.getElementById('rsDrop')!.addEventListener('pointerdown', () => {
    clearCheckpoint();
    updateResumeCard();
  });
}

/** Re-enter a checkpointed round on the hole that was in progress, with the
 *  same seed (identical wind and pins) and the completed holes back on the
 *  card. The hole itself restarts from its tee — nothing mid-shot is stored. */
function resumeSavedRound(cp: RoundCheckpoint): void {
  endPractice();
  // Strike the record BEFORE the build it is about to trigger: if that build
  // white-screens the device, the strike is already on disk, and two strikes
  // retire the record instead of trapping the player in a crash loop. The
  // first checkpoint write of the resumed round (at rest) resets the count.
  markResumeAttempt();
  resumingFrom = cp;
  sel.mode = 'solo';
  sel.courseId = cp.courseId;
  landingEl.classList.remove('on');
  startRound(cp.holeIdx);
  // MID-HOLE: put the ball back where it was resting, with the strokes it
  // cost. `dropAt` re-reads the surface under the point, so the lie comes from
  // the COURSE rather than from a file — a stored lie could disagree with the
  // ground it names.
  if (cp.ball && cp.strokes) current?.resumeAt(cp.ball.x, cp.ball.y, cp.strokes);
}

/** Place the opt-in "Learn to play" entry. It's hidden unless the tutorial flag
 *  is on. For someone likely new to the game — a guest, or a device with no
 *  round played yet — it becomes the HERO (above, and louder than, Play Now) so
 *  the first thing they see is the invitation to learn; everyone else gets a
 *  quiet secondary button that keeps it available (it's replayable) without
 *  competing with Play. */
function updateLearnEntry(newPlayer: boolean): void {
  const learn = document.getElementById('landingLearn');
  const play = document.getElementById('landingPlay');
  if (!learn || !play) return;
  if (!flag('tutorial')) {
    learn.style.display = 'none';
    learnIsHero = false;
    syncPlayDemotion();
    return;
  }
  learn.style.display = 'block';
  // Someone who has already been through the lesson is not the audience for a
  // hero-sized invitation to take it again — it stays, quietly, below Play.
  const hero = (newPlayer || !signedIn) && !deviceSettings.tutorialDone;
  learn.classList.toggle('heroLearn', hero);
  // Quick Start's demotion has two authors now (this and the account CTA), so
  // neither writes the class directly — see `syncPlayDemotion`.
  learnIsHero = hero;
  syncPlayDemotion();
  learn.textContent = hero ? '🎓 New here? Learn to play →' : '🎓 Learn to play';
  // Learn sits ABOVE the tee-off actions for everyone now (owner call): the
  // markup order is the order, and only the STYLING changes with experience.
  // The old DOM swap moved the node per repaint, which is exactly the kind of
  // mutation that makes a layout impossible to reason about.
}

/**
 * One-tap Play (`quickPlay`).
 *
 * The wizard asks two questions — mode and course — before a first-time player
 * has any basis for answering either, and it charges every returning player two
 * extra taps to say "the same as last time". The vision doc asks the landing to
 * present "a clear primary action rather than a dashboard of competing
 * demands", so Play Now now DOES the obvious thing (a solo round on the course
 * this device last played, or the default course) and the wizard moves to an
 * explicit "Course & mode" entry beneath it for anyone who wants to choose.
 */
/** Where Quick Start goes NEXT: the rotation's course after the one this
 *  device played last (owner, career round 2: "the quick start button should
 *  rotate courses" — replaying the same course every tap made one course the
 *  whole game). First tap ever still opens the default course. */
function quickPlayCourseId(): string {
  const last = deviceSettings.lastCourseId;
  if (!last) return courseIdOrDefault(sel.courseId, COURSES);
  return nextCourseIdAfter(courseIdOrDefault(last, COURSES));
}

function quickPlay(): void {
  endPractice();
  sel.mode = 'solo';
  sel.courseId = quickPlayCourseId();
  landingEl.classList.remove('on');
  startRound(0);
}

/** The two tee-off actions: Quick Start says exactly what it will do, and
 *  Choose-your-course exists only while quickPlay makes Quick Start one-tap
 *  (with the flag off, the primary button IS the wizard). */
function updateSetupEntry(): void {
  const btn = document.getElementById('landingChoose');
  // The button names the course Quick Start will ACTUALLY open (the rotation's
  // next), not the one just played.
  const course = COURSES[quickPlayCourseId()];
  if (btn) btn.style.display = flag('quickPlay') ? '' : 'none';
  // NAME THE COURSE AND THE GOLFER ON THE BUTTON.
  //
  // Quick Start tees off on whatever this device played last, and the golfer is
  // re-rolled every round until a loadout is locked — so the two variables that
  // move a score most were both invisible at the moment of committing to a
  // round. Simulation puts the course at up to ~2 strokes across the roster and
  // a random archetype at ~0.55 (tests/simulation/difficultyAnchors.test.ts),
  // which is most of what "the game got harder" turns out to mean.
  const play = document.getElementById('landingPlay');
  if (!play || !flag('quickPlay')) return;
  const g = profile.loadoutLocked
    ? styleName(profile.archetype)
    : profile.archetype === 'career'
      ? styleName('career') // the Pro survives the shuffle — say so
      : 'random golfer';
  play.innerHTML =
    `<span class="lpMain">▶ Quick Start</span>` +
    `<span class="lpSub">${escapeHtml(course?.name ?? 'choose a course')} · ${escapeHtml(g)}</span>`;
}

function showSetup(): void {
  endPractice();
  tourPlayoff = null; // a live playoff hole is abandoned (the pending tie survives on the profile)
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
  updateWeeklyCard(); // this week's course may have been overridden
});

/** Today's effective daily challenge: the live-ops override when one is
 *  published for the date, else the deterministic hash pick. */
function effectiveDailyChallenge(dateKey: string): DailyChallenge {
  const overrideId = dailyOverrideFor(liveOps, dateKey);
  return DAILY_CHALLENGES.find((c) => c.id === overrideId) ?? dailyChallengeFor(dateKey);
}

/** This week's featured event, with any published live-ops course override. */
function effectiveWeeklyEvent(): WeeklyEvent {
  // DAILY under the strip-down: a week is a very long time to leave one course
  // featured in a game whose rounds take four minutes.
  const ev = flag('focusedGame') ? dailyEventFor(devNow()) : weeklyEventFor(devNow());
  const override = weeklyOverrideFor(liveOps, ev.id);
  return override && COURSES[override] ? { ...ev, courseId: override } : ev;
}

/** The landing's compact Weekly Featured row (Part 8): course, the player's
 *  best + rank when known, time remaining, one Play action. Standings fill in
 *  asynchronously — the card never blocks on the network. */
function updateWeeklyCard(): void {
  const el = document.getElementById('weeklyCard');
  if (!el) return;
  const ev = effectiveWeeklyEvent();
  const course = COURSES[ev.courseId];
  const best = profile.retention.records.bestWeekly[ev.id];
  const bestBit = best ? `Best ${best.total} (${best.toPar === 0 ? 'E' : best.toPar > 0 ? `+${best.toPar}` : best.toPar})` : 'Not played yet';
  el.innerHTML =
    `<div class="wkInfo"><span class="wkLabel">${flag('focusedGame') ? 'TODAY\'S TOURNAMENT' : 'WEEKLY FEATURED'} · ${weeklyTimeLeft(ev, Date.now())} left</span>` +
    `<div class="wkLine">${escapeHtml(course.name)} · <span id="wkStanding">${bestBit}</span></div>` +
    `<div id="wkBoard" class="wkBoard"></div></div>` +
    `<button id="wkPlay" class="wkPlay">Play</button>`;
  document.getElementById('wkPlay')!.addEventListener('pointerdown', () => {
    pendingWeekly = ev;
    sel.mode = 'solo';
    sel.courseId = ev.courseId;
    closeDailyPopup(); // the card lives in the 🔥 popup — don't leave it over the round
    landingEl.classList.remove('on');
    startRound(0);
  });
  // Rank/percentile + the top of the ONE open board, best-effort
  // (world-readable /weekly node). Ratings ride beside names (career mode) so
  // the board is honest about who is a rookie and who is a 95-rated veteran.
  if (best) {
    void fetchWeeklyEntries(ev.id).then((entries) => {
      const standing = weeklyStanding(entries, profile.id);
      const slot = document.getElementById('wkStanding');
      if (slot && standing) {
        slot.textContent = `${bestBit} · ${ordinal(standing.rank)} of ${standing.of}${standing.of > 3 ? ` · top ${100 - standing.percentile || 1}%` : ''}`;
      }
      const board = document.getElementById('wkBoard');
      if (board && entries.length) {
        const top = [...entries].sort((x, y) => x.total - y.total || x.submittedAt - y.submittedAt).slice(0, 3);
        board.innerHTML = top
          .map(
            (e, i) =>
              `<span class="wkRow${e.playerId === profile.id ? ' you' : ''}">${i + 1}. ${escapeHtml(e.name)}` +
              `${typeof e.rating === 'number' ? ` · ${e.rating}` : ''} — ${e.toPar === 0 ? 'E' : e.toPar > 0 ? `+${e.toPar}` : e.toPar}</span>`
          )
          .join('');
      }
    });
  }
}

/** Arm an incoming ?c= async challenge (Part 9): validate, then show the ONE
 *  banner with the target and a Play action. Malformed/expired codes show a
 *  quiet message instead of breaking the landing. */
function receiveChallenge(raw: string): void {
  const code = parseChallengeParam(raw) ?? raw;
  const def = decodeChallenge(code);
  const el = document.getElementById('challengeBanner');
  if (!el) return;
  if (!def || !COURSES[def.courseId]) {
    el.innerHTML = `<span class="chLabel">CHALLENGE</span><div class="chName">That challenge link isn't valid.</div>`;
    return;
  }
  if (challengeExpired(def, Date.now())) {
    el.innerHTML = `<span class="chLabel">CHALLENGE</span><div class="chName">This challenge has expired.</div>`;
    return;
  }
  const who = def.creator || 'A friend';
  el.innerHTML =
    `<span class="chLabel">⚔ CHALLENGE</span>` +
    `<div class="chName">${escapeHtml(who)} challenges you: beat ${def.total} on ${escapeHtml(COURSES[def.courseId].name)}</div>` +
    `<button id="chPlay" class="chPlay">Take it on</button>`;
  document.getElementById('chPlay')!.addEventListener('pointerdown', () => {
    pendingChallenge = def;
    sel.mode = 'solo';
    sel.courseId = def.courseId;
    landingEl.classList.remove('on');
    el.innerHTML = '';
    startRound(0);
  });
}

/** Today's daily challenge + streak: the SETUP banner and the landing's ONE
 *  concise Daily card (objective · progress · reward · streak — Part 3). */
function updateDailyBanner(): void {
  // Progressive disclosure: no daily surface anywhere until the first round
  // on this device is in the books (Part 11).
  if (!deviceSettings.firstRoundDone && profile.stats.rounds === 0) {
    const b = document.getElementById('dailyBanner');
    if (b) b.innerHTML = '';
    const c = document.getElementById('dailyCard');
    if (c) c.innerHTML = '';
    return;
  }
  const key = todayKey();
  const ch = effectiveDailyChallenge(key);
  const doneToday = profile.daily.date === key && profile.daily.done;
  const banner = document.getElementById('dailyBanner');
  if (banner) {
    const live = currentStreak(profile.retention.streak, key);
    const streak = live > 0 ? ` · 🔥 ${live}` : '';
    banner.innerHTML = `<span class="dcLabel">DAILY${streak}</span><span class="dcName">${doneToday ? '✅ ' : ''}${escapeHtml(ch.name)}</span>`;
  }
  const card = document.getElementById('dailyCard');
  if (card) {
    const s = profile.retention.streak;
    // The live value, so a lapsed streak reads "Start a streak today" rather
    // than still advertising a number the next round will not honour.
    const cur = currentStreak(s, key);
    const streakBit =
      cur > 0
        ? `<span class="dcStreak">🔥 ${cur} day${cur > 1 ? 's' : ''} · day ${cycleDay(cur)}/7${s.protectionAvailable ? ' 🛡' : ''}</span>`
        : `<span class="dcStreak">Start a streak today</span>`;
    const reward = streakRewardFor(Math.max(1, s.lastDate === key ? cur : cur + 1));
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
  if (gpuBlocked()) return;
  // A fresh start from the menu abandons any half-finished AI tournament, and
  // any tour ROUND in play (the tour EVENT's banked rounds live on the
  // profile and survive — that's what makes majors resumable; a pending
  // playoff likewise survives on the profile, only the LIVE hole is dropped).
  aiTour = null;
  tourRoundLive = false;
  tourPlayoff = null;
  // ...and any unfinished-round checkpoint, unless THIS call is the resume.
  if (!resumingFrom) clearCheckpoint();
  round.course = courseFallback(sel.courseId);
  round.mode = sel.mode;
  // Normal play always opens on hole 1; the perf/verification hooks can boot a
  // later hole directly (WW3/TL3 are the heavy first-tee-shot cases).
  round.holeIdx = Math.min(Math.max(0, startHoleIdx), round.course.holes.length - 1);
  round.activePlayer = 0;
  round.holeWinds = [];
  round.holePins = [];
  // Every round runs under a seed now (same generator path tournaments always
  // used): casual rounds roll a fresh random one — identical distribution —
  // which makes ANY round shareable as an async challenge, and lets a weekly
  // or challenge entry pin the standardized seed instead.
  round.seed =
    forcedSeed ??
    resumingFrom?.seed ??
    (pendingWeekly ? pendingWeekly.seed : pendingChallenge ? pendingChallenge.seed : (Math.random() * 0xffffffff) >>> 0);
  // Remember where this device last teed off, so one-tap Play reopens there.
  const startedCourseId = courseIdByName(round.course.name);
  if (deviceSettings.lastCourseId !== startedCourseId) updateDeviceSettings({ lastCourseId: startedCourseId });
  round.weeklyEventId = pendingWeekly ? pendingWeekly.id : null;
  round.challenge = pendingChallenge;
  // Lock the difficulty for this round before a single shot is armed. Casual,
  // weekly, daily, challenge and tutorial rounds all come through here.
  lockRoundDifficulty();
  // weekly_round_started deprecated 2026-07-18: the weekly funnel is served by
  // round_started + weekly_round_completed; no dashboard consumed the started
  // side (docs/technical/ANALYTICS_FRAMEWORK.md).
  if (pendingChallenge) analytics.track('async_challenge_opened', { course: pendingChallenge.courseId });
  pendingWeekly = null;
  pendingChallenge = null;
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
  // Record plain solo rounds only (see roundRecorder). A RESUMED round cannot
  // be recorded: its earlier holes were played in a previous session and their
  // inputs are gone, so a partial recording would verify as the wrong score.
  lastRecording = null;
  if (flag('roundRecording') && sel.mode === 'solo' && !resumingFrom && !practiceMode && startHoleIdx === 0) {
    roundRecorder.start();
  } else {
    roundRecorder.stop();
  }
  // Arm the ghost, if one was chosen. Replaying the whole opponent round up
  // front (a few ms of the same physics the round runs on) means nothing but a
  // lookup happens during play. A ghost that fails to replay — a stale
  // recording, a course that has changed under it — is dropped rather than
  // shown flying somewhere its owner never hit it.
  activeGhost = null;
  if (flag('ghostRace') && pendingGhost && sel.mode === 'solo' && startHoleIdx === 0) {
    const candidate = new GhostRun(pendingGhost, round.course, replayOptions());
    if (candidate.ok) {
      activeGhost = candidate;
      analytics.track('ghost_race_started', { course: courseIdByName(round.course.name) });
    } else if (!ENV.isProd) {
      console.warn(`[ghost] dropped — ${candidate.reason}`);
    }
  }
  pendingGhost = null;
  // Fix the ease-in pin decision now that everything it depends on is settled
  // (mode, ghost, daily, seed). Pins are drawn lazily per hole, so this only has
  // to precede the first `pinForHole` — but it must be ONE answer for the round.
  roundGentlePins = easeInActive();
  const golfer = roundGolfer();
  round.players = [{ golfer, isAI: false, scores: [] }];
  if (resumingFrom) {
    // Put the completed holes back on the card so the scorecard, the running
    // to-par and the end-of-round scoring all see the whole round.
    round.players[0].scores = resumingFrom.scores.slice();
    analytics.track('round_resumed', { course: courseIdByName(round.course.name), hole: resumingFrom.holeIdx + 1 });
    resumingFrom = null;
  }
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

/**
 * TRUE for a player with nowhere to save: no account, on a build where accounts
 * exist at all. Everything account-shaped keys off this one predicate — the
 * landing hero, the post-round card, and the copy in both.
 */
function guestWithNoAccount(): boolean {
  return !signedIn && authConfigured();
}

/**
 * SIGNED OUT, the account is the headline (owner: "swap the quick start button
 * and the profile button… make the profile button say 'create an account to
 * save progress'", and "make the cta more prevalent").
 *
 * The swap is done by WEIGHT, not by moving nodes: the account CTA takes the
 * hero styling and Quick Start drops to the quiet outline treatment
 * Learn-to-play already uses. The landing used to relocate nodes per repaint
 * and the file still carries the note about why that was a mistake
 * (`updateLearnEntry`) — so the markup order is fixed and only the classes
 * move. The Profile tile keeps its place in the grid and only changes what it
 * says (`updateDestinations`): it is also the only door to Settings, which a
 * player without an account needs exactly as much as one with.
 *
 * Idempotent, and called from every path that repaints the landing, because the
 * one thing worse than a missing CTA is one that survives signing in.
 */
function applyAccountCta(): void {
  const cta = document.getElementById('landingAccountCta');
  if (!cta) return;
  cta.style.display = guestWithNoAccount() ? 'flex' : 'none';
  syncPlayDemotion();
}

/** True while the Learn-to-play button is the hero (a newcomer who has not taken
 *  the lesson). Kept as state because TWO things can demote Quick Start — the
 *  lesson and the account CTA — and whichever ran last must not undo the other. */
let learnIsHero = false;

/** The one writer of Quick Start's `demoted` class. */
function syncPlayDemotion(): void {
  document.getElementById('landingPlay')?.classList.toggle('demoted', learnIsHero || guestWithNoAccount());
}

/** Refresh the landing's account-facing chrome. Historically this rendered a
 * dedicated #acctMenu sign-in block; that element no longer exists in the
 * landing DOM (sign-in lives in Profile's account row, reached via the
 * #landingProfile button), so all that remains live is keeping the Profile
 * button's label in sync with the signed-in account. */
function renderAcctMenu(): void {
  if (signedIn) {
    void linkedAccountName().then((name) => updateLandingProfileButton(name ?? undefined));
  } else {
    updateLandingProfileButton();
  }
}

/**
 * LEAVE THE ROUND.
 *
 * There was no way back to the menu once a round started: the only exits were
 * playing all three holes out or reloading the page, and a reload loses the
 * card. That is a trap, and on a phone it is the reason a session ends for good
 * rather than pausing.
 *
 * A solo round is checkpointed on the way out (`checkpointRound` already runs
 * per hole under `resumeRound`), so leaving offers to pick the round back up
 * from the landing rather than throwing it away. Modes that cannot be resumed —
 * a tournament, a shared-seed daily — say so plainly instead of pretending.
 */
function leaveRound(): void {
  if (!current) return;
  // PRACTICE / THE RANGE: nothing is at stake — no card, no record — so there
  // is nothing to confirm losing. The menu button just leaves.
  if (!practiceMode) {
    const resumable = flag('resumeRound') && round.mode === 'solo' && !dailyRound;
    const message = resumable
      ? 'Leave this round? Your card is saved — you can finish it from the menu.'
      : "Leave this round? This one can't be resumed, so the card is lost.";
    if (!window.confirm(message)) return;
    if (resumable) checkpointRound();
    else clearCheckpoint();
  }
  // Tear the scene down the same way a finished round does, so nothing is left
  // holding the engine (observers, RTTs, audio) between rounds.
  current.dispose();
  current = null;
  exposeDebug();
  roundRecorder.stop();
  dailyRound = null;
  activeGhost = null;
  // Abandoning a tour round forfeits only THAT round's progress — the event's
  // completed rounds are already banked on the profile.
  tourRoundLive = false;
  swingBtn.style.display = 'none';
  hudEl.style.display = 'none';
  pauseBtn.style.display = 'none';
  promptEl.textContent = '';
  aimReadoutEl.style.display = 'none';
  summaryEl.style.display = 'none';
  analytics.track(practiceMode ? 'practice_left' : 'round_abandoned', { hole: round.holeIdx + 1 });
  showLanding();
}
pauseBtn.addEventListener('pointerdown', () => leaveRound());
document.getElementById('builderBackBtn')!.addEventListener('pointerdown', () => backToBuilder());
designBtn.addEventListener('pointerdown', () => current?.toggleDesign());

document.getElementById('landingPlay')!.addEventListener('pointerdown', () => {
  if (flag('quickPlay')) quickPlay();
  else showSetup();
});
document.getElementById('landingChoose')?.addEventListener('click', () => showSetup());
document.getElementById('destBoards')?.addEventListener('click', () => renderRecords());
document.getElementById('dpPlay')?.addEventListener('click', () => {
  closeDailyPopup();
  quickPlay();
});
document.getElementById('dpClose')?.addEventListener('click', () => closeDailyPopup());
document.getElementById('dailyPopup')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDailyPopup();
});
document.getElementById('landingLearn')!.addEventListener('pointerdown', () => startTutorial());
// THE RANGE: the bar unfolds the one question (which shot?), the answer starts
// the drill. 'click' — these live on a screen that survives the tap.
document.getElementById('rangeBar')?.addEventListener('click', () => {
  const row = document.getElementById('rangeRow');
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
});
document.getElementById('rangeDrive')?.addEventListener('click', () => startPractice('drive'));
document.getElementById('rangeChip')?.addEventListener('click', () => startPractice('chip'));
document.getElementById('rangePutt')?.addEventListener('click', () => startPractice('putt'));
document.getElementById('landingSeason')!.addEventListener('click', () => renderSeasonPass());
document.getElementById('landingStore')!.addEventListener('click', () => renderStore());
// Signed out, the "Log In / Profile" door opens straight onto the sign-in
// row (Settings); signed in, the Player tab now carries the account + Log
// out at its top (owner pass 8).
document.getElementById('landingProfile')!.addEventListener('click', () => renderProfile(signedIn ? 'player' : 'settings'));
// The signed-out hero goes STRAIGHT to the screen with the sign-in button on
// it. A call to action that lands you in a menu is not a call to action.
document.getElementById('landingAccountCta')!.addEventListener('click', () => {
  analytics.track('account_cta_tapped', { from: 'landing' });
  renderProfile('settings');
});
document.getElementById('landingSettings')!.addEventListener('click', () => renderProfile('settings'));
// Straight to the tab, not to the top of a scroll.
document.getElementById('landingAdmin')!.addEventListener('click', () => renderProfile('admin'));
document.getElementById('landingDev')!.addEventListener('click', () => renderProfile('dev'));
document.getElementById('landingLocker')!.addEventListener('click', () => renderLockerRoom());
document.getElementById('navLocker')!.addEventListener('pointerdown', () => renderLockerRoom());
// The four doors. Delegated off each tile rather than bound by id so adding a
// destination is a markup change.
// 'click', NOT 'pointerdown'.
//
// The sheet appears on the press, so a pointerdown binding meant the RELEASE
// landed on whatever the sheet had just put under the finger — and under the
// More tile that is the "About the game" link, which is an anchor, so tapping
// More navigated straight off the page. Same trap as the #lkLock note in
// renderLockerRoom. A menu that opens on the release is imperceptibly slower
// and cannot do this.
// Only tiles that carry a data-dest open the sheet — Leaderboards is a tile
// by LOOK but a direct button by behaviour.
for (const tile of Array.from(document.querySelectorAll<HTMLElement>('.destTile[data-dest]'))) {
  tile.addEventListener('click', () => openDest(tile.dataset.dest as DestId));
}
// The Tour Season tile opens the TOUR HUB (owner: past results, standings,
// schedule and play, all behind the click) — or the Locker's Style tab when
// no career has started yet. 'click' for the tap-through rule above.
document.getElementById('destTour')?.addEventListener('click', () => {
  if (careerStarted(profile.career)) {
    renderTourHub();
  } else {
    lkTab = 'style';
    renderLockerRoom();
  }
});
// 'click' for the CLOSE too, and for the same reason in reverse: closing on
// the down-stroke re-exposes the landing under a still-falling finger, and on
// touch the browser synthesizes the tap's click against whatever the release
// finds there — which "over-reads" one tap as two (owner: "back from choosing
// a course goes into the today menu").
document.getElementById('destSheetClose')!.addEventListener('click', () => closeDest());
// Tapping the scrim closes it; tapping the sheet itself must not.
document.getElementById('destSheet')!.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDest();
});
updateLandingProfileButton();
tourBoardBtn.addEventListener('pointerdown', () => (aiTour ? showAiTourBoard() : showTourBoard()));
renderAcctMenu();
// 'click', NOT 'pointerdown' — Back HIDES the setup screen, and hiding on the
// press put the landing's destination tiles under the release: the tap's
// synthesized click then hit-tested onto the Today tile and opened the sheet
// the player never asked for. Same rule as the destTiles above and #lkBack.
backBtn.addEventListener('click', () => {
  if (sel.step <= 0) showLanding();
  else goStep(sel.step - 1);
});
nextBtn.addEventListener('pointerdown', () => {
  if (sel.step < stepLabels().length - 1) goStep(sel.step + 1);
  else startRound();
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
  // The capture harness is the one start path that used to skip this, so a
  // reference screenshot silently drew the module default rather than the
  // difficulty being captured. "Exactly one rule" has to mean every path.
  lockRoundDifficulty();
  setupEl.style.display = 'none';
  // Real play always passes through the menu, giving the grain images time to
  // decode before the first synchronous bake; this direct boot must wait for
  // them or every capture shows the procedural fallback players never see.
  await grainPreloadsSettled();
  playHole();
  const scene = current!;
  scene.enterShotPose(SHOT.cam);
  // NO AIM OVERLAY IN A CAPTURE.
  //
  // The harness poses the camera but left the game at address, so every image
  // it has ever produced carries the aim reticle and the distance chip — which
  // is how the marketing green shot ended up with a marker sitting on the
  // flagstick, and that image is the landing's own background. A screenshot is
  // of the COURSE; the aiming furniture belongs to a player who is not there.
  scene.hideAimForCapture();
  if (SHOT.boundary) scene.showBoundary();
  void Promise.all([
    scene.bodiesReady,
    new Promise((resolve) => scene.scene.executeWhenReady(() => resolve(null))),
    // THE SCATTER HAS TO ACTUALLY BE PLANTED. Ground scatter, garden beds and
    // flowers drain from a per-frame population queue at ~3.5 ms/frame, and
    // the beds are the LAST rows in it — so the old fixed 1500 ms settle
    // routinely fired with the trees in and the flowers not, which is why the
    // menus' background art had bare beds. `natureReady` resolves when the
    // queue is empty (the intro flyover already waits on it); the race caps a
    // bed-heavy worst case at the same ceiling the mirror refill uses.
    Promise.race([scene.natureReady(), new Promise((resolve) => setTimeout(resolve, 8000))])
  ]).then(() => {
    // One last beat for in-flight glb instancing to hit the GPU.
    setTimeout(() => {
      (window as unknown as { __shotReady: boolean }).__shotReady = true;
    }, 600);
  });
}

if (SHOT.hole) void startShotCapture();
else {
  showLanding();
  // A shared ?t=CODE link boots straight into the tournament's join screen;
  // a shared ?c=CODE link (async challenge, Part 9) arms the challenge banner.
  try {
    const params = new URLSearchParams(window.location.search);
    const ccode = params.get('c');
    if (ccode) receiveChallenge(ccode);
    // A ?coop=ID link invites you into a friend's season (owner pass 9).
    const coopId = params.get('coop');
    if (coopId) void receiveCoopInvite(coopId);
    // A ?rival=CODE link makes the sender your rival (and you theirs).
    const rcode = params.get('rival');
    if (rcode && flag('rival')) void receiveRivalInvite(rcode);
    else void checkPendingRivalInvite();
    // ?builderHole=1 tees off the hole the Hole Builder just handed over.
    if (params.get('builderHole') === '1') startBuilderHole();
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
  /** Pin the round seed so a capture spec can render the SAME wind and pins
   *  twice (the natureBatching pixel gate compares two page loads). */
  seed?: number;
}) => {
  if (opts?.name !== undefined) {
    sel.name = opts.name;
    profile.name = opts.name; // roundGolfer() reads profile.name, not sel.name
  }
  if (opts?.character) sel.character = opts.character;
  if (opts?.archetype) sel.archetype = opts.archetype;
  if (opts?.character || opts?.archetype) {
    // roundGolfer() re-rolls a random owned loadout unless the profile has one
    // locked in, which would silently discard the loadout the caller just asked
    // for. A hook caller naming a golfer means it.
    profile.character = opts.character ?? profile.character;
    profile.archetype = opts.archetype ?? profile.archetype;
    profile.loadoutLocked = true;
  }
  if (opts?.mode) sel.mode = opts.mode;
  if (opts?.opponentId) sel.opponentId = opts.opponentId;
  if (opts?.courseId && COURSES[opts.courseId]) sel.courseId = opts.courseId;
  // Mirror the real Play flow: the landing overlay comes down before the
  // round starts (a hook-started round otherwise leaves it covering the game).
  landingEl.classList.remove('on');
  forcedSeed = opts?.seed;
  startRound(opts?.hole ? opts.hole - 1 : 0);
  forcedSeed = undefined;
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
// Test hook: the last completed round's recording, plus an in-page
// verification of it. The e2e gate plays a real round and asserts the inputs
// replay to the score that was actually played — the round-trip everything
// else (verification, ghosts, replays) is built on.
(window as unknown as { __lastRecording: unknown }).__lastRecording = () => lastRecording;
(window as unknown as { __verifyLastRecording: unknown }).__verifyLastRecording = () =>
  lastRecording ? verifyRecording(lastRecording, COURSES, replayOptions()) : null;
// Test hook: the rivalry's state (tests/visual/rival.spec.ts). The head-to-head
// is the one number the feature asks the player to believe, so a spec has to be
// able to read it directly rather than parse it back out of a sentence.
(window as unknown as { __rival: unknown }).__rival = () => {
  const r = profile.retention.rival;
  if (!hasRival(r)) return null;
  const st = rivalStanding(r);
  return { name: r.name, kind: r.kind, skill: r.skill, wins: r.wins, losses: r.losses, ties: r.ties, played: st.played };
};
(window as unknown as { __ghostStanding: unknown }).__ghostStanding = () =>
  activeGhost ? { name: activeGhost.name, scores: activeGhost.scores } : null;

(window as unknown as { __aiTour: unknown }).__aiTour = () => (aiTour ? { courseIds: [...aiTour.courseIds], played: aiTour.played } : null);

// Test hook: the Tour Season's live state (tests/visual/tour.spec.ts) — which
// event is up, whether the round in play belongs to the tour, and that
// entering really did force-select the career Pro.
(window as unknown as { __tour: unknown }).__tour = () => {
  const t = tourNow();
  const def = t ? currentEvent(t, tourCourseIds()) : null;
  return {
    started: !!t,
    seasonNo: t?.seasonNo ?? 0,
    played: t?.played ?? 0,
    eventIdx: def?.idx ?? null,
    major: def?.major ?? false,
    roundsIn: t ? eventRoundsPlayed(t) : 0,
    roundLive: tourRoundLive,
    archetype: roundLoadout.archetype,
    points: t ? { ...t.points } : {}
  };
};

/**
 * Test hook for the SEASON COLLECTION (Stage 5). Forges a second season and a
 * finished one so a spec can reach the picker and the archive without playing
 * thirty-two events, then reports what the collection holds.
 *
 * The screens themselves are real — this only supplies the state.
 */
(window as unknown as { __seasons: unknown }).__seasons = (stage = false) => {
  if (stage) {
    const solo = newSeason(910001);
    const friend = { ...newSeason(910002), coop: { id: 'demo', playerId: 'me', partners: [{ playerId: 'f', name: 'Dana', results: {} }] } };
    const done = { ...newSeason(910003), played: TOUR_EVENTS, points: { player: 2400, rex: 3100, dutch: 1800 } };
    profile.tours = putTour(putTour(profile.tours, done), friend);
    profile.tours = archiveTour(profile.tours, done, { proId: 'p', proName: 'Demo', at: 1, ended: 'finale' });
    profile.tours = putTour(profile.tours, solo);
    persistProfile();
  }
  return {
    keys: Object.keys(profile.tours.seasons),
    activeId: profile.tours.activeId,
    archive: profile.tours.archive.map((a) => ({ key: a.key, rank: a.playerRank, rows: a.standings.length }))
  };
};
(window as unknown as { __seasonView: unknown }).__seasonView = (which: string) => {
  if (which === 'picker') renderSeasonPicker();
  else if (which === 'history') renderSeasonHistory();
  else if (which === 'past') renderPastSeason(0);
  else renderTourHub();
};

// Test hooks for the sudden-death playoff (tests/visual/tourPlayoff.spec.ts).
// __stagePlayoff forges a regulation-complete event with the player and the
// first `tied` rivals level on top — the only practical way a spec reaches a
// tie deterministically; __playoffProbe reads the pending state, the live
// hole's simulated rivals, and the scene's parked balls.
(window as unknown as { __stagePlayoff: unknown }).__stagePlayoff = (tied = 2) => {
  if (!flag('careerMode') || !careerStarted(profile.career)) return false;
  if (!tourNow()) setTour(newSeason(555001));
  const t = tourNow()!;
  const def = currentEvent(t, tourCourseIds());
  if (!def) return false;
  const fill = (v: number): number[] => Array.from({ length: def.rounds }, () => v);
  t.activeEvent = {
    idx: t.played,
    playerTotals: fill(11),
    playerToPars: fill(-1),
    fieldTotals: TOUR_RIVALS.map((_, i) => (i < tied ? fill(11) : fill(15))),
    fieldToPars: TOUR_RIVALS.map((_, i) => (i < tied ? fill(-1) : fill(3)))
  };
  persistProfile();
  return true;
};
// Test hooks for the per-golfer record book (tests/visual/tourRecords.spec.ts):
// a reader, and a forge that stamps results through the REAL recording
// functions for the active Pro — the only deterministic way a spec fills the
// book without winning simulated events.
(window as unknown as { __tourRecords: unknown }).__tourRecords = () =>
  JSON.parse(JSON.stringify(profile.tourHistory));
(window as unknown as { __forgeTourResult: unknown }).__forgeTourResult = (
  kind: 'win' | 'major' | 'season',
  seasonNo = 1,
  rank = 1,
  points = 0
) => {
  const pro = activePro(profile.career);
  if (!pro) return false;
  if (kind === 'season') recordTourSeasonFinish(profile.tourHistory, pro.id, pro.name, seasonNo, rank, points);
  else recordTourEventWin(profile.tourHistory, pro.id, pro.name, kind === 'major' ? MAJOR_NAMES[0] : undefined);
  persistProfile();
  return true;
};
// Test hook: bank `n` finished events into the season in progress, so a spec
// can reach a mid-season state (to quit it, to read the hub's schedule) without
// playing every event shot by shot. Scores are plausible but synthetic — the
// real scoring path has its own specs.
(window as unknown as { __seasonProgress: unknown }).__seasonProgress = (n: number) => {
  const t = tourNow();
  if (!t) return false;
  const ids = tourCourseIds();
  const sched = tourSchedule(t.seed, ids);
  for (let i = t.played; i < Math.min(n, TOUR_EVENTS); i++) {
    const major = sched[i]?.major ?? false;
    t.results.push({
      idx: i,
      playerRank: 2,
      points: TOUR_POINTS[1] * (major ? 2 : 1),
      toPar: -3,
      winnerId: TOUR_RIVALS[0].id,
      total: 33,
      field: TOUR_RIVALS.map((_, k) => ({ total: 32 + k, toPar: -4 + k }))
    });
  }
  t.played = Math.min(n, TOUR_EVENTS);
  t.points = recomputeSeasonPoints(t, ids, TOUR_RIVALS);
  t.activeEvent = null;
  persistProfile();
  return true;
};
(window as unknown as { __playoffProbe: unknown }).__playoffProbe = () => {
  const t = tourNow();
  const pend = t ? playoffPending(t, tourCourseIds()) : null;
  return {
    pending: pend ? { tied: [...pend.tiedRivalIds], holesPlayed: pend.holesPlayed } : null,
    live: tourPlayoff
      ? tourPlayoff.rivals.map((r) => ({ id: r.id, strokes: r.strokes, holed: r.holed, rests: r.rests.length }))
      : null,
    scene: current?.playoffDebug() ?? null
  };
};

// Test hook: read the player's current True Vision charge count (owned +
// this round's ephemeral bonus, matching what the in-round button shows), so
// specs can assert every round grants at least one without scraping the DOM.
// Test hook: the live round's putt tally. A conceded gimme never reaches the
// shot path where putts are counted, so this is the only way a spec can prove
// the concession was booked (tests/visual/inRound.spec.ts).
(window as unknown as { __roundPutts: unknown }).__roundPutts = () => ({
  puttsMade: shotAcc.puttsMade,
  holePutts: { ...shotAcc.holePutts }
});
(window as unknown as { __trueVisionCharges: unknown }).__trueVisionCharges = () =>
  chargesRemaining(profile, TRUE_VISION.id) + roundTrueVisionBonus;

// Test hook: grant session coins so specs can exercise the purchase flow
// (signed-out play is ephemeral — nothing here persists or reaches the cloud).
(window as unknown as { __grantCoins: unknown }).__grantCoins = (n: number) => {
  profile.coins += n;
};

// Test hook: bank CP directly (career mode), so specs can exercise the spend
// UI without simulating the rounds that would earn it.
(window as unknown as { __grantCp: unknown }).__grantCp = (n: number) => {
  grantCareerCp(profile, n);
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
