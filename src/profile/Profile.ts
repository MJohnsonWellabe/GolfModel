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
  /** Pass XP accrued this season — grow-only, merges by max. */
  xp: number;
  /** Reward levels already claimed — merges by union. */
  claimed: number[];
  /** True once the pass is purchased — merges by OR. */
  owned: boolean;
  purchasedAt?: number;
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
  /** Consecutive days a daily challenge was completed. */
  dailyStreak: number;
  /** YYYY-MM-DD of the last completed daily challenge. */
  lastDailyDate: string;
  settings: { sound: number; ambience: number; reducedMotion: boolean };
  /** Codes of tournaments the player created or played, newest first — the
   *  "My Tournaments" history (Phase 8 gap). */
  tournaments: Array<{ code: string; name: string }>;
  season: SeasonState;
  /** Owned consumable perks (season-pass rewards). */
  perks: PerkState[];
  /** Perk equipped for the next round, or null. */
  equippedPerk: string | null;
  updatedAt: number;
}

/** Rounds of a perk still available (granted − used, never negative). */
export function perkRemaining(p: PerkState): number {
  return Math.max(0, (p.granted ?? 0) - (p.used ?? 0));
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
    tournaments: [],
    season: { id: 's1', xp: 0, claimed: [], owned: false },
    perks: [],
    equippedPerk: null,
    updatedAt: now
  };
}

/** Add rounds of a perk to the inventory (grants stack onto an existing entry). */
export function grantPerk(profile: PlayerProfile, perkId: string, rounds: number): void {
  const existing = profile.perks.find((p) => p.id === perkId);
  if (existing) existing.granted += rounds;
  else profile.perks.push({ id: perkId, granted: rounds, used: 0 });
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
 * `clubUpgrades`/`achievements`/`tournaments` absent (undefined) and
 * `stats.bestRoundToPar` absent — feeding that raw into mergeProfiles would throw
 * (`Object.keys(undefined)`). Normalizing through here first guarantees all
 * collections are present. Shared by loadProfile and cloudSyncProfile.
 */
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
      // Always keep the default-owned items, even for older saves.
      owned: [...new Set([...base.cosmetics.owned, ...(parsed.cosmetics?.owned ?? [])])],
      equipped: { ...base.cosmetics.equipped, ...(parsed.cosmetics?.equipped ?? {}) }
    },
    clubUpgrades: { ...(parsed.clubUpgrades ?? {}) },
    achievements: [...(parsed.achievements ?? [])],
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    daily: { ...base.daily, ...(parsed.daily ?? {}) },
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
    tournaments: [...(parsed.tournaments ?? [])],
    // RTDB drops the empty claimed array — coalesce it back (like achievements).
    season: {
      ...base.season,
      ...(parsed.season ?? {}),
      claimed: [...(parsed.season?.claimed ?? [])]
    },
    // RTDB drops empty arrays/null — backfill perks + equipped like the rest.
    perks: [...(parsed.perks ?? [])],
    equippedPerk: parsed.equippedPerk ?? null
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
 *
 * Every collection access is null-coalesced because a cloud copy from Firebase
 * RTDB comes back with empty arrays/objects/null OMITTED (undefined) — feeding
 * that raw in used to throw `Object.keys(undefined)` and silently abort the save.
 * (Callers should still normalize via migrateProfile; this is defense in depth.)
 */
export function mergeProfiles(a: PlayerProfile, b: PlayerProfile): PlayerProfile {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
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
    coinsEarned,
    coinsSpent,
    coins: Math.max(0, coinsEarned - coinsSpent),
    xp: Math.max(a.xp ?? 0, b.xp ?? 0),
    level: Math.max(a.level ?? 1, b.level ?? 1),
    cosmetics: {
      owned: [...new Set([...aOwned, ...bOwned])],
      equipped: newer.cosmetics?.equipped ?? {}
    },
    clubUpgrades: Object.fromEntries(
      [...new Set([...Object.keys(aClub), ...Object.keys(bClub)])].map((k) => [
        k,
        Math.max(aClub[k] ?? 0, bClub[k] ?? 0)
      ])
    ),
    achievements: [...new Set([...(a.achievements ?? []), ...(b.achievements ?? [])])],
    stats,
    tournaments: mergeTournaments(a.tournaments ?? [], b.tournaments ?? []),
    season: mergeSeason(a.season, b.season),
    perks: mergePerks(a.perks, b.perks),
    // Equip choice is transient per-round state — the most recent copy wins.
    equippedPerk: newer.equippedPerk ?? null,
    updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0)
  };
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
    ...(purchased.length ? { purchasedAt: Math.min(...purchased) } : {})
  };
}
