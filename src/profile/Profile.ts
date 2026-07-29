import { ArchetypeId } from '../data/archetypes';
import { CareerState, emptyCareer, mergeCareers, migrateCareer } from '../data/career';
import { emptyTours, mergeTourHistory, mergeTours, migrateTourHistory, migrateTours, TourCollection, TourHistory, TourSeasonState } from '../systems/TourSeason';
import { CharacterKey } from '../data/characters';
import { DEFAULT_EQUIPPED, DEFAULT_OWNED } from '../data/storeCatalog';
import { asDifficulty, Difficulty } from '../systems/Difficulty';
import { emptyRecords, mergeRecords, migrateRecords, PersonalRecords } from '../systems/Records';
import { emptyStreak, mergeStreak, migrateStreak, StreakState } from '../systems/Streak';
import { emptyRival, mergeRival, migrateRival, RivalState } from '../systems/Rival';
import { emptyMastery, mergeMastery, migrateMastery, MasteryState } from '../systems/Mastery';
import { emptyFeats, FeatState, mergeFeats, migrateFeats } from '../systems/Feats';

/**
 * The player's persistent identity: selections, currency, progression and
 * career stats. Guest-first (docs 08: "Guest Mode should always be the
 * default experience") — stored locally from first launch, synced to the
 * cloud once Firebase auth is configured (firebase/FirebaseClient.ts).
 * Phases 6 (progression) and 7 (store) read and write this object.
 */

export type CosmeticKind = 'character' | 'ball' | 'trail' | 'outfit' | 'clubskin' | 'pal';

/** One owned perk (data/perks.ts). Consumable: `granted`/`used` are grow-only
 *  round counters (merge by max, like the coin counters), remaining = granted −
 *  used. A perk with remaining 0 is spent (kept for a clean merge). */
export interface PerkState {
  id: string;
  granted: number;
  used: number;
}

/** Season-pass progress (systems/SeasonPassEngine + data/seasonPass). */
export interface SeasonState {
  /** Which season this progress belongs to ('s1'…). */
  id: string;
  /** Pass progress accrued this season — grow-only, merges by max. CAREER
   *  MODE: this now stores CP (the pass paces on CP earned); the field name
   *  is kept so stored profiles and the merge stay untouched. */
  xp: number;
  /** Reward levels already claimed — merges by union. */
  claimed: number[];
  /** True once the pass is purchased — merges by OR. */
  owned: boolean;
  purchasedAt?: number;
  /** True once xp has been re-denominated from the legacy XP scale to CP
   *  (÷25, one time). Absent = a pre-career save that still needs it. */
  cpDenominated?: boolean;
}

export interface CareerStats {
  rounds: number;
  holesPlayed: number;
  totalStrokes: number;
  birdies: number;
  eagles: number;
  holeInOnes: number;
  fairwaysHit: number;
  greensInRegulation: number;
  puttsMade: number;
  pars: number;
  bogeys: number;
  chipIns: number;
  tournamentWins: number;
  wins: number;
  /** Tour Seasons finished top of the points table (career round 2). */
  seasonChampionships: number;
  bestRoundToPar: number | null;
  longestDriveYds: number;
  longestPuttFt: number;
}

export interface PlayerProfile {
  v: 1;
  /** Guest id (crypto-random); replaced by the auth uid after linking. */
  id: string;
  name: string;
  character: CharacterKey;
  /** The chosen style: a preset archetype, or 'career' — the player's own
   *  Pro (career mode), whose stats live on the active Pro in `career`. */
  archetype: ArchetypeId | 'career';
  /** Spendable balance. Invariant: coins === coinsEarned − coinsSpent. */
  coins: number;
  /** Lifetime coins ever earned — grow-only, so it merges by max. */
  coinsEarned: number;
  /** Lifetime coins ever spent — grow-only, so it merges by max. Together
   *  these let a spendable balance survive a cloud merge: a spend sticks
   *  (spent only grows) and a fresh/empty local profile can never wipe the
   *  cloud balance (earned only grows). */
  coinsSpent: number;
  xp: number;
  level: number;
  cosmetics: {
    owned: string[];
    equipped: Partial<Record<CosmeticKind, string>>;
  };
  /** Club-family upgrade tiers purchased (docs 08 §Club Upgrades). */
  clubUpgrades: Record<string, number>;
  achievements: string[];
  stats: CareerStats;
  /** Daily-challenge state (see systems/ProgressionEngine + data/progression). */
  daily: { date: string; challengeId: string; done: boolean };
  /** Consecutive days with at least one completed round (the daily-challenge
   *  result no longer gates the streak — it's a separate bonus). */
  dailyStreak: number;
  /** YYYY-MM-DD of the last completed round — the streak's continuity anchor. */
  lastDailyDate: string;
  settings: {
    sound: number;
    ambience: number;
    reducedMotion: boolean;
    /**
     * Chosen swing difficulty (systems/Difficulty). ABSENT means never chosen,
     * which is a different fact from choosing Amateur: while it is absent the
     * lesson-aware default applies (Beginner before the lesson, Amateur after),
     * and the moment the player picks one it stops moving on its own.
     *
     * On the profile rather than DeviceSettings because it decides whether a
     * round can set a record, and records sync with the account.
     */
    difficulty?: Difficulty;
  };
  season: SeasonState;
  /** Owned consumable perks (season-pass rewards). */
  perks: PerkState[];
  /** Perk equipped for the next round, or null. */
  equippedPerk: string | null;
  /** Single-use consumables (season-pass rewards, e.g. True Vision) — spent
   *  the instant they're used, unlike perks[] which are equipped for a whole
   *  round. Same grow-only {id, granted, used} shape as perks[]. */
  consumables: PerkState[];
  /** True once the player has chosen a loadout in the Locker Room ("Lock it
   *  in"). Until then, each round tees off with a random owned loadout. */
  loadoutLocked?: boolean;
  /**
   * One-time marker for the Paintfall gift (`season.cpDenominated` /
   * `career.cpPerPro` pattern).
   *
   * Adding the ball to DEFAULT_OWNED grants it to every save on its own, but
   * the owner asked for it to be the ball players are actually USING — and
   * `equipped` is the one collection that does NOT union on migrate (stored
   * wins over base, so nobody's choice is silently overwritten). So the equip
   * has to be an explicit, once-only act. Marked here so a second load, or a
   * round-trip through the cloud, never drags a player back off a ball they
   * chose afterwards.
   */
  dripGranted?: boolean;
  /** Retention layer (records / 7-day streak / hole mastery) — versioned
   *  sub-states that migrate from any stored shape and merge grow-only, so
   *  cross-device sync and offline reconciliation can never lose a best,
   *  resurrect a claim, or double-award a star. */
  retention: RetentionState;
  /** CAREER MODE: your stable of named Pros and the CP each of them earned
   *  (data/career.ts). CP replaces XP as the progression currency — the
   *  legacy xp/level fields above are frozen — and it belongs to the PRO who
   *  earned it: `career.cpLedger` holds one grow-only earned/spent pair per
   *  Pro, so a rookie starts at zero and an older Pro's unspent CP is still
   *  there when you go back to them. Merges via mergeCareers (per-Pro
   *  grow-only pairs, pros union by id, per-stat max attrs). */
  career: CareerState;
  /**
   * TOUR SEASONS (career round 2, Stage 5): every season the player has going,
   * keyed, plus which one is active and an archive of the finished ones with
   * their full final standings (systems/TourSeason.ts).
   *
   * Merges PER KEY, so joining a friend's season on one device can no longer
   * erase the solo season on another — which is exactly what the single
   * `tour` field below did.
   */
  tours: TourCollection;
  /**
   * LEGACY single season. Frozen: nothing writes it, and `migrateTours` folds
   * a stored one into `tours` on load. Kept on the type so an old save still
   * migrates and a profile written by an older build still parses.
   *
   * @deprecated use `tours` (activeTour / putTour / archiveTour).
   */
  tour?: TourSeasonState | null;
  /** PER-GOLFER TOUR RECORDS (pass 8): every Pro's career wins, major wins
   *  and season placements — the season state is discarded at rollover, so
   *  this is the record book. Keyed by Pro id; survives Pro deletion.
   *  Merges per Pro: larger tallies win, seasons union (mergeTourHistory). */
  tourHistory: TourHistory;
  updatedAt: number;
}

/** One 1v1 challenge this player is part of (creator or responder) — the
 *  "Your Challenges" profile list. Results live in the shared /challenges
 *  doc; this is just the pointer. */
export interface ChallengeRef {
  cid: string;
  /** Epoch ms this player joined (created or responded). */
  at: number;
}

export interface RetentionState {
  records: PersonalRecords;
  streak: StreakState;
  mastery: MasteryState;
  /** 1v1 challenges joined, newest first, capped. Merges by union (cid). */
  challenges: ChallengeRef[];
  /** The player's current rival and the running head-to-head (`rival`). */
  rival: RivalState;
  /** Which courses have given up an eagle / an ace / a driven par 4 — the
   *  ledger the legend-tier feats read (systems/Feats.ts). */
  feats: FeatState;
}

export function emptyRetention(): RetentionState {
  return {
    records: emptyRecords(),
    streak: emptyStreak(),
    mastery: emptyMastery(),
    challenges: [],
    rival: emptyRival(),
    feats: emptyFeats()
  };
}

const CHALLENGE_REF_CAP = 30;

function migrateChallengeRefs(raw: unknown): ChallengeRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is ChallengeRef => !!c && typeof c.cid === 'string' && typeof c.at === 'number')
    .slice(0, CHALLENGE_REF_CAP);
}

function mergeChallengeRefs(a: ChallengeRef[], b: ChallengeRef[]): ChallengeRef[] {
  const byCid = new Map<string, ChallengeRef>();
  for (const c of [...a, ...b]) {
    const cur = byCid.get(c.cid);
    if (!cur || c.at < cur.at) byCid.set(c.cid, c);
  }
  return [...byCid.values()].sort((x, y) => y.at - x.at).slice(0, CHALLENGE_REF_CAP);
}

function migrateRetention(raw: unknown): RetentionState {
  const r = (raw ?? {}) as Partial<RetentionState>;
  return {
    records: migrateRecords(r.records),
    streak: migrateStreak(r.streak),
    mastery: migrateMastery(r.mastery),
    challenges: migrateChallengeRefs(r.challenges),
    rival: migrateRival(r.rival),
    feats: migrateFeats(r.feats)
  };
}

function mergeRetention(a: RetentionState | undefined, b: RetentionState | undefined): RetentionState {
  const ma = migrateRetention(a);
  const mb = migrateRetention(b);
  return {
    records: mergeRecords(ma.records, mb.records),
    streak: mergeStreak(ma.streak, mb.streak),
    mastery: mergeMastery(ma.mastery, mb.mastery),
    challenges: mergeChallengeRefs(ma.challenges, mb.challenges),
    rival: mergeRival(ma.rival, mb.rival),
    feats: mergeFeats(ma.feats, mb.feats)
  };
}

/** Rounds of a perk still available (granted − used, never negative). */
export function perkRemaining(p: PerkState): number {
  return Math.max(0, (p.granted ?? 0) - (p.used ?? 0));
}

const KEY = 'johnsons-golf-profile-v1';
const DEVICE_SETTINGS_KEY = 'johnsons-golf-device-settings-v1';

/** Injectable storage so tests (and headless sims) run without a DOM. */
export interface KVStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStorage(): KVStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * DEVICE-LOCAL preferences — sound/ambience volumes, reduced motion, and the
 * shot-clip recorder opt-in. Unlike gameplay progress (account-gated: a
 * signed-out session persists nothing), these are preferences about THIS
 * device and must survive refresh/reopen even for guests — muting the game and
 * having it come back loud after a reload was the #1 sound complaint. They are
 * also re-asserted OVER the profile after any cloud merge, so a sync from a
 * louder device never unmutes this one (see applyDeviceSettings callers).
 */
/**
 * What this device was drawing when a WebGL context died.
 *
 * The crashes that matter happen on players' phones, which no test rig here can
 * reproduce — the reports have been "it lagged then died on Wild Prairie 3",
 * with no numbers attached. This is written by the lost-context handler and
 * surfaced in Settings → Graphics so the numbers can be read back off the
 * device that actually failed. Device-local for the same reason as the volumes:
 * a guest's crash is exactly as informative as a signed-in player's.
 *
 * Deliberately small and plain: it is written at the worst possible moment, so
 * every field is a number or a short string already in memory. Nothing here
 * touches the GPU.
 */
export interface CrashRecord {
  /** Epoch ms, so the readout can say how long ago. */
  at: number;
  course: string;
  hole: number;
  /** Quality tier in force when it died, and the session's worst tier. */
  tier: number;
  floor: number;
  /** Why the governor last moved, if it had. */
  reason: string;
  meshes: number;
  materials: number;
  textures: number;
  /** Planted scatter instances across every batch — the number this whole
   *  performance investigation has been circling. */
  props: number;
  /** Chrome only; null elsewhere. */
  heapMB: number | null;
  /**
   * ---- Fields that do NOT depend on there being a live scene. ----
   *
   * The first readout this record ever produced was all zeros, because the
   * only loss it captured was the AFTERSHOCK — fired after the abandon path
   * had already dropped the scene — and every count above reads through that
   * scene. These read from the round, the engine and the device instead, so a
   * record written with no scene still says something.
   */
  /** Which loss this was in the session: 1 is the one that actually matters. */
  lossIndex: number;
  /** True when there was no live scene — i.e. this is an aftershock, or the
   *  loss landed between holes. */
  sceneNull: boolean;
  /** The `jg-building` breadcrumb: `courseId:holeIdx` when the loss landed
   *  INSIDE a scene build, empty when it did not. Answers the one question the
   *  scene counts cannot. */
  building: string;
  /** Clip capture was enabled, and the recorder was actually rolling. A
   *  continuous canvas capture is real GPU work no quality tier accounts for. */
  recording: boolean;
  /** Textures the ENGINE still holds. Unlike `textures` this outlives any one
   *  scene, so it is the number that shows accumulation across holes. */
  engineTextures: number;
  /** Drawing-buffer size in device pixels, and the display's ratio — what the
   *  render scale actually resolved to on this device. */
  canvasW: number;
  canvasH: number;
  dpr: number;
  /** navigator.deviceMemory (GB), where the browser reports it. */
  deviceMemory: number | null;
}

export interface DeviceSettings {
  sound: number;
  ambience: number;
  reducedMotion: boolean;
  /** Rolling shot-clip recorder opt-in (MediaRecorder is real per-frame encode
   *  work — default OFF; the player turns it on from the clip button). */
  clipCapture: boolean;
  /** True once this device has completed a round — gates the progressive
   *  reveal of secondary systems (daily/weekly/season/store) on the landing
   *  (retention Part 11). Device-local so it works for guests. */
  firstRoundDone: boolean;
  /** Last course teed off on this device, so the landing's one-tap Play
   *  (`quickPlay`) reopens where the player left off instead of always
   *  resetting to the default course. A preference about THIS device, like the
   *  volumes — never gameplay progress. Empty until a round has been started;
   *  validated against the live roster before use. */
  lastCourseId: string;
  /** True once the "Learn to play" lesson hole has been played to the end.
   *  Demotes the landing's lesson hero (it stays available, just stops
   *  shouting) and makes the completion reward pay exactly once. Device-local
   *  for the same reason as firstRoundDone: guests must get it too. */
  tutorialDone: boolean;
  /** How this device swings: the classic three-click meter (the default) or
   *  the traced tempo swing. A control-scheme preference like the volumes —
   *  both inputs resolve through the same swingModel, so this never changes
   *  difficulty, only the gesture. */
  swingType: 'tap' | 'trace';
  /**
   * Local mirror of the chosen swing difficulty.
   *
   * The AUTHORITATIVE copy is `profile.settings.difficulty`, because difficulty
   * decides whether a round can set a record and records sync with the account.
   * But `persistProfile()` only writes the profile when signed in, so without
   * this a signed-out player's choice lived in memory and died on reload — they
   * would pick Expert, play, reload, and silently be back on the default. Device
   * settings persist for everyone, guests included, so this is the copy that
   * survives. Read profile-first, device-second.
   */
  difficulty?: Difficulty;
  /** Graphics budget. 'auto' (the default) lets the adaptive governor pick the
   *  tier from the frame times this device actually achieves — see
   *  src/core/rendering/quality.ts. A number pins it, for a player who would
   *  rather choose than be measured. A preference about THIS device, like the
   *  volumes; it changes what a frame COSTS, never how the hole plays. */
  graphics: 'auto' | 0 | 1 | 2 | 3;
  /** The most recent store week this device has actually looked at. The coins
   *  chip flags "new items" while this trails the current week index. Kept here
   *  rather than on the profile because `persistProfile()` writes nothing for a
   *  signed-out player, and a guest should still be told the shelf changed. */
  storeSeenWeek: number;
  /**
   * WebGL context losses on this device, newest first, capped at CRASH_LOG_MAX.
   *
   * Deliberately a LOG rather than a single `lastCrash`. A lost context is
   * routinely followed by a second loss event once the abandon path has dropped
   * the scene, and with one slot the aftershock — which knows nothing — simply
   * overwrote the crash that did. The evidence has to outlive its own echo.
   */
  crashes: CrashRecord[];
}

/** How many losses the device keeps. Three covers "it happened again" without
 *  turning a diagnostic into storage. */
export const CRASH_LOG_MAX = 3;

/** Parse a stored crash record, rejecting anything malformed. Storage is
 *  attacker-adjacent (any script on the origin can write it) and this is shown
 *  as text, so every field is coerced rather than trusted. */
function readCrash(v: unknown): CrashRecord | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Partial<CrashRecord>;
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return undefined;
  const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  return {
    at: c.at,
    course: typeof c.course === 'string' ? c.course.slice(0, 40) : '',
    hole: num(c.hole),
    tier: num(c.tier),
    floor: num(c.floor),
    reason: typeof c.reason === 'string' ? c.reason.slice(0, 80) : '',
    meshes: num(c.meshes),
    materials: num(c.materials),
    textures: num(c.textures),
    props: num(c.props),
    heapMB: typeof c.heapMB === 'number' && Number.isFinite(c.heapMB) ? c.heapMB : null,
    // Records written before the log existed carry none of these; zero and
    // false read correctly for them ("no scene info recorded"), and the
    // readout leans on `lossIndex === 0` to say so.
    lossIndex: num(c.lossIndex),
    sceneNull: !!c.sceneNull,
    building: typeof c.building === 'string' ? c.building.slice(0, 40) : '',
    recording: !!c.recording,
    engineTextures: num(c.engineTextures),
    canvasW: num(c.canvasW),
    canvasH: num(c.canvasH),
    dpr: num(c.dpr),
    deviceMemory: typeof c.deviceMemory === 'number' && Number.isFinite(c.deviceMemory) ? c.deviceMemory : null
  };
}

/** Parse the stored crash log. Accepts the single `lastCrash` this replaced, so
 *  a device that has already recorded a failure keeps it. */
function readCrashes(list: unknown, legacy: unknown): CrashRecord[] {
  const out: CrashRecord[] = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      const rec = readCrash(entry);
      if (rec) out.push(rec);
    }
  }
  if (!out.length) {
    const old = readCrash(legacy);
    if (old) out.push(old);
  }
  return out.slice(0, CRASH_LOG_MAX);
}

export function loadDeviceSettings(storage: KVStorage | null = defaultStorage()): DeviceSettings | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<DeviceSettings>;
    return {
      sound: typeof p.sound === 'number' ? Math.max(0, Math.min(1, p.sound)) : 0.8,
      ambience: typeof p.ambience === 'number' ? Math.max(0, Math.min(1, p.ambience)) : 0.2,
      reducedMotion: !!p.reducedMotion,
      clipCapture: !!p.clipCapture,
      firstRoundDone: !!p.firstRoundDone,
      tutorialDone: !!p.tutorialDone,
      lastCourseId: typeof p.lastCourseId === 'string' ? p.lastCourseId : '',
      swingType: p.swingType === 'trace' ? 'trace' : 'tap',
      difficulty: asDifficulty(p.difficulty),
      graphics: p.graphics === 0 || p.graphics === 1 || p.graphics === 2 || p.graphics === 3 ? p.graphics : 'auto',
      storeSeenWeek: typeof p.storeSeenWeek === 'number' && Number.isFinite(p.storeSeenWeek) ? p.storeSeenWeek : -1,
      crashes: readCrashes(p.crashes, (p as { lastCrash?: unknown }).lastCrash)
    };
  } catch {
    return null;
  }
}

export function saveDeviceSettings(s: DeviceSettings, storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Quota/private-mode failures are non-fatal.
  }
}

export function emptyCareerStats(): CareerStats {
  return {
    rounds: 0,
    holesPlayed: 0,
    totalStrokes: 0,
    birdies: 0,
    eagles: 0,
    holeInOnes: 0,
    fairwaysHit: 0,
    greensInRegulation: 0,
    puttsMade: 0,
    pars: 0,
    bogeys: 0,
    chipIns: 0,
    tournamentWins: 0,
    wins: 0,
    seasonChampionships: 0,
    bestRoundToPar: null,
    longestDriveYds: 0,
    longestPuttFt: 0
  };
}

export function defaultProfile(now = 0): PlayerProfile {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Math.floor(Math.random() * 1e9)}`;
  return {
    v: 1,
    id: `guest-${rnd}`,
    name: '',
    character: 'chip',
    archetype: 'bigHitter',
    coins: 0,
    coinsEarned: 0,
    coinsSpent: 0,
    xp: 0,
    level: 1,
    cosmetics: { owned: [...DEFAULT_OWNED], equipped: { ...DEFAULT_EQUIPPED } },
    clubUpgrades: {},
    achievements: [],
    stats: emptyCareerStats(),
    daily: { date: '', challengeId: '', done: false },
    dailyStreak: 0,
    lastDailyDate: '',
    settings: { sound: 0.8, ambience: 0.2, reducedMotion: false },
    season: { id: 's1', xp: 0, claimed: [], owned: false, cpDenominated: true },
    perks: [],
    equippedPerk: null,
    consumables: [],
    loadoutLocked: false,
    // A fresh profile starts already gifted — DEFAULT_OWNED/DEFAULT_EQUIPPED
    // gave it the ball outright, so there is nothing for the migration to do.
    dripGranted: true,
    retention: emptyRetention(),
    career: emptyCareer(),
    tours: emptyTours(),
    tourHistory: {},
    updatedAt: now
  };
}

/** Add rounds of a perk to the inventory (grants stack onto an existing entry). */
export function grantPerk(profile: PlayerProfile, perkId: string, rounds: number): void {
  const existing = profile.perks.find((p) => p.id === perkId);
  if (existing) existing.granted += rounds;
  else profile.perks.push({ id: perkId, granted: rounds, used: 0 });
}

/** Add charges of a consumable to the inventory (grants stack onto an existing entry). */
export function grantConsumable(profile: PlayerProfile, id: string, qty: number): void {
  const existing = profile.consumables.find((c) => c.id === id);
  if (existing) existing.granted += qty;
  else profile.consumables.push({ id, granted: qty, used: 0 });
}

/** Charges of a consumable still available (granted − used, never negative). */
export function chargesRemaining(profile: PlayerProfile, id: string): number {
  const entry = profile.consumables.find((c) => c.id === id);
  return entry ? perkRemaining(entry) : 0;
}

/** Spend one charge of a consumable. Returns false (no-op) if none remain. */
export function consumeCharge(profile: PlayerProfile, id: string): boolean {
  const entry = profile.consumables.find((c) => c.id === id);
  if (!entry || perkRemaining(entry) <= 0) return false;
  entry.used += 1;
  return true;
}

/**
 * Reset the player's *records* to a clean slate: career stats, achievements,
 * XP/level, and daily-challenge progress. Coins and owned/equipped cosmetics
 * are deliberately preserved — a reset clears accomplishments, not purchases.
 * Returns the same object (mutated) for convenience.
 */
export function resetProfileRecords(profile: PlayerProfile, now = 0): PlayerProfile {
  profile.stats = emptyCareerStats();
  profile.achievements = [];
  profile.xp = 0;
  profile.level = 1;
  profile.daily = { date: '', challengeId: '', done: false };
  profile.dailyStreak = 0;
  profile.lastDailyDate = '';
  profile.updatedAt = now;
  return profile;
}

/**
 * Fill a partial/sparse profile into a complete PlayerProfile, backfilling every
 * missing field from the defaults. Critical for the CLOUD copy: Firebase RTDB
 * does not store empty arrays/objects/null, so a saved profile reads back with
 * `clubUpgrades`/`achievements` absent (undefined) and
 * `stats.bestRoundToPar` absent — feeding that raw into mergeProfiles would throw
 * (`Object.keys(undefined)`). Normalizing through here first guarantees all
 * collections are present. Shared by loadProfile and cloudSyncProfile.
 */
/**
 * Put the Paintfall ball in a returning player's hands, once.
 *
 * `alreadyGranted` is the marker: true means this profile has already been
 * through here, so whatever ball is equipped now is the player's own decision
 * and must be left alone. It is deliberately a one-shot rather than a default —
 * a gift that re-equipped itself on every load would override the player's
 * choice forever, which is a worse bug than not giving the gift at all.
 */
function withDripEquipped(
  equipped: Partial<Record<CosmeticKind, string>>,
  alreadyGranted: boolean
): Partial<Record<CosmeticKind, string>> {
  if (alreadyGranted) return equipped;
  return { ...equipped, ball: DEFAULT_EQUIPPED.ball };
}

export function migrateProfile(parsed: Partial<PlayerProfile>): PlayerProfile {
  const base = defaultProfile();
  return {
    ...base,
    ...parsed,
    v: 1,
    // Backfill the grow-only coin counters for saves from before they existed:
    // treat the whole current balance as "earned, none tracked-spent" so the
    // balance is preserved and future spends/earns stay consistent.
    coinsEarned: parsed.coinsEarned ?? parsed.coins ?? base.coinsEarned,
    coinsSpent: parsed.coinsSpent ?? base.coinsSpent,
    cosmetics: {
      // Always keep the default-owned items, even for older saves. This is what
      // grants the Paintfall ball to everyone who already had a profile.
      owned: [...new Set([...base.cosmetics.owned, ...(parsed.cosmetics?.owned ?? [])])],
      // Stored equipment wins over the defaults — a player's choices are never
      // overwritten — EXCEPT for the one-time Paintfall equip below, which is
      // the only way a gift can become the ball they are actually using.
      equipped: withDripEquipped(
        { ...base.cosmetics.equipped, ...(parsed.cosmetics?.equipped ?? {}) },
        parsed.dripGranted === true
      )
    },
    clubUpgrades: { ...(parsed.clubUpgrades ?? {}) },
    achievements: [...(parsed.achievements ?? [])],
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    daily: { ...base.daily, ...(parsed.daily ?? {}) },
    settings: {
      ...base.settings,
      ...(parsed.settings ?? {}),
      // A stored/synced difficulty is untrusted input, and an unrecognised one
      // must fall back to "never chosen" (undefined) rather than to a made-up
      // value — otherwise a garbled sync would silently pin someone's game.
      difficulty: asDifficulty(parsed.settings?.difficulty)
    },
    // RTDB drops the empty claimed array — coalesce it back (like achievements).
    // Pre-career saves carry season progress on the old XP scale (~25× CP):
    // re-denominate ONCE, marked so a migrated copy never divides twice.
    season: {
      ...base.season,
      ...(parsed.season ?? {}),
      claimed: [...(parsed.season?.claimed ?? [])],
      xp: parsed.season?.cpDenominated ? (parsed.season.xp ?? 0) : Math.round((parsed.season?.xp ?? 0) / 25),
      cpDenominated: true
    },
    // RTDB drops empty arrays/null — backfill perks + equipped like the rest.
    perks: [...(parsed.perks ?? [])],
    equippedPerk: parsed.equippedPerk ?? null,
    consumables: [...(parsed.consumables ?? [])],
    loadoutLocked: parsed.loadoutLocked ?? false,
    // Stamped whether or not anything moved, so the equip above happens exactly
    // once in this profile's life.
    dripGranted: true,
    // Pre-retention profiles (and RTDB copies with the sub-trees dropped)
    // backfill to safe empty states — no loss of existing profiles.
    retention: migrateRetention(parsed.retention),
    // Any stored career shape (the legacy single-Pro one included) upgrades
    // to the stable; partial RTDB copies coalesce row by row so a dropped
    // counter can't zero a grow-only pair. The legacy Pro inherits the
    // profile's name and character as its own. A pre-ledger account-wide CP
    // wallet is split onto the Pro who was playing here, exactly once.
    career: migrateCareer(parsed.career, {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      character: (parsed.character as PlayerProfile['character']) ?? 'chip'
    }),
    // The legacy `tour` is folded in here and nowhere else — see migrateTours.
    tours: migrateTours(parsed.tours, parsed.tour),
    tourHistory: migrateTourHistory(parsed.tourHistory)
  };
}

export function loadProfile(storage: KVStorage | null = defaultStorage()): PlayerProfile {
  if (!storage) return defaultProfile();
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return defaultProfile();
    return migrateProfile(JSON.parse(raw) as Partial<PlayerProfile>);
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: PlayerProfile, storage: KVStorage | null = defaultStorage(), now?: number): void {
  if (!storage) return;
  profile.updatedAt = now ?? Date.now();
  try {
    storage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Quota/private-mode failures are non-fatal — play continues in memory
  }
}

/**
 * Remove the persisted profile from local storage. Used on sign-out so a
 * signed-out session truly shows a clean slate (account-gated model): the live
 * profile is reset to defaultProfile() in memory and nothing local remains to
 * resurrect the previous account's coins/records on reload.
 */
export function clearLocalProfile(storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    // KVStorage is a minimal getItem/setItem shape; localStorage also supports
    // removeItem. Clear the key by removing it when possible, else blank it.
    const s = storage as KVStorage & { removeItem?: (k: string) => void };
    if (typeof s.removeItem === 'function') s.removeItem(KEY);
    else s.setItem(KEY, '');
  } catch {
    // Nothing persisted / storage blocked — safe to ignore.
  }
}


/**
 * Merge a local and a cloud copy of the same player. Progress is never lost:
 * currency/xp take the max, collections union, career counters take the max
 * (they only ever grow), preferences follow the most recently updated copy.
 *
 * Every collection access is null-coalesced because a cloud copy from Firebase
 * RTDB comes back with empty arrays/objects/null OMITTED (undefined) — feeding
 * that raw in used to throw `Object.keys(undefined)` and silently abort the save.
 * (Callers should still normalize via migrateProfile; this is defense in depth.)
 */
export function mergeProfiles(a: PlayerProfile, b: PlayerProfile): PlayerProfile {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const older = newer === a ? b : a;
  const aStats = a.stats ?? emptyCareerStats();
  const bStats = b.stats ?? emptyCareerStats();
  const aClub = a.clubUpgrades ?? {};
  const bClub = b.clubUpgrades ?? {};
  const aOwned = a.cosmetics?.owned ?? [];
  const bOwned = b.cosmetics?.owned ?? [];
  const stats: CareerStats = { ...emptyCareerStats() };
  (Object.keys(stats) as Array<keyof CareerStats>).forEach((k) => {
    if (k === 'bestRoundToPar') {
      // Reject undefined too (RTDB drops a null best-round) so Math.min can't NaN.
      const vals = [aStats.bestRoundToPar, bStats.bestRoundToPar].filter((v): v is number => v != null);
      stats.bestRoundToPar = vals.length ? Math.min(...vals) : null;
    } else {
      (stats[k] as number) = Math.max((aStats[k] as number) ?? 0, (bStats[k] as number) ?? 0);
    }
  });
  // Coins are SPENDABLE, so neither a plain max (resurrects spent currency) nor
  // last-write-wins (a fresh/empty local profile clobbers the cloud balance on
  // login) is correct. Derive the balance from two GROW-ONLY lifetime counters
  // that each merge cleanly by max: earned only grows, spent only grows, so a
  // spend always sticks AND logging in on a wiped device never loses the cloud
  // balance. Coalesce for pre-counter saves (earned falls back to the balance).
  const aEarned = a.coinsEarned ?? a.coins ?? 0;
  const bEarned = b.coinsEarned ?? b.coins ?? 0;
  const coinsEarned = Math.max(aEarned, bEarned);
  const coinsSpent = Math.max(a.coinsSpent ?? 0, b.coinsSpent ?? 0);
  return {
    ...newer,
    // `...newer` takes settings wholesale, which is fine for the three that are
    // also mirrored on DeviceSettings and re-asserted at boot — but `difficulty`
    // has no such backstop on the profile side. A remote copy with a newer
    // updatedAt (a second device, clock skew, an offline-queued write) would
    // silently drop a choice the player had just made. Absent means "never
    // chosen", so either side having chosen wins over neither.
    settings: {
      ...newer.settings,
      difficulty: newer.settings?.difficulty ?? older.settings?.difficulty
    },
    coinsEarned,
    coinsSpent,
    coins: Math.max(0, coinsEarned - coinsSpent),
    xp: Math.max(a.xp ?? 0, b.xp ?? 0),
    level: Math.max(a.level ?? 1, b.level ?? 1),
    cosmetics: {
      owned: [...new Set([...aOwned, ...bOwned])],
      equipped: newer.cosmetics?.equipped ?? {}
    },
    // One-time markers OR together, like season.cpDenominated: if EITHER side
    // has already handed out the Paintfall ball, the gift is spent. Taking the
    // newer side's value instead would let a stale cloud copy un-mark it and
    // re-equip the ball over a choice the player made since.
    dripGranted: (a.dripGranted ?? false) || (b.dripGranted ?? false),
    clubUpgrades: Object.fromEntries(
      [...new Set([...Object.keys(aClub), ...Object.keys(bClub)])].map((k) => [
        k,
        Math.max(aClub[k] ?? 0, bClub[k] ?? 0)
      ])
    ),
    achievements: [...new Set([...(a.achievements ?? []), ...(b.achievements ?? [])])],
    stats,
    daily: mergeDaily(a.daily, b.daily),
    season: mergeSeason(a.season, b.season),
    perks: mergePerks(a.perks, b.perks),
    consumables: mergePerks(a.consumables, b.consumables),
    retention: mergeRetention(a.retention, b.retention),
    // The career merges like the coins, once PER PRO: each Pro's grow-only
    // earned/spent pair takes the max, every balance is derived, attributes
    // take the per-stat max — the NEWER career goes first so its style choice
    // wins a conflict (and its legacy-split attribution, if the two devices
    // ever disagreed about it).
    career: mergeCareers(
      newer.career ?? emptyCareer(),
      (newer === a ? b.career : a.career) ?? emptyCareer()
    ),
    // Seasons merge PER KEY: each season resolves against its own counterpart
    // (the further-progressed copy wins), the archives union, and a season one
    // device has archived is never resurrected as live by the other.
    tours: mergeTours(
      migrateTours(newer.tours, newer.tour),
      migrateTours(newer === a ? b.tours : a.tours, newer === a ? b.tour : a.tour)
    ),
    // The record book merges per Pro: larger tallies win (two copies of one
    // timeline — summing would double-count), seasons union by seasonNo.
    tourHistory: mergeTourHistory(
      migrateTourHistory(a.tourHistory),
      migrateTourHistory(b.tourHistory)
    ),
    // Equip choice is transient per-round state — the most recent copy wins.
    equippedPerk: newer.equippedPerk ?? null,
    updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0)
  };
}

/** Daily-challenge state must merge MONOTONICALLY, not by last-write-wins: it
 *  fell out of the `...newer` spread, so a stale cross-device sync where the
 *  same day still reads `done:false` but carries a NEWER updatedAt used to
 *  RE-OPEN a completed challenge and pay the bonus a second time. For the SAME
 *  date key `done` is sticky — true if EITHER side completed it (mirrors the
 *  season `claimed` union). Different date keys are a genuine day rollover, so
 *  the LATER calendar day wins (a new day legitimately resets `done:false`). */
function mergeDaily(
  a?: PlayerProfile['daily'],
  b?: PlayerProfile['daily']
): PlayerProfile['daily'] {
  const fresh = { date: '', challengeId: '', done: false };
  const da = a ?? fresh;
  const db = b ?? fresh;
  if (da.date === db.date) {
    return { date: da.date, challengeId: da.challengeId || db.challengeId, done: da.done || db.done };
  }
  return da.date >= db.date ? da : db;
}

/** Union perks by id; grow-only counters take the max so a charge consumed on
 *  one device is never resurrected by the other (mirrors coinsEarned/Spent). */
function mergePerks(a?: PerkState[], b?: PerkState[]): PerkState[] {
  const byId = new Map<string, PerkState>();
  for (const p of [...(a ?? []), ...(b ?? [])]) {
    if (!p || typeof p.id !== 'string') continue;
    const cur = byId.get(p.id);
    if (cur) {
      cur.granted = Math.max(cur.granted, p.granted ?? 0);
      cur.used = Math.max(cur.used, p.used ?? 0);
    } else {
      byId.set(p.id, { id: p.id, granted: p.granted ?? 0, used: p.used ?? 0 });
    }
  }
  return [...byId.values()];
}

/** Season progress merges like the rest: xp grow-only (max), claimed unions,
 *  owned ORs, earliest purchase timestamp wins. Null-safe for cloud copies
 *  from before the pass existed. */
function mergeSeason(a?: SeasonState, b?: SeasonState): SeasonState {
  const fresh: SeasonState = { id: 's1', xp: 0, claimed: [], owned: false };
  const sa = a ?? fresh;
  const sb = b ?? fresh;
  const purchased = [sa.purchasedAt, sb.purchasedAt].filter((v): v is number => v != null);
  return {
    id: sa.id || sb.id || 's1',
    xp: Math.max(sa.xp ?? 0, sb.xp ?? 0),
    claimed: [...new Set([...(sa.claimed ?? []), ...(sb.claimed ?? [])])],
    owned: (sa.owned ?? false) || (sb.owned ?? false),
    // Both sides pass through migrateProfile before a merge, so by here the
    // scale is CP on both — the flag just has to survive.
    cpDenominated: (sa.cpDenominated ?? false) || (sb.cpDenominated ?? false),
    ...(purchased.length ? { purchasedAt: Math.min(...purchased) } : {})
  };
}
