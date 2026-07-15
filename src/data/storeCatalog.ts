import { GolferStats } from '../core/types';
import { SWING } from '../config';
import { CharacterKey } from './characters';
import { PalKey } from './pals';

/**
 * The store catalog (docs 08): cosmetics + modest club upgrades bought with
 * J-Coins earned through play (real money exists only as a coin top-up and
 * the Season Pass — docs 08 §Real-Money Purchases, firebase/Purchases.ts).
 * Everything here uses assets the game already ships — procedural ball/trail
 * colors and the full 25-character rigged roster (five free, the other twenty
 * unlockable). Items flagged `season` are pass-claim-only, never sold. Config
 * only; the pure `StoreEngine` runs the transactions.
 */

export type StoreKind = 'ball' | 'trail' | 'character' | 'clubUpgrade' | 'outfit' | 'clubskin' | 'pal';
export type UpgradeFamily = 'driver' | 'irons' | 'wedges' | 'putter';

/** Cosmetic kinds that are equipped (a chosen tint/pal), vs owned-only. */
export const EQUIPPABLE_KINDS: StoreKind[] = ['ball', 'trail', 'outfit', 'clubskin', 'pal'];
export const isEquippableKind = (kind: StoreKind): boolean => EQUIPPABLE_KINDS.includes(kind);

export interface StoreItem {
  id: string;
  kind: StoreKind;
  name: string;
  price: number;
  rarity: 'common' | 'rare' | 'special';
  /** ball/trail: RGB hex tint. */
  color?: number;
  /** character: which avatar this unlocks. */
  character?: CharacterKey;
  /** clubUpgrade: which family + tier (1 or 2). */
  upgrade?: { family: UpgradeFamily; tier: number };
  /** pal: which companion this unlocks. */
  pal?: PalKey;
  /** Season-pass exclusive: the season id ('s1'…). These items are price 0 but
   *  NOT default-owned and can never be coin-bought — they are granted only by
   *  claiming the matching pass reward (systems/SeasonPassEngine). */
  season?: string;
}

/** Characters owned from the start (the rest are store unlocks). */
export const FREE_CHARACTERS: CharacterKey[] = ['chip', 'rose', 'rio', 'sunny', 'theo'];

/** Cosmetics owned by default (white ball + plain white trail + the classic
 *  outfit colorway, steel clubs, and the starter pals — none equipped). */
export const DEFAULT_OWNED = [
  'ball_white',
  'trail_white',
  'outfit_default',
  'clubskin_steel',
  'pal_fox',
  'pal_dragon',
  ...FREE_CHARACTERS.map((c) => `char_${c}`)
];

/** Default equipped cosmetics for a fresh profile. */
export const DEFAULT_EQUIPPED = {
  ball: 'ball_white',
  trail: 'trail_white',
  outfit: 'outfit_default',
  clubskin: 'clubskin_steel'
} as const;

const BALL_TINTS: Array<[string, string, number, StoreItem['rarity'], number]> = [
  ['red', 'Cherry', 0xe23c3c, 'common', 100],
  ['blue', 'Sky', 0x3c86e2, 'common', 100],
  ['orange', 'Tangerine', 0xf08a2c, 'common', 100],
  ['pink', 'Blossom', 0xf06fb0, 'rare', 200],
  ['green', 'Lime', 0x53c24a, 'rare', 200],
  ['gold', 'Gold', 0xf5c542, 'special', 300],
  ['black', 'Onyx', 0x2a2a30, 'rare', 200],
  ['purple', 'Amethyst', 0x9a5cd0, 'special', 300]
];

// Saturated tints so an unlit streak reads clearly as its color, not a pale
// wash (playtest: trails all looked like the white default).
const TRAIL_TINTS: Array<[string, string, number, StoreItem['rarity'], number]> = [
  ['blue', 'Comet', 0x3d8bff, 'common', 100],
  ['gold', 'Gilded', 0xffc21f, 'rare', 200],
  ['pink', 'Sakura', 0xff5fb0, 'common', 100],
  ['green', 'Emerald', 0x2ecc40, 'rare', 200],
  ['fire', 'Inferno', 0xff5a12, 'special', 300]
];

// kuro / jade / nova / remi are NOT here — they are Season 1 pass exclusives
// (claim-only, never sold), defined as season char items in the catalog below.
const CHARACTER_UNLOCKS: Array<[CharacterKey, StoreItem['rarity'], number]> = [
  ['dez', 'common', 100],
  ['beat', 'common', 100],
  ['milo', 'common', 100],
  ['finn', 'common', 100],
  ['bree', 'common', 100],
  ['coco', 'common', 100],
  ['lily', 'rare', 200],
  ['cole', 'rare', 200],
  ['reid', 'rare', 200],
  ['wren', 'rare', 200],
  ['ivy', 'rare', 200],
  ['dash', 'rare', 200],
  ['enzo', 'special', 300],
  ['knox', 'special', 300],
  ['pia', 'special', 300],
  ['remi', 'special', 300]
];

/** Characters awarded ONLY by the Season 1 pass (not buyable). Season-flagged
 *  so the store hides them and StoreEngine treats them as claim-only. */
const SEASON_CHARACTERS: CharacterKey[] = ['kuro', 'jade', 'nova', 'zuri'];

// Outfit colorways: tint the whole character kit (one 'characters' material —
// the chibi mesh has no separable garments, so this is a whole-kit wash applied
// as an albedo multiply). Mid-saturation tints so the hue shift reads clearly
// as a colorway (a multiply can only darken/colorize, never lighten).
const OUTFIT_TINTS: Array<[string, string, number, StoreItem['rarity'], number]> = [
  ['azure', 'Azure Kit', 0x5a86d8, 'common', 100],
  ['rose', 'Rose Kit', 0xd8688e, 'common', 100],
  ['mint', 'Mint Kit', 0x57bf83, 'rare', 200],
  ['sun', 'Sunlit Kit', 0xd8b23e, 'rare', 200],
  ['noir', 'Noir Kit', 0x565c68, 'special', 300]
];

// Club skins: tint the (procedural) shaft + head. Gold matches the vision's
// upgraded-club look.
const CLUBSKIN_TINTS: Array<[string, string, number, StoreItem['rarity'], number]> = [
  ['crimson', 'Crimson Clubs', 0xd23c3c, 'common', 100],
  ['azure', 'Azure Clubs', 0x3c86e2, 'common', 100],
  ['emerald', 'Emerald Clubs', 0x3fbf6a, 'rare', 200],
  ['onyx', 'Onyx Clubs', 0x2a2a30, 'rare', 200],
  ['gold', 'Gold Clubs', 0xf5c542, 'special', 300]
];

// Season 1 pass-exclusive tints (data/seasonPass.ts places them on the reward
// track). New hues, distinct from every store tint, so a pass reward always
// reads as something the store can't sell.
const S1_BALL_TINTS: Array<[string, string, number, StoreItem['rarity']]> = [
  ['lagoon', 'Lagoon', 0x27d3c7, 'common'],
  ['fuchsia', 'Fuchsia', 0xe040c0, 'common'],
  ['copper', 'Copper', 0xc26f3a, 'rare'],
  ['ice', 'Ice', 0xbfe8ff, 'rare'],
  ['volt', 'Volt', 0xd6ff3a, 'special']
];
const S1_TRAIL_TINTS: Array<[string, string, number, StoreItem['rarity']]> = [
  ['aurora', 'Aurora', 0x1fe0c0, 'common'],
  ['violet', 'Violet Storm', 0xa04ef0, 'common'],
  ['crimson', 'Crimson', 0xf03030, 'rare'],
  ['frost', 'Frost', 0xbfe8ff, 'rare'],
  ['sunset', 'Sunset', 0xff8a3c, 'special']
];
const S1_CLUBSKIN_TINTS: Array<[string, string, number, StoreItem['rarity']]> = [
  ['copper', 'Copper Clubs', 0xc26f3a, 'common'],
  ['rose', 'Rose Clubs', 0xd8688e, 'common'],
  ['violet', 'Violet Clubs', 0x8a5cd0, 'rare'],
  ['frost', 'Frost Clubs', 0xb8d4e8, 'rare'],
  ['neon', 'Neon Clubs', 0x3af0a0, 'special']
];
const S1_OUTFIT_TINTS: Array<[string, string, number, StoreItem['rarity']]> = [
  ['coral', 'Coral Kit', 0xd87a5a, 'common'],
  ['teal', 'Teal Kit', 0x3aa8a0, 'common'],
  ['lavender', 'Lavender Kit', 0x9a86d8, 'rare'],
  ['ember', 'Ember Kit', 0xc25a3a, 'rare'],
  ['ivory', 'Ivory Kit', 0xcfc9b8, 'special']
];

const UPGRADE_FAMILIES: Array<[UpgradeFamily, string]> = [
  ['driver', 'Driver'],
  ['irons', 'Irons'],
  ['wedges', 'Wedges'],
  ['putter', 'Putter']
];

export const STORE_CATALOG: StoreItem[] = [
  { id: 'ball_white', kind: 'ball', name: 'Classic White', price: 0, rarity: 'common', color: 0xf7f7f2 },
  ...BALL_TINTS.map(
    ([id, name, color, rarity, price]): StoreItem => ({ id: `ball_${id}`, kind: 'ball', name: `${name} Ball`, price, rarity, color })
  ),
  { id: 'trail_white', kind: 'trail', name: 'Classic Trail', price: 0, rarity: 'common', color: 0xffffff },
  ...TRAIL_TINTS.map(
    ([id, name, color, rarity, price]): StoreItem => ({ id: `trail_${id}`, kind: 'trail', name: `${name} Trail`, price, rarity, color })
  ),
  ...CHARACTER_UNLOCKS.map(
    ([character, rarity, price]): StoreItem => ({
      id: `char_${character}`,
      kind: 'character',
      name: `${character[0].toUpperCase()}${character.slice(1)}`,
      price,
      rarity,
      character
    })
  ),
  { id: 'outfit_default', kind: 'outfit', name: 'Classic Kit', price: 0, rarity: 'common', color: 0xffffff },
  ...OUTFIT_TINTS.map(
    ([id, name, color, rarity, price]): StoreItem => ({ id: `outfit_${id}`, kind: 'outfit', name, price, rarity, color })
  ),
  { id: 'pal_fox', kind: 'pal', name: 'Foxy', price: 0, rarity: 'common', pal: 'fox' },
  { id: 'pal_dragon', kind: 'pal', name: 'Ember', price: 0, rarity: 'common', pal: 'dragon' },
  { id: 'pal_gecko', kind: 'pal', name: 'Zippy', price: 100, rarity: 'common', pal: 'gecko' },
  { id: 'pal_crab', kind: 'pal', name: 'Clawdia', price: 200, rarity: 'rare', pal: 'crab' },
  { id: 'pal_trex', kind: 'pal', name: 'Rexy', price: 300, rarity: 'special', pal: 'trex' },
  // The two newest pets + the orange fox recolor — cheapest tier so they're an
  // easy first purchase (playtest: "add the new pals to the store, make them cheap").
  { id: 'pal_pug', kind: 'pal', name: 'Pugsley', price: 100, rarity: 'common', pal: 'pug' },
  { id: 'pal_cat', kind: 'pal', name: 'Whiskers', price: 100, rarity: 'common', pal: 'cat' },
  { id: 'pal_foxorange', kind: 'pal', name: 'Rusty', price: 100, rarity: 'common', pal: 'foxorange' },
  { id: 'clubskin_steel', kind: 'clubskin', name: 'Steel Clubs', price: 0, rarity: 'common', color: 0x9aa6b2 },
  ...CLUBSKIN_TINTS.map(
    ([id, name, color, rarity, price]): StoreItem => ({ id: `clubskin_${id}`, kind: 'clubskin', name, price, rarity, color })
  ),
  // Club upgrades: two tiers per family, +3 stat each (docs 08). Gold-only.
  ...UPGRADE_FAMILIES.flatMap(([family, label]): StoreItem[] => [
    { id: `up_${family}_1`, kind: 'clubUpgrade', name: `${label} +3`, price: 300, rarity: 'rare', upgrade: { family, tier: 1 } },
    { id: `up_${family}_2`, kind: 'clubUpgrade', name: `${label} +6`, price: 500, rarity: 'special', upgrade: { family, tier: 2 } }
  ]),
  // Season 1 pass exclusives — claim-only (never rendered in the store, never
  // coin-buyable; see StoreEngine.isOwned/canBuy season guards).
  ...S1_BALL_TINTS.map(
    ([id, name, color, rarity]): StoreItem => ({ id: `s1_ball_${id}`, kind: 'ball', name: `${name} Ball`, price: 0, rarity, color, season: 's1' })
  ),
  ...S1_TRAIL_TINTS.map(
    ([id, name, color, rarity]): StoreItem => ({ id: `s1_trail_${id}`, kind: 'trail', name: `${name} Trail`, price: 0, rarity, color, season: 's1' })
  ),
  ...S1_CLUBSKIN_TINTS.map(
    ([id, name, color, rarity]): StoreItem => ({ id: `s1_clubskin_${id}`, kind: 'clubskin', name, price: 0, rarity, color, season: 's1' })
  ),
  ...S1_OUTFIT_TINTS.map(
    ([id, name, color, rarity]): StoreItem => ({ id: `s1_outfit_${id}`, kind: 'outfit', name, price: 0, rarity, color, season: 's1' })
  ),
  // Season-1 pass-exclusive characters (claim-only; keep the char_<key> id so a
  // pass reward and any prior owner reference the same character).
  ...SEASON_CHARACTERS.map(
    (character): StoreItem => ({
      id: `char_${character}`,
      kind: 'character',
      name: `${character[0].toUpperCase()}${character.slice(1)}`,
      price: 0,
      rarity: 'special',
      character,
      season: 's1'
    })
  ),
  { id: 's1_pal_geckoorange', kind: 'pal', name: 'Mango', price: 0, rarity: 'special', pal: 'geckoorange', season: 's1' },
  // Season-1 pass marquee companions (levels 46-50, claim-only).
  { id: 's1_pal_trice', kind: 'pal', name: 'Triceratops', price: 0, rarity: 'special', pal: 'trice', season: 's1' },
  { id: 's1_pal_deadpool', kind: 'pal', name: 'Deadpool', price: 0, rarity: 'special', pal: 'deadpool', season: 's1' },
  { id: 's1_pal_toothless', kind: 'pal', name: 'Toothless', price: 0, rarity: 'special', pal: 'toothless', season: 's1' },
  { id: 's1_pal_spidey', kind: 'pal', name: 'Spiderman', price: 0, rarity: 'special', pal: 'spidey', season: 's1' }
];

export const STORE_BY_ID = new Map(STORE_CATALOG.map((i) => [i.id, i]));

/** Per-family upgrade stat lift. ONLY the driver lifts stats now: it buys
 *  distance (effectiveCarryYards) and its bump also shows on the select card
 *  and sharpens driving accuracy. The iron/wedge/putter upgrades deliberately
 *  lift NO stat — they must not change how far those clubs go (playtest). Their
 *  benefit is a wider swing-meter perfect zone instead (upgradePerfectZoneMult).
 */
const FAMILY_STATS: Partial<Record<UpgradeFamily, Array<keyof GolferStats>>> = {
  driver: ['drivingPower', 'drivingAccuracy']
};

/** Apply the profile's purchased club upgrades to a base stat block. Only the
 *  DRIVER upgrade touches the stats, and it pushes PAST the 100 rating ceiling
 *  (a Big Hitter's power reads "100+3") — the real carry gain comes from the
 *  distance multiplier in effectiveCarryYards, since the stat is capped at 100
 *  for distance. Iron/wedge/putter upgrades are no-ops here by design (see
 *  FAMILY_STATS / upgradePerfectZoneMult). 110 is a sanity bound. */
export function applyClubUpgrades(stats: GolferStats, clubUpgrades: Record<string, number>): GolferStats {
  const out = { ...stats };
  for (const [family, tier] of Object.entries(clubUpgrades)) {
    const keys = FAMILY_STATS[family as UpgradeFamily];
    if (!keys) continue;
    for (const k of keys) out[k] = Math.min(110, out[k] + tier * 3);
  }
  return out;
}

/** Which upgrade family governs a club — mirrors the stat mapping in
 *  PhysicsEngine.statsForClub (woods↔driver, wedges↔wedges, putter↔putter,
 *  everything else↔irons). One source of truth for both the carry bonus
 *  (driver) and the perfect-zone bonus (irons/wedges/putter). */
export function upgradeFamilyForClub(clubId: string): UpgradeFamily {
  if (clubId === 'driver' || clubId === '3w' || clubId === '5w') return 'driver';
  if (clubId === 'putter') return 'putter';
  if (clubId === 'pw' || clubId === 'sw') return 'wedges';
  return 'irons';
}

/** Swing-meter perfect-zone multiplier a club earns from purchased upgrades.
 *  Only the SHORT clubs (irons/wedges/putter) get it — the driver upgrade buys
 *  distance instead (family 'driver' → 1). Tier 1 sits HALFWAY between a normal
 *  meter and today's on-fire meter; tier 2 EQUALS today's on-fire widening.
 *  Fire then LAYERS on top: the meter multiplies this by the live fire
 *  multiplier, so an on-fire upgraded club gets an even wider perfect band
 *  (playtest design). */
export function upgradePerfectZoneMult(clubId: string, clubUpgrades: Record<string, number>): number {
  const fam = upgradeFamilyForClub(clubId);
  if (fam === 'driver') return 1;
  const tier = clubUpgrades[fam] ?? 0;
  if (tier <= 0) return 1;
  const fire = SWING.firePerfectMult;
  return tier === 1 ? 1 + (fire - 1) * 0.5 : fire;
}
