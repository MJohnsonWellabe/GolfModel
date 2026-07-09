import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { buildHeightField } from '../../src/systems/HeightField';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, NO_WIND, PERFECT_SWING } from './simHelpers';
import type { HoleData } from '../../src/core/types';
import wildwood from '../../src/data/courses/wildwood.json';

/**
 * Green break must be LIVE: production greens are flat plateaus in the
 * heightfield, so the authored `hole.slope` is what curves a putt. A straight,
 * dead-pace putt on a sloped green should drift off line and miss; on a flat
 * green the identical putt drops. (Regression: break used to be dead on every
 * elevation hole — putting felt like pure RNG.)
 */
const hole = wildwood.holes[0] as unknown as HoleData;
const putter = clubById('putter');
const golfer = golferWith(85);
const CARRY_PX = putter.baseDistance * (0.259 + 0.85 * 0.926) * 2;

function puttStraightAtPin(engine: PhysicsEngine) {
  const distPx = 20 / 1.5; // a 20ft putt (1px = 1.5ft)
  const origin = { x: hole.pin.x, y: hole.pin.y + distPx };
  const aim = Math.atan2(hole.pin.y - origin.y, hole.pin.x - origin.x); // dead straight at the cup
  return engine.simulate({
    origin,
    aimAngle: aim,
    swing: PERFECT_SWING(distPx / CARRY_PX),
    club: putter,
    golfer,
    fireBoost: 0,
    lie: 'green',
    wind: NO_WIND,
    hole
  });
}

describe('green break is live', () => {
  it('a straight putt on a sloped green drifts off line (break matters)', () => {
    expect(hole.slope.strength).toBeGreaterThan(0);
    const out = puttStraightAtPin(new PhysicsEngine(hole, buildHeightField(hole), mulberry32(1)));
    const lateral = Math.abs(out.finalPos.x - hole.pin.x);
    expect(lateral).toBeGreaterThan(0.15); // deflected — reading the break is required
  });

  it('the identical putt on a FLATTENED green rolls dead straight and drops', () => {
    const flatHole = { ...hole, slope: { angle: 0, strength: 0 } } as HoleData;
    const out = puttStraightAtPin(new PhysicsEngine(flatHole, null, mulberry32(1)));
    expect(Math.abs(out.finalPos.x - flatHole.pin.x)).toBeLessThan(0.05);
    expect(out.holed).toBe(true);
  });
});
