/**
 * Season Pass config — Season 1. Config only; the pure `SeasonPassEngine`
 * consumes this. Pass XP mirrors the round XP the player already earns
 * (ProgressionEngine's 'xp' event), so ~120 XP/round × 2400 XP/level × 50
 * levels ≈ 1000 rounds to finish the track — the owner's pacing target.
 *
 * Reward mix (owner spec, exact counts, total 50):
 *   ball 5 · trail 5 · club colors (clubskin) 5 · skin colors (outfit) 5 ·
 *   character 4 · pal 1 · perk 5 · XP 10 · J-Coins 10.
 * - J-Coins total ≤ 1000 across the 10 coin levels.
 * - The major rewards land on the last page (46–50): a ++ perk, a character,
 *   and the level-50 exclusive pal (Mango, the bright-orange gecko).
 * - Everyone accrues pass XP while the season runs; claiming rewards requires
 *   owning the pass ($5). Claims are retroactive. Pass purchases OPEN on
 *   2026-07-16 12:00 ET (see salesOpen); until then the game says "coming soon".
 */

export type SeasonReward =
  | { item: string } // StoreItem id granted into cosmetics.owned
  | { perk: string } // PerkDef id granted into the perk inventory
  | { coins: number }
  | { xp: number };

export interface SeasonDef {
  id: string;
  name: string;
  /** ISO date (inclusive) the season starts. */
  start: string;
  /** ISO date (inclusive) the season ends. */
  end: string;
  /** ISO instant real-money purchases open (noon ET on launch day). */
  salesOpenAt: string;
  xpPerLevel: number;
  levels: number;
  /** rewards[i] = the single reward for level i+1; length === levels. */
  rewards: SeasonReward[];
  priceUsd: number;
}

// --- The 50-level track, authored by category so the counts are auditable. ---

// Cosmetic tints (5 each) — the existing season-exclusive catalog items.
const BALLS = ['s1_ball_lagoon', 's1_ball_fuchsia', 's1_ball_copper', 's1_ball_ice', 's1_ball_volt'];
const TRAILS = ['s1_trail_aurora', 's1_trail_violet', 's1_trail_crimson', 's1_trail_frost', 's1_trail_sunset'];
const CLUBSKINS = ['s1_clubskin_copper', 's1_clubskin_rose', 's1_clubskin_violet', 's1_clubskin_frost', 's1_clubskin_neon'];
const OUTFITS = ['s1_outfit_coral', 's1_outfit_teal', 's1_outfit_lavender', 's1_outfit_ember', 's1_outfit_ivory'];
const CHARACTERS = ['char_kuro', 'char_jade', 'char_nova', 'char_zuri'];

// Explicit level → reward assignment. Counts verified by seasonPass.test.ts.
const FIXED: Record<number, SeasonReward> = {
  // Page 1
  1: { xp: 150 },
  2: { item: BALLS[0] },
  3: { coins: 50 },
  4: { item: TRAILS[0] },
  5: { perk: 'perk_drive_t1_r1' },
  // Page 2
  6: { item: CLUBSKINS[0] },
  7: { xp: 150 },
  8: { coins: 75 },
  9: { item: OUTFITS[0] },
  10: { item: BALLS[1] },
  // Page 3
  11: { xp: 200 },
  12: { item: CHARACTERS[0] },
  13: { coins: 75 },
  14: { item: TRAILS[1] },
  15: { perk: 'perk_wedge_t1_r3' },
  // Page 4
  16: { item: CLUBSKINS[1] },
  17: { xp: 200 },
  18: { coins: 100 },
  19: { item: OUTFITS[1] },
  20: { item: BALLS[2] },
  // Page 5
  21: { xp: 250 },
  22: { item: TRAILS[2] },
  23: { coins: 100 },
  24: { item: CLUBSKINS[2] },
  25: { item: CHARACTERS[1] },
  // Page 6
  26: { xp: 250 },
  27: { item: BALLS[3] },
  28: { coins: 100 },
  29: { item: OUTFITS[2] },
  30: { perk: 'perk_iron_t2_r3' },
  // Page 7
  31: { item: TRAILS[3] },
  32: { xp: 300 },
  33: { coins: 100 },
  34: { item: CLUBSKINS[3] },
  35: { item: CHARACTERS[2] },
  // Page 8
  36: { xp: 300 },
  37: { item: OUTFITS[3] },
  38: { coins: 125 },
  39: { item: BALLS[4] },
  40: { perk: 'perk_putt_t1_r5' },
  // Page 9
  41: { xp: 400 },
  42: { item: TRAILS[4] },
  43: { coins: 125 },
  44: { item: CLUBSKINS[4] },
  45: { xp: 500 },
  // Page 10 (major rewards)
  46: { item: CHARACTERS[3] },
  47: { perk: 'perk_drive_t2_r5' },
  48: { item: OUTFITS[4] },
  49: { coins: 150 },
  50: { item: 's1_pal_geckoorange' }
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
  // Noon Eastern (EDT = UTC−4) on launch day.
  salesOpenAt: '2026-07-16T16:00:00Z',
  xpPerLevel: 2400,
  levels: 50,
  rewards: REWARDS,
  priceUsd: 5
};

/** Have real-money pass/coin purchases opened yet? */
export function salesOpen(def: SeasonDef, now: number): boolean {
  return now >= new Date(def.salesOpenAt).getTime();
}
