import { describe, expect, it } from 'vitest';
import { PALS, palByKey } from '../src/data/pals';
import { STORE_CATALOG } from '../src/data/storeCatalog';

describe('pals data', () => {
  it('keys are unique and files follow models/pals/<key>.glb', () => {
    expect(new Set(PALS.map((p) => p.key)).size).toBe(PALS.length);
    for (const p of PALS) {
      expect(p.file).toBe(`models/pals/${p.key}.glb`);
      expect(p.file.startsWith('/')).toBe(false); // GH Pages subpath needs relative urls
      expect(p.targetHeight).toBeGreaterThan(0);
    }
  });

  it('every pal has exactly one catalog item and vice-versa', () => {
    const items = STORE_CATALOG.filter((i) => i.kind === 'pal');
    expect(items.length).toBe(PALS.length);
    for (const item of items) {
      expect(item.id).toBe(`pal_${item.pal}`);
      expect(palByKey(item.pal)).toBeDefined();
    }
  });

  it('palByKey resolves known keys and rejects junk', () => {
    expect(palByKey('fox')?.name).toBe('Foxy');
    expect(palByKey('dragon')?.name).toBe('Ember');
    expect(palByKey('unicorn')).toBeUndefined();
    expect(palByKey(undefined)).toBeUndefined();
  });
});
