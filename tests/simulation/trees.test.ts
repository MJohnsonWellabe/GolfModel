import { describe, expect, it } from 'vitest';
import { PX_PER_YARD, PHYSICS } from '../../src/config';
import { PhysicsEngine } from '../../src/systems/PhysicsEngine';
import { clubById } from '../../src/data/clubs';
import { mulberry32 } from '../../src/utils/Random';
import { golferWith, NO_WIND, openHole, PERFECT_SWING, SWING_OF } from './simHelpers';
import { collectTreeBlobs, hash2 } from '../../src/systems/treeField';
import { Hazard } from '../../src/core/types';

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

/**
 * keepGround trunks stop a ROLLING ball (Sable Bay regression). A `keepGround`
 * tree leaves the LIE to whatever surface is beneath it, so surfaceAt() never
 * returns 'trees' for it (Sable Bay's 17 palms are all keepGround, standing on
 * fairway/waste). The rolling-phase trunk check used to be gated on
 * `surf === 'trees'`, so a rolling ball was NEVER tested against those trunks
 * and rolled straight through every palm — while the ungated AIRBORNE check
 * worked fine. The fix calls nearTree()/inBuilding() DIRECTLY in the rolling
 * branch, exactly like the airborne one: keepGround affects only the lie, never
 * whether a trunk is solid. A pure putt is a rolling-only shot (z stays at
 * ground), so it exercises exactly that branch and nothing else.
 */
describe('keepGround trunks stop a rolling ball (Sable Bay palm regression)', () => {
  const putter = clubById('putter');
  const golfer = golferWith(85);
  const CARRY_PX = putter.baseDistance * (0.259 + (85 / 100) * 0.926) * 2;

  // A woods region wide/deep enough that its trunk radii sit fully INSIDE it —
  // like a real Sable Bay palm stand — so surfaceAt reports the underlying
  // surface across a keepGround stand (never 'trees'), yet the trunks must still
  // collide. Both keepGround and normal versions share the SAME trunk grid
  // (collectTreeBlobs ignores keepGround for placement).
  function woods(keepGround: boolean): Hazard {
    return {
      type: 'trees',
      keepGround,
      spacing: 60,
      treeR: 22,
      polygon: [
        [1420, 1780],
        [1580, 1780],
        [1580, 1440],
        [1420, 1440]
      ]
    };
  }

  // The trunk nearest the stand centre — roll the ball dead at it so a straight
  // putt is guaranteed to reach a real trunk (not thread the grid).
  const P = collectTreeBlobs(openHole({ hazards: [woods(true)] })).reduce((best, b) =>
    Math.hypot(b.x - 1500, b.y - 1600) < Math.hypot(best.x - 1500, best.y - 1600) ? b : best
  );
  const origin = { x: P.x, y: P.y + 500 }; // 500px straight below the trunk
  const power = ((origin.y - (P.y - 250)) * 1) / CARRY_PX; // armed to overrun the trunk by ~250px

  function rollPutt(hazards: Hazard[]): { finalY: number; hitTrees: boolean; surfAtP: string } {
    const hole = openHole({ hazards });
    const engine = new PhysicsEngine(hole, null, mulberry32(3));
    const out = engine.simulate({
      origin: { ...origin },
      aimAngle: -Math.PI / 2, // straight up-field, dead at the trunk P
      swing: PERFECT_SWING(power),
      club: putter,
      golfer,
      fireBoost: 0,
      lie: 'green',
      wind: NO_WIND,
      hole
    });
    return { finalY: out.finalPos.y, hitTrees: out.hitTrees, surfAtP: String(engine.surfaceAt(P.x, P.y)) };
  }

  it('no tree: the putt rolls well PAST the trunk line (control — the shot overruns P)', () => {
    const r = rollPutt([]);
    expect(r.hitTrees).toBe(false);
    // Rolls beyond P (smaller y = further up-field past the trunk at P.y).
    expect(r.finalY, `finalY ${r.finalY.toFixed(0)} should be well past P.y=${P.y.toFixed(0)}`).toBeLessThan(P.y - 40);
  });

  it('keepGround:true stand: surfaceAt is NOT trees there, yet the rolling ball is stopped AT/BEFORE P', () => {
    const control = rollPutt([]);
    const blocked = rollPutt([woods(true)]);
    // The bug's precondition: a keepGround stand never reports the 'trees' lie.
    expect(blocked.surfAtP, 'keepGround leaves the lie to the surface beneath').not.toBe('trees');
    expect(blocked.hitTrees, 'a keepGround trunk must register a rolling strike').toBe(true);
    // Stopped at/before the trunk: it never rolls through to the open-putt finish.
    expect(blocked.finalY, `blocked finalY ${blocked.finalY.toFixed(0)} vs P.y=${P.y.toFixed(0)}`).toBeGreaterThanOrEqual(
      P.y - PHYSICS.treeHeight // small creep past the trunk under damping is allowed
    );
    expect(blocked.finalY, `blocked ${blocked.finalY.toFixed(0)} vs open ${control.finalY.toFixed(0)}`).toBeGreaterThan(
      control.finalY + 40
    );
  });

  it('keepGround:false control: same stand reports the trees lie and also stops the roll (always worked)', () => {
    const blocked = rollPutt([woods(false)]);
    expect(blocked.surfAtP, 'a normal stand reports the trees lie').toBe('trees');
    expect(blocked.hitTrees, 'a normal trunk stops the roll too').toBe(true);
    expect(blocked.finalY, `finalY ${blocked.finalY.toFixed(0)}`).toBeGreaterThanOrEqual(P.y - PHYSICS.treeHeight);
  });
});

/**
 * Palm hitboxes (Hazard.palm / accentIsPalm): a real palm is bare trunk with
 * fronds only at the top, so it collides on two bands — a narrow trunk near
 * the ground, then open air, then the elevated canopy — instead of the usual
 * single flat band. Exercises PhysicsEngine.nearTree() directly (private,
 * cast via `as any`) at controlled heights, since crafting a real ballistic
 * arc that passes through an exact height band is far less precise than
 * asserting the geometry itself.
 */
describe('palm tree hitboxes — trunk + elevated canopy, gap between', () => {
  const CENTER = { x: 1500, y: 1500 };
  const TREE_R = 20;
  // Mirrors PHYSICS.palm* against the single specimen hazard below: H=40,
  // trunk band [0, 8.8], gap (8.8, 22), canopy band [22, 40].
  const H = Math.max(24, TREE_R * PHYSICS.palmHeightMult);
  const trunkTop = H * PHYSICS.palmTrunkTopFrac;
  const canopyBottom = H * PHYSICS.palmCanopyBottomFrac;

  function specimenHole(extra: Partial<Hazard>): ReturnType<typeof openHole> {
    // A polygon smaller than the default grid step collapses to exactly one
    // centroid trunk (treeField's specimen-fallback), so the trunk's position
    // and treeR are exactly what's authored — no grid jitter to account for.
    return openHole({
      hazards: [
        {
          type: 'trees',
          polygon: [
            [CENTER.x - 4, CENTER.y - 4],
            [CENTER.x + 4, CENTER.y - 4],
            [CENTER.x + 4, CENTER.y + 4],
            [CENTER.x - 4, CENTER.y + 4]
          ],
          treeR: TREE_R,
          ...extra
        }
      ]
    });
  }

  it('a palm trunk stops a ball near the ground, close to the trunk', () => {
    const engine = new PhysicsEngine(specimenHole({ palm: true }));
    // Well inside the narrow trunk radius (treeR * 0.3 ≈ 6, minus canopyMult).
    expect((engine as any).nearTree(CENTER.x + 3, CENTER.y, 0)).toBe(true);
    // Outside the trunk radius but well inside the OLD flat canopy radius —
    // ground level is below the canopy band, so this must NOT stop the ball.
    expect((engine as any).nearTree(CENTER.x + 12, CENTER.y, 0)).toBe(false);
  });

  it('a ball threading the gap band (above the trunk, below the canopy) is not stopped', () => {
    const engine = new PhysicsEngine(specimenHole({ palm: true }));
    const gapHeight = (trunkTop + canopyBottom) / 2;
    // Even close to the trunk's center horizontally, a height in the gap
    // clears — this is the entire point of a palm's silhouette.
    expect((engine as any).nearTree(CENTER.x + 5, CENTER.y, gapHeight)).toBe(false);
  });

  it('the elevated canopy still stops a ball at canopy height', () => {
    const engine = new PhysicsEngine(specimenHole({ palm: true }));
    const canopyHeight = H - 2;
    expect((engine as any).nearTree(CENTER.x + 10, CENTER.y, canopyHeight)).toBe(true);
    // Well outside the canopy radius, even at canopy height, clears.
    expect((engine as any).nearTree(CENTER.x + 100, CENTER.y, canopyHeight)).toBe(false);
  });

  it('the identical hazard WITHOUT palm:true keeps the old single flat band (gated by the flag, not the height math)', () => {
    const engine = new PhysicsEngine(specimenHole({}));
    const gapHeight = (trunkTop + canopyBottom) / 2;
    // A non-palm tree ignores height entirely — the same point that cleared
    // the palm's gap band still collides on the flat, single-band tree.
    expect((engine as any).nearTree(CENTER.x + 5, CENTER.y, gapHeight)).toBe(true);
  });

  it('collectTreeBlobs resolves a mixed accentIsPalm hazard per-trunk, matching course3d\'s render-time hash — not all-or-nothing', () => {
    const hazard: Hazard = {
      type: 'trees',
      accentChance: 0.7,
      accentIsPalm: true,
      spacing: 40,
      polygon: [
        [1000, 1000],
        [1400, 1000],
        [1400, 1400],
        [1000, 1400]
      ]
    };
    const blobs = collectTreeBlobs({ ...openHole(), hazards: [hazard] });
    expect(blobs.length).toBeGreaterThan(5);
    const palmCount = blobs.filter((b) => b.isPalm).length;
    // A mixed hazard must produce SOME of each — not every trunk the same way.
    expect(palmCount, 'expected a mix, not all-palm').toBeGreaterThan(0);
    expect(palmCount, 'expected a mix, not all-other').toBeLessThan(blobs.length);
    // Every blob's isPalm matches exactly what course3d's render-time roll
    // would compute for that same (x, y) — physics and rendering agree.
    for (const b of blobs) {
      const expected = hash2(b.x * 1.7, b.y * 0.9) < 0.7;
      expect(b.isPalm).toBe(expected);
    }
  });
});
