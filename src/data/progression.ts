
/**
 * Progression tuning — XP, coins, levels and daily challenges (the feats
 * moved to systems/Feats.ts),
 * all straight from `docs/08_LIVE_SERVICE_AND_PROGRESSION.md`. Config only:
 * the pure `ProgressionEngine` consumes these. XP/levels NEVER affect
 * gameplay (docs 08) — nothing here is read by physics or the AI.
 */

/** LEGACY XP table — frozen with the xp/level fields it fed (career mode: CP
 *  replaced XP as the progression currency, data/career.ts). Kept only so an
 *  old profile's numbers still mean what they meant; nothing grants from it. */
/** A legacy `xp` reward re-denominated in CP (the tables were authored at
 *  ~25 XP : 1 CP). Floor of 2 so no reward pays zero. Still live: the season
 *  pass and the streak ladder both grant from xp-denominated reward tables. */
export function achievementCp(xp: number): number {
  return Math.max(2, Math.round(xp / 25));
}

export const XP = {
  round: 100,
  birdie: 25,
  eagle: 75,
  holeInOne: 250,
  tournamentWin: 200,
  daily: 50
} as const;

export const COINS = {
  // Per-round earnings halved (owner) to slow the coin economy so the coin
  // Season-Pass price (500) and store prices carry more weight.
  round: 10,
  perUnderPar: 5,
  tournamentWin: 25,
  daily: 25,
  weekly: 100,
  /** One-time payout for finishing the "Learn to play" lesson (`tutorialDepth`).
   *  Deliberately modest — about two rounds' worth, enough to make the lesson
   *  feel like it counted without shortcutting the store economy the
   *  reward-economy audit sized in docs/21_RETENTION_AND_PERFORMANCE_PASS.md. */
  tutorial: 50
} as const;

export const LEVEL_CAP = 50;

/** Cumulative XP required to REACH level n (quadratic curve). L2=250, L10≈11250. */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round(125 * (n - 1) * n);
}

/** Highest level whose XP threshold `xp` has reached. */
export function levelForXp(xp: number): number {
  let n = 1;
  while (n < LEVEL_CAP && xp >= xpForLevel(n + 1)) n++;
  return n;
}

/* The curated achievement table used to live here. It is now
 * `systems/Feats.ts` — same ids, same rewards (re-denominated from the legacy
 * `xp` field into the CP those rewards already paid), plus the one thing it
 * could never do: report how far along each one the player is. */

/**
 * Round-level results the daily challenges and reward math read. Built by the
 * live game (main.ts) and the headless RoundSimulator alike.
 */
export interface RoundStats {
  toPar: number;
  strokes: number;
  birdies: number;
  eagles: number;
  holeInOnes: number;
  pars: number;
  bogeys: number;
  fairwaysHit: number;
  fairwaysPossible: number;
  greensInRegulation: number;
  puttsMade: number;
  longestDriveYds: number;
  longestPuttMadeFt: number;
  chipIns: number;
  /** True when the human won a 1v1 / tournament this round. */
  won?: boolean;
}

export function emptyRoundStats(): RoundStats {
  return {
    toPar: 0,
    strokes: 0,
    birdies: 0,
    eagles: 0,
    holeInOnes: 0,
    pars: 0,
    bogeys: 0,
    fairwaysHit: 0,
    fairwaysPossible: 0,
    greensInRegulation: 0,
    puttsMade: 0,
    longestDriveYds: 0,
    longestPuttMadeFt: 0,
    chipIns: 0
  };
}

export interface DailyChallenge {
  id: string;
  name: string;
  test: (r: RoundStats) => boolean;
}

export const DAILY_CHALLENGES: DailyChallenge[] = [
  { id: 'birdie', name: 'Make a birdie', test: (r) => r.birdies >= 1 },
  { id: 'eagle', name: 'Make an eagle', test: (r) => r.eagles >= 1 },
  { id: 'chip_in', name: 'Chip in from off the green', test: (r) => r.chipIns >= 1 },
  { id: 'under_par', name: 'Finish the round under par', test: (r) => r.toPar < 0 },
  { id: 'big_drive', name: 'Drive one over 300 yards', test: (r) => r.longestDriveYds >= 300 },
  { id: 'long_putt', name: 'Make a putt over 20 feet', test: (r) => r.longestPuttMadeFt >= 20 },
  { id: 'all_fairways', name: 'Hit every fairway', test: (r) => r.fairwaysPossible > 0 && r.fairwaysHit >= r.fairwaysPossible }
];

/** Deterministic, well-distributed 0..1 hash (FNV-1a + avalanche) — plain
 *  char-sum hashing clusters for near-identical date strings. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The challenge for a given YYYY-MM-DD day key. */
export function dailyChallengeFor(dateKey: string): DailyChallenge {
  return DAILY_CHALLENGES[Math.floor(hashStr(dateKey) * DAILY_CHALLENGES.length) % DAILY_CHALLENGES.length];
}
