import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PUTT_RULE, WIND_RULE } from '../../src/slice3d/tutorial';
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

/**
 * The extended lesson (`tutorialDepth`) teaches wind, which is the input a new
 * player is most likely to mistake for randomness. Same standard as the putting
 * rule: the copy has to describe what the game actually does — the HUD arrow is
 * drawn RELATIVE to the aim (HoleScene.updateHud rotates it by
 * wind.angle - aim.yaw), the number is a speed, and nothing corrects for it.
 */
describe('tutorial wind lesson', () => {
  it('points the player at the HUD wind chip', () => {
    expect(WIND_RULE.toLowerCase()).toContain('wind');
    expect(WIND_RULE.toLowerCase()).toMatch(/arrow/);
  });

  it('explains the arrow is relative to the aim, not the compass', () => {
    expect(WIND_RULE.toLowerCase()).toContain('relative to your aim');
  });

  it('is honest that nothing auto-corrects for wind', () => {
    expect(WIND_RULE.toLowerCase()).toMatch(/nothing here corrects|but you/);
  });

  it('wind is a real force in the physics the lesson describes', () => {
    expect(typeof PHYSICS.maxWind).toBe('number');
    expect(PHYSICS.maxWind).toBeGreaterThan(0);
  });
});

/**
 * Length is a feature.
 *
 * The owner's report was that the tutorial messages are too long AND that they
 * cover the HUD element they are explaining — a card long enough to need four
 * lines is a card big enough to sit on the thing it points at. Cutting the copy
 * is half the fix; keeping it cut is this.
 */
describe('tutorial copy stays short enough to read at a glance', () => {
  /** A phone reads roughly this much without the card becoming a wall. */
  const MAX_BODY = 130;

  it('every shared rule fits', () => {
    expect(PUTT_RULE.length, `PUTT_RULE is ${PUTT_RULE.length} chars`).toBeLessThanOrEqual(170);
    expect(WIND_RULE.length, `WIND_RULE is ${WIND_RULE.length} chars`).toBeLessThanOrEqual(170);
  });

  it('every card body in the source fits', () => {
    // Read the bodies out of the module source: they are inline in the card
    // definitions, and a test that only checked the two exported rules would
    // miss the ten that are not exported.
    const src = readFileSync('src/slice3d/tutorial.ts', 'utf8');
    const bodies = [...src.matchAll(/body:\s*((?:'[^']*'(?:\s*\+\s*)?)+)/g)].map((m) =>
      m[1]
        .split('+')
        .map((part) => part.trim().replace(/^'|'$/g, ''))
        .join('')
    );
    expect(bodies.length, 'no tutorial bodies found — the matcher has drifted').toBeGreaterThan(6);
    const long = bodies.filter((b) => b.length > MAX_BODY);
    expect(long, `these tutorial bodies are too long:\n${long.map((b) => `  ${b.length}: ${b}`).join('\n')}`).toEqual(
      []
    );
  });
});
