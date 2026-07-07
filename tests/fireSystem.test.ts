import { describe, expect, it } from 'vitest';
import { FIRE, SWING } from '../src/config';
import { FireSystem } from '../src/systems/FireSystem';
import { Band, SwingResult } from '../src/core/types';

const swing = (power: Band, accuracy: Band): SwingResult => ({
  power: 1,
  powerQuality: power,
  accuracy: 0,
  accuracyQuality: accuracy
});

describe('FireSystem', () => {
  it('ignites after two consecutive all-perfect swings', () => {
    const f = new FireSystem();
    expect(f.recordSwing(swing('perfect', 'perfect'))).toBe(false);
    expect(f.isOnFire).toBe(false);
    expect(f.recordSwing(swing('perfect', 'perfect'))).toBe(true);
    expect(f.isOnFire).toBe(true);
    expect(f.statBoost).toBe(FIRE.statBoost);
    expect(f.perfectZoneMultiplier).toBe(SWING.firePerfectMult);
  });

  it('a half-perfect swing does not build the streak', () => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'good'));
    f.recordSwing(swing('perfect', 'perfect'));
    expect(f.isOnFire).toBe(false); // streak was only 1
  });

  it('a good swing keeps the fire but a miss puts it out', () => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'perfect'));
    f.recordSwing(swing('perfect', 'perfect'));
    expect(f.isOnFire).toBe(true);

    f.recordSwing(swing('good', 'good'));
    expect(f.isOnFire).toBe(true); // survives a decent swing

    f.recordSwing(swing('miss', 'good'));
    expect(f.isOnFire).toBe(false);
    expect(f.statBoost).toBe(0);
    expect(f.perfectZoneMultiplier).toBe(1);
  });

  it('reset clears everything', () => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'perfect'));
    f.recordSwing(swing('perfect', 'perfect'));
    f.reset();
    expect(f.isOnFire).toBe(false);
    expect(f.currentStreak).toBe(0);
  });
});
