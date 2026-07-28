import { describe, expect, it } from 'vitest';
import { SWING } from '../src/config';
import { FireSystem } from '../src/systems/FireSystem';
import { assembleGolfer } from '../src/data/golfers';
import { clubById } from '../src/data/clubs';
import { effectiveCarryYards, statsForClub } from '../src/systems/PhysicsEngine';
import { goodHalf, perfectHalf } from '../src/systems/swingModel';
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
    expect(f.perfectZoneMultiplier).toBe(SWING.firePerfectMult);
  });

  it('a half-perfect swing does not build the streak', () => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'good'));
    f.recordSwing(swing('perfect', 'perfect'));
    expect(f.isOnFire).toBe(false); // streak was only 1
  });

  it('only an all-perfect swing keeps the fire; a good swing puts it out', () => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'perfect'));
    f.recordSwing(swing('perfect', 'perfect'));
    expect(f.isOnFire).toBe(true);

    // A merely "good" band on EITHER click ends the fire now (owner: fire is
    // only for a flawless run, not a decent one).
    f.recordSwing(swing('good', 'good'));
    expect(f.isOnFire).toBe(false);
    expect(f.currentStreak).toBe(0);

    // Re-ignite, then a one-perfect/one-good swing also ends it.
    f.recordSwing(swing('perfect', 'perfect'));
    f.recordSwing(swing('perfect', 'perfect'));
    expect(f.isOnFire).toBe(true);
    f.recordSwing(swing('perfect', 'good'));
    expect(f.isOnFire).toBe(false);

    f.recordSwing(swing('miss', 'good'));
    expect(f.isOnFire).toBe(false);
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

  it('snapshot/restore carries the streak across a hole change', () => {
    // Simulate a hole change: the old FireSystem is disposed with the HoleScene;
    // its snapshot is restored onto the fresh FireSystem built for the next hole.
    const h1 = new FireSystem();
    h1.recordSwing(swing('perfect', 'perfect'));
    h1.recordSwing(swing('perfect', 'perfect'));
    expect(h1.isOnFire).toBe(true);
    const carried = h1.snapshot();

    const h2 = new FireSystem();
    expect(h2.isOnFire).toBe(false); // a brand-new hole starts cold...
    h2.restore(carried); // ...until the round's carried streak is restored
    expect(h2.isOnFire).toBe(true);
    expect(h2.currentStreak).toBe(h1.currentStreak);

    // The carried streak survives an all-perfect swing on the new hole...
    h2.recordSwing(swing('perfect', 'perfect'));
    expect(h2.isOnFire).toBe(true);
    // ...but a less-than-perfect swing on the new hole ends it.
    h2.recordSwing(swing('good', 'good'));
    expect(h2.isOnFire).toBe(false);
  });

  it('restore(undefined) is a no-op (first hole of a round)', () => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'perfect'));
    f.restore(undefined);
    expect(f.currentStreak).toBe(1);
  });
});

/**
 * Fire's WHOLE effect, pinned.
 *
 * Owner: "the fire streak that boosts your stats should only change the perfect
 * zone... we don't also need it to increase distance, reduce dispersion, etc."
 * The stat boost is gone, so there is no longer any input by which fire could
 * reach the physics — these assert that structurally rather than by tuning.
 */
describe('fire only ever changes the swing zones', () => {
  const golfer = assembleGolfer('Test', 'chip', 'ironMaiden');
  const lit = (): FireSystem => {
    const f = new FireSystem();
    f.recordSwing(swing('perfect', 'perfect'));
    f.recordSwing(swing('perfect', 'perfect'));
    return f;
  };

  it('widens the perfect AND good bands by the fire multiplier', () => {
    const base = { stat: 80, powerTarget: 0.8, isPutt: false };
    const cold = { ...base, perfectMult: 1 };
    const hot = { ...base, perfectMult: lit().perfectZoneMultiplier };
    expect(perfectHalf(hot) / perfectHalf(cold)).toBeCloseTo(SWING.firePerfectMult, 10);
    expect(goodHalf(hot) / goodHalf(cold)).toBeCloseTo(SWING.firePerfectMult, 10);
  });

  it('leaves carry, dispersion and the governing stats alone', () => {
    // There is no fire input to these any more — the test is that the API
    // itself offers none, so a future change cannot quietly re-add one.
    for (const club of ['driver', '7i', 'sw', 'putter'].map((id) => clubById(id))) {
      const stats = statsForClub(club, golfer);
      expect(stats.distance).toBe(Math.min(100, golfer.stats.drivingPower));
      expect(stats.dispersion).toBe(Math.min(100, golfer.stats.drivingAccuracy));
      // Same call, on fire or not — carry is a function of (club, golfer, lie).
      expect(effectiveCarryYards(club, golfer, 'fairway')).toBe(
        effectiveCarryYards(club, golfer, 'fairway')
      );
    }
  });
});
