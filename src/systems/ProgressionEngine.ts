import { PlayerProfile } from '../profile/Profile';
import { COINS, DailyChallenge, dailyChallengeFor, RoundStats } from '../data/progression';
import { featDone, FEATS } from './Feats';
import { cpForRound } from '../data/career';
import { grantCareerCp } from './CareerWallet';

/**
 * Pure progression: turn a completed round into CP, coins, daily-challenge
 * credit, achievements and career-stat updates. Mutates the passed profile
 * and returns the reward events for the summary UI.
 *
 * CP REPLACED XP (career mode, owner decision: two economies, not three).
 * The legacy xp/level fields are FROZEN — never granted again, kept only so
 * old profiles merge cleanly. CP is credited to THE PRO WHO PLAYED THE ROUND
 * (systems/CareerWallet over the per-Pro ledger — a grow-only earned/spent
 * pair each), and the same amount paces the season pass. Career ATTRIBUTES
 * affect gameplay by design now — but only ever through the player's own
 * explicit spending, never through anything in this engine.
 */

export type RewardEvent =
  | { kind: 'cp'; amount: number }
  | { kind: 'coins'; amount: number }
  | { kind: 'daily'; name: string; streak: number }
  | { kind: 'achievement'; id: string; name: string; desc: string };

/** Yesterday's YYYY-MM-DD, for the streak-continuity check. Uses LOCAL calendar
 *  time to match todayKey() in slice3d/main.ts — mixing UTC here with a local
 *  today made the streak/daily date logic disagree near midnight in negative-UTC
 *  zones. new Date(y, m-1, d-1) constructs the previous local day directly, so
 *  it's DST-safe (no fixed 86.4M-ms subtraction that can slip an hour). */
function prevDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function applyRound(
  profile: PlayerProfile,
  r: RoundStats,
  dateKey = '',
  /** The day's challenge — normally the deterministic pick; the caller may
   *  pass a live-ops override (data/liveOpsConfig). Same date key, same
   *  challenge, everywhere. */
  challengeOverride?: DailyChallenge
): RewardEvent[] {
  const events: RewardEvent[] = [];

  // Coins for the round; the CP is computed once the daily outcome is known.
  let coins = COINS.round + Math.max(0, -r.toPar) * COINS.perUnderPar;
  if (r.won) coins += COINS.tournamentWin;
  let dailyDone = false;

  // Daily streak — consecutive days with at least one COMPLETED ROUND. The
  // streak used to extend only when the daily challenge succeeded, so a single
  // hard challenge day (eagle, chip-in…) reset it and it never climbed past
  // 1–2 for a daily player. Playing every day is the habit the streak rewards;
  // the challenge below stays a separate XP/coin bonus.
  if (dateKey && profile.lastDailyDate !== dateKey) {
    profile.dailyStreak = profile.lastDailyDate === prevDay(dateKey) ? profile.dailyStreak + 1 : 1;
    profile.lastDailyDate = dateKey;
  }

  // Daily challenge — completed at most once per day, pays a bonus
  if (dateKey && !(profile.daily.date === dateKey && profile.daily.done)) {
    const challenge = challengeOverride ?? dailyChallengeFor(dateKey);
    profile.daily = { date: dateKey, challengeId: challenge.id, done: false };
    if (challenge.test(r)) {
      profile.daily.done = true;
      dailyDone = true;
      coins += COINS.daily;
      events.push({ kind: 'daily', name: challenge.name, streak: profile.dailyStreak });
    }
  }

  // CP — the career currency the round pays (data/career.ts owns the table).
  const cp = cpForRound({
    toPar: r.toPar,
    birdies: r.birdies,
    eagles: r.eagles,
    holeInOnes: r.holeInOnes,
    won: r.won ?? false,
    dailyDone
  });
  grantCareerCp(profile, cp);
  profile.coins += coins;
  profile.coinsEarned += coins; // grow-only lifetime tally (drives cloud merge)
  events.push({ kind: 'cp', amount: cp });
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

  // Feats (checked after the stats fold so this round's counters can complete
  // one). `profile.achievements` is still the completed-id list — the ids were
  // carried over deliberately, so a player who earned a badge under the old
  // achievement table keeps it (systems/Feats.ts).
  for (const f of FEATS) {
    if (profile.achievements.includes(f.id)) continue;
    if (featDone(f, profile)) {
      profile.achievements.push(f.id);
      grantCareerCp(profile, f.cp);
      profile.coins += f.coins;
      profile.coinsEarned += f.coins; // grow-only lifetime tally
      events.push({ kind: 'achievement', id: f.id, name: f.name, desc: f.desc });
    }
  }
  return events;
}
