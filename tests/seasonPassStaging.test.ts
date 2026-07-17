import { describe, expect, it } from 'vitest';
import { SEASON_1 } from '../src/data/seasonPass';
import {
  SeasonPassDraft,
  defaultDraft,
  duplicateFromSeason,
  resizeLevels,
  moveLevel,
  normalizeDraft,
  validateSeasonPassDraft,
  rewardKind,
  makeReward,
  rewardRawValue,
  rewardLabel
} from '../src/admin/seasonPassStaging';

/** Deep-clone helper so a mutation in one test can't bleed into another. */
const c = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

describe('defaultDraft', () => {
  it('is internally consistent and passes validation', () => {
    const d = defaultDraft();
    expect(d.xpPerLevel.length).toBe(d.levels);
    expect(d.rewards.length).toBe(d.levels);
    expect(d.name.length).toBeGreaterThan(0);
    expect(d.artwork.length).toBeGreaterThan(0);
    expect(validateSeasonPassDraft(d)).toEqual([]);
  });
});

describe('duplicateFromSeason', () => {
  it('copies the SEASON_1 level track but with a distinct id', () => {
    const d = duplicateFromSeason(SEASON_1);
    expect(d.levels).toBe(50);
    expect(d.levels).toBe(SEASON_1.levels);
    expect(d.id).not.toBe(SEASON_1.id);
    expect(d.id).toBe('s1_next');
    expect(d.xpPerLevel).toEqual(SEASON_1.xpPerLevel);
    expect(d.rewards).toEqual(SEASON_1.rewards);
  });

  it('deep-copies rewards (no shared references with the live season)', () => {
    const d = duplicateFromSeason(SEASON_1);
    (d.rewards[0] as { xp: number }).xp = 99999;
    expect(d.rewards[0]).not.toEqual(SEASON_1.rewards[0]);
  });

  it('produces a draft that validates', () => {
    expect(validateSeasonPassDraft(duplicateFromSeason(SEASON_1))).toEqual([]);
  });
});

describe('resizeLevels', () => {
  it('grows by appending defaults, keeping arrays in sync with levels', () => {
    const grown = resizeLevels(defaultDraft(), 15);
    expect(grown.levels).toBe(15);
    expect(grown.xpPerLevel.length).toBe(15);
    expect(grown.rewards.length).toBe(15);
    // Existing entries are preserved; new ones are sensible defaults.
    expect(grown.xpPerLevel[14]).toBeGreaterThan(0);
    expect(rewardKind(grown.rewards[14])).toBe('coins');
  });

  it('shrinks by truncation, keeping arrays in sync with levels', () => {
    const shrunk = resizeLevels(duplicateFromSeason(SEASON_1), 3);
    expect(shrunk.levels).toBe(3);
    expect(shrunk.xpPerLevel.length).toBe(3);
    expect(shrunk.rewards.length).toBe(3);
    expect(shrunk.xpPerLevel).toEqual(SEASON_1.xpPerLevel.slice(0, 3));
    expect(shrunk.rewards).toEqual(SEASON_1.rewards.slice(0, 3));
  });

  it('clamps out-of-range level counts to 1..100', () => {
    expect(resizeLevels(defaultDraft(), 0).levels).toBe(1);
    expect(resizeLevels(defaultDraft(), 9999).levels).toBe(100);
  });
});

describe('moveLevel', () => {
  it('swaps the xp threshold and reward of adjacent levels together', () => {
    const d = duplicateFromSeason(SEASON_1);
    const xp0 = d.xpPerLevel[0];
    const xp1 = d.xpPerLevel[1];
    const r0 = c(d.rewards[0]);
    const r1 = c(d.rewards[1]);
    const moved = moveLevel(d, 0, 1);
    expect(moved.xpPerLevel[0]).toBe(xp1);
    expect(moved.xpPerLevel[1]).toBe(xp0);
    expect(moved.rewards[0]).toEqual(r1);
    expect(moved.rewards[1]).toEqual(r0);
  });

  it('is a no-op at the boundaries', () => {
    const d = defaultDraft();
    expect(moveLevel(d, 0, -1)).toEqual(d);
    expect(moveLevel(d, d.levels - 1, 1)).toEqual(d);
  });
});

describe('reward helpers', () => {
  it('round-trips kind + raw value', () => {
    expect(rewardKind({ item: 's1_ball_ice' })).toBe('item');
    expect(rewardKind({ perk: 'perk_x' })).toBe('perk');
    expect(rewardKind({ coins: 50 })).toBe('coins');
    expect(rewardKind({ xp: 100 })).toBe('xp');
    expect(rewardKind({ trueVision: 3 })).toBe('trueVision');
    expect(rewardRawValue({ coins: 50 })).toBe('50');
    expect(makeReward('coins', '75')).toEqual({ coins: 75 });
    expect(makeReward('item', 'abc')).toEqual({ item: 'abc' });
  });

  it('labels each reward variant', () => {
    expect(rewardLabel({ coins: 50 })).toContain('50');
    expect(rewardLabel({ trueVision: 3 })).toContain('True Vision');
    expect(rewardLabel({ item: 'abc' })).toContain('abc');
  });
});

describe('normalizeDraft', () => {
  it('syncs arrays to levels and coerces xp to numbers', () => {
    const d = defaultDraft();
    d.levels = 12; // arrays intentionally out of sync
    (d.xpPerLevel as unknown as string[])[0] = '1500' as unknown as string;
    const n = normalizeDraft(d);
    expect(n.xpPerLevel.length).toBe(12);
    expect(n.rewards.length).toBe(12);
    expect(n.xpPerLevel[0]).toBe(1500);
    expect(typeof n.xpPerLevel[0]).toBe('number');
  });

  it('trims string fields', () => {
    const d = defaultDraft();
    d.name = '  Winter  ';
    expect(normalizeDraft(d).name).toBe('Winter');
  });
});

describe('validateSeasonPassDraft', () => {
  const valid = (): SeasonPassDraft => defaultDraft();

  it('accepts a valid draft', () => {
    expect(validateSeasonPassDraft(valid())).toEqual([]);
  });

  it('flags an empty name', () => {
    const d = valid();
    d.name = '   ';
    expect(validateSeasonPassDraft(d).some((e) => /name/i.test(e))).toBe(true);
  });

  it('flags a level count below 1 or above 100', () => {
    const lo = resizeLevels(valid(), 5);
    lo.levels = 0;
    expect(validateSeasonPassDraft(lo).some((e) => /level count/i.test(e))).toBe(true);
    const hi = valid();
    hi.levels = 101;
    expect(validateSeasonPassDraft(hi).some((e) => /level count/i.test(e))).toBe(true);
  });

  it('flags xpPerLevel length mismatch', () => {
    const d = valid();
    d.xpPerLevel = d.xpPerLevel.slice(0, d.levels - 1);
    expect(validateSeasonPassDraft(d).some((e) => /XP thresholds/i.test(e))).toBe(true);
  });

  it('flags rewards length mismatch', () => {
    const d = valid();
    d.rewards = d.rewards.slice(0, d.levels - 1);
    expect(validateSeasonPassDraft(d).some((e) => /Rewards/i.test(e))).toBe(true);
  });

  it('flags a non-positive xp threshold', () => {
    const d = valid();
    d.xpPerLevel[2] = 0;
    expect(validateSeasonPassDraft(d).some((e) => /positive number/i.test(e))).toBe(true);
  });

  it('flags start after end', () => {
    const d = valid();
    d.start = '2027-05-01';
    d.end = '2027-01-01';
    expect(validateSeasonPassDraft(d).some((e) => /on or before/i.test(e))).toBe(true);
  });

  it('flags an unparseable salesOpenAt', () => {
    const d = valid();
    d.salesOpenAt = 'not-a-date';
    expect(validateSeasonPassDraft(d).some((e) => /Sales-open/i.test(e))).toBe(true);
  });

  it('flags a non-positive numeric reward amount', () => {
    const d = valid();
    d.rewards[0] = { coins: 0 };
    expect(validateSeasonPassDraft(d).some((e) => /coins amount/i.test(e))).toBe(true);
  });

  it('flags an empty item/perk reward id', () => {
    const d = valid();
    d.rewards[0] = { item: '' };
    expect(validateSeasonPassDraft(d).some((e) => /item id/i.test(e))).toBe(true);
  });

  it('flags empty artwork', () => {
    const d = valid();
    d.artwork = '';
    expect(validateSeasonPassDraft(d).some((e) => /Artwork/i.test(e))).toBe(true);
  });
});
