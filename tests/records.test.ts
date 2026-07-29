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

/**
 * THE PAR-OR-BETTER RUN HAS TO BE ABLE TO FALL.
 *
 * It is the one field in PersonalRecords that is not a record — it is a live
 * counter — and it was merged with the same grow-only `Math.max` as everything
 * around it. That made it monotonic by construction: a device reset it, the
 * next cloud sync handed the old number straight back and re-uploaded it, and
 * a 224-round run survived a round over par forever (owner: "I shot over a
 * while ago and still have a 224 round streak").
 */
describe('the par-or-better run', () => {
  it('an over-par round ends it AT ANY DIFFICULTY', () => {
    // Beginner and Amateur are the defaults and the tutorial's setting, and
    // they are `ranked: false` — under the old rule they could not end a run
    // no matter how the player scored.
    for (const ranked of [true, false]) {
      const rec = emptyRecords();
      rec.parOrBetterRun = 224;
      rec.bestParOrBetterRun = 224;
      round(rec, 15, {}, { ranked }); // +3
      expect(rec.parOrBetterRun, `ranked=${ranked}`).toBe(0);
      // The BEST run is a record and survives, as it always did.
      expect(rec.bestParOrBetterRun).toBe(224);
    }
  });

  it('but only a RANKED round can extend it', () => {
    const rec = emptyRecords();
    round(rec, 12, {}, { ranked: false }); // level par at Beginner
    expect(rec.parOrBetterRun, 'a relaxed round cannot buy a longer run').toBe(0);
    round(rec, 12, {}, { ranked: true });
    expect(rec.parOrBetterRun).toBe(1);
  });

  it('a reset survives a cloud merge instead of being resurrected', () => {
    // The device that played the over-par round.
    const local = emptyRecords();
    local.parOrBetterRun = 224;
    local.bestParOrBetterRun = 224;
    local.totalRounds = 400;
    round(local, 15); // +3 → run resets, and stamps its ordinal
    expect(local.parOrBetterRun).toBe(0);

    // What the cloud still holds: the pre-reset snapshot, stamped EARLIER.
    const cloud = migrateRecords({ ...local, parOrBetterRun: 224, parOrBetterRunAt: 300 });

    for (const merged of [mergeRecords(local, cloud), mergeRecords(cloud, local)]) {
      expect(merged.parOrBetterRun, 'the newer write wins, in both directions').toBe(0);
      expect(merged.bestParOrBetterRun, 'the record itself is never lost').toBe(224);
    }
  });

  it('still takes the larger when neither side can be ordered', () => {
    // Two devices with the same ordinal genuinely cannot be interleaved; the
    // old behaviour is the safer guess there, and it errs toward keeping a run.
    const a = migrateRecords({ parOrBetterRun: 5, parOrBetterRunAt: 10 });
    const b = migrateRecords({ parOrBetterRun: 9, parOrBetterRunAt: 10 });
    expect(mergeRecords(a, b).parOrBetterRun).toBe(9);
  });

  it('a profile stored before the ordinal existed still merges', () => {
    const old = migrateRecords({ parOrBetterRun: 17, bestParOrBetterRun: 17 });
    expect(old.parOrBetterRunAt).toBe(0);
    const fresh = migrateRecords({ parOrBetterRun: 0, parOrBetterRunAt: 5 });
    expect(mergeRecords(old, fresh).parOrBetterRun, 'the stamped side is newer').toBe(0);
  });
});
