import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeById, StatKey } from '../src/data/archetypes';
import { assembleGolfer } from '../src/data/golfers';
import { CHARACTERS } from '../src/data/characters';

const STAT_KEYS: StatKey[] = ['drivingPower', 'drivingAccuracy', 'approach', 'chipping', 'putting'];
const mean = (s: Record<StatKey, number>): number =>
  STAT_KEYS.reduce((a, k) => a + s[k], 0) / STAT_KEYS.length;

describe('archetypes', () => {
  it('defines the five expected archetypes', () => {
    expect(ARCHETYPES.map((a) => a.id)).toEqual([
      'bigHitter',
      'sniper',
      'ironMaiden',
      'shortGame',
      'puttKing'
    ]);
  });

  it('all archetypes share the same overall rating (87) — distinct but balanced', () => {
    for (const a of ARCHETYPES) {
      expect(Math.round(mean(a.stats))).toBe(87);
    }
  });

  it('each archetype is elite (100) in exactly its signature stat', () => {
    for (const a of ARCHETYPES) {
      expect(a.stats[a.signature]).toBe(100);
      const others = STAT_KEYS.filter((k) => k !== a.signature);
      for (const k of others) {
        expect(a.stats[k]).toBeLessThan(100);
        expect(a.stats[k]).toBeGreaterThanOrEqual(75); // solid-to-good elsewhere
      }
    }
  });

  it('driving power spans ~250→320yd territory (79↔100) across archetypes', () => {
    const powers = ARCHETYPES.map((a) => a.stats.drivingPower);
    expect(Math.min(...powers)).toBeLessThanOrEqual(80);
    expect(Math.max(...powers)).toBe(100);
  });

  it('archetypeById throws on an unknown id', () => {
    expect(() => archetypeById('nope')).toThrow();
  });
});

describe('assembleGolfer', () => {
  it('combines a name, character and archetype into a runtime golfer', () => {
    const g = assembleGolfer('Matt', 'kuro', 'bigHitter');
    expect(g.name).toBe('Matt');
    expect(g.character).toBe('kuro');
    expect(g.stats).toEqual(archetypeById('bigHitter').stats);
    expect(g.color).toBe(archetypeById('bigHitter').color);
  });

  it('falls back to a default name when blank', () => {
    expect(assembleGolfer('   ', CHARACTERS[0].key, 'puttKing').name).toBe('Player');
  });

  it('copies stats so mutating one golfer never affects the archetype', () => {
    const g = assembleGolfer('A', 'rio', 'sniper');
    g.stats.putting = 1;
    expect(archetypeById('sniper').stats.putting).toBe(82);
  });
});
