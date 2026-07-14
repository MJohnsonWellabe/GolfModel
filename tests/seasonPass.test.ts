import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/profile/Profile';
import { SEASON_1 } from '../src/data/seasonPass';
import { STORE_BY_ID } from '../src/data/storeCatalog';
import {
  addSeasonXp,
  claimReward,
  claimState,
  seasonActive,
  seasonLevel
} from '../src/systems/SeasonPassEngine';

const DURING = new Date('2026-09-01T12:00:00').getTime();
const BEFORE = new Date('2026-07-01T12:00:00').getTime();
const AFTER = new Date('2026-12-05T12:00:00').getTime();

describe('season definition', () => {
  it('has exactly 50 rewards (10 pages of 5), one per level', () => {
    expect(SEASON_1.levels).toBe(50);
    expect(SEASON_1.rewards.length).toBe(50);
  });

  it('every item reward exists in the store catalog', () => {
    for (const r of SEASON_1.rewards) {
      if ('item' in r) expect(STORE_BY_ID.has(r.item), r.item).toBe(true);
    }
  });

  it('level 50 grants the exclusive pal; characters appear sparingly', () => {
    const last = SEASON_1.rewards[49];
    expect(last).toEqual({ item: 's1_pal_geckoorange' });
    const chars = SEASON_1.rewards.filter((r) => 'item' in r && r.item.startsWith('char_'));
    expect(chars.length).toBe(4);
    // The pal appears ONLY at level 50
    const pals = SEASON_1.rewards.filter((r) => 'item' in r && r.item.includes('pal'));
    expect(pals.length).toBe(1);
  });

  it('paces to ~1000 rounds at ~120 XP per round', () => {
    const total = SEASON_1.xpPerLevel * SEASON_1.levels;
    expect(total / 120).toBeGreaterThan(900);
    expect(total / 120).toBeLessThan(1100);
  });
});

describe('season window + leveling', () => {
  it('is active between start and end, inclusive', () => {
    expect(seasonActive(SEASON_1, DURING)).toBe(true);
    expect(seasonActive(SEASON_1, BEFORE)).toBe(false);
    expect(seasonActive(SEASON_1, AFTER)).toBe(false);
    // The end date itself still counts
    expect(seasonActive(SEASON_1, new Date('2026-11-30T23:00:00').getTime())).toBe(true);
  });

  it('levels at flat xpPerLevel boundaries and caps at 50', () => {
    expect(seasonLevel(SEASON_1, 0)).toBe(0);
    expect(seasonLevel(SEASON_1, 2399)).toBe(0);
    expect(seasonLevel(SEASON_1, 2400)).toBe(1);
    expect(seasonLevel(SEASON_1, 120000)).toBe(50);
    expect(seasonLevel(SEASON_1, 999999)).toBe(50);
  });

  it('accrues XP only while the season runs', () => {
    const p = defaultProfile();
    addSeasonXp(p, SEASON_1, 120, DURING);
    expect(p.season.xp).toBe(120);
    addSeasonXp(p, SEASON_1, 120, AFTER);
    expect(p.season.xp).toBe(120);
    addSeasonXp(p, SEASON_1, -50, DURING); // never negative
    expect(p.season.xp).toBe(120);
  });
});

describe('claims', () => {
  it('requires the pass, the level, and only pays once', () => {
    const p = defaultProfile();
    p.season.xp = SEASON_1.xpPerLevel; // level 1 reached
    expect(claimState(p, SEASON_1, 1)).toBe('needsPass');
    expect(claimReward(p, SEASON_1, 1).ok).toBe(false);

    p.season.owned = true;
    expect(claimState(p, SEASON_1, 1)).toBe('claimable');
    expect(claimState(p, SEASON_1, 2)).toBe('locked');
    expect(claimReward(p, SEASON_1, 2).ok).toBe(false);

    expect(claimReward(p, SEASON_1, 1).ok).toBe(true); // level 1 grants XP
    expect(claimState(p, SEASON_1, 1)).toBe('claimed');
    const again = claimReward(p, SEASON_1, 1);
    expect(again.ok).toBe(false);
  });

  it('coin claims add coins and keep the coins === earned − spent invariant', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = SEASON_1.xpPerLevel * 50;
    const coinLevel = SEASON_1.rewards.findIndex((r) => 'coins' in r) + 1;
    const before = p.coins;
    expect(claimReward(p, SEASON_1, coinLevel).ok).toBe(true);
    expect(p.coins).toBeGreaterThan(before);
    expect(p.coins).toBe(p.coinsEarned - p.coinsSpent);
  });

  it('item claims grant ownership; XP claims raise profile XP but not pass XP', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = SEASON_1.xpPerLevel * 50;
    expect(claimReward(p, SEASON_1, 2).ok).toBe(true); // s1_ball_lagoon
    expect(p.cosmetics.owned).toContain('s1_ball_lagoon');
    const passXpBefore = p.season.xp;
    const xpLevel = SEASON_1.rewards.findIndex((r) => 'xp' in r) + 1;
    const profXpBefore = p.xp;
    expect(claimReward(p, SEASON_1, xpLevel).ok).toBe(true);
    expect(p.xp).toBeGreaterThan(profXpBefore);
    expect(p.season.xp).toBe(passXpBefore); // no feedback loop
  });

  it('claims stay open after the season ends (rewards are never revoked)', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = SEASON_1.xpPerLevel * 50;
    expect(claimReward(p, SEASON_1, 50).ok).toBe(true);
    expect(p.cosmetics.owned).toContain('s1_pal_geckoorange');
  });
});

import { perkById } from '../src/data/perks';
import { salesOpen } from '../src/data/seasonPass';

describe('reward mix (owner-specified exact counts)', () => {
  const counts: Record<string, number> = {};
  for (const r of SEASON_1.rewards) {
    let key: string;
    if ('coins' in r) key = 'coins';
    else if ('xp' in r) key = 'xp';
    else if ('perk' in r) key = 'perk';
    else key = STORE_BY_ID.get(r.item)?.kind ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }

  it('has the exact per-category counts', () => {
    expect(counts).toEqual({
      ball: 5,
      trail: 5,
      clubskin: 5,
      outfit: 5,
      character: 4,
      pal: 1,
      perk: 5,
      xp: 10,
      coins: 10
    });
  });

  it('gives away at most 1000 J-Coins total', () => {
    const total = SEASON_1.rewards.reduce((n, r) => n + ('coins' in r ? r.coins : 0), 0);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it('every perk reward id resolves to a real perk', () => {
    for (const r of SEASON_1.rewards) {
      if ('perk' in r) expect(perkById(r.perk), r.perk).toBeTruthy();
    }
  });

  it('the major perk (++ / 5 rounds) is on the last page', () => {
    const majorLevel = SEASON_1.rewards.findIndex((r) => 'perk' in r && perkById(r.perk)?.tier === 2 && perkById(r.perk)?.rounds === 5) + 1;
    expect(majorLevel).toBeGreaterThanOrEqual(46);
  });
});

describe('perk claim grants inventory charges', () => {
  it('claiming a perk level adds its rounds to the profile', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = SEASON_1.xpPerLevel * 50;
    const perkLevel = SEASON_1.rewards.findIndex((r) => 'perk' in r) + 1;
    const reward = SEASON_1.rewards[perkLevel - 1] as { perk: string };
    expect(claimReward(p, SEASON_1, perkLevel).ok).toBe(true);
    const entry = p.perks.find((ps) => ps.id === reward.perk);
    expect(entry).toBeTruthy();
    expect(entry!.granted).toBe(perkById(reward.perk)!.rounds);
  });
});

describe('sales gate', () => {
  it('opens at noon ET on July 16, 2026', () => {
    expect(salesOpen(SEASON_1, new Date('2026-07-16T15:59:00Z').getTime())).toBe(false);
    expect(salesOpen(SEASON_1, new Date('2026-07-16T16:00:00Z').getTime())).toBe(true);
  });
});
