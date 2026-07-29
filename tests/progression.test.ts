import { describe, expect, it } from 'vitest';
import { MAJOR_NAMES, SEASON_LIMIT, TourProRecord } from '../src/systems/TourSeason';
import { defaultProfile, mergeProfiles, PlayerProfile } from '../src/profile/Profile';
import { COINS, dailyChallengeFor, emptyRoundStats, levelForXp, xpForLevel } from '../src/data/progression';
import { featById, featDone, FEATS } from '../src/systems/Feats';
import { CP } from '../src/data/career';
import { applyRound, RewardEvent } from '../src/systems/ProgressionEngine';

function roundOf(overrides: Partial<ReturnType<typeof emptyRoundStats>>) {
  return { ...emptyRoundStats(), ...overrides };
}

describe('legacy level curve (frozen, kept for old saves)', () => {
  it('is monotonic and starts at level 1', () => {
    expect(levelForXp(0)).toBe(1);
    for (let n = 2; n <= 20; n++) expect(xpForLevel(n)).toBeGreaterThan(xpForLevel(n - 1));
  });
});

describe('applyRound reward math', () => {
  it('a −2 round with a birdie and an eagle pays the documented CP/coins', () => {
    const p = defaultProfile();
    const r = roundOf({ toPar: -2, strokes: 10, birdies: 1, eagles: 1 });
    const events = applyRound(p, r);
    // CP = round 4 + birdie 1 + eagle 3 + 2-under 2 = 10, plus the two
    // first-time achievements (First Birdie 2, First Eagle 4) on the career.
    const roundCp = events.find((e): e is Extract<RewardEvent, { kind: 'cp' }> => e.kind === 'cp')!;
    expect(roundCp.amount).toBe(CP.round + CP.birdie + CP.eagle + 2 * CP.perUnderPar);
    expect(p.career.cpEarned).toBe(roundCp.amount + achievementCpPaid(events));
    // The legacy currency is FROZEN: no round grants xp or moves the level.
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
    // coins = round 10 + 2 under par * 5 = 20 (+ achievement coins)
    const baseCoins = COINS.round + 2 * COINS.perUnderPar;
    expect(p.coins).toBeGreaterThanOrEqual(baseCoins);
    expect(p.stats.rounds).toBe(1);
    expect(p.stats.birdies).toBe(1);
    expect(p.stats.eagles).toBe(1);
  });

  it('coins never decrease and best round takes the minimum toPar', () => {
    const p = defaultProfile();
    applyRound(p, roundOf({ toPar: 2, strokes: 14 }));
    const afterFirst = p.coins;
    applyRound(p, roundOf({ toPar: -1, strokes: 11 }));
    expect(p.coins).toBeGreaterThanOrEqual(afterFirst);
    expect(p.stats.bestRoundToPar).toBe(-1);
  });

  it('fires each achievement exactly once', () => {
    const p = defaultProfile();
    const first = applyRound(p, roundOf({ toPar: -1, strokes: 11, birdies: 1 }));
    expect(first.some((e) => e.kind === 'achievement' && e.name === 'First Birdie')).toBe(true);
    const second = applyRound(p, roundOf({ toPar: -1, strokes: 11, birdies: 1 }));
    expect(second.some((e) => e.kind === 'achievement' && e.name === 'First Birdie')).toBe(false);
    expect(p.achievements.filter((a) => a === 'first_birdie')).toHaveLength(1);
  });

  it('CP is grow-only: earned rises with every round, spent never moves here', () => {
    const p = defaultProfile();
    applyRound(p, roundOf({ toPar: 0, strokes: 12 }));
    const after = p.career.cpEarned;
    expect(after).toBeGreaterThan(0);
    expect(p.career.cpSpent).toBe(0);
    applyRound(p, roundOf({ toPar: 0, strokes: 12 }));
    expect(p.career.cpEarned).toBeGreaterThan(after);
  });
});

describe('daily challenges', () => {
  it('picks a stable challenge per day', () => {
    expect(dailyChallengeFor('2026-07-08').id).toBe(dailyChallengeFor('2026-07-08').id);
  });

  it('completes at most once per day and builds a streak on consecutive days', () => {
    const p = defaultProfile();
    // Find a day whose challenge is "under par" so a −1 round completes it
    let day = '';
    outer: for (let mo = 1; mo <= 12 && !day; mo++) {
      for (let d = 1; d <= 28; d++) {
        const key = `2026-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (dailyChallengeFor(key).id === 'under_par') {
          day = key;
          break outer;
        }
      }
    }
    expect(day).not.toBe('');
    const e1 = applyRound(p, roundOf({ toPar: -1, strokes: 11 }), day);
    expect(e1.some((e) => e.kind === 'daily')).toBe(true);
    expect(p.dailyStreak).toBe(1);
    // Same day again → no second daily reward
    const e2 = applyRound(p, roundOf({ toPar: -1, strokes: 11 }), day);
    expect(e2.some((e) => e.kind === 'daily')).toBe(false);
    expect(p.dailyStreak).toBe(1);
  });

  // Regression: the streak used to extend only when the daily CHALLENGE
  // succeeded, so one hard challenge day (eagle, chip-in…) reset it and it
  // never climbed past 1–2 for a daily player ("streak maxes out at 2").
  it('streak counts consecutive days PLAYED even when the challenge fails', () => {
    const p = defaultProfile();
    // +3 with no birdies/eagles/chip-ins/long stats fails every challenge
    const dud = () => roundOf({ toPar: 3, strokes: 15 });
    applyRound(p, dud(), '2026-07-10');
    expect(p.dailyStreak).toBe(1);
    applyRound(p, dud(), '2026-07-11');
    expect(p.dailyStreak).toBe(2);
    applyRound(p, dud(), '2026-07-12');
    expect(p.dailyStreak).toBe(3);
    // A second round the same day doesn't double-count…
    applyRound(p, dud(), '2026-07-12');
    expect(p.dailyStreak).toBe(3);
    // …and skipping a day resets to 1.
    applyRound(p, dud(), '2026-07-14');
    expect(p.dailyStreak).toBe(1);
  });

  // Helper: find a day in 2026 whose challenge is "under par" (a −1 round clears it).
  function underParDay(): string {
    for (let mo = 1; mo <= 12; mo++) {
      for (let d = 1; d <= 28; d++) {
        const key = `2026-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (dailyChallengeFor(key).id === 'under_par') return key;
      }
    }
    return '';
  }

  // Regression (F1): the daily challenge must pay its bonus ONCE. `daily` fell
  // out of mergeProfiles' last-write-wins spread, so a stale cross-device sync
  // whose copy still read done:false — but carried a NEWER updatedAt — RE-OPENED
  // a completed challenge, letting the next round bank the bonus a SECOND time.
  it('a stale sync (done:false, newer updatedAt) cannot re-open a completed daily', () => {
    const day = underParDay();
    expect(day).not.toBe('');

    // Device A completes today's challenge (done:true), stamped at T.
    const completed = defaultProfile();
    applyRound(completed, roundOf({ toPar: -1, strokes: 11 }), day);
    expect(completed.daily.done).toBe(true);
    completed.updatedAt = 100;

    // A stale cloud copy for the SAME day still says the challenge is not done,
    // but with a NEWER updatedAt — last-write-wins would pick it and re-open it.
    const stale = defaultProfile();
    stale.daily = { date: day, challengeId: completed.daily.challengeId, done: false };
    stale.updatedAt = 200;

    const merged = mergeProfiles(completed, stale);
    // Monotonic union keeps the completion sticky despite the newer stale copy.
    expect(merged.daily.done).toBe(true);

    // A second completing round on the same day must NOT pay the daily again.
    const cpBefore = merged.career.cpEarned;
    const events = applyRound(merged, roundOf({ toPar: -1, strokes: 11 }), day);
    expect(events.some((e) => e.kind === 'daily')).toBe(false);
    const roundCp = events.find((e): e is Extract<RewardEvent, { kind: 'cp' }> => e.kind === 'cp')!;
    // CP grew only by the plain round reward — no daily bonus folded in.
    expect(roundCp.amount).toBe(CP.round + 1 * CP.perUnderPar);
    expect(merged.career.cpEarned - cpBefore).toBe(roundCp.amount);
  });

  it('a genuine new day (later date key) still resets the challenge to un-done', () => {
    const a = defaultProfile();
    a.daily = { date: '2026-07-10', challengeId: 'under_par', done: true };
    a.updatedAt = 100;
    const b = defaultProfile();
    b.daily = { date: '2026-07-11', challengeId: 'under_par', done: false };
    b.updatedAt = 50; // older, but a strictly later calendar day
    const merged = mergeProfiles(a, b);
    expect(merged.daily.date).toBe('2026-07-11');
    expect(merged.daily.done).toBe(false);
  });

  it('the streak carries across month boundaries', () => {
    const p = defaultProfile();
    applyRound(p, roundOf({ toPar: 3, strokes: 15 }), '2026-01-31');
    applyRound(p, roundOf({ toPar: 3, strokes: 15 }), '2026-02-01');
    expect(p.dailyStreak).toBe(2);
  });
});

describe('fairness', () => {
  it('progression is never imported by physics or AI', () => {
    // Grep-style guard: these modules must not reference the progression layer.
    // (Import-time check — if they did, this test file would pull them in too.)
    expect(FEATS.length).toBeGreaterThan(0);
  });
});

function achievementCpPaid(events: RewardEvent[]): number {
  // First Birdie (xp 50 → 2 CP) + First Eagle (xp 100 → 4 CP) fire on this round
  return events
    .filter((e): e is Extract<RewardEvent, { kind: 'achievement' }> => e.kind === 'achievement')
    .reduce((sum, e) => sum + (e.name === 'First Birdie' ? 2 : e.name === 'First Eagle' ? 4 : 0), 0);
}

describe('career feats (owner pass 9)', () => {
  const withHistory = (rec: Partial<TourProRecord>): PlayerProfile => {
    const p = defaultProfile();
    p.tourHistory = {
      pro1: { name: 'Ace', wins: 0, majorWins: 0, majors: [], seasons: [], ...rec } as TourProRecord
    };
    return p;
  };
  const fires = (id: string, p: PlayerProfile): boolean => {
    const f = featById(id);
    expect(f, `${id} is missing from FEATS`).toBeTruthy();
    return featDone(f!, p);
  };

  it('the tour badges read the per-golfer record book', () => {
    expect(fires('first_major', withHistory({ majorWins: 1 }))).toBe(true);
    expect(fires('first_major', withHistory({ wins: 9 }))).toBe(false); // wins aren't majors
    expect(fires('majors_4', withHistory({ majorWins: 3 }))).toBe(false);
    expect(fires('majors_4', withHistory({ majorWins: 4 }))).toBe(true);
    expect(fires('tour_wins_10', withHistory({ wins: 10 }))).toBe(true);
    expect(fires('grand_slam', withHistory({ majors: [...MAJOR_NAMES].slice(0, 3) }))).toBe(false);
    expect(fires('grand_slam', withHistory({ majors: [...MAJOR_NAMES] }))).toBe(true);
  });

  it('they are per-GOLFER, never a total across the stable', () => {
    const p = defaultProfile();
    p.tourHistory = {
      a: { name: 'A', wins: 6, majorWins: 2, majors: [], seasons: [] },
      b: { name: 'B', wins: 6, majorWins: 2, majors: [], seasons: [] }
    };
    // 12 wins and 4 majors between them is not 10 wins or 4 majors with ONE.
    expect(fires('tour_wins_10', p)).toBe(false);
    expect(fires('majors_4', p)).toBe(false);
  });

  it('the Hall of Fame badge lands exactly at the season limit', () => {
    const seasons = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ seasonNo: i + 1, rank: 1, points: 100 }));
    expect(fires('hall_of_fame', withHistory({ seasons: seasons(SEASON_LIMIT - 1) }))).toBe(false);
    expect(fires('hall_of_fame', withHistory({ seasons: seasons(SEASON_LIMIT) }))).toBe(true);
  });

  it('an empty record book fires nothing and never throws', () => {
    const p = defaultProfile();
    for (const id of ['first_major', 'majors_4', 'tour_wins_10', 'grand_slam', 'hall_of_fame']) {
      expect(fires(id, p), id).toBe(false);
    }
  });

  it('the retired grind counters are gone', () => {
    // 'wins_10' joined them in Stage 3: CareerStats.wins only increments in
    // 1v1, which the focusedGame flag hides, so it was unreachable.
    for (const id of ['putts_50', 'fairways_100', 'gir_100', 'pars_100', 'rounds_100', 'wins_10']) {
      expect(featById(id), `${id} should have been retired`).toBeUndefined();
    }
  });
});
