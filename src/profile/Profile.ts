import { ArchetypeId } from '../data/archetypes';
import { CharacterKey } from '../data/characters';
import { DEFAULT_EQUIPPED, DEFAULT_OWNED } from '../data/storeCatalog';

/**
 * The player's persistent identity: selections, currency, progression and
 * career stats. Guest-first (docs 08: "Guest Mode should always be the
 * default experience") — stored locally from first launch, synced to the
 * cloud once Firebase auth is configured (firebase/FirebaseClient.ts).
 * Phases 6 (progression) and 7 (store) read and write this object.
 */

export type CosmeticKind = 'character' | 'ball' | 'trail' | 'outfit' | 'clubskin';

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
  archetype: ArchetypeId;
  coins: number;
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
  /** Consecutive days a daily challenge was completed. */
  dailyStreak: number;
  /** YYYY-MM-DD of the last completed daily challenge. */
  lastDailyDate: string;
  settings: { sound: number; ambience: number; reducedMotion: boolean };
  /** Codes of tournaments the player created or played, newest first — the
   *  "My Tournaments" history (Phase 8 gap). */
  tournaments: Array<{ code: string; name: string }>;
  updatedAt: number;
}

const KEY = 'johnsons-golf-profile-v1';

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
    tournaments: [],
    updatedAt: now
  };
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

export function loadProfile(storage: KVStorage | null = defaultStorage()): PlayerProfile {
  if (!storage) return defaultProfile();
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    // Forward-compatible migrate: fill anything missing from the default
    const base = defaultProfile();
    return {
      ...base,
      ...parsed,
      v: 1,
      cosmetics: {
        // Always keep the default-owned items, even for older saves.
        owned: [...new Set([...base.cosmetics.owned, ...(parsed.cosmetics?.owned ?? [])])],
        equipped: { ...base.cosmetics.equipped, ...(parsed.cosmetics?.equipped ?? {}) }
      },
      clubUpgrades: { ...(parsed.clubUpgrades ?? {}) },
      achievements: [...(parsed.achievements ?? [])],
      stats: { ...base.stats, ...(parsed.stats ?? {}) },
      daily: { ...base.daily, ...(parsed.daily ?? {}) },
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      tournaments: [...(parsed.tournaments ?? [])]
    };
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

/** Union two tournament histories by code, newest (a) first, capped at 30. */
function mergeTournaments(
  a: PlayerProfile['tournaments'],
  b: PlayerProfile['tournaments']
): PlayerProfile['tournaments'] {
  const seen = new Set<string>();
  const out: PlayerProfile['tournaments'] = [];
  for (const t of [...a, ...b]) {
    if (seen.has(t.code)) continue;
    seen.add(t.code);
    out.push(t);
  }
  return out.slice(0, 30);
}

/**
 * Merge a local and a cloud copy of the same player. Progress is never lost:
 * currency/xp take the max, collections union, career counters take the max
 * (they only ever grow), preferences follow the most recently updated copy.
 */
export function mergeProfiles(a: PlayerProfile, b: PlayerProfile): PlayerProfile {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const stats: CareerStats = { ...emptyCareerStats() };
  (Object.keys(stats) as Array<keyof CareerStats>).forEach((k) => {
    if (k === 'bestRoundToPar') {
      const vals = [a.stats.bestRoundToPar, b.stats.bestRoundToPar].filter((v): v is number => v !== null);
      stats.bestRoundToPar = vals.length ? Math.min(...vals) : null;
    } else {
      (stats[k] as number) = Math.max(a.stats[k] as number, b.stats[k] as number);
    }
  });
  return {
    ...newer,
    // Coins are SPENDABLE, so a plain max would resurrect currency the player
    // just spent (buy an item on this device, sync, and the pre-spend cloud
    // balance overwrites the debit). Take the most-recently-updated copy's
    // balance instead — last write wins — so spends and earnings both persist.
    coins: newer.coins,
    xp: Math.max(a.xp, b.xp),
    level: Math.max(a.level, b.level),
    cosmetics: {
      owned: [...new Set([...a.cosmetics.owned, ...b.cosmetics.owned])],
      equipped: newer.cosmetics.equipped
    },
    clubUpgrades: Object.fromEntries(
      [...new Set([...Object.keys(a.clubUpgrades), ...Object.keys(b.clubUpgrades)])].map((k) => [
        k,
        Math.max(a.clubUpgrades[k] ?? 0, b.clubUpgrades[k] ?? 0)
      ])
    ),
    achievements: [...new Set([...a.achievements, ...b.achievements])],
    stats,
    tournaments: mergeTournaments(a.tournaments, b.tournaments),
    updatedAt: Math.max(a.updatedAt, b.updatedAt)
  };
}
