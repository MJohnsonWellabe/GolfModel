import { describe, expect, it } from 'vitest';
import {
  advanceStreak,
  claimStreakReward,
  cycleDay,
  emptyStreak,
  mergeStreak,
  migrateStreak,
  streakRewardFor,
  StreakState
} from '../src/systems/Streak';

function run(days: string[]): StreakState {
  let s = emptyStreak();
  for (const d of days) s = advanceStreak(s, d).state;
  return s;
}

describe('seven-day streak', () => {
  it('advances by one per consecutive day and is idempotent within a day', () => {
    let s = emptyStreak();
    s = advanceStreak(s, '2026-07-01').state;
    s = advanceStreak(s, '2026-07-01').state; // same day again
    s = advanceStreak(s, '2026-07-02').state;
    expect(s.current).toBe(2);
    expect(s.best).toBe(2);
  });

  it('missing exactly one day consumes the protection token and continues', () => {
    let s = run(['2026-07-01', '2026-07-02', '2026-07-03']);
    const r = advanceStreak(s, '2026-07-05'); // skipped the 4th
    expect(r.usedProtection).toBe(true);
    expect(r.state.current).toBe(4);
    expect(r.state.protectionAvailable).toBe(false);
    expect(r.state.protectionUsedOn).toBe('2026-07-04');
  });

  it('a second one-day miss in the same cycle resets (token already spent)', () => {
    let s = run(['2026-07-01', '2026-07-02']);
    s = advanceStreak(s, '2026-07-04').state; // protection used
    const r = advanceStreak(s, '2026-07-06'); // another miss, no token
    expect(r.restarted).toBe(true);
    expect(r.state.current).toBe(1);
  });

  it('a 2+ day gap resets to 1 but best is never lost', () => {
    let s = run(['2026-07-01', '2026-07-02', '2026-07-03']);
    const r = advanceStreak(s, '2026-07-10');
    expect(r.state.current).toBe(1);
    expect(r.state.best).toBe(3);
  });

  it('entering a new 7-day cycle re-arms the protection token', () => {
    // Days 1-2, miss day 3 (protection), days 4-7, then day 8 = new cycle day 1.
    let s = run(['2026-07-01', '2026-07-02']);
    s = advanceStreak(s, '2026-07-04').state; // used protection → current 3
    s = run2(s, ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08']); // current 7
    expect(s.current).toBe(7);
    expect(s.protectionAvailable).toBe(false);
    s = advanceStreak(s, '2026-07-09').state; // current 8 → cycle day 1
    expect(cycleDay(s.current)).toBe(1);
    expect(s.protectionAvailable).toBe(true);
  });

  it('cycleDay maps 1..7 then repeats', () => {
    expect(cycleDay(1)).toBe(1);
    expect(cycleDay(7)).toBe(7);
    expect(cycleDay(8)).toBe(1);
    expect(cycleDay(21)).toBe(7);
    expect(cycleDay(0)).toBe(0);
  });
});

function run2(s: StreakState, days: string[]): StreakState {
  for (const d of days) s = advanceStreak(s, d).state;
  return s;
}

describe('streak rewards', () => {
  it('uses only existing currencies and marks day 7 as the milestone', () => {
    for (let d = 1; d <= 7; d++) {
      const r = streakRewardFor(d);
      expect(r.coins + r.xp).toBeGreaterThan(0);
      expect(r.milestone).toBe(d === 7);
    }
  });

  it('claim pays exactly once per day (refresh/dup safe)', () => {
    let s = run(['2026-07-01']);
    const first = claimStreakReward(s, '2026-07-01');
    expect(first.reward).not.toBeNull();
    const second = claimStreakReward(first.state, '2026-07-01');
    expect(second.reward).toBeNull();
  });

  it('claim only pays for the streak\'s current day (no back-dating)', () => {
    const s = run(['2026-07-01', '2026-07-02']);
    expect(claimStreakReward(s, '2026-07-01').reward).toBeNull();
    expect(claimStreakReward(s, '2026-07-02').reward).not.toBeNull();
  });

  it('cross-device merge unions claims so a day can never pay twice', () => {
    let a = run(['2026-07-01']);
    a = claimStreakReward(a, '2026-07-01').state;
    const b = run(['2026-07-01']); // other device, not yet claimed
    const merged = mergeStreak(a, b);
    expect(claimStreakReward(merged, '2026-07-01').reward).toBeNull();
  });

  it('migrate coerces garbage safely', () => {
    expect(migrateStreak(null)).toEqual(emptyStreak());
    expect(migrateStreak({ current: -3, claimedDays: 'x' }).current).toBe(0);
    expect(migrateStreak({ current: 4.7 }).current).toBe(4);
  });
});
