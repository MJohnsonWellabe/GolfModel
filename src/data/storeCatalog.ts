import { GolferStats } from '../core/types';
import { CharacterKey } from './characters';

/**
 * Gold-only store (docs 08): cosmetics + modest club upgrades bought with
 * J-Coins earned through play. No real money. Everything here uses assets the
 * game already ships — procedural ball/trail colors and the existing rigged
 * characters (four free, the rest unlockable). Config only; the pure
 * `StoreEngine` runs the transactions.
 */

export type StoreKind = 'ball' | 'trail' | 'character' | 'clubUpgrade';
export type UpgradeFamily = 'driver' | 'irons' | 'wedges' | 'putter';

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
}

/** Characters owned from the start (the rest are store unlocks). */
export const FREE_CHARACTERS: CharacterKey[] = ['chip', 'rose', 'rio', 'sunny'];

/** Cosmetics owned by default (white ball + plain white trail). */
export const DEFAULT_OWNED = ['ball_white', 'trail_white', ...FREE_CHARACTERS.map((c) => `char_${c}`)];

/** Default equipped cosmetics for a fresh profile. */
export const DEFAULT_EQUIPPED = { ball: 'ball_white', trail: 'trail_white' } as const;

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
  ['kuro', 'rare', 200],
  ['lily', 'rare', 200],
  ['jade', 'special', 300],
  ['nova', 'special', 300]
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
