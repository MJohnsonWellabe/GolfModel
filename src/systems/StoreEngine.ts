import { CosmeticKind, PlayerProfile } from '../profile/Profile';
import { isEquippableKind, STORE_BY_ID, StoreItem } from '../data/storeCatalog';

/**
 * Pure store transactions (Phase 7): buy, own, equip. Coins never go
 * negative and an item can't be bought twice. Club upgrades must be bought
 * in tier order. J-Coins only in here — real money never touches the store
 * engine (coin top-ups and the Season Pass go through firebase/Purchases +
 * SeasonPassEngine), and season-exclusive items can't be bought at all.
 */

export type BuyResult = { ok: true } | { ok: false; reason: string };

export function isOwned(profile: PlayerProfile, item: StoreItem): boolean {
  // Season exclusives are price 0 but must be CLAIMED via the pass — only the
  // free default items are auto-owned.
  if (item.season) return profile.cosmetics.owned.includes(item.id);
  if (item.price === 0) return true;
  if (item.kind === 'clubUpgrade') {
    return (profile.clubUpgrades[item.upgrade!.family] ?? 0) >= item.upgrade!.tier;
  }
  return profile.cosmetics.owned.includes(item.id);
}

export function canBuy(profile: PlayerProfile, item: StoreItem): BuyResult {
  if (item.season) return { ok: false, reason: 'Season Pass exclusive' };
  if (isOwned(profile, item)) return { ok: false, reason: 'Already owned' };
  if (profile.coins < item.price) return { ok: false, reason: 'Not enough coins' };
  if (item.kind === 'clubUpgrade') {
    const have = profile.clubUpgrades[item.upgrade!.family] ?? 0;
    if (item.upgrade!.tier !== have + 1) return { ok: false, reason: 'Buy the previous tier first' };
  }
  return { ok: true };
}

export function buyItem(profile: PlayerProfile, itemId: string): BuyResult {
  const item = STORE_BY_ID.get(itemId);
  if (!item) return { ok: false, reason: 'Unknown item' };
  const check = canBuy(profile, item);
  if (!check.ok) return check;
  profile.coins -= item.price;
  profile.coinsSpent += item.price; // grow-only lifetime tally (drives cloud merge)
  if (item.kind === 'clubUpgrade') {
    profile.clubUpgrades[item.upgrade!.family] = item.upgrade!.tier;
  } else {
    if (!profile.cosmetics.owned.includes(item.id)) profile.cosmetics.owned.push(item.id);
    // Auto-equip a freshly bought tint (ball/trail/outfit/clubskin) so the buy
    // feels immediate.
    if (isEquippableKind(item.kind)) profile.cosmetics.equipped[item.kind as CosmeticKind] = item.id;
  }
  return { ok: true };
}

/** Equip an already-owned cosmetic. */
export function equip(profile: PlayerProfile, itemId: string): BuyResult {
  const item = STORE_BY_ID.get(itemId);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (item.kind === 'clubUpgrade') return { ok: false, reason: 'Not equippable' };
  if (!isOwned(profile, item)) return { ok: false, reason: 'Not owned' };
  if (isEquippableKind(item.kind)) profile.cosmetics.equipped[item.kind as CosmeticKind] = item.id;
  return { ok: true };
}

/** Tint (RGB hex) of an equipped cosmetic slot, falling back to the default. */
export function equippedColor(
  profile: PlayerProfile,
  kind: 'ball' | 'trail' | 'outfit' | 'clubskin',
  fallback: number
): number {
  const id = profile.cosmetics.equipped[kind];
  const item = id ? STORE_BY_ID.get(id) : undefined;
  return item?.color ?? fallback;
}
