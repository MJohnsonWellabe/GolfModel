/**
 * Season Pass config — Season 1. Config only; the pure `SeasonPassEngine`
 * consumes this. Pass XP mirrors the round XP the player already earns
 * (ProgressionEngine's 'xp' event), so ~120 XP/round × 1200 XP/level × 50
 * levels ≈ 500 rounds to finish the track — the owner's pacing target.
 *
 * Reward mix (owner spec, exact counts, total 50):
 *   ball 5 · trail 5 · club colors (clubskin) 5 · skin colors (outfit) 5 ·
 *   character 4 · pal 5 · perk 5 · XP 6 · J-Coins 6 · True Vision 4 (packs of 3,
 *   levels 13/21/33/41 — the putting-aid consumable, season-pass exclusive).
 * - J-Coins total ≤ 1000 across the coin levels.
 * - The pass's marquee companion pals land on levels 30/35/40/45/50, each with
 *   a full render in the pass: Triceratops · Mango · Deadpool · Toothless ·
 *   Thanos (the level-50 finale). Everything else lives in the remaining
 *   1–45/46–49 levels.
 * - Everyone accrues pass XP while the season runs; claiming rewards requires
 *   owning the pass ($5). Claims are retroactive. Pass purchases OPEN on
 *   2026-07-14 (see salesOpen); until then the game says "coming soon".
 */

export type SeasonReward =
  | { item: string } // StoreItem id granted into cosmetics.owned
  | { perk: string } // PerkDef id granted into the perk inventory
  | { coins: number }
  | { xp: number }
  | { trueVision: number }; // ConsumableDef charges granted into consumables[]

export interface SeasonDef {
  id: string;
  name: string;
  /** ISO date (inclusive) the season starts. */
  start: string;
  /** ISO date (inclusive) the season ends. */
  end: string;
  /** ISO instant real-money purchases open (noon ET on launch day). */
  salesOpenAt: string;
  /** XP required to complete EACH level, index 0 = level 1's cost. Length
   *  === levels. Progressive (each entry > the last) so early levels come
   *  quickly and the climb steepens toward the end — see progressiveXpCosts. */
  xpPerLevel: number[];
  levels: number;
  /** rewards[i] = the single reward for level i+1; length === levels. */
  rewards: SeasonReward[];
  priceUsd: number;
}

/**
 * Progressive per-level XP costs: an arithmetic ramp from a LOW first-level
 * cost to a HIGH last-level cost, summing to EXACTLY `flatCost * levels` —
 * the flat-1200-per-level total (~500 rounds at ~120 XP/round, the owner's
 * pacing target) is unchanged, only its distribution across levels.
 * Solved in closed form: with n levels, step d and first term a, sum =
 * n·a + d·n·(n−1)/2 must equal the flat total; d is fixed at a clean round
 * number and a is derived from it (rounded to the nearest integer). That
 * rounding leaves a small remainder (at most n/2, since d is a whole
 * number of "flatCost/48" units); it's spread as a ±1 nudge across the
 * first |remainder| levels rather than dumped on the last one — lumping it
 * all on the last level can tie it with the second-to-last (and did, once
 * flatCost got small enough that the remainder reached d), breaking the
 * "every level costs strictly more" invariant.
 */
function progressiveXpCosts(levels: number, flatCost: number): number[] {
  const d = Math.round(flatCost / 48 / 25) * 25; // clean step, ~2% of flatCost
  const total = flatCost * levels;
  const a = Math.round((total - (d * levels * (levels - 1)) / 2) / levels);
  const costs = Array.from({ length: levels }, (_, i) => a + d * i);
  const remainder = total - costs.reduce((sum, v) => sum + v, 0);
  const step = remainder >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(remainder); i++) costs[i] += step;
  return costs;
}

// --- The 50-level track, authored by category so the counts are auditable. ---

// Cosmetic tints (5 each) — the existing season-exclusive catalog items.
const BALLS = ['s1_ball_lagoon', 's1_ball_fuchsia', 's1_ball_copper', 's1_ball_ice', 's1_ball_volt'];
const TRAILS = ['s1_trail_aurora', 's1_trail_violet', 's1_trail_crimson', 's1_trail_frost', 's1_trail_sunset'];
const CLUBSKINS = ['s1_clubskin_copper', 's1_clubskin_rose', 's1_clubskin_violet', 's1_clubskin_frost', 's1_clubskin_neon'];
const OUTFITS = ['s1_outfit_coral', 's1_outfit_teal', 's1_outfit_lavender', 's1_outfit_ember', 's1_outfit_ivory'];
const CHARACTERS = ['char_kuro', 'char_jade', 'char_nova', 'char_zuri'];
// Marquee companion pals (full renders in the pass), landing on levels
// 30/35/40/45/50 — each is the LAST card of its page (26-30, 31-35, 36-40,
// 41-45, 46-50), so it reads as that page's payoff. Thanos closes the track.
const PALS = ['s1_pal_trice', 's1_pal_geckoorange', 's1_pal_deadpool', 's1_pal_toothless', 's1_pal_thanos'];

// Explicit level → reward assignment. Counts verified by seasonPass.test.ts.
// True Vision is fixed at 13/21/33/41; the five pals sit at 30/35/40/45/50 —
// the item each pal displaced (a clubskin/perk/outfit/xp reward that used to
// occupy that level) moved down into 46-49, which the pals vacated.
const FIXED: Record<number, SeasonReward> = {
  // Page 1
  1: { xp: 150 },
  2: { item: BALLS[0] },
  3: { coins: 50 },
  4: { item: TRAILS[0] },
  5: { perk: 'perk_drive_t1_r1' },
  // Page 2
  6: { item: CLUBSKINS[0] },
  7: { item: OUTFITS[0] },
  8: { coins: 75 },
  9: { item: BALLS[1] },
  10: { item: CHARACTERS[0] },
  // Page 3
  11: { xp: 200 },
  12: { item: TRAILS[1] },
  13: { trueVision: 3 },
  14: { item: CLUBSKINS[1] },
  15: { perk: 'perk_wedge_t1_r3' },
  // Page 4
  16: { item: OUTFITS[1] },
  17: { coins: 100 },
  18: { item: BALLS[2] },
  19: { item: CHARACTERS[1] },
  20: { item: TRAILS[2] },
  // Page 5
  21: { trueVision: 3 },
  22: { item: CLUBSKINS[2] },
  23: { xp: 250 },
  24: { item: OUTFITS[2] },
  25: { perk: 'perk_iron_t2_r3' },
  // Page 6 — closes with Triceratops
  26: { coins: 100 },
  27: { item: BALLS[3] },
  28: { item: CHARACTERS[2] },
  29: { item: TRAILS[3] },
  30: { item: PALS[0] }, // Triceratops
  // Page 7 — closes with Mango
  31: { xp: 300 },
  32: { item: OUTFITS[3] },
  33: { trueVision: 3 },
  34: { coins: 125 },
  35: { item: PALS[1] }, // Mango
  // Page 8 — closes with Deadpool
  36: { item: BALLS[4] },
  37: { item: CHARACTERS[3] },
  38: { item: TRAILS[4] },
  39: { item: CLUBSKINS[4] },
  40: { item: PALS[2] }, // Deadpool
  // Page 9 — closes with Toothless
  41: { trueVision: 3 },
  42: { coins: 125 },
  43: { perk: 'perk_drive_t2_r5' },
  44: { xp: 400 },
  45: { item: PALS[3] }, // Toothless
  // Page 10 — the rewards the pals displaced from 30/35/40/45, then closes
  // with Thanos as the season finale.
  46: { item: CLUBSKINS[3] }, // displaced from 30
  47: { perk: 'perk_putt_t1_r5' }, // displaced from 35
  48: { item: OUTFITS[4] }, // displaced from 40
  49: { xp: 500 }, // displaced from 45
  50: { item: PALS[4] } // Thanos — season finale
};

const REWARDS: SeasonReward[] = Array.from({ length: 50 }, (_, i) => {
  const r = FIXED[i + 1];
  if (!r) throw new Error(`seasonPass: no reward defined for level ${i + 1}`);
  return r;
});

export const SEASON_1: SeasonDef = {
  id: 's1',
  name: 'Season One',
  start: '2026-07-13',
  end: '2026-11-30',
  // Launch day (moved up from the original July 16 date).
  salesOpenAt: '2026-07-14T00:00:00Z',
  xpPerLevel: progressiveXpCosts(50, 1200),
  levels: 50,
  rewards: REWARDS,
  priceUsd: 5
};

/** Have real-money pass/coin purchases opened yet? */
export function salesOpen(def: SeasonDef, now: number): boolean {
  return now >= new Date(def.salesOpenAt).getTime();
}
