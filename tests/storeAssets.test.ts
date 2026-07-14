import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORE_CATALOG } from '../src/data/storeCatalog';
import { characterByKey } from '../src/data/characters';
import { palByKey } from '../src/data/pals';

/**
 * Asset-completeness audit: every store item must have its real, playable
 * asset actually shipped in the repo, not just a catalog entry — a character
 * or pal added to the store ahead of its glb/portrait would let a player
 * unlock a cosmetic that renders broken (or not at all). vite.config.ts sets
 * publicDir: 'assets', so a model's catalog-relative path ('models/…') is
 * this repo's assets/models/… on disk.
 */
const ASSETS_DIR = join(__dirname, '..', 'assets');
const hasAsset = (relPath: string): boolean => existsSync(join(ASSETS_DIR, relPath));

describe('store catalog — every item is actually built', () => {
  it('every character item resolves to a real CharacterDef with a shipped model + portrait', () => {
    const characters = STORE_CATALOG.filter((i) => i.kind === 'character');
    expect(characters.length).toBeGreaterThan(0);
    for (const item of characters) {
      const def = characterByKey(item.character!);
      expect(def, `${item.id}: character key '${item.character}' has no CharacterDef`).toBeTruthy();
      expect(hasAsset(def!.file), `${item.id}: missing model ${def!.file}`).toBe(true);
      expect(
        hasAsset(`ui/characters/${item.character}.png`),
        `${item.id}: missing portrait ui/characters/${item.character}.png`
      ).toBe(true);
    }
  });

  it('every pal item resolves to a real PalDef with a shipped model', () => {
    const pals = STORE_CATALOG.filter((i) => i.kind === 'pal');
    expect(pals.length).toBeGreaterThan(0);
    for (const item of pals) {
      const def = palByKey(item.pal);
      expect(def, `${item.id}: pal key '${item.pal}' has no PalDef`).toBeTruthy();
      expect(hasAsset(def!.file), `${item.id}: missing model ${def!.file}`).toBe(true);
    }
  });

  it('every ball/trail/outfit/clubskin tint carries a real color (the only asset these need)', () => {
    const tinted = STORE_CATALOG.filter((i) =>
      ['ball', 'trail', 'outfit', 'clubskin'].includes(i.kind)
    );
    expect(tinted.length).toBeGreaterThan(0);
    for (const item of tinted) {
      expect(typeof item.color, `${item.id}: no color set`).toBe('number');
    }
  });

  it('every clubUpgrade item specifies a valid family + tier', () => {
    const upgrades = STORE_CATALOG.filter((i) => i.kind === 'clubUpgrade');
    expect(upgrades.length).toBeGreaterThan(0);
    for (const item of upgrades) {
      expect(item.upgrade, `${item.id}: missing upgrade spec`).toBeTruthy();
      expect(['driver', 'irons', 'wedges', 'putter']).toContain(item.upgrade!.family);
      expect([1, 2]).toContain(item.upgrade!.tier);
    }
  });

  it('no catalog item is missing its kind-appropriate identifying field', () => {
    for (const item of STORE_CATALOG) {
      if (item.kind === 'character') expect(item.character, item.id).toBeTruthy();
      if (item.kind === 'pal') expect(item.pal, item.id).toBeTruthy();
      if (item.kind === 'clubUpgrade') expect(item.upgrade, item.id).toBeTruthy();
    }
  });
});
