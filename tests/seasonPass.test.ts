import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/profile/Profile';
import { SEASON_1 } from '../src/data/seasonPass';
import { STORE_BY_ID } from '../src/data/storeCatalog';
import {
  addSeasonXp,
  claimReward,
  claimState,
  ownsPass,
  rewardLabel,
  rolloverSeason,
  seasonActive,
  seasonLevel,
  totalSeasonXp
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

  it('the five marquee pals close pages 6-10 (levels 30/35/40/45/50); the pass ends on Thanos; characters appear sparingly', () => {
    const last = SEASON_1.rewards[49];
    expect(last).toEqual({ item: 's1_pal_thanos' });
    const chars = SEASON_1.rewards.filter((r) => 'item' in r && r.item.startsWith('char_'));
    expect(chars.length).toBe(4);
    // Each pal is the LAST card of its page — 30/35/40/45/50 — and nowhere else.
    const palLevels = SEASON_1.rewards
      .map((r, i) => ('item' in r && STORE_BY_ID.get(r.item)?.kind === 'pal' ? i + 1 : null))
      .filter((v): v is number => v != null);
    expect(palLevels).toEqual([30, 35, 40, 45, 50]);
  });

  it('paces to ~500 rounds at ~120 XP per round', () => {
    const total = totalSeasonXp(SEASON_1);
    expect(total / 120).toBeGreaterThan(400);
    expect(total / 120).toBeLessThan(600);
  });

  it('per-level XP cost is progressive: each level costs more than the last, total unchanged from the flat baseline', () => {
    expect(SEASON_1.xpPerLevel).toHaveLength(50);
    for (let i = 1; i < SEASON_1.xpPerLevel.length; i++) {
      expect(SEASON_1.xpPerLevel[i]).toBeGreaterThan(SEASON_1.xpPerLevel[i - 1]);
    }
    // Same total grind as the flat 1200 × 50 design — only the distribution changed.
    expect(totalSeasonXp(SEASON_1)).toBe(1200 * 50);
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

  it('levels at the progressive xpPerLevel boundaries and caps at 50', () => {
    const total = totalSeasonXp(SEASON_1);
    expect(seasonLevel(SEASON_1, 0)).toBe(0);
    expect(seasonLevel(SEASON_1, SEASON_1.xpPerLevel[0] - 1)).toBe(0);
    expect(seasonLevel(SEASON_1, SEASON_1.xpPerLevel[0])).toBe(1);
    expect(seasonLevel(SEASON_1, total)).toBe(50);
    expect(seasonLevel(SEASON_1, total + 999999)).toBe(50);
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
    p.season.xp = SEASON_1.xpPerLevel[0]; // level 1 reached
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
    p.season.xp = totalSeasonXp(SEASON_1);
    const coinLevel = SEASON_1.rewards.findIndex((r) => 'coins' in r) + 1;
    const before = p.coins;
    expect(claimReward(p, SEASON_1, coinLevel).ok).toBe(true);
    expect(p.coins).toBeGreaterThan(before);
    expect(p.coins).toBe(p.coinsEarned - p.coinsSpent);
  });

  it('item claims grant ownership; XP claims raise profile XP but not pass XP', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = totalSeasonXp(SEASON_1);
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
    p.season.xp = totalSeasonXp(SEASON_1);
    expect(claimReward(p, SEASON_1, 50).ok).toBe(true);
    expect(p.cosmetics.owned).toContain('s1_pal_thanos');
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
    else if ('trueVision' in r) key = 'trueVision';
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
      pal: 5,
      perk: 5,
      xp: 6,
      coins: 6,
      trueVision: 4
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

  it('the major perk (++ / 5 rounds) is a late-track reward', () => {
    const majorLevel = SEASON_1.rewards.findIndex((r) => 'perk' in r && perkById(r.perk)?.tier === 2 && perkById(r.perk)?.rounds === 5) + 1;
    expect(majorLevel).toBeGreaterThanOrEqual(40);
    expect(majorLevel).toBeLessThanOrEqual(45);
  });

  it('every True Vision reward grants a pack of 3, never buyable with coins', () => {
    const tvLevels = SEASON_1.rewards
      .map((r, i) => ('trueVision' in r ? i + 1 : null))
      .filter((v): v is number => v != null);
    expect(tvLevels).toEqual([13, 21, 33, 41]);
    for (const level of tvLevels) {
      const r = SEASON_1.rewards[level - 1] as { trueVision: number };
      expect(r.trueVision).toBe(3);
    }
  });
});

describe('True Vision claim grants consumable charges', () => {
  it('claiming a trueVision level adds charges to profile.consumables', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = totalSeasonXp(SEASON_1);
    expect(claimReward(p, SEASON_1, 13).ok).toBe(true);
    const entry = p.consumables.find((c) => c.id === 'true_vision');
    expect(entry).toBeTruthy();
    expect(entry!.granted).toBe(3);
    // A second pack (level 21) stacks onto the same entry.
    expect(claimReward(p, SEASON_1, 21).ok).toBe(true);
    expect(p.consumables.find((c) => c.id === 'true_vision')!.granted).toBe(6);
  });

  it('rewardLabel shows the pack size', () => {
    const { name } = rewardLabel({ trueVision: 3 });
    expect(name).toBe('3× True Vision');
  });
});

describe('perk claim grants inventory charges', () => {
  it('claiming a perk level adds its rounds to the profile', () => {
    const p = defaultProfile();
    p.season.owned = true;
    p.season.xp = totalSeasonXp(SEASON_1);
    const perkLevel = SEASON_1.rewards.findIndex((r) => 'perk' in r) + 1;
    const reward = SEASON_1.rewards[perkLevel - 1] as { perk: string };
    expect(claimReward(p, SEASON_1, perkLevel).ok).toBe(true);
    const entry = p.perks.find((ps) => ps.id === reward.perk);
    expect(entry).toBeTruthy();
    expect(entry!.granted).toBe(perkById(reward.perk)!.rounds);
  });
});

describe('sales gate', () => {
  it('opens at midnight UTC on launch day, 2026-07-14', () => {
    expect(salesOpen(SEASON_1, new Date('2026-07-13T23:59:00Z').getTime())).toBe(false);
    expect(salesOpen(SEASON_1, new Date('2026-07-14T00:00:00Z').getTime())).toBe(true);
  });
});

describe('pass ownership + season rollover (no double-buy)', () => {
  it('ownsPass is true only for the CURRENT season', () => {
    const p = defaultProfile();
    expect(ownsPass(p, SEASON_1)).toBe(false);
    p.season.owned = true; // owns the current (s1) pass
    expect(ownsPass(p, SEASON_1)).toBe(true);
    // A profile still tracking a PRIOR season's ownership does not count as
    // owning the active season's pass (the buy button must reappear).
    p.season.id = 's0';
    expect(ownsPass(p, SEASON_1)).toBe(false);
  });

  it('rollover resets owned/xp/claims when a new season goes live, so the new pass is buyable', () => {
    const p = defaultProfile();
    p.season = { id: 's0', xp: 5000, claimed: [1, 2, 3], owned: true };
    rolloverSeason(p, SEASON_1); // active season is now s1
    expect(p.season.id).toBe(SEASON_1.id);
    expect(p.season.owned).toBe(false); // must buy the new season's pass
    expect(p.season.xp).toBe(0);
    expect(p.season.claimed).toEqual([]);
    expect(ownsPass(p, SEASON_1)).toBe(false);
  });

  it('rollover is a no-op while the season id already matches (keeps ownership/progress)', () => {
    const p = defaultProfile();
    p.season = { id: SEASON_1.id, xp: 1234, claimed: [1], owned: true };
    rolloverSeason(p, SEASON_1);
    expect(p.season.owned).toBe(true);
    expect(p.season.xp).toBe(1234);
    expect(p.season.claimed).toEqual([1]);
  });
});
