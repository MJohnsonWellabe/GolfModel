import { describe, expect, it } from 'vitest';
import { deliveredPower, SwingCtx } from '../src/systems/swingModel';
import { SWING } from '../src/config';

/**
 * Guards the driver overpower fix. The live game passes the driver's overswing
 * coefficient (SWING.driverOverswingBonus, negative = a penalty) for the driver
 * behind the `driverOverswingNerf` flag; the pure model must honor it while
 * leaving every other outcome — and the shipped default — untouched.
 */
const fullShot = (overswingBonus?: number): SwingCtx => ({
  stat: 80,
  powerTarget: 1,
  isPutt: false,
  overswingBonus
});

describe('driver overswing penalty', () => {
  const target = SWING.fullPowerMark; // bar target for a full-power shot
  const topOfBar = 1.0; // cursor stopped at the very top = max overswing

  it('the driver coefficient is a PENALTY (negative), not a bonus', () => {
    expect(SWING.driverOverswingBonus).toBeLessThan(0);
  });

  it('by default an overswing ADDS power past the target (every other club)', () => {
    expect(deliveredPower(fullShot(), topOfBar, 'miss')).toBeGreaterThan(1);
  });

  it('an overhit drive flies SHORTER than a flush strike, and shorter the more you overswing', () => {
    const perfect = deliveredPower(fullShot(SWING.driverOverswingBonus), target, 'perfect'); // == 1
    const maxOver = deliveredPower(fullShot(SWING.driverOverswingBonus), topOfBar, 'miss');
    const smallOver = deliveredPower(fullShot(SWING.driverOverswingBonus), (target + topOfBar) / 2, 'miss');
    expect(maxOver).toBeLessThan(perfect); // overhit < perfect
    expect(maxOver).toBeLessThan(smallOver); // more overswing = less distance
    expect(smallOver).toBeLessThan(perfect);
    // ...and unambiguously shorter than the un-nerfed (bonus) overswing.
    expect(maxOver).toBeLessThan(deliveredPower(fullShot(), topOfBar, 'miss'));
  });

  it('does not touch a perfect strike (still exactly the target)', () => {
    expect(deliveredPower(fullShot(SWING.driverOverswingBonus), target, 'perfect')).toBe(1);
  });

  it('does not touch a SHORT swing (the coefficient only applies past the target)', () => {
    const shortCursor = target * 0.6;
    expect(deliveredPower(fullShot(SWING.driverOverswingBonus), shortCursor, 'miss')).toBe(
      deliveredPower(fullShot(), shortCursor, 'miss')
    );
  });
});
