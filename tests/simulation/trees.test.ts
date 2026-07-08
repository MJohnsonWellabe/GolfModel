import { describe, expect, it } from 'vitest';
import { PX_PER_YARD } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, NO_WIND, openHole, SWING_OF } from './simHelpers';

/**
 * Phase 9 (playtest feedback): a tree in the fairway must actually stop or
 * slow a ball that strikes it — not let it sail through. A broad stand of
 * trees sits across the driver landing zone so the descending ball hits the
 * canopy; the identical shot on an open hole is the control.
 */
const tee = { x: 1500, y: 2800 };
const treeWall: number[][] = [
  [1200, 2360],
  [1800, 2360],
  [1800, 2040],
  [1200, 2040]
];

function driveDistanceYd(hole: ReturnType<typeof openHole>): { yd: number; hitTrees: boolean } {
  const engine = new PhysicsEngine(hole, null, mulberry32(7));
  const out = engine.simulate({
    origin: { ...tee },
    aimAngle: -Math.PI / 2,
    swing: SWING_OF(0.98, 'perfect', 0),
    club: clubById('driver'),
    golfer: golferWith(80),
    fireBoost: 0,
    lie: 'tee',
    wind: NO_WIND,
    hole
  });
  const yd = Math.hypot(out.finalPos.x - tee.x, out.finalPos.y - tee.y) / PX_PER_YARD;
  return { yd, hitTrees: out.hitTrees };
}

describe('tree-in-fairway collision', () => {
  it('a ball into the trees is flagged and stops far short of an open drive', () => {
    const open = driveDistanceYd(openHole());
    const blocked = driveDistanceYd(openHole({ hazards: [{ type: 'trees', polygon: treeWall }] }));
    expect(open.hitTrees).toBe(false);
    expect(open.yd, `open drive ${open.yd.toFixed(0)}yd`).toBeGreaterThan(200);
    expect(blocked.hitTrees, 'blocked shot should register a tree strike').toBe(true);
    // The tree kills the carry: the ball drops well short of the open drive.
    expect(blocked.yd, `blocked ${blocked.yd.toFixed(0)}yd vs open ${open.yd.toFixed(0)}yd`).toBeLessThan(open.yd - 40);
  });
});
