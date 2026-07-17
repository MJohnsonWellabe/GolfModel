import { describe, expect, it } from 'vitest';
import {
  dailyOverrideFor,
  emptyLiveOpsConfig,
  migrateLiveOpsConfig,
  validateLiveOpsConfig,
  weeklyOverrideFor
} from '../src/data/liveOpsConfig';
import { DAILY_CHALLENGES } from '../src/data/progression';

describe('live-ops config', () => {
  it('migrates garbage to a safe empty config', () => {
    expect(migrateLiveOpsConfig(null)).toEqual(emptyLiveOpsConfig());
    const m = migrateLiveOpsConfig({
      version: 3,
      dailyOverrides: { '2026-07-20': 'birdie', 'not-a-date': 'birdie', '2026-07-21': 42 },
      weeklyOverrides: { 'w2026-30': 'sablebay', bogus: 'sablebay' }
    });
    expect(m.version).toBe(3);
    expect(Object.keys(m.dailyOverrides)).toEqual(['2026-07-20']);
    expect(Object.keys(m.weeklyOverrides)).toEqual(['w2026-30']);
  });

  it('validation blocks unknown challenge/course ids and bad keys', () => {
    const cfg = emptyLiveOpsConfig();
    cfg.dailyOverrides['2026-07-20'] = 'not-a-challenge';
    cfg.weeklyOverrides['w2026-30'] = 'not-a-course';
    const errs = validateLiveOpsConfig(cfg);
    expect(errs.some((e) => e.includes('unknown challenge id'))).toBe(true);
    expect(errs.some((e) => e.includes('unknown course id'))).toBe(true);
  });

  it('valid overrides pass validation and resolve', () => {
    const cfg = emptyLiveOpsConfig();
    cfg.dailyOverrides['2026-07-20'] = DAILY_CHALLENGES[0].id;
    cfg.weeklyOverrides['w2026-30'] = 'timberline';
    expect(validateLiveOpsConfig(cfg)).toEqual([]);
    expect(dailyOverrideFor(cfg, '2026-07-20')).toBe(DAILY_CHALLENGES[0].id);
    expect(dailyOverrideFor(cfg, '2026-07-21')).toBeNull();
    expect(weeklyOverrideFor(cfg, 'w2026-30')).toBe('timberline');
    expect(weeklyOverrideFor(cfg, 'w2026-31')).toBeNull();
    expect(dailyOverrideFor(null, '2026-07-20')).toBeNull();
  });
});
