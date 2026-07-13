/**
 * Season Pass config — Season 1. Config only; the pure `SeasonPassEngine`
 * consumes this. Pass XP mirrors the round XP the player already earns
 * (ProgressionEngine's 'xp' event), so ~120 XP/round × 2400 XP/level × 50
 * levels ≈ 1000 rounds to finish the track — the owner's pacing target.
 *
 * Reward rules (owner spec):
 * - 50 levels, ONE reward each, shown as 10 pages of 5.
 * - Characters sparingly (4, from the existing locked roster).
 * - The level-50 grand prize is the season-exclusive pal (Mango, the
 *   bright-orange gecko) — pals appear ONLY there.
 * - The rest: season-exclusive ball/trail/club/outfit tints plus J-Coin and
 *   XP grants.
 * - Everyone accrues pass XP while the season runs; claiming rewards requires
 *   owning the pass ($5 — see firebase/Purchases.ts). Claims are retroactive:
 *   buy late and every reached level is immediately claimable.
 */

export type SeasonReward =
  | { item: string } // StoreItem id granted into cosmetics.owned
  | { coins: number }
  | { xp: number };

export interface SeasonDef {
  id: string;
  name: string;
  /** ISO date (inclusive) the season starts. */
  start: string;
  /** ISO date (inclusive) the season ends. */
  end: string;
  xpPerLevel: number;
  levels: number;
  /** rewards[i] = the single reward for level i+1; length === levels. */
  rewards: SeasonReward[];
  priceUsd: number;
}

/** Level → reward. Levels not listed here get the coin/XP drip below. */
const FIXED: Record<number, SeasonReward> = {
  2: { item: 's1_ball_lagoon' },
  4: { item: 's1_trail_aurora' },
  6: { item: 's1_clubskin_copper' },
  7: { item: 's1_ball_fuchsia' },
  9: { item: 's1_trail_violet' },
  10: { item: 's1_outfit_coral' },
  12: { item: 'char_kuro' },
  13: { item: 's1_ball_copper' },
  15: { item: 's1_clubskin_rose' },
  17: { item: 's1_trail_crimson' },
  19: { item: 's1_outfit_teal' },
  23: { item: 's1_clubskin_violet' },
  24: { item: 'char_jade' },
  27: { item: 's1_ball_ice' },
  29: { item: 's1_outfit_lavender' },
  31: { item: 's1_trail_frost' },
  33: { item: 's1_clubskin_frost' },
  36: { item: 'char_nova' },
  37: { item: 's1_outfit_ember' },
  41: { item: 's1_ball_volt' },
  43: { item: 's1_trail_sunset' },
  46: { item: 's1_clubskin_neon' },
  48: { item: 'char_remi' },
  49: { item: 's1_outfit_ivory' },
  50: { item: 's1_pal_geckoorange' }
};

/** Coin/XP drip for the in-between levels: alternates coins and XP, growing
 *  with depth so late-track filler still feels worth reaching. */
function drip(level: number): SeasonReward {
  const tier = Math.floor((level - 1) / 10); // 0..4 by page
  return level % 2 === 1 ? { coins: 50 + tier * 25 } : { xp: 100 + tier * 50 };
}

const REWARDS: SeasonReward[] = Array.from({ length: 50 }, (_, i) => FIXED[i + 1] ?? drip(i + 1));

export const SEASON_1: SeasonDef = {
  id: 's1',
  name: 'Season One',
  start: '2026-07-13',
  end: '2026-11-30',
  xpPerLevel: 2400,
  levels: 50,
  rewards: REWARDS,
  priceUsd: 5
};
