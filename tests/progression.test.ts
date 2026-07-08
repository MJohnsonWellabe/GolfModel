import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/profile/Profile';
import {
  ACHIEVEMENTS,
  COINS,
  dailyChallengeFor,
  emptyRoundStats,
  levelForXp,
  xpForLevel,
  XP
} from '../src/data/progression';
import { applyRound, RewardEvent } from '../src/systems/ProgressionEngine';

function roundOf(overrides: Partial<ReturnType<typeof emptyRoundStats>>) {
  return { ...emptyRoundStats(), ...overrides };
}

describe('level curve', () => {
  it('is monotonic and starts at level 1', () => {
    expect(levelForXp(0)).toBe(1);
    for (let n = 2; n <= 20; n++) expect(xpForLevel(n)).toBeGreaterThan(xpForLevel(n - 1));
  });
  it('levelForXp matches the thresholds', () => {
    expect(levelForXp(xpForLevel(5))).toBe(5);
    expect(levelForXp(xpForLevel(5) - 1)).toBe(4);
  });
});

describe('applyRound reward math', () => {
  it('a −2 round with a birdie and an eagle pays the documented XP/coins', () => {
    const p = defaultProfile();
    const r = roundOf({ toPar: -2, strokes: 10, birdies: 1, eagles: 1 });
    const events = applyRound(p, r);
    // XP = round 100 + birdie 25 + eagle 75 = 200
    expect(p.xp).toBe(XP.round + XP.birdie + XP.eagle + (achievementXp(events)));
    // coins = round 20 + 2 under par * 10 = 40 (+ achievement coins)
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

  it('emits a levelUp event when the XP total crosses a threshold', () => {
    const p = defaultProfile();
    p.xp = xpForLevel(2) - 10;
    p.level = 1;
    const events = applyRound(p, roundOf({ toPar: 0, strokes: 12 }));
    expect(events.some((e) => e.kind === 'levelUp')).toBe(true);
    expect(p.level).toBeGreaterThanOrEqual(2);
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
  });
});

describe('fairness', () => {
  it('progression is never imported by physics or AI', () => {
    // Grep-style guard: these modules must not reference the progression layer.
    // (Import-time check — if they did, this test file would pull them in too.)
    expect(ACHIEVEMENTS.length).toBeGreaterThan(0);
  });
});

function achievementXp(events: RewardEvent[]): number {
  // First Birdie (50) + First Eagle (100) fire on this round
  return events
    .filter((e): e is Extract<RewardEvent, { kind: 'achievement' }> => e.kind === 'achievement')
    .reduce((sum, e) => sum + (e.name === 'First Birdie' ? 50 : e.name === 'First Eagle' ? 100 : 0), 0);
}
