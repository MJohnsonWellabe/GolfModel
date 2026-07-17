import { CareerStats, PlayerProfile } from '../profile/Profile';
import { starCount } from '../systems/Mastery';

/**
 * Progression tuning — XP, coins, levels, achievements and daily challenges,
 * all straight from `docs/08_LIVE_SERVICE_AND_PROGRESSION.md`. Config only:
 * the pure `ProgressionEngine` consumes these. XP/levels NEVER affect
 * gameplay (docs 08) — nothing here is read by physics or the AI.
 */

export const XP = {
  round: 100,
  birdie: 25,
  eagle: 75,
  holeInOne: 250,
  tournamentWin: 200,
  daily: 50
} as const;

export const COINS = {
  round: 20,
  perUnderPar: 10,
  tournamentWin: 50,
  daily: 25,
  weekly: 100
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

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  xp: number;
  coins: number;
  /** True once the career stats (and level) satisfy the achievement. */
  test: (stats: CareerStats, profile: PlayerProfile) => boolean;
}

/**
 * Curated achievement set (retention Part 6): deliberately limited — one
 * meaningful goal per skill surface, not hundreds of checkbox fillers.
 * Categories: scoring, putting, driving, accuracy, recovery, course mastery,
 * consistency, Fire Mode, Daily Challenge, competitive, rare. Deterministic
 * and testable: every test reads only career stats / profile state.
 */
export const ACHIEVEMENTS: Achievement[] = [
  // Firsts (scoring / rare)
  { id: 'first_birdie', name: 'First Birdie', desc: 'Make your first birdie', xp: 50, coins: 25, test: (s) => s.birdies >= 1 },
  { id: 'first_eagle', name: 'First Eagle', desc: 'Make your first eagle', xp: 100, coins: 50, test: (s) => s.eagles >= 1 },
  { id: 'first_ace', name: 'Hole-in-One!', desc: 'Record a hole-in-one', xp: 250, coins: 100, test: (s) => s.holeInOnes >= 1 },
  // Scoring depth
  { id: 'birdies_25', name: 'Birdie Machine', desc: 'Make 25 birdies', xp: 100, coins: 50, test: (s) => s.birdies >= 25 },
  { id: 'deep_red', name: 'Deep Red', desc: 'Finish a round 3+ under par', xp: 150, coins: 75, test: (s) => s.bestRoundToPar !== null && s.bestRoundToPar <= -3 },
  // Putting
  { id: 'putts_50', name: 'Putting Ace', desc: 'Make 50 putts', xp: 75, coins: 40, test: (s) => s.puttsMade >= 50 },
  { id: 'bomb_putt', name: 'Bomb Dropper', desc: 'Hole a putt of 30+ feet', xp: 100, coins: 50, test: (s) => s.longestPuttFt >= 30 },
  // Driving
  { id: 'big_stick', name: 'Big Stick', desc: 'Drive one 320+ yards', xp: 100, coins: 50, test: (s) => s.longestDriveYds >= 320 },
  // Accuracy
  { id: 'fairways_100', name: 'Straight Shooter', desc: 'Hit 100 fairways', xp: 100, coins: 50, test: (s) => s.fairwaysHit >= 100 },
  { id: 'gir_100', name: 'Dialed In', desc: 'Hit 100 greens in regulation', xp: 100, coins: 50, test: (s) => s.greensInRegulation >= 100 },
  // Recovery
  { id: 'chip_ins_10', name: 'Short-Game Wizard', desc: 'Hole out 10 chip-ins', xp: 150, coins: 75, test: (s) => s.chipIns >= 10 },
  // Course mastery (retention Part 5 stars)
  { id: 'course_master', name: 'Course Master', desc: 'Earn all 9 stars on one course', xp: 200, coins: 100, test: (_s, p) => ['sablebay', 'wildwood', 'timberline', 'portjohnson'].some((c) => starCount(p.retention?.mastery ?? { v: 1, stars: {} }, c) >= 9) },
  { id: 'stars_18', name: 'Constellation', desc: 'Earn 18 mastery stars', xp: 200, coins: 100, test: (_s, p) => starCount(p.retention?.mastery ?? { v: 1, stars: {} }) >= 18 },
  // Consistency
  { id: 'rounds_25', name: 'Regular', desc: 'Play 25 rounds', xp: 100, coins: 50, test: (s) => s.rounds >= 25 },
  { id: 'rounds_100', name: 'Century Club', desc: 'Play 100 rounds', xp: 250, coins: 150, test: (s) => s.rounds >= 100 },
  { id: 'pars_100', name: 'Steady Hand', desc: 'Make 100 pars', xp: 100, coins: 50, test: (s) => s.pars >= 100 },
  // Fire Mode
  { id: 'fire_5', name: 'Blazing', desc: 'Reach a 5-swing Fire streak', xp: 150, coins: 75, test: (_s, p) => (p.retention?.records?.longestFireStreak ?? 0) >= 5 },
  // Daily Challenge (also the day-7 streak badge)
  { id: 'streak_7', name: 'Committed', desc: 'Reach a 7-day streak', xp: 100, coins: 50, test: (_s, p) => Math.max(p.dailyStreak, p.retention?.streak?.best ?? 0) >= 7 },
  // Competitive
  { id: 'level_10', name: 'Seasoned', desc: 'Reach level 10', xp: 150, coins: 75, test: (_s, p) => p.level >= 10 },
  { id: 'wins_10', name: 'Rival Slayer', desc: 'Win 10 head-to-head rounds', xp: 150, coins: 75, test: (s) => s.wins >= 10 },
  { id: 'win_tournament', name: 'Champion', desc: 'Win a tournament', xp: 200, coins: 100, test: (s) => s.tournamentWins >= 1 }
];

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
