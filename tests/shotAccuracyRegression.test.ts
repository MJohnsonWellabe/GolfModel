import { describe, expect, it } from 'vitest';
import { normalizedAccuracyOffset } from '../src/slice3d/meter3d';

const TARGET = 0.08;

describe('shot accuracy timing normalization', () => {
  it('scales continuously as timing gets worse instead of cliffing at the good/miss edge', () => {
    const perfect = Math.abs(normalizedAccuracyOffset(TARGET));
    const tiny = Math.abs(normalizedAccuracyOffset(TARGET + 0.012));
    const small = Math.abs(normalizedAccuracyOffset(TARGET + 0.04));
    const moderate = Math.abs(normalizedAccuracyOffset(TARGET + 0.10));
    const large = Math.abs(normalizedAccuracyOffset(TARGET + 0.35));
    const terrible = Math.abs(normalizedAccuracyOffset(1));

    expect(perfect).toBe(0);
    expect(tiny).toBeLessThan(small);
    expect(small).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(large);
    expect(large).toBeLessThan(terrible);
    expect(tiny, 'a tiny miss should remain a tiny directional input').toBeLessThan(0.02);
    expect(moderate, 'just outside the old good-band edge must not jump to a severe hook/slice').toBeLessThan(0.12);
  });
});
