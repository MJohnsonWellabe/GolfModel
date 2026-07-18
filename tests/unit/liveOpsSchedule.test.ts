import { describe, expect, it } from 'vitest';
import { emptyLiveOpsConfig } from '../../src/data/liveOpsConfig';
import {
  detectRedundantOverrides,
  previewDailySchedule,
  previewWeeklySchedule
} from '../../src/data/liveOpsSchedule';
import { DAILY_CHALLENGES, dailyChallengeFor } from '../../src/data/progression';
import { weeklyEventFor, WEEKLY_ROTATION } from '../../src/systems/WeeklyFeatured';

describe('previewDailySchedule', () => {
  it('serves the deterministic default for unpinned days', () => {
    const days = previewDailySchedule(emptyLiveOpsConfig(), '2026-07-18', 14);
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe('2026-07-18');
    expect(days[13].date).toBe('2026-07-31');
    for (const d of days) {
      expect(d.source).toBe('default');
      expect(d.challengeId).toBe(dailyChallengeFor(d.date).id);
      expect(d.redundant).toBe(false);
    }
  });

  it('marks overrides and steps month boundaries correctly', () => {
    const cfg = emptyLiveOpsConfig();
    // Pin a challenge that is NOT the deterministic default for the date.
    const def = dailyChallengeFor('2026-07-31');
    const other = DAILY_CHALLENGES.find((c) => c.id !== def.id)!;
    cfg.dailyOverrides['2026-07-31'] = other.id;
    const days = previewDailySchedule(cfg, '2026-07-30', 3);
    expect(days.map((d) => d.date)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(days[1].source).toBe('override');
    expect(days[1].challengeId).toBe(other.id);
    expect(days[1].redundant).toBe(false);
  });

  it('flags a redundant override (pins the default)', () => {
    const cfg = emptyLiveOpsConfig();
    cfg.dailyOverrides['2026-07-20'] = dailyChallengeFor('2026-07-20').id;
    const days = previewDailySchedule(cfg, '2026-07-20', 1);
    expect(days[0].source).toBe('override');
    expect(days[0].redundant).toBe(true);
  });
});

describe('previewWeeklySchedule', () => {
  it('lists consecutive distinct weeks with rotation defaults', () => {
    const weeks = previewWeeklySchedule(emptyLiveOpsConfig(), new Date('2026-07-18T12:00:00Z'), 6);
    expect(weeks).toHaveLength(6);
    const ids = weeks.map((w) => w.weekId);
    expect(new Set(ids).size).toBe(6);
    expect(ids[0]).toBe(weeklyEventFor(new Date('2026-07-18T12:00:00Z')).id);
    for (const w of weeks) {
      expect(w.source).toBe('default');
      expect(WEEKLY_ROTATION).toContain(w.courseId);
    }
  });

  it('applies weekly overrides and marks redundancy', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const ev = weeklyEventFor(now);
    const cfg = emptyLiveOpsConfig();
    const other = WEEKLY_ROTATION.find((c) => c !== ev.courseId)!;
    cfg.weeklyOverrides[ev.id] = other;
    let weeks = previewWeeklySchedule(cfg, now, 2);
    expect(weeks[0].source).toBe('override');
    expect(weeks[0].courseId).toBe(other);
    expect(weeks[0].redundant).toBe(false);

    cfg.weeklyOverrides[ev.id] = ev.courseId; // now a no-op pin
    weeks = previewWeeklySchedule(cfg, now, 2);
    expect(weeks[0].redundant).toBe(true);
  });
});

describe('detectRedundantOverrides', () => {
  it('returns notices only for no-op pins', () => {
    const cfg = emptyLiveOpsConfig();
    expect(detectRedundantOverrides(cfg)).toEqual([]);
    cfg.dailyOverrides['2026-07-20'] = dailyChallengeFor('2026-07-20').id;
    const notices = detectRedundantOverrides(cfg);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('2026-07-20');
  });
});
