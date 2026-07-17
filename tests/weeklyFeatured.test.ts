import { describe, expect, it } from 'vitest';
import {
  isPlausibleWeeklyEntry,
  isoWeekOf,
  weeklyEventFor,
  weeklyStanding,
  weeklyTimeLeft,
  WeeklyEntry,
  WEEKLY_ROTATION
} from '../src/systems/WeeklyFeatured';

function entry(over: Partial<WeeklyEntry>): WeeklyEntry {
  return {
    playerId: 'p1',
    name: 'A',
    golferId: 'chip-bigHitter',
    total: 12,
    toPar: 0,
    holes: [4, 3, 5],
    submittedAt: 1,
    ...over
  };
}

describe('weekly featured event', () => {
  it('is deterministic: same date → same event, id, course and seed', () => {
    const a = weeklyEventFor(new Date(2026, 6, 15)); // Wed 2026-07-15
    const b = weeklyEventFor(new Date(2026, 6, 15));
    expect(a).toEqual(b);
    expect(a.id).toMatch(/^w2026-\d{2}$/);
    expect(WEEKLY_ROTATION).toContain(a.courseId as (typeof WEEKLY_ROTATION)[number]);
  });

  it('every day of one week maps to the same event', () => {
    const mon = weeklyEventFor(new Date(2026, 6, 13));
    const sun = weeklyEventFor(new Date(2026, 6, 19));
    expect(mon.id).toBe(sun.id);
    expect(mon.seed).toBe(sun.seed);
  });

  it('consecutive weeks rotate to the next course and change the seed', () => {
    const w1 = weeklyEventFor(new Date(2026, 6, 15));
    const w2 = weeklyEventFor(new Date(2026, 6, 22));
    expect(w2.id).not.toBe(w1.id);
    expect(w2.seed).not.toBe(w1.seed);
    const i1 = WEEKLY_ROTATION.indexOf(w1.courseId as (typeof WEEKLY_ROTATION)[number]);
    const i2 = WEEKLY_ROTATION.indexOf(w2.courseId as (typeof WEEKLY_ROTATION)[number]);
    expect(i2).toBe((i1 + 1) % WEEKLY_ROTATION.length);
  });

  it('the window covers Monday to next Monday and time-left formats compactly', () => {
    const ev = weeklyEventFor(new Date(2026, 6, 15));
    expect(ev.endMs - ev.startMs).toBe(7 * 86400000);
    expect(weeklyTimeLeft(ev, ev.endMs - 86400000 - 3600000)).toBe('1d 1h');
    expect(weeklyTimeLeft(ev, ev.endMs + 999)).toBe('0m');
  });

  it('isoWeekOf handles the year boundary correctly', () => {
    // 2027-01-01 is a Friday → ISO week 53 of 2026.
    expect(isoWeekOf(new Date(2026, 11, 31))).toEqual({ isoYear: 2026, isoWeek: 53 });
    expect(isoWeekOf(new Date(2027, 0, 4))).toEqual({ isoYear: 2027, isoWeek: 1 });
  });
});

describe('weekly leaderboard helpers', () => {
  it('rejects implausible entries (mismatched totals, absurd holes)', () => {
    expect(isPlausibleWeeklyEntry(entry({}))).toBe(true);
    expect(isPlausibleWeeklyEntry(entry({ total: 11 }))).toBe(false);
    expect(isPlausibleWeeklyEntry(entry({ holes: [4, 3] }))).toBe(false);
    expect(isPlausibleWeeklyEntry(entry({ holes: [40, 3, 5], total: 48 }))).toBe(false);
  });

  it('ranks by total, shares ties, and reports percentile', () => {
    const entries = [
      entry({ playerId: 'a', total: 10, holes: [3, 3, 4] }),
      entry({ playerId: 'b', total: 12, holes: [4, 3, 5] }),
      entry({ playerId: 'c', total: 12, holes: [4, 4, 4] }),
      entry({ playerId: 'd', total: 15, holes: [5, 5, 5] })
    ];
    expect(weeklyStanding(entries, 'a')).toEqual({ rank: 1, of: 4, percentile: 100 });
    expect(weeklyStanding(entries, 'b')!.rank).toBe(2);
    expect(weeklyStanding(entries, 'c')!.rank).toBe(2);
    expect(weeklyStanding(entries, 'x')).toBeNull();
  });
});
