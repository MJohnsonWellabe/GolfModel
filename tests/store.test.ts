import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/profile/Profile';
import { STORE_CATALOG, STORE_BY_ID, applyClubUpgrades, DEFAULT_OWNED } from '../src/data/storeCatalog';
import { buyItem, canBuy, equip, equippedColor, isOwned } from '../src/systems/StoreEngine';
import { assembleGolfer } from '../src/data/golfers';

describe('store catalog', () => {
  it('ships at least 25 purchasable items with unique ids', () => {
    const purchasable = STORE_CATALOG.filter((i) => i.price > 0);
    expect(purchasable.length).toBeGreaterThanOrEqual(25);
    expect(new Set(STORE_CATALOG.map((i) => i.id)).size).toBe(STORE_CATALOG.length);
  });
  it('default-owned items exist in the catalog', () => {
    for (const id of DEFAULT_OWNED) expect(STORE_BY_ID.has(id) || id.startsWith('char_')).toBe(true);
  });
});

describe('purchases', () => {
  it('deducts coins and grants the item, once', () => {
    const p = defaultProfile();
    p.coins = 250;
    const item = STORE_CATALOG.find((i) => i.id === 'ball_red')!;
    expect(buyItem(p, 'ball_red').ok).toBe(true);
    expect(p.coins).toBe(150);
    expect(isOwned(p, item)).toBe(true);
    // Buying again is rejected and doesn't change coins
    const again = buyItem(p, 'ball_red');
    expect(again.ok).toBe(false);
    expect(p.coins).toBe(150);
  });

  it('rejects a purchase with insufficient coins (coins never go negative)', () => {
    const p = defaultProfile();
    p.coins = 50;
    const r = buyItem(p, 'ball_gold'); // 300
    expect(r.ok).toBe(false);
    expect(p.coins).toBe(50);
  });

  it('buying a ball auto-equips it', () => {
    const p = defaultProfile();
    p.coins = 100;
    buyItem(p, 'ball_blue');
    expect(p.cosmetics.equipped.ball).toBe('ball_blue');
    expect(equippedColor(p, 'ball', 0)).toBe(STORE_BY_ID.get('ball_blue')!.color);
  });

  it('club upgrades must be bought in tier order and lift the right stat', () => {
    const p = defaultProfile();
    p.coins = 5000;
    // Tier 2 before tier 1 is rejected
    expect(canBuy(p, STORE_BY_ID.get('up_driver_2')!).ok).toBe(false);
    expect(buyItem(p, 'up_driver_1').ok).toBe(true);
    expect(buyItem(p, 'up_driver_2').ok).toBe(true);
    expect(p.clubUpgrades.driver).toBe(2);
    // +6 driving power/accuracy vs the base archetype
    const base = assembleGolfer('A', 'chip', 'bigHitter');
    const upgraded = assembleGolfer('A', 'chip', 'bigHitter', p.clubUpgrades);
    expect(upgraded.stats.drivingPower).toBe(Math.min(100, base.stats.drivingPower + 6));
    expect(upgraded.stats.drivingAccuracy).toBe(Math.min(100, base.stats.drivingAccuracy + 6));
  });

  it('equipping requires ownership', () => {
    const p = defaultProfile();
    expect(equip(p, 'trail_fire').ok).toBe(false); // not owned
    expect(equip(p, 'trail_white').ok).toBe(true); // default-owned
  });
});

describe('applyClubUpgrades', () => {
  it('caps stats at 100', () => {
    const stats = { drivingPower: 99, drivingAccuracy: 50, approach: 50, chipping: 50, putting: 50 };
    const out = applyClubUpgrades(stats, { driver: 2 });
    expect(out.drivingPower).toBe(100);
  });
});
