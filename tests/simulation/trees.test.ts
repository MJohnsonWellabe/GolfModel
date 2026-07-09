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

  it('stops a still-RISING ball that flies into a tree', () => {
    // A stand right in front of the tee: the ball is still climbing when it
    // reaches it and must be knocked down all the same (playtest FB9 — the old
    // engine only stopped descending balls, so low liners sailed through).
    const nearStand: number[][] = [
      [1430, 2740],
      [1570, 2740],
      [1570, 2660],
      [1430, 2660]
    ];
    const blocked = driveDistanceYd(openHole({ hazards: [{ type: 'trees', polygon: nearStand }] }));
    expect(blocked.hitTrees, 'a rising ball into the stand should register a strike').toBe(true);
    expect(blocked.yd, `rising-strike drive ${blocked.yd.toFixed(0)}yd`).toBeLessThan(140);
  });

  it('lets a ball THREAD a clear gap between trees', () => {
    // Two separate clumps with an open lane between them: a straight ball down
    // the lane flies on untouched — only balls that truly reach a tree stop,
    // because the hitbox is now the individual trunks, not the whole polygon.
    const leftClump: number[][] = [
      [1330, 2360],
      [1410, 2360],
      [1410, 2040],
      [1330, 2040]
    ];
    const rightClump: number[][] = [
      [1590, 2360],
      [1670, 2360],
      [1670, 2040],
      [1590, 2040]
    ];
    const threaded = driveDistanceYd(
      openHole({ hazards: [{ type: 'trees', polygon: leftClump }, { type: 'trees', polygon: rightClump }] })
    );
    expect(threaded.hitTrees, 'a ball down the open lane should NOT hit a tree').toBe(false);
    expect(threaded.yd, `threaded drive ${threaded.yd.toFixed(0)}yd`).toBeGreaterThan(200);
  });
});
