import { describe, expect, it } from 'vitest';
import {
  FutureStoreItem,
  StoreStagingDraft,
  validateStoreDraft,
  hardErrors,
  defaultDraft,
  newItem,
  duplicateItem,
  reorder,
  normalize,
  STORE_KINDS
} from '../src/admin/storeStaging';

/** A fully-valid item; override any field to craft a bad one. */
const item = (over: Partial<FutureStoreItem> = {}): FutureStoreItem => ({
  id: 'ball-cool',
  name: 'Cool Ball',
  category: 'ball',
  description: 'A very cool ball.',
  price: 100,
  currency: 'coins',
  image: 'marketing/img/feature-fire.png',
  rarity: 'rare',
  availableFrom: '2026-08-01',
  availableTo: '2026-09-01',
  featured: true,
  sortOrder: 0,
  ...over
});

describe('validateStoreDraft', () => {
  it('passes a valid multi-item draft', () => {
    const d: StoreStagingDraft = {
      items: [
        item({ id: 'a', sortOrder: 0 }),
        item({ id: 'b', category: 'pal', currency: 'usd', price: 4.99, rarity: 'special', sortOrder: 1 }),
        item({ id: 'c', category: 'clubUpgrade', rarity: 'common', availableFrom: '', availableTo: '', sortOrder: 2 })
      ]
    };
    expect(validateStoreDraft(d)).toEqual([]);
  });

  it('flags an empty draft', () => {
    expect(validateStoreDraft({ items: [] }).join('\n')).toMatch(/at least one item/i);
  });

  it('flags an empty id', () => {
    const errs = validateStoreDraft({ items: [item({ id: '' })] });
    expect(errs.some((e) => /id is required/i.test(e))).toBe(true);
  });

  it('flags duplicate ids', () => {
    const errs = validateStoreDraft({ items: [item({ id: 'dup', sortOrder: 0 }), item({ id: 'dup', sortOrder: 1 })] });
    expect(errs.some((e) => /duplicate id/i.test(e))).toBe(true);
  });

  it('flags a negative price', () => {
    const errs = validateStoreDraft({ items: [item({ price: -5 })] });
    expect(errs.some((e) => /negative/i.test(e))).toBe(true);
  });

  it('flags a non-finite price', () => {
    const errs = validateStoreDraft({ items: [item({ price: NaN })] });
    expect(errs.some((e) => /price must be a number/i.test(e))).toBe(true);
  });

  it('flags a missing name', () => {
    const errs = validateStoreDraft({ items: [item({ name: '   ' })] });
    expect(errs.some((e) => /name is required/i.test(e))).toBe(true);
  });

  it('flags a bad currency', () => {
    const errs = validateStoreDraft({ items: [item({ currency: 'gems' as unknown as FutureStoreItem['currency'] })] });
    expect(errs.some((e) => /currency must be/i.test(e))).toBe(true);
  });

  it('flags a bad category', () => {
    const errs = validateStoreDraft({ items: [item({ category: 'spaceship' })] });
    expect(errs.some((e) => /not a valid store kind/i.test(e))).toBe(true);
  });

  it('accepts every StoreKind as a category', () => {
    for (const kind of STORE_KINDS) {
      expect(validateStoreDraft({ items: [item({ category: kind })] })).toEqual([]);
    }
  });

  it('flags a bad rarity', () => {
    const errs = validateStoreDraft({ items: [item({ rarity: 'legendary' as unknown as FutureStoreItem['rarity'] })] });
    expect(errs.some((e) => /rarity must be/i.test(e))).toBe(true);
  });

  it('flags a missing image', () => {
    const errs = validateStoreDraft({ items: [item({ image: '' })] });
    expect(errs.some((e) => /image is required/i.test(e))).toBe(true);
  });

  it('flags availableFrom after availableTo', () => {
    const errs = validateStoreDraft({ items: [item({ availableFrom: '2026-09-01', availableTo: '2026-08-01' })] });
    expect(errs.some((e) => /after available-to/i.test(e))).toBe(true);
  });

  it('allows a one-sided availability window', () => {
    expect(validateStoreDraft({ items: [item({ availableFrom: '2026-09-01', availableTo: '' })] })).toEqual([]);
    expect(validateStoreDraft({ items: [item({ availableFrom: '', availableTo: '2026-09-01' })] })).toEqual([]);
  });

  it('flags a non-finite sortOrder', () => {
    const errs = validateStoreDraft({ items: [item({ sortOrder: NaN })] });
    expect(errs.some((e) => /sort order must be a number/i.test(e))).toBe(true);
  });
});

describe('hardErrors', () => {
  it('blocks only on empty/duplicate ids', () => {
    // A negative price is a soft warning, not blocking.
    expect(hardErrors({ items: [item({ price: -5 })] })).toEqual([]);
    expect(hardErrors({ items: [item({ id: '' })] }).length).toBe(1);
    expect(hardErrors({ items: [item({ id: 'x', sortOrder: 0 }), item({ id: 'x', sortOrder: 1 })] }).length).toBe(1);
  });
});

describe('defaultDraft / newItem', () => {
  it('defaultDraft has exactly one item', () => {
    const d = defaultDraft();
    expect(d.items.length).toBe(1);
    expect(d.items[0].sortOrder).toBe(0);
  });

  it('newItem seeds a valid category, currency, and rarity', () => {
    const it = newItem(3);
    expect(it.sortOrder).toBe(3);
    expect(STORE_KINDS.includes(it.category as (typeof STORE_KINDS)[number])).toBe(true);
    expect(it.currency).toBe('coins');
    expect(it.rarity).toBe('common');
  });
});

describe('duplicateItem', () => {
  it('deep-copies with a -copy id and no shared references', () => {
    const src = item({ id: 'orig' });
    const copy = duplicateItem(src);
    expect(copy.id).toBe('orig-copy');
    expect(copy).not.toBe(src);
    copy.name = 'Changed';
    expect(src.name).toBe('Cool Ball'); // original untouched
  });

  it('handles an empty source id', () => {
    expect(duplicateItem(item({ id: '' })).id).toBe('item-copy');
  });
});

describe('reorder', () => {
  it('swaps neighbours and re-bases sortOrder to array position', () => {
    const items = [item({ id: 'a', sortOrder: 0 }), item({ id: 'b', sortOrder: 1 }), item({ id: 'c', sortOrder: 2 })];
    reorder(items, 0, 1); // a down
    expect(items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it('moves up', () => {
    const items = [item({ id: 'a', sortOrder: 0 }), item({ id: 'b', sortOrder: 1 })];
    reorder(items, 1, -1);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it('is a no-op at the ends', () => {
    const items = [item({ id: 'a', sortOrder: 0 }), item({ id: 'b', sortOrder: 1 })];
    reorder(items, 0, -1);
    reorder(items, 1, 1);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('normalize', () => {
  it('sorts by sortOrder and re-bases to 0..n-1', () => {
    const d: StoreStagingDraft = {
      items: [item({ id: 'a', sortOrder: 5 }), item({ id: 'b', sortOrder: 2 }), item({ id: 'c', sortOrder: 9 })]
    };
    const out = normalize(d);
    expect(out.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(out.items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it('coerces malformed fields to safe defaults', () => {
    const raw = {
      items: [
        {
          id: 5,
          name: null,
          category: 'nonsense',
          description: undefined,
          price: 'abc',
          currency: 'gems',
          image: 42,
          rarity: 'legendary',
          featured: 'yes',
          sortOrder: 'x'
        }
      ]
    } as unknown as StoreStagingDraft;
    const out = normalize(raw);
    const it = out.items[0];
    expect(it.id).toBe('');
    expect(it.name).toBe('');
    expect(it.category).toBe(STORE_KINDS[0]);
    expect(it.description).toBe('');
    expect(it.price).toBe(0);
    expect(it.currency).toBe('coins');
    expect(it.image).toBe('');
    expect(it.rarity).toBe('common');
    expect(it.featured).toBe(true); // 'yes' is truthy
    expect(it.sortOrder).toBe(0);
  });

  it('handles a null/empty draft', () => {
    expect(normalize(null).items).toEqual([]);
    expect(normalize(undefined).items).toEqual([]);
    expect(normalize({ items: [] }).items).toEqual([]);
  });

  it('is idempotent on a clean draft', () => {
    const d = normalize({ items: [item({ id: 'a', sortOrder: 0 }), item({ id: 'b', sortOrder: 1 })] });
    expect(normalize(d)).toEqual(d);
  });

  it('a normalized default draft validates clean once given a name', () => {
    const d = defaultDraft();
    d.items[0].name = 'Named';
    expect(validateStoreDraft(normalize(d))).toEqual([]);
  });
});
