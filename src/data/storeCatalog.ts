import { GolferStats } from '../core/types';
import { CharacterKey } from './characters';
import { PalKey } from './pals';

/**
 * Gold-only store (docs 08): cosmetics + modest club upgrades bought with
 * J-Coins earned through play. No real money. Everything here uses assets the
 * game already ships — procedural ball/trail colors and the full 25-character
 * rigged roster (five free, the other twenty unlockable). Config only; the pure
 * `StoreEngine` runs the transactions.
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

const TRAIL_TINTS: Array<[string, string, number, StoreItem['rarity'], number]> = [
  ['blue', 'Comet', 0x6fb0ff, 'common', 100],
  ['gold', 'Gilded', 0xffd54f, 'rare', 200],
  ['pink', 'Sakura', 0xff8fc4, 'common', 100],
  ['green', 'Emerald', 0x66d96a, 'rare', 200],
  ['fire', 'Inferno', 0xff6a1a, 'special', 300]
];

const CHARACTER_UNLOCKS: Array<[CharacterKey, StoreItem['rarity'], number]> = [
  ['dez', 'common', 100],
  ['beat', 'common', 100],
  ['milo', 'common', 100],
  ['finn', 'common', 100],
  ['bree', 'common', 100],
  ['coco', 'common', 100],
  ['kuro', 'rare', 200],
  ['lily', 'rare', 200],
  ['cole', 'rare', 200],
  ['reid', 'rare', 200],
  ['wren', 'rare', 200],
  ['ivy', 'rare', 200],
  ['dash', 'rare', 200],
  ['jade', 'special', 300],
  ['nova', 'special', 300],
  ['enzo', 'special', 300],
  ['knox', 'special', 300],
  ['pia', 'special', 300],
  ['zuri', 'special', 300],
  ['remi', 'special', 300]
];

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
  { id: 'clubskin_steel', kind: 'clubskin', name: 'Steel Clubs', price: 0, rarity: 'common', color: 0x9aa6b2 },
  ...CLUBSKIN_TINTS.map(
    ([id, name, color, rarity, price]): StoreItem => ({ id: `clubskin_${id}`, kind: 'clubskin', name, price, rarity, color })
  ),
  // Club upgrades: two tiers per family, +3 stat each (docs 08). Gold-only.
  ...UPGRADE_FAMILIES.flatMap(([family, label]): StoreItem[] => [
    { id: `up_${family}_1`, kind: 'clubUpgrade', name: `${label} +3`, price: 300, rarity: 'rare', upgrade: { family, tier: 1 } },
    { id: `up_${family}_2`, kind: 'clubUpgrade', name: `${label} +6`, price: 500, rarity: 'special', upgrade: { family, tier: 2 } }
  ])
];

export const STORE_BY_ID = new Map(STORE_CATALOG.map((i) => [i.id, i]));

/** Per-family upgrade: which stats it lifts. Each tier adds +3, capped at 100. */
const FAMILY_STATS: Record<UpgradeFamily, Array<keyof GolferStats>> = {
  driver: ['drivingPower', 'drivingAccuracy'],
  irons: ['approach'],
  wedges: ['chipping'],
  putter: ['putting']
};

/** Apply the profile's purchased club upgrades to a base stat block. */
export function applyClubUpgrades(stats: GolferStats, clubUpgrades: Record<string, number>): GolferStats {
  const out = { ...stats };
  for (const [family, tier] of Object.entries(clubUpgrades)) {
    const keys = FAMILY_STATS[family as UpgradeFamily];
    if (!keys) continue;
    for (const k of keys) out[k] = Math.min(100, out[k] + tier * 3);
  }
  return out;
}
