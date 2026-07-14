import { describe, expect, it } from 'vitest';
import {
  chargesRemaining,
  consumeCharge,
  defaultProfile,
  grantConsumable,
  mergeProfiles,
  PerkState
} from '../src/profile/Profile';
import { consumableById, TRUE_VISION } from '../src/data/consumables';

describe('consumable definitions', () => {
  it('True Vision resolves by id', () => {
    expect(consumableById('true_vision')).toBe(TRUE_VISION);
    expect(consumableById('nope')).toBeUndefined();
  });
});

describe('consumable inventory (profile)', () => {
  it('grants stack charges and remaining = granted − used', () => {
    const p = defaultProfile();
    expect(chargesRemaining(p, TRUE_VISION.id)).toBe(0);
    grantConsumable(p, TRUE_VISION.id, 3);
    expect(chargesRemaining(p, TRUE_VISION.id)).toBe(3);
    grantConsumable(p, TRUE_VISION.id, 3); // a second grant stacks
    expect(chargesRemaining(p, TRUE_VISION.id)).toBe(6);
  });

  it('consumeCharge spends one charge and returns false once exhausted', () => {
    const p = defaultProfile();
    grantConsumable(p, TRUE_VISION.id, 2);
    expect(consumeCharge(p, TRUE_VISION.id)).toBe(true);
    expect(chargesRemaining(p, TRUE_VISION.id)).toBe(1);
    expect(consumeCharge(p, TRUE_VISION.id)).toBe(true);
    expect(chargesRemaining(p, TRUE_VISION.id)).toBe(0);
    expect(consumeCharge(p, TRUE_VISION.id)).toBe(false); // none left
    expect(chargesRemaining(p, TRUE_VISION.id)).toBe(0); // unchanged by the no-op
  });

  it('consumeCharge on an ungranted consumable is a no-op', () => {
    const p = defaultProfile();
    expect(consumeCharge(p, TRUE_VISION.id)).toBe(false);
  });

  it('merge unions consumables and takes the max grow-only counters (no resurrection)', () => {
    const a = defaultProfile();
    const b = defaultProfile();
    a.consumables = [{ id: TRUE_VISION.id, granted: 6, used: 4 }];
    b.consumables = [{ id: TRUE_VISION.id, granted: 6, used: 1 }]; // fewer used on this device
    const m = mergeProfiles(a, b);
    const entry = m.consumables.find((x: PerkState) => x.id === TRUE_VISION.id)!;
    expect(entry.used).toBe(4); // the more-consumed value wins
    expect(chargesRemaining(m, TRUE_VISION.id)).toBe(2);
  });

  it('a separate consumables[] array never leaks into perks[]', () => {
    const p = defaultProfile();
    grantConsumable(p, TRUE_VISION.id, 3);
    expect(p.perks.find((x) => x.id === TRUE_VISION.id)).toBeUndefined();
  });
});
