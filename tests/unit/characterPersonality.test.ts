import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/data/characters';
import {
  CHARACTER_PERSONALITY,
  clampPersonality,
  NEUTRAL_PERSONALITY,
  PERSONALITY_ARCHETYPES,
  PERSONALITY_LIMITS,
  personalityFor
} from '../../src/data/characterPersonality';

describe('character personality data', () => {
  it('maps every roster character to an archetype', () => {
    for (const c of CHARACTERS) {
      const arche = CHARACTER_PERSONALITY[c.key];
      expect(arche, `character "${c.key}" has no personality mapping`).toBeTruthy();
      expect(PERSONALITY_ARCHETYPES[arche]).toBeTruthy();
    }
  });

  it('keeps every archetype inside the documented safe ranges', () => {
    for (const [name, p] of Object.entries(PERSONALITY_ARCHETYPES)) {
      for (const [key, [lo, hi]] of Object.entries(PERSONALITY_LIMITS)) {
        const v = p[key as keyof typeof PERSONALITY_LIMITS];
        expect(v, `${name}.${key}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${name}.${key}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('reaction hold can never outlast the 2.4s post-hole window', () => {
    for (const p of Object.values(PERSONALITY_ARCHETYPES)) {
      expect(p.reactionHold).toBeLessThanOrEqual(2.0);
    }
    // Even hostile data is clamped back inside the window.
    expect(clampPersonality({ ...NEUTRAL_PERSONALITY, reactionHold: 99 }).reactionHold).toBe(2.0);
  });

  it('steady archetype IS the neutral (V1) behavior', () => {
    expect(PERSONALITY_ARCHETYPES.steady).toEqual(NEUTRAL_PERSONALITY);
  });

  it('unknown or missing character keys fall back to neutral', () => {
    expect(personalityFor(undefined)).toEqual(NEUTRAL_PERSONALITY);
    expect(personalityFor('not-a-character')).toEqual(NEUTRAL_PERSONALITY);
  });

  it('personalityFor returns clamped archetype params for a mapped key', () => {
    expect(personalityFor('dez')).toEqual(clampPersonality(PERSONALITY_ARCHETYPES.showman));
    expect(personalityFor('kuro').epicClip).toBe('win'); // the Cool Customer gag
    expect(personalityFor('chip').hopRate).toBeGreaterThan(1); // rookie triple hop
  });
});
