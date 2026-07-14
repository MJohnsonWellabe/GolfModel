import { describe, expect, it } from 'vitest';
import { AimControl, ShotContext } from '../src/core/input/AimControl';
import { PhysicsEngine } from '../src/systems/PhysicsEngine';
import { SWING } from '../src/config';
import { CHIP_GRID_YDS } from '../src/core/puttAids';
import { angleTo } from '../src/utils/Geometry';
import { golferWith, NO_WIND, openHole } from './simulation/simHelpers';

/**
 * Chip mode (sand wedge inside CHIP_GRID_YDS of the pin): the swing works
 * like a putt — the aim distance itself is the full-power target, instead of
 * a fraction of the club's max carry — so "however far you're aimed is the
 * full power bar." Outside chip range, or with any other club, the sand
 * wedge plays a normal full shot.
 */

const hole = openHole({ pin: { x: 1000, y: 300 } });
const engine = new PhysicsEngine(hole);
const golfer = golferWith(80);

function ctxAt(distYds: number, overrides: Partial<ShotContext> = {}): ShotContext {
  return {
    ball: { x: 1000, y: 300 + distYds * 2 }, // PX_PER_YARD = 2, straight below the pin
    lie: 'fairway',
    golfer,
    fireBoost: 0,
    strokes: 1,
    ...overrides
  };
}

describe('isChipping', () => {
  it('is true for the sand wedge within CHIP_GRID_YDS of the pin', () => {
    const aim = new AimControl(hole, engine);
    aim.setClubById('sw');
    expect(aim.isChipping(ctxAt(20))).toBe(true);
    expect(aim.isChipping(ctxAt(CHIP_GRID_YDS))).toBe(true); // boundary, inclusive
  });

  it('is false past the chip range (normal full sand-wedge shot)', () => {
    const aim = new AimControl(hole, engine);
    aim.setClubById('sw');
    expect(aim.isChipping(ctxAt(CHIP_GRID_YDS + 1))).toBe(false);
  });

  it('is false for any other club, even at chip-range distances', () => {
    const aim = new AimControl(hole, engine);
    for (const id of ['pw', '9i', '7i', 'putter']) {
      aim.setClubById(id);
      expect(aim.isChipping(ctxAt(20)), id).toBe(false);
    }
  });
});

describe('chip aim/power mechanic mirrors putting', () => {
  it('resetAim defaults the aim spot AT the pin, like a putt', () => {
    const aim = new AimControl(hole, engine);
    aim.setClubById('sw');
    const ctx = ctxAt(35);
    aim.resetAim(ctx);
    expect(aim.yaw).toBeCloseTo(angleTo(ctx.ball, hole.pin), 5);
    const aimed = aim.aimPoint(ctx.ball);
    expect(aimed.x).toBeCloseTo(hole.pin.x, 1);
    expect(aimed.y).toBeCloseTo(hole.pin.y, 1);
  });

  it('the bar power target is fixed at fullPowerMark, exactly like a putt', () => {
    const aim = new AimControl(hole, engine);
    aim.setClubById('sw');
    const ctx = ctxAt(35);
    aim.resetAim(ctx);
    expect(aim.barPowerTarget(ctx)).toBeCloseTo(SWING.fullPowerMark, 5);
  });

  it('meterScalePx tracks the aim distance, not the club max carry', () => {
    const aim = new AimControl(hole, engine);
    aim.setClubById('sw');
    const near = ctxAt(15);
    aim.resetAim(near);
    const nearDistPx = aim.distPx;
    const scaleNear = aim.meterScalePx(near);
    expect(scaleNear).toBeCloseTo(nearDistPx / SWING.fullPowerMark, 5);
    const far = ctxAt(40);
    aim.resetAim(far);
    const scaleFar = aim.meterScalePx(far);
    expect(scaleFar).toBeGreaterThan(scaleNear);
    expect(scaleFar).toBeCloseTo(aim.distPx / SWING.fullPowerMark, 5);
  });

  it('a normal full shot (outside chip range) is NOT distance-aimed: power target varies with % of max carry, not fixed', () => {
    const aim = new AimControl(hole, engine);
    aim.setClubById('sw');
    const ctx = ctxAt(70); // beyond CHIP_GRID_YDS, still within the SW's carry
    aim.resetAim(ctx);
    expect(aim.isChipping(ctx)).toBe(false);
    expect(aim.barPowerTarget(ctx)).not.toBeCloseTo(SWING.fullPowerMark, 2);
  });
});

describe('a perfect chip swing carries to the aimed distance (end-to-end)', () => {
  // Mirrors updateAimVisuals' own landing-point detection: the first path
  // sample where the ball returns to ground height (z<=0.01) after leaving it.
  function carryDistPx(path: { x: number; y: number; z: number }[], origin: { x: number; y: number }): number {
    let landIdx = path.findIndex((p, i) => i > 0 && p.z <= 0.01);
    if (landIdx < 0) landIdx = path.length - 1;
    const p = path[landIdx];
    return Math.hypot(p.x - origin.x, p.y - origin.y);
  }

  it('carries ~= the aim distance for a range of chip lengths', () => {
    for (const yds of [10, 25, 45]) {
      const aim = new AimControl(hole, engine);
      aim.setClubById('sw');
      const ctx = ctxAt(yds);
      aim.resetAim(ctx);
      expect(aim.isChipping(ctx)).toBe(true);
      const power = aim.barToPhysicsPower(aim.barPowerTarget(ctx), ctx);
      const out = engine.simulate({
        origin: ctx.ball,
        aimAngle: aim.yaw,
        swing: { power, powerQuality: 'perfect', accuracy: 0, accuracyQuality: 'perfect' },
        club: aim.club,
        golfer,
        fireBoost: 0,
        lie: ctx.lie,
        wind: NO_WIND,
        hole,
        preview: true
      });
      const carryPx = carryDistPx(out.path, ctx.ball);
      const aimedPx = yds * 2; // PX_PER_YARD
      // Within ~10% of the aimed distance — a real flight arc, not an exact
      // roll-to-target like a putt, but the carry should land close to the pin.
      expect(Math.abs(carryPx - aimedPx) / aimedPx, `${yds}yd chip`).toBeLessThan(0.1);
    }
  });
});
