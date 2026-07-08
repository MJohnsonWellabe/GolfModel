import { PlayerProfile } from '../profile/Profile';
import {
  ACHIEVEMENTS,
  COINS,
  dailyChallengeFor,
  levelForXp,
  RoundStats,
  XP
} from '../data/progression';

/**
 * Pure progression: turn a completed round into XP, coins, daily-challenge
 * credit, achievements and career-stat updates. Mutates the passed profile
 * and returns the reward events for the summary UI. NEVER touched by physics
 * or the AI (XP/level must not affect gameplay — docs 08).
 */

export type RewardEvent =
  | { kind: 'xp'; amount: number }
  | { kind: 'coins'; amount: number }
  | { kind: 'daily'; name: string; streak: number }
  | { kind: 'achievement'; name: string; desc: string }
  | { kind: 'levelUp'; level: number };

/** Yesterday's YYYY-MM-DD, for the streak-continuity check. */
function prevDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function applyRound(profile: PlayerProfile, r: RoundStats, dateKey = ''): RewardEvent[] {
  const events: RewardEvent[] = [];
  const startLevel = profile.level;

  // XP + coins for the round
  let xp = XP.round + r.birdies * XP.birdie + r.eagles * XP.eagle + r.holeInOnes * XP.holeInOne;
  let coins = COINS.round + Math.max(0, -r.toPar) * COINS.perUnderPar;
  if (r.won) {
    xp += XP.tournamentWin;
    coins += COINS.tournamentWin;
  }

  // Daily challenge — completed at most once per day, extends the streak
  if (dateKey && !(profile.daily.date === dateKey && profile.daily.done)) {
    const challenge = dailyChallengeFor(dateKey);
    profile.daily = { date: dateKey, challengeId: challenge.id, done: false };
    if (challenge.test(r)) {
      profile.daily.done = true;
      xp += XP.daily;
      coins += COINS.daily;
      profile.dailyStreak = profile.lastDailyDate === prevDay(dateKey) ? profile.dailyStreak + 1 : 1;
      profile.lastDailyDate = dateKey;
      events.push({ kind: 'daily', name: challenge.name, streak: profile.dailyStreak });
    }
  }

  profile.xp += xp;
  profile.coins += coins;
  events.push({ kind: 'xp', amount: xp });
  events.push({ kind: 'coins', amount: coins });

  // Career statistics (accumulate; bests take the extreme)
  const s = profile.stats;
  s.rounds += 1;
  s.holesPlayed += r.pars + r.birdies + r.eagles + r.bogeys + r.holeInOnes;
  s.totalStrokes += r.strokes;
  s.birdies += r.birdies;
  s.eagles += r.eagles;
  s.holeInOnes += r.holeInOnes;
  s.pars += r.pars;
  s.bogeys += r.bogeys;
  s.fairwaysHit += r.fairwaysHit;
  s.greensInRegulation += r.greensInRegulation;
  s.puttsMade += r.puttsMade;
  s.chipIns += r.chipIns;
  if (r.won) s.wins += 1;
  s.longestDriveYds = Math.max(s.longestDriveYds, r.longestDriveYds);
  s.longestPuttFt = Math.max(s.longestPuttFt, r.longestPuttMadeFt);
  s.bestRoundToPar = s.bestRoundToPar === null ? r.toPar : Math.min(s.bestRoundToPar, r.toPar);

  // Level up from the new XP total
  profile.level = levelForXp(profile.xp);

  // Achievements (checked after stats + level so level_10 etc. can fire)
  for (const a of ACHIEVEMENTS) {
    if (profile.achievements.includes(a.id)) continue;
    if (a.test(s, profile)) {
      profile.achievements.push(a.id);
      profile.xp += a.xp;
      profile.coins += a.coins;
      events.push({ kind: 'achievement', name: a.name, desc: a.desc });
    }
  }
  // A late achievement XP bump can cross another level threshold
  profile.level = levelForXp(profile.xp);
  for (let lvl = startLevel + 1; lvl <= profile.level; lvl++) {
    events.push({ kind: 'levelUp', level: lvl });
  }
  return events;
}
