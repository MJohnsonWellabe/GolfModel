import { describe, expect, it } from 'vitest';
import { PUTT_RULE } from '../../src/slice3d/tutorial';
import { PHYSICS } from '../../src/config';

/**
 * The tutorial must teach the REAL putting rule, not a plausible-sounding wrong
 * one. config.ts encodes the owner law "2 inches of uphill = 1 foot long"
 * (puttSlopePaceBoost), verified holing out in tests/simulation/putting.test.ts.
 * Lock the coach copy to those facts so a future reword can't quietly ship a
 * misleading ratio.
 */
describe('tutorial putting lesson', () => {
  it('states the 6:1 pace rule in the owner’s own terms', () => {
    expect(PUTT_RULE).toContain('1 foot');
    expect(PUTT_RULE).toContain('2 inches');
    expect(PUTT_RULE).toMatch(/6[- ]to[- ]1/);
  });

  it('teaches that the rule is symmetric downhill', () => {
    expect(PUTT_RULE.toLowerCase()).toContain('downhill');
  });

  it('warns the aim line does not compensate (the read is the player’s job)', () => {
    expect(PUTT_RULE.toLowerCase()).toMatch(/aim line does not|does not add/);
  });

  it('the encoded pace boost still exists (guards the taught rule’s premise)', () => {
    // If this constant is ever removed/renamed, the "6:1" the copy promises no
    // longer holds and this test flags that the lesson needs revisiting.
    expect(typeof PHYSICS.puttSlopePaceBoost).toBe('number');
    expect(PHYSICS.puttSlopePaceBoost).toBeGreaterThan(0);
  });
});
