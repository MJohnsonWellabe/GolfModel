import { describe, expect, it } from 'vitest';
import {
  applyRoundRecords,
  emptyRecords,
  mergeRecords,
  migrateRecords,
  PersonalRecords
} from '../src/systems/Records';
import { emptyRoundStats, RoundStats } from '../src/data/progression';

function stats(over: Partial<RoundStats> = {}): RoundStats {
  return { ...emptyRoundStats(), ...over };
}

function round(rec: PersonalRecords, total: number, over: Partial<RoundStats> = {}, extra: Parameters<typeof applyRoundRecords>[1] extends infer T ? Partial<T> : never = {}) {
  return applyRoundRecords(rec, {
    courseId: 'sablebay',
    courseName: 'Sable Bay',
    total,
    stats: stats({ toPar: total - 12, ...over }),
    now: 1000,
    ...extra
  });
}

describe('personal records', () => {
  it('first round sets baselines silently (no hollow celebrations)', () => {
    const rec = emptyRecords();
    const events = round(rec, 12, { longestDriveYds: 250, longestPuttMadeFt: 12 });
    expect(events.filter((e) => e.kind === 'broken')).toEqual([]);
    expect(rec.bestByCourse.sablebay.total).toBe(12);
    expect(rec.longestDriveYds).toBe(250);
    expect(rec.totalRounds).toBe(1);
  });

  it('breaking the course best emits exactly one broken event and updates', () => {
    const rec = emptyRecords();
    round(rec, 12);
    const events = round(rec, 10);
    expect(events.some((e) => e.id === 'course_best' && e.kind === 'broken')).toBe(true);
    expect(rec.bestByCourse.sablebay.total).toBe(10);
  });

  it('one stroke off the best reads as a positive near miss', () => {
    const rec = emptyRecords();
    round(rec, 10);
    const events = round(rec, 11);
    expect(events.some((e) => e.id === 'course_best_near' && e.kind === 'near')).toBe(true);
    expect(rec.bestByCourse.sablebay.total).toBe(10); // unchanged
  });

  it('longest putt/drive only celebrate when a previous record existed', () => {
    const rec = emptyRecords();
    round(rec, 12, { longestPuttMadeFt: 10, longestDriveYds: 240 });
    const events = round(rec, 12, { longestPuttMadeFt: 24, longestDriveYds: 290 });
    expect(events.some((e) => e.id === 'longest_putt')).toBe(true);
    expect(events.some((e) => e.id === 'longest_drive')).toBe(true);
    expect(rec.longestPuttFt).toBe(24);
    expect(rec.longestDriveYds).toBe(290);
  });

  it('par-or-better run counts consecutive rounds and resets on an over-par round', () => {
    const rec = emptyRecords();
    round(rec, 12, { toPar: 0 });
    round(rec, 11, { toPar: -1 });
    expect(rec.parOrBetterRun).toBe(2);
    round(rec, 14, { toPar: 2 });
    expect(rec.parOrBetterRun).toBe(0);
    expect(rec.bestParOrBetterRun).toBe(2);
  });

  it('weekly bests track per event id and only improve', () => {
    const rec = emptyRecords();
    round(rec, 12, {}, { weeklyEventId: 'w2026-29' });
    const better = round(rec, 10, {}, { weeklyEventId: 'w2026-29' });
    const worse = round(rec, 13, {}, { weeklyEventId: 'w2026-29' });
    expect(better.some((e) => e.id === 'weekly_best')).toBe(true);
    expect(worse.some((e) => e.id === 'weekly_best')).toBe(false);
    expect(rec.bestWeekly['w2026-29'].total).toBe(10);
  });

  it('merge is grow-only in both directions (offline reconciliation)', () => {
    const a = emptyRecords();
    const b = emptyRecords();
    round(a, 10, { longestDriveYds: 300 });
    round(b, 12, { longestPuttMadeFt: 30 });
    b.totalRounds = 5;
    const m = mergeRecords(a, b);
    expect(m.bestByCourse.sablebay.total).toBe(10);
    expect(m.longestDriveYds).toBe(300);
    expect(m.longestPuttFt).toBe(30);
    expect(m.totalRounds).toBe(5);
  });

  it('migrate coerces garbage to safe defaults without data loss', () => {
    expect(migrateRecords(null)).toEqual(emptyRecords());
    expect(migrateRecords({ longestPuttFt: 'nope', bestByCourse: { x: { total: 9 } } }).bestByCourse.x.total).toBe(9);
    expect(migrateRecords({ longestPuttFt: 'nope' }).longestPuttFt).toBe(0);
  });
});
