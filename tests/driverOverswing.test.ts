import { describe, expect, it } from 'vitest';
import { deliveredPower, SwingCtx } from '../src/systems/swingModel';
import { SWING } from '../src/config';

/**
 * Guards the dev-gated driver overpower fix. The live game passes a lower
 * `overswingBonus` for the driver (SWING.driverOverswingBonus) behind the
 * `driverOverswingNerf` flag; the pure model must honor it while leaving every
 * other outcome — and the shipped default — untouched.
 */
const fullShot = (overswingBonus?: number): SwingCtx => ({
  stat: 80,
  powerTarget: 1,
  isPutt: false,
  overswingBonus
});

describe('driver overswing nerf', () => {
  const target = SWING.fullPowerMark; // bar target for a full-power shot
  const topOfBar = 1.0; // cursor stopped at the very top = max overswing

  it('by default an overswing ADDS power past the target (shipped behavior)', () => {
    expect(deliveredPower(fullShot(), topOfBar, 'miss')).toBeGreaterThan(1);
  });

  it('with the driver bonus (0) an overswing delivers only the target — no runaway distance', () => {
    const nerfed = deliveredPower(fullShot(SWING.driverOverswingBonus), topOfBar, 'miss');
    expect(nerfed).toBeCloseTo(1, 5);
    expect(nerfed).toBeLessThan(deliveredPower(fullShot(), topOfBar, 'miss'));
  });

  it('does not touch a perfect strike (still exactly the target)', () => {
    expect(deliveredPower(fullShot(SWING.driverOverswingBonus), target, 'perfect')).toBe(1);
  });

  it('does not touch a SHORT swing (bonus only ever applies past the target)', () => {
    const shortCursor = target * 0.6;
    expect(deliveredPower(fullShot(SWING.driverOverswingBonus), shortCursor, 'miss')).toBe(
      deliveredPower(fullShot(), shortCursor, 'miss')
    );
  });
});
