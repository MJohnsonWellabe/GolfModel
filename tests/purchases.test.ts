import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/profile/Profile';
import { applyEntitlement, Entitlement, PAYMENT_LINKS, purchaseConfigured } from '../src/firebase/Purchases';

describe('applyEntitlement', () => {
  it('coin grants add to balance AND the grow-only earned counter', () => {
    const p = defaultProfile();
    const ok = applyEntitlement(p, { product: 'coins1000', coins: 1000, created: 1 });
    expect(ok).toBe(true);
    expect(p.coins).toBe(1000);
    expect(p.coins).toBe(p.coinsEarned - p.coinsSpent);
  });

  it('season pass grant flips owned once and keeps the first purchase time', () => {
    const p = defaultProfile();
    expect(applyEntitlement(p, { product: 'seasonpass_s1', created: 500 })).toBe(true);
    expect(p.season.owned).toBe(true);
    expect(p.season.purchasedAt).toBe(500);
    // A second (duplicate) pass purchase is consumed but changes nothing
    expect(applyEntitlement(p, { product: 'seasonpass_s1', created: 900 })).toBe(true);
    expect(p.season.purchasedAt).toBe(500);
  });

  it('already-claimed and unrecognized entitlements are not applied', () => {
    const p = defaultProfile();
    expect(applyEntitlement(p, { product: 'coins1000', coins: 1000, claimed: true })).toBe(false);
    expect(p.coins).toBe(0);
    // Unknown product from a future client — left unclaimed, nothing granted
    expect(applyEntitlement(p, { product: 'coins9000_mega' } as Entitlement)).toBe(false);
    expect(p.coins).toBe(0);
    expect(p.season.owned).toBe(false);
  });

  it('purchase UI stays dormant until Payment Links are configured', () => {
    // Ships with empty links — docs/16_PAYMENTS.md is the flip-on runbook.
    expect(purchaseConfigured('coins1000')).toBe(Boolean(PAYMENT_LINKS.coins1000));
    expect(purchaseConfigured('seasonpass_s1')).toBe(Boolean(PAYMENT_LINKS.seasonpass_s1));
  });
});
